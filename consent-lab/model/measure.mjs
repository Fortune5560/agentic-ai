#!/usr/bin/env node
/* ============================================================================
   measure.mjs — run the consent-extraction task against a LOCAL model and write
   down what actually happened.

   This is the honesty layer of the project. The point is not to show a good
   number; it is to produce a number someone else can re-run, on hardware you can
   name, with the failures quoted in full.

   Nothing here calls a hosted API. It talks to a local Ollama instance, and if
   there is no network the task still works (that is the whole argument).

   Usage
     node consent-lab/model/measure.mjs --dry-run
     node consent-lab/model/measure.mjs --model qwen2.5:3b
     node consent-lab/model/measure.mjs --model qwen2.5:7b --limit 5 --out model/results/qwen7b.json
     node consent-lab/model/measure.mjs --model qwen2.5:3b --fail-under 0.8

   Exit codes
     0  the run completed (whatever the accuracy was)
     1  configuration problem — Ollama unreachable, model not pulled, key invalid
     2  --fail-under was set and accuracy came in below it

   What is measured, and what is not
     measured   : wall time, model tokens/sec, peak RAM drop on this machine,
                  exact-match accuracy against a 20-item answer key written
                  before any output was seen, and every wrong answer verbatim.
     not measured: quality on real clinical notes (all notes here are synthetic),
                  performance on a phone, or behaviour with a different prompt.
   ========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { cpus, totalmem, platform, release, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalise, scoreItem, summarise, pct, FIELDS } from './score.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ args --- */
function parseArgs(argv) {
  const args = {
    model: null,
    base: 'http://127.0.0.1:11434',
    out: null,
    limit: null,
    timeout: 180000,
    failUnder: null,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--base') args.base = argv[++i].replace(/\/$/, '');
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--timeout') args.timeout = Number(argv[++i]) * 1000;
    else if (a === '--fail-under') args.failUnder = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('See the header of consent-lab/model/measure.mjs for usage.');
      process.exit(0);
    } else {
      console.error('Unknown argument: ' + a);
      process.exit(1);
    }
  }
  return args;
}

/* ----------------------------------------------------------------- input --- */
function loadInputs() {
  const promptPath = path.join(HERE, 'prompt.md');
  const keyPath = path.join(HERE, 'answer-key.json');
  if (!existsSync(promptPath)) fail('Missing ' + promptPath);
  if (!existsSync(keyPath)) fail('Missing ' + keyPath);
  const template = readFileSync(promptPath, 'utf8');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));

  const problems = validateKey(key);
  if (problems.length) {
    fail('answer-key.json is invalid:\n  - ' + problems.join('\n  - '));
  }
  return { template, key };
}

export function validateKey(key) {
  const problems = [];
  if (!Array.isArray(key.items) || key.items.length !== 20) {
    problems.push('expected exactly 20 items, found ' + (Array.isArray(key.items) ? key.items.length : 0));
  }
  const ids = new Set();
  const reasons = new Set();
  for (const item of key.items || []) {
    if (!item.id) problems.push('an item is missing an id');
    if (ids.has(item.id)) problems.push('duplicate id ' + item.id);
    ids.add(item.id);
    if (!item.note || item.note.trim().length < 20) problems.push(item.id + ' has no usable note');
    const e = item.expect || {};
    for (const field of FIELDS) {
      if (!(field in e)) problems.push(item.id + ' is missing expect.' + field);
    }
    if (e.decision !== 'accept' && e.decision !== 'reject') {
      problems.push(item.id + ' has an invalid decision');
    }
    if (e.decision === 'reject' && !e.reject_reason) {
      problems.push(item.id + ' rejects without a reject_reason');
    }
    if (e.decision === 'accept' && e.reject_reason) {
      problems.push(item.id + ' accepts but also carries a reject_reason');
    }
    if (e.reject_reason) reasons.add(e.reject_reason);
  }
  // Every reason in the policy should be exercised, or the key is not covering it.
  for (const reason of key.policy?.reject_reasons || []) {
    if (!reasons.has(reason)) problems.push('no item exercises reject_reason "' + reason + '"');
  }
  return problems;
}

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

/* --------------------------------------------------------------- machine --- */
function memAvailableBytes() {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+) kB/.exec(meminfo);
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function machineFacts() {
  const mem = memAvailableBytes();
  return {
    host: hostname(),
    platform: platform(),
    release: release(),
    cpu: cpus()[0]?.model?.trim() || 'unknown',
    cpuCount: cpus().length,
    totalRamGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    availableRamGb: mem ? Math.round((mem / 1024 ** 3) * 10) / 10 : null,
    node: process.version
  };
}

