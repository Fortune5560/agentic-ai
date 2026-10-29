/* UI-level tests for the sandbox page.
   The site itself ships with zero dependencies; jsdom is a dev dependency used
   only to exercise demo.js the way a browser would.

   Run:  npm install && npm run test:ui
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function loadDemo() {
  const dom = new JSDOM(read('demo/index.html'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  // jsdom has no matchMedia; site.js only reads it.
  window.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {}
  });

  const errors = [];
  window.console.error = (...args) => errors.push(args.join(' '));

  window.eval(read('site.js'));
  window.eval(read('demo/ops-agent-engine.js'));
  window.eval(read('demo/demo.js'));

  // demo.js waits for DOMContentLoaded, which fires on a later tick.
  await new Promise((resolve) => setTimeout(resolve, 60));
  return { window, document: window.document, errors };
}

test('the sandbox renders the full suite on load', async () => {
  const { document } = await loadDemo();

  const rows = document.querySelectorAll('#suite-rows tr');
  assert.equal(rows.length, 14, 'one table row per scenario');

  const metrics = document.querySelectorAll('#suite-metrics .metric');
  assert.equal(metrics.length, 6, 'six result tiles');

  const text = [...metrics].map((m) => m.textContent).join(' | ');
  assert.match(text, /14\/14/, 'accuracy is reported from the engine output');
  assert.match(text, /Unsafe executions/, 'unsafe executions are surfaced');
  assert.match(document.getElementById('suite-status').textContent, /14\/14/,
    'the status line states the measured result');
});

test('the decision card and audit trail render for the default incident', async () => {
  const { document } = await loadDemo();

  const card = document.getElementById('decision-card');
  assert.ok(card.textContent.trim().length > 20, 'card is populated');
  assert.match(card.textContent, /Auto-resolved|Escalated/);
  assert.ok(document.querySelectorAll('#audit li').length >= 4, 'audit trail has steps');
});

test('raising the blast radius forces an escalation and names the guard', async () => {
  const { window, document } = await loadDemo();

  const affected = document.getElementById('affectedUsers');
  affected.value = '50000';
  affected.dispatchEvent(new window.Event('input', { bubbles: true }));

  const card = document.getElementById('decision-card').textContent;
  assert.match(card, /Escalated/);
  assert.match(card, /blast-radius cap/, 'the guard that fired is named');
});

test('a destructive free-text instruction is blocked', async () => {
  const { window, document } = await loadDemo();

  const input = document.getElementById('requestedAction');
  input.value = 'delete old orders';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  const card = document.getElementById('decision-card').textContent;
  assert.match(card, /Escalated/);
  assert.match(card, /blocklist/);
});

test('switching symptom reconfigures the signal-specific control', async () => {
  const { window, document } = await loadDemo();
  const symptom = document.getElementById('symptom');

  symptom.value = 'worker_backlog';
  symptom.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match(document.querySelector('label[for="extra"]').textContent, /Queue depth/);
  assert.equal(document.getElementById('extra').disabled, false);

  symptom.value = 'http_5xx_spike';
  symptom.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(document.getElementById('extra').disabled, true);
});

test('re-running the suite works and produces no console errors', async () => {
  const { window, document, errors } = await loadDemo();

  const button = document.getElementById('run-suite');
  button.dispatchEvent(new window.Event('click'));
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(button.textContent, 'Run again');
  assert.equal(document.querySelectorAll('#suite-rows tr').length, 14);
  assert.deepEqual(errors, []);
});
