import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const engine = require('../consent-lab/consent-engine.js');

const NOW = engine.NOW;
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'consent-lab', 'consent-engine.js');

const validDraft = (over = {}) => Object.assign({
  participantRef: 'PT-021',
  age: 24,
  language: 'en',
  scopes: ['assessment'],
  consentMonths: 6,
  witness: 'Community health worker',
  guardian: '',
  selfConsent: false,
  purpose: 'review before referral',
  notes: 'Sleep and exam stress.',
  statementsConfirmed: engine.STATEMENT_KEYS.slice()
}, over);

/* ---------------------------------------------------------------- answer key */

test('the engine matches the 24-case answer key', () => {
  const report = engine.runKey();
  const failures = report.runs.filter((r) => !r.pass)
    .map((r) => `${r.id} (${r.intent}): expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
  assert.equal(report.failed, 0, failures.join('\n'));
  assert.equal(report.total, 24);
});

test('the answer key covers every guardrail code the engine can emit', () => {
  const keyed = new Set(engine.ANSWER_KEY.flatMap((c) => c.expect.codes || []));
  for (const code of ['no_expiry', 'expiry_too_long', 'no_scope', 'unsupported_language',
    'statements_not_confirmed', 'no_witness', 'minor_without_guardian', 'minor_self_consent',
    'purpose_thin', 'contact_detail_present', 'no_participant_ref']) {
    assert.ok(keyed.has(code), 'answer key has no case for ' + code);
  }
});

/* ------------------------------------------------------------------- records */

test('a valid draft produces a record with a computed expiry', () => {
  const { ok, record } = engine.createRecord(validDraft(), { now: NOW, id: 'CR-TEST-1' });
  assert.equal(ok, true);
  assert.equal(record.id, 'CR-TEST-1');
  assert.equal(record.status, 'active');
  assert.equal(record.expiresAt, engine.addMonths(NOW, 6));
  assert.equal(record.capturedAt, NOW);
});

test('the consent statements are stored in the language they were read in', () => {
  const en = engine.createRecord(validDraft({ language: 'en' }), { now: NOW }).record;
  const yo = engine.createRecord(validDraft({ language: 'yo' }), { now: NOW }).record;
  assert.equal(en.statements.length, engine.STATEMENT_KEYS.length);
  assert.equal(yo.statements[0].language, 'yo');
  assert.notEqual(en.statements[0].text, yo.statements[0].text);
  assert.equal(yo.statements[0].text, engine.STATEMENTS.yo.storage);
});

test('the Yoruba translation is labelled as a draft, in the data', () => {
  // Honesty as a testable fact rather than a paragraph on a page.
  assert.equal(engine.STATEMENTS.yo.status, 'draft');
  assert.equal(engine.STATEMENTS.en.status, 'reviewed-english');
  assert.deepEqual(Object.keys(engine.STATEMENTS.en).sort(), Object.keys(engine.STATEMENTS.yo).sort());
});

test('identical input and clock give an identical record', () => {
  const a = engine.createRecord(validDraft(), { now: NOW, id: 'X' }).record;
  const b = engine.createRecord(validDraft(), { now: NOW, id: 'X' }).record;
  assert.equal(engine.canonical(a), engine.canonical(b));
});

/* ------------------------------------------------------------------ reading */

test('reading needs a stated purpose and a role', () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });
  const noPurpose = engine.openRecord(record, { actor: 'nurse' }, { now: NOW });
  assert.equal(noPurpose.ok, false);
  assert.deepEqual(noPurpose.errors.map((e) => e.code), ['no_purpose']);

  const noActor = engine.openRecord(record, { purpose: 'review before referral' }, { now: NOW });
  assert.deepEqual(noActor.errors.map((e) => e.code), ['no_actor']);

  const good = engine.openRecord(record, { actor: 'nurse', purpose: 'review before referral' }, { now: NOW });
  assert.equal(good.ok, true);
  assert.equal(good.record.participantRef, 'PT-021');
});

test('an expired consent cannot be read', () => {
  const { record } = engine.createRecord(validDraft({ consentMonths: 1 }), { now: NOW });
  const later = new Date(Date.parse(NOW) + 40 * 24 * 3600 * 1000).toISOString();
  const res = engine.openRecord(record, { actor: 'nurse', purpose: 'review before referral' }, { now: later });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map((e) => e.code), ['expired']);
});

test('a withdrawn consent cannot be read, exported, or withdrawn twice', () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });
  const revoked = engine.revokeRecord(record, { reason: 'participant asked' }, { now: NOW });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.record.status, 'revoked');
  assert.equal(revoked.record.notes, '', 'the payload must be gone');
  assert.deepEqual(revoked.record.scopes, []);
  assert.equal(revoked.record.revokeReason, 'participant asked');

  const read = engine.openRecord(revoked.record, { actor: 'nurse', purpose: 'review before referral' }, { now: NOW });
  assert.deepEqual(read.errors.map((e) => e.code), ['revoked']);
  const exported = engine.exportRecord(revoked.record, { recipient: 'clinic', purpose: 'review before referral' }, { now: NOW });
  assert.deepEqual(exported.errors.map((e) => e.code), ['revoked']);
  const again = engine.revokeRecord(revoked.record, { reason: 'participant asked' }, { now: NOW });
  assert.deepEqual(again.errors.map((e) => e.code), ['already_revoked']);
});

test('withdrawal needs a reason', () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });
  const res = engine.revokeRecord(record, { reason: '' }, { now: NOW });
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.map((e) => e.code), ['no_reason']);
});

/* ------------------------------------------------------------------ export */

test('export requires a named recipient, a purpose and a consented scope', () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });

  const noRecipient = engine.exportRecord(record, { purpose: 'review before referral' }, { now: NOW });
  assert.deepEqual(noRecipient.errors.map((e) => e.code), ['no_recipient']);

  const outsideScope = engine.exportRecord(
    record,
    { recipient: 'State hospital', purpose: 'review before referral', scopes: ['counselling_notes'] },
    { now: NOW }
  );
  assert.deepEqual(outsideScope.errors.map((e) => e.code), ['scope_not_consented']);

  const good = engine.exportRecord(
    record,
    { recipient: 'State hospital', purpose: 'review before referral' },
    { now: NOW }
  );
  assert.equal(good.ok, true);
  assert.equal(good.payload.recipient, 'State hospital');
  assert.equal(good.payload.consentExpiresAt, record.expiresAt);
});

/* ------------------------------------------------------------------- audit */

test('the audit chain verifies when untouched', async () => {
  const log = engine.newAuditLog();
  await engine.appendAudit(log, { action: 'consent.recorded', actor: 'health worker', subject: 'PT-021', purpose: 'intake' }, { now: NOW });
  await engine.appendAudit(log, { action: 'record.read', actor: 'nurse', subject: 'PT-021', purpose: 'review before referral' }, { now: NOW });
  await engine.appendAudit(log, { action: 'record.exported', actor: 'nurse', subject: 'PT-021', purpose: 'referral', detail: 'State hospital' }, { now: NOW });

  const result = await engine.verifyAudit(log);
  assert.equal(result.ok, true);
  assert.equal(result.length, 3);
  assert.equal(log.entries[0].prevHash, 'GENESIS');
  assert.equal(log.entries[1].prevHash, log.entries[0].hash);
});

test('editing an old audit entry is detected, and the position is reported', async () => {
  const log = engine.newAuditLog();
  for (let i = 1; i <= 3; i++) {
    await engine.appendAudit(log, { action: 'step.' + i, actor: 'a', subject: 'PT-021', purpose: 'p' }, { now: NOW });
  }
  log.entries[1].purpose = 'nothing to see here';
  const result = await engine.verifyAudit(log);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
  assert.match(result.reason, /hash/);
});

test('deleting an audit entry is detected', async () => {
  const log = engine.newAuditLog();
  for (let i = 1; i <= 3; i++) {
    await engine.appendAudit(log, { action: 'step.' + i, actor: 'a', subject: 'PT-021', purpose: 'p' }, { now: NOW });
  }
  log.entries.splice(1, 1);
  const result = await engine.verifyAudit(log);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
});

/* ----------------------------------------------------------------- sealing */

test('a sealed record round-trips and the ciphertext contains no plaintext', async () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW, id: 'CR-SEAL-1' });
  const sealed = await engine.sealRecord(record, 'correct horse battery', { iterations: 1000 });

  const blob = JSON.stringify(sealed);
  assert.ok(!blob.includes('PT-021'), 'the pseudonym must not appear in the sealed file');
  assert.ok(!blob.includes('exam stress'), 'the notes must not appear in the sealed file');
  assert.equal(sealed.cipher, 'AES-GCM');
  assert.equal(sealed.kdf.name, 'PBKDF2');

  const opened = await engine.openSealed(sealed, 'correct horse battery');
  assert.equal(opened.ok, true);
  assert.equal(opened.record.participantRef, 'PT-021');
  assert.equal(opened.record.expiresAt, record.expiresAt);
});

test('the wrong passphrase fails closed, without message detail', async () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });
  const sealed = await engine.sealRecord(record, 'correct horse battery', { iterations: 1000 });
  const opened = await engine.openSealed(sealed, 'wrong horse battery');
  assert.equal(opened.ok, false);
  assert.equal(opened.record, undefined);
  assert.doesNotMatch(opened.reason, /PT-021|note|record content/i);
});

test('a tampered ciphertext does not open', async () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });
  const sealed = await engine.sealRecord(record, 'correct horse battery', { iterations: 1000 });
  const bytes = Buffer.from(sealed.ciphertext, 'base64');
  bytes[5] = bytes[5] ^ 0xff;
  const opened = await engine.openSealed(Object.assign({}, sealed, { ciphertext: bytes.toString('base64') }), 'correct horse battery');
  assert.equal(opened.ok, false);
});

test('short passphrases are refused rather than silently accepted', async () => {
  const { record } = engine.createRecord(validDraft(), { now: NOW });
  await assert.rejects(() => engine.sealRecord(record, 'short'), /at least 8 characters/);
});

/* --------------------------------------------------------------------- CLI */

test('the CLI exits 0 and reports PASS', () => {
  const res = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /RESULT: PASS/);
  assert.match(res.stdout, /Passed\s+: 24/);
});

test('the JSON CLI emits a parseable report', () => {
  const res = spawnSync(process.execPath, [CLI, '--json'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.total, 24);
  assert.equal(parsed.failed, 0);
  assert.equal(parsed.cases.length, 24);
});