async function ollamaGet(base, route, timeout = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(base + route, { signal: controller.signal });
    if (!res.ok) throw new Error(route + ' returned ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function preflight(args) {
  let version;
  try {
    version = await ollamaGet(args.base, '/api/version');
  } catch (err) {
    fail(
      'Could not reach Ollama at ' + args.base + ' (' + err.message + ').\n\n' +
      '  Start it:      ollama serve\n' +
      '  Pull a model:  ollama pull qwen2.5:3b\n' +
      '  Then re-run:   node consent-lab/model/measure.mjs --model qwen2.5:3b\n\n' +
      'This harness deliberately does not fall back to a hosted API.'
    );
  }

  const tags = await ollamaGet(args.base, '/api/tags');
  const installed = (tags.models || []).map((m) => m.name);
  if (!args.model) {
    fail(
      'No --model given. Installed models:\n  ' +
      (installed.length ? installed.join('\n  ') : '(none — run: ollama pull qwen2.5:3b)')
    );
  }
  const matched = installed.find((n) => n === args.model || n.startsWith(args.model + ':'));
  if (!matched) {
    fail(
      'Model "' + args.model + '" is not installed.\n\nInstalled:\n  ' +
      (installed.length ? installed.join('\n  ') : '(none)') +
      '\n\nPull it with:  ollama pull ' + args.model
    );
  }
  return { version: version.version || 'unknown', resolvedModel: matched, installed };
}

/* ------------------------------------------------------------------ run --- */
async function generate(args, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeout);
  const started = Date.now();
  try {
    const res = await fetch(args.base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        // JSON mode keeps the comparison fair; the prompt still asks for JSON.
        format: 'json',
        options: { temperature: 0, seed: 42, num_predict: 220, num_ctx: 2048 }
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + (await res.text()).slice(0, 200));
    const body = await res.json();
    const wallMs = Date.now() - started;
    const evalNs = Number(body.eval_duration) || 0;
    const promptNs = Number(body.prompt_eval_duration) || 0;
    return {
      ok: true,
      wallMs,
      response: body.response || '',
      modelEvalCount: Number(body.eval_count) || 0,
      tokensPerSecond: evalNs > 0 ? (Number(body.eval_count) || 0) / (evalNs / 1e9) : null,
      promptTokensPerSecond: promptNs > 0 ? (Number(body.prompt_eval_count) || 0) / (promptNs / 1e9) : null,
      loadMs: body.load_duration ? Math.round(body.load_duration / 1e6) : null,
      doneReason: body.done_reason || null
    };
  } catch (err) {
    return { ok: false, wallMs: Date.now() - started, error: err.name === 'AbortError' ? 'timed out after ' + args.timeout / 1000 + 's' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through to a brace hunt */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch { return null; }
  }
  return null;
}

/* ----------------------------------------------------------------- main --- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { template, key } = loadInputs();
  const items = args.limit ? key.items.slice(0, args.limit) : key.items;

  if (args.dryRun) {
    console.log('\nConsent model harness — dry run');
    console.log('='.repeat(64));
    console.log('Answer key      : ' + key.items.length + ' items, ' + new Set(key.items.map((i) => i.expect.reject_reason || 'accept')).size + ' outcomes');
    console.log('Prompt          : ' + (template.length > 0 ? 'loaded (' + template.split(/\s+/).length + ' words)' : 'EMPTY'));
    console.log('Scorer fields   : ' + FIELDS.join(', '));
    console.log('Ollama endpoint : ' + args.base + ' (not contacted in a dry run)');
    console.log('Machine         : ' + JSON.stringify(machineFacts()));
    console.log('-'.repeat(64));
    console.log('RESULT: PASS — key and prompt are valid; nothing was run.\n');
    return 0;
  }

  const pre = await preflight(args);
  const facts = machineFacts();
  const startedAt = new Date().toISOString();

  console.log('\nConsent model harness');
  console.log('='.repeat(72));
  console.log('Model      : ' + pre.resolvedModel + ' (Ollama ' + pre.version + ')');
  console.log('Machine    : ' + facts.cpu + ' · ' + facts.cpuCount + ' threads · ' + facts.totalRamGb + ' GB RAM');
  console.log('Items      : ' + items.length + ' of ' + key.items.length);
  console.log('-'.repeat(72));

  // Sample available memory while the model works, so the number is observed
  // rather than taken from a spec sheet.
  const baselineMem = memAvailableBytes();
  let lowestMem = baselineMem;
  const sampler = baselineMem ? setInterval(() => {
    const m = memAvailableBytes();
    if (m && (lowestMem === null || m < lowestMem)) lowestMem = m;
  }, 250) : null;

  const rows = [];
  for (const item of items) {
    const prompt = template.replace('{{NOTE}}', item.note);
    const gen = await generate(args, pre.resolvedModel, prompt);
    const parsed = gen.ok ? extractJson(gen.response) : null;
    const score = scoreItem(item.expect, parsed || {});
    rows.push({
      id: item.id,
      ok: gen.ok,
      error: gen.error || null,
      parseError: gen.ok && !parsed ? 'response was not JSON' : null,
      raw: gen.ok ? gen.response.slice(0, 400) : null,
      normalised: parsed ? normalise(parsed) : null,
      tokensPerSecond: gen.tokensPerSecond,
      wallMs: gen.wallMs,
      score
    });
    const mark = score.ok ? 'ok  ' : 'FAIL';
    const tps = gen.tokensPerSecond ? gen.tokensPerSecond.toFixed(1) + ' tok/s' : '—';
    console.log('  ' + mark + '  ' + item.id + '  ' + String(gen.wallMs).padStart(6) + ' ms  ' + tps);
  }

  if (sampler) clearInterval(sampler);

  const summary = summarise(rows);
  const tpsValues = rows.map((r) => r.tokensPerSecond).filter((v) => Number.isFinite(v));
  const meanTps = tpsValues.length ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : null;
  const peakDropMb = baselineMem && lowestMem ? Math.round((baselineMem - lowestMem) / 1024 / 1024) : null;

  let modelFootprint = null;
  try {
    const ps = await ollamaGet(args.base, '/api/ps');
    const loaded = (ps.models || []).find((m) => m.name === pre.resolvedModel || m.model === pre.resolvedModel);
    if (loaded) {
      modelFootprint = {
        sizeBytes: loaded.size ?? null,
        sizeVramBytes: loaded.size_vram ?? null,
        sizeGb: loaded.size ? Math.round((loaded.size / 1024 ** 3) * 10) / 10 : null,
        vramGb: loaded.size_vram ? Math.round((loaded.size_vram / 1024 ** 3) * 10) / 10 : null,
        parameterSize: loaded.details?.parameter_size || null,
        quantization: loaded.details?.quantization_level || null
      };
    }
  } catch { /* /api/ps is best-effort */ }

  const report = {
    generatedAt: new Date().toISOString(),
    startedAt,
    finishedAt: new Date().toISOString(),
    model: {
      name: pre.resolvedModel,
      ollama: pre.version,
      ...modelFootprint
    },
    machine: facts,
    run: {
      items: items.length,
      promptWords: template.split(/\s+/).length,
      temperature: 0,
      seed: 42,
      jsonMode: true,
      meanTokensPerSecond: meanTps,
      slowestItemMs: Math.max(...rows.map((r) => r.wallMs)),
      peakRamDropMb: peakDropMb,
      totalWallSeconds: Math.round(rows.reduce((a, r) => a + r.wallMs, 0) / 1000)
    },
    summary: {
      correct: summary.correct,
      items: summary.items,
      accuracy: summary.accuracy,
      perFieldAccuracy: summary.perFieldAccuracy,
      unsafeAccepts: summary.unsafeAccepts,
      unparseable: summary.unparseable
    },
    failures: summary.failures,
    items: rows.map((r) => ({
      id: r.id,
      ok: r.ok,
      error: r.error,
      parseError: r.parseError,
      raw: r.raw,
      tokensPerSecond: r.tokensPerSecond,
      wallMs: r.wallMs,
      expected: r.score.expected,
      actual: r.score.actual,
      wrongFields: FIELDS.filter((f) => !r.score.fields[f])
    }))
  };

  const outPath = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.join(HERE, 'results', pre.resolvedModel.replace(/[^a-z0-9.-]+/gi, '-') + '.json');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log('-'.repeat(72));
  console.log('Exact-match accuracy : ' + summary.correct + '/' + summary.items + ' (' + pct(summary.accuracy) + '%)');
  console.log('Unsafe accepts       : ' + summary.unsafeAccepts + '  (policy said reject, model said accept)');
  console.log('Unparseable outputs  : ' + summary.unparseable);
  console.log('Mean speed           : ' + (meanTps ? meanTps.toFixed(1) + ' tok/s' : 'n/a'));
  console.log('Peak RAM drop        : ' + (peakDropMb === null ? 'n/a' : peakDropMb + ' MB'));
  console.log('Per-field accuracy   :');
  for (const [field, value] of Object.entries(summary.perFieldAccuracy)) {
    console.log('  ' + field.padEnd(24) + pct(value) + '%');
  }

  if (summary.failures.length) {
    console.log('\nFailures, verbatim:');
    for (const f of summary.failures) {
      console.log('  ' + f.id + '  wrong: ' + f.wrongFields.join(', '));
      console.log('      expected: ' + JSON.stringify(pick(f.expected, f.wrongFields)));
      console.log('      actual  : ' + JSON.stringify(pick(f.actual, f.wrongFields)));
      if (f.parseError) console.log('      parse   : ' + f.parseError + ' — raw: ' + String(f.raw).slice(0, 160));
    }
  }

  console.log('-'.repeat(72));
  console.log('Report written to ' + outPath);
  console.log('Publish it as-is. A model that scores 14/20 with two unsafe accepts is a');
  console.log('finding; the same model described as "works well" is a liability.\n');

  if (args.failUnder !== null && summary.accuracy < args.failUnder) {
    console.error('Accuracy ' + pct(summary.accuracy) + '% is below --fail-under ' + pct(args.failUnder) + '%');
    return 2;
  }
  return 0;
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) out[f] = obj[f];
  return out;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('\nHarness error: ' + (err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
