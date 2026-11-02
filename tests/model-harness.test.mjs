import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FIELDS, normalise, scoreItem, summarise, pct } from '../consent-lab/model/score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const harness = path.join(root, 'consent-lab', 'model', 'measure.mjs');
const keyPath = path.join(root, 'consent-lab', 'model', 'answer-key.json');
const promptPath = path.join(root, 'consent-lab', 'model', 'prompt.md');

const key = JSON.parse(readFileSync(keyPath, 'utf8'));

/* -------------------------------------------------------------- the inputs */

test('the answer key has 20 unique items with every field present', () => {
  assert.equal(key.items.length, 20);
  const ids = new Set(key.items.map((i) => i.id));
  assert.equal(ids.size, 20);
  for (const item of key.items) {
    assert.ok(item.note.length > 20, item.id + ' note is too short to be a task');
    for (const field of FIELDS) assert.ok(field in item.expect, item.id + ' missing ' + field);
  }
});

test('every reject reason in the policy is exercised by an item', () => {
  const covered = new Set(key.items.filter((i) => i.expect.reject_reason).map((i) => i.expect.reject_reason));
  for (const reason of key.policy.reject_reasons) {
    assert.ok(covered.has(reason), 'no item exercises ' + reason);
  }
  assert.ok(key.items.some((i) => i.expect.decision === 'accept'), 'no accept case');
  assert.ok(key.items.some((i) => i.expect.decision === 'reject'), 'no reject case');
});

test('the prompt asks for JSON and contains the substitution slot', () => {
  const prompt = readFileSync(promptPath, 'utf8');
  assert.match(prompt, /\{\{NOTE\}\}/);
  assert.match(prompt, /JSON/);
  for (const field of FIELDS) assert.ok(prompt.includes(field), 'prompt never mentions ' + field);
});

test('the key is consistent with the engine policy', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const engine = require('../consent-lab/consent-engine.js');
  assert.equal(key.policy.max_consent_months, engine.POLICY.maxConsentMonths);
  assert.equal(key.policy.min_age, engine.POLICY.minAge);
  assert.deepEqual(key.policy.languages, engine.POLICY.supportedLanguages);
  assert.deepEqual(key.policy.scopes.slice().sort(), engine.SCOPES.slice().sort());
});

/* ------------------------------------------------------------- the scoring */

const expect = {
  decision: 'reject', reject_reason: 'no_expiry', consent_months: null,
  scopes: ['assessment', 'referral'], language: 'en',
  witness_required: true, contains_contact_details: false
};

test('a perfect answer scores every field', () => {
  const s = scoreItem(expect, {
    decision: 'REJECT', reject_reason: ' No_Expiry ', consent_months: null,
    scopes: ['referral', 'assessment'], language: 'EN',
    witness_required: true, contains_contact_details: false
  });
  assert.equal(s.ok, true);
  assert.equal(s.matched, FIELDS.length);
});

test('scopes are compared as a set, not as an order', () => {
  const reversed = { ...expect, scopes: ['referral', 'assessment'] };
  assert.equal(scoreItem(expect, reversed).fields.scopes, true);
  assert.equal(scoreItem(expect, { ...reversed, scopes: ['referral'] }).fields.scopes, false);
});

test('a missing decision is a failure, not a pass', () => {
  const s = scoreItem(expect, {});
  assert.equal(s.ok, false);
  assert.equal(s.fields.decision, false);
  assert.equal(s.fields.reject_reason, false);
  // A blank "actual" still matches the fields whose expected value is falsy
  // (null months, false contact-details) — which is exactly why the decision
  // field has to gate the item.
  assert.ok(s.matched < FIELDS.length);
});

test('summarise counts unsafe accepts separately', () => {
  const rows = [
    { id: 'A', score: scoreItem({ ...expect, decision: 'reject' }, { ...expect, decision: 'accept', reject_reason: '' }) },
    { id: 'B', score: scoreItem(expect, expect) },
    { id: 'C', score: scoreItem(expect, expect), parseError: 'response was not JSON' }
  ];
  const s = summarise(rows);
  assert.equal(s.items, 3);
  assert.equal(s.correct, 2);
  assert.equal(s.unsafeAccepts, 1);
  assert.equal(s.unparseable, 1);
  assert.equal(pct(s.accuracy), 66.7);
  assert.equal(s.failures.length, 1);
});

test('normalise coerces the shapes models actually emit', () => {
  const n = normalise({ decision: 'Accept', consent_months: '6', scopes: 'assessment', witness_required: 'true' });
  assert.equal(n.decision, 'accept');
  assert.equal(n.consent_months, 6);
  assert.deepEqual(n.scopes, []);
  assert.equal(n.witness_required, true);
});

/* ------------------------------------------------------------- the harness */

test('the harness dry run passes without a model', () => {
  const res = spawnSync(process.execPath, [harness, '--dry-run'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /RESULT: PASS/);
  assert.match(res.stdout, /20 items/);
});

test('the harness fails clearly when Ollama is not running', () => {
  const res = spawnSync(
    process.execPath,
    [harness, '--model', 'qwen2.5:3b', '--base', 'http://127.0.0.1:9'],
    { encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Could not reach Ollama/);
  assert.match(res.stderr, /does not fall back to a hosted API/);
});

test('the harness rejects an unknown argument instead of guessing', () => {
  const res = spawnSync(process.execPath, [harness, '--nonsense'], { encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Unknown argument/);
});
