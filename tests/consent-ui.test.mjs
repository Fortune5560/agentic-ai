/* ============================================================================
   consent-ui.test.mjs — drives the consent-lab page in a real DOM.

   The engine tests prove the rules. These prove the page is actually wired to
   them: that clicking the buttons produces the refusals and the audit entries
   the engine promised, and that nothing on the page decides anything itself.

   Run with: node --test tests/consent-ui.test.mjs
   ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The page needs a document, a matchMedia stub (jsdom has none) and SubtleCrypto
   (jsdom ships getRandomValues but not the WebCrypto interface). */
async function boot() {
  const html = fs.readFileSync(path.join(ROOT, 'consent-lab/index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://fortune5560.github.io/agentic-ai/consent-lab/',
    pretendToBeVisual: true
  });
  const { window } = dom;

  window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {}
  });
  if (!window.crypto.subtle) {
    Object.defineProperty(window.crypto, 'subtle', {
      value: globalThis.crypto.subtle,
      configurable: true
    });
  }

  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));

  for (const rel of ['site.js', 'consent-lab/consent-engine.js', 'consent-lab/consent-lab.js']) {
    window.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  }

  // Wait for the page's own DOMContentLoaded rather than faking one: a second
  // init() would rebind the handlers.
  if (window.document.readyState === 'loading') {
    await new Promise((resolve) =>
      window.document.addEventListener('DOMContentLoaded', resolve, { once: true })
    );
  }

  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const text = (id) => $(id).textContent;

  const fire = (id, type = 'click') =>
    $(id).dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));

  const submit = async () => {
    fire('consent-form', 'submit');
    await settle();
  };

  // Submit handlers are async: yield to the microtask/timer queue.
  const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

  const setField = (id, value) => {
    $(id).value = value;
  };

  return { dom, window, doc, $, text, fire, submit, settle, setField, errors };
}

test('the guardrail table renders every code the page claims to show', async () => {
  const { doc, text } = await boot();
  const rows = doc.querySelectorAll('#rule-rows tr');
  assert.ok(rows.length >= 12, `expected the rules table to be filled, got ${rows.length} rows`);

  const table = doc.getElementById('rule-rows').textContent;
  for (const code of ['no_expiry', 'expiry_too_long', 'contact_detail_present', 'revoked']) {
    assert.ok(table.includes(code), `rules table is missing ${code}`);
  }
  assert.match(text('record-view'), /No record yet/);
});

test('a well-formed draft is recorded, sealed and logged', async () => {
  const { $, text, submit, doc } = await boot();
  await submit();

  assert.match(text('verdict-headline'), /^Recorded/);
  assert.ok($('verdict').className.includes('decision-ok'), 'verdict card should read as accepted');

  const record = text('record-view');
  assert.match(record, /participant\s+PT-014/);
  assert.match(record, /status\s+active/);

  const sealed = text('sealed-view');
  assert.match(sealed, /ciphertext/);
  assert.ok(
    !/exam stress|counselling/i.test(sealed),
    'the sealed blob must not leak the note in plaintext'
  );

  assert.ok(doc.querySelectorAll('#audit-log li').length >= 1, 'recording must be logged');
});

test('reading is allowed, logged, and refused once the record is withdrawn', async () => {
  const { $, text, fire, submit, settle, doc } = await boot();
  await submit();

  fire('read-btn');
  await settle();
  assert.match(text('action-status'), /Read by/);

  const afterRead = doc.querySelectorAll('#audit-log li').length;
  assert.ok(afterRead >= 2, 'a read must append its own audit entry');

  fire('revoke-btn');
  await settle();
  assert.match(text('verdict-headline'), /Withdrawn/);
  assert.match(text('record-view'), /\(cleared\)/, 'withdrawal must clear the payload');

  fire('read-btn');
  await settle();
  assert.match(text('action-status'), /Refused/);
});

test('an export with no named recipient is refused, and a named one is logged', async () => {
  const { text, fire, submit, settle, setField, doc } = await boot();
  await submit();

  setField('recipient', '');
  fire('export-btn');
  await settle();
  assert.match(text('action-status'), /Refused/);
  assert.match(doc.getElementById('audit-log').textContent, /export\.refused/);

  setField('recipient', 'Dr Bello, primary care');
  fire('export-btn');
  await settle();
  assert.match(text('action-status'), /Exported to Dr Bello/);
});

test('the audit chain verifies, and tampering breaks it at a named entry', async () => {
  const { text, fire, submit, settle } = await boot();
  await submit();

  fire('read-btn');
  await settle();

  fire('verify-btn');
  await settle();
  assert.match(text('verify-status'), /Chain intact/);

  fire('tamper-btn');
  await settle();
  fire('verify-btn');
  await settle();
  assert.match(text('verify-status'), /Chain broken at entry \d+/);
});

test('the sealed record opens with the right passphrase and not with a wrong one', async () => {
  const { $, text, fire, submit, settle, setField } = await boot();
  await submit();

  fire('unlock-btn');
  await settle(500);
  assert.match(text('unlock-status'), /Opened/);

  setField('passphrase', 'not the passphrase');
  fire('unlock-btn');
  await settle(500);
  assert.match(text('unlock-status'), /cannot be opened/);
});

test('invalid drafts are refused with the engine rule named on the card', async () => {
  const { $, text, submit, settle, setField } = await boot();

  // 36 months is past the 24-month maximum.
  setField('consentMonths', '36');
  await submit();
  assert.match(text('verdict-headline'), /^Refused/);
  assert.match(text('verdict-facts'), /expiry_too_long/);
  assert.ok($('verdict').className.includes('decision-bad'));

  // A phone number in the note is a data-minimisation breach.
  setField('consentMonths', '6');
  setField('notes', 'Call 0803 123 4567 and ask for me.');
  await submit();
  assert.match(text('verdict-facts'), /contact_detail_present/);

  assert.match(text('record-view'), /No record yet/, 'a refused draft must not leave a record behind');
});

test('Yorùbá is announced as a draft translation, and is still accepted', async () => {
  const { $, text, fire, submit, settle } = await boot();

  $('language').value = 'yo';
  fire('language', 'change');
  assert.match(text('verdict-reason'), /draft/);

  await submit();
  assert.match(text('verdict-headline'), /^Recorded/);
  assert.match(text('verdict-reason'), /draft translation/);
});

test('the page never claims a model result it does not have', async () => {
  const { doc } = await boot();
  const body = doc.body.textContent.replace(/\s+/g, ' ');
  assert.match(body, /no model has been run/i);
});

test('loading the page raises no errors', async () => {
  const { errors, submit, fire, settle } = await boot();
  await submit();
  fire('verify-btn');
  await settle();
  assert.deepEqual(errors, []);
});
