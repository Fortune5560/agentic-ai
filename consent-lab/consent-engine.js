/* ============================================================================
   consent-engine.js
   ----------------------------------------------------------------------------
   A consent record for community mental-health work, with the guardrails in the
   code rather than in a policy document.

   The premise: a counselling note is the most sensitive thing a small clinic
   holds, and the record usually belongs to whoever has the notebook. This engine
   makes the participant's limits part of the data — scope, expiry, language,
   witness — and refuses to store a record that does not have them.

   What is real here:
     * every rule below runs, and the browser and the Node tests execute the same
       file;
     * the audit log is a SHA-256 hash chain, so editing an old entry breaks the
       chain and `verifyAudit()` says where;
     * records are sealed with AES-GCM 256 under a PBKDF2-derived key, so the
       ciphertext on disk is useless without the passphrase;
     * `node consent-lab/consent-engine.js` runs the 24-case answer key.

   What is NOT real, and the demo page says so on every load:
     * the participants, notes and records in the demo are synthetic;
     * nobody has reviewed this with a community health worker yet — it is an
       architecture sketch, not a validated clinical tool;
     * the Yoruba strings are a draft translation and are labelled as such in the
       data (translationStatus: 'draft') and on the page;
     * there is no model in this file. Model-assisted summarisation is a separate,
       measurable layer (see consent-lab/model/), and it never writes the record.

   Browser: attaches `Consent` to the global object.
   Node:    require('./consent-engine.js')   or run the CLI at the bottom.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Consent = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* --------------------------------------------------------------------------
     Policy — the numbers a clinic committee would argue about, in one place
     -------------------------------------------------------------------------- */
  const POLICY = {
    minConsentMonths: 1,
    maxConsentMonths: 24,        // a consent that outlives two years is not consent
    minAge: 18,                  // under this, a guardian must be named
    minPurposeWords: 3,          // "access" is not a purpose; "review for referral" is
    supportedLanguages: ['en', 'yo'],
    auditHash: 'SHA-256',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 150000, saltBytes: 16 },
    cipher: 'AES-GCM',
    keyBits: 256
  };

  /* What a participant is actually agreeing to, in each supported language.
     Yoruba is a DRAFT translation: it has not been reviewed by a health worker or
     a translator yet, and the UI must say so. Marking it here means the claim can
     be tested rather than remembered. */
  const STATEMENTS = {
    en: {
      status: 'reviewed-english',
      storage: 'My information may be stored on this device.',
      access: 'I have been told what is stored and who is allowed to read it.',
      limits: 'I can limit what is written down about me.',
      withdraw: 'I can withdraw this consent at any time, and the record will be marked as withdrawn.',
      expiry: 'This consent expires on the date written in this record.'
    },
    yo: {
      status: 'draft',
      storage: 'A le fi alaye mi pamọ sori ẹrọ yii.',
      access: 'Wọn ti sọ fun mi ohun tí wọ́n fi pamọ́ àti ẹni tí ó lè kà á.',
      limits: 'Mo lè dín ohun tí wọ́n kọ nípa mi kù.',
      withdraw: 'Mo lè yọ ìgbàláyè mi padà nígbàkúgbà, a ó sì fi àmì sí àkọsílẹ̀ náà.',
      expiry: 'Ìgbàláyè yìí máa parí ní ọjọ́ tí ó wà nínú àkọsílẹ̀ yìí.'
    }
  };

  const SCOPE_LABELS = {
    assessment: 'Initial assessment summary',
    counselling_notes: 'Counselling session notes',
    referral: 'Referral to another service',
    medication: 'Medication notes',
    followup_contact: 'Contact for follow-up'
  };

  const STATEMENT_KEYS = Object.keys(STATEMENTS.en).filter((k) => k !== 'status');
  const SCOPES = Object.keys(SCOPE_LABELS);

  /* --------------------------------------------------------------------------
     Small helpers
     -------------------------------------------------------------------------- */
  const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
  const words = (v) => String(v || '').trim().split(/\s+/).filter(Boolean).length;

  function toB64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }

  function fromB64(str) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    const raw = atob(str);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function subtle() {
    const c = globalThis.crypto;
    if (!c || !c.subtle) {
      throw new Error('Web Crypto is unavailable. In Node 20+ this is global; in a browser the page must be served over https or localhost.');
    }
    return c.subtle;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }

  async function sha256Hex(text) {
    const digest = await subtle().digest('SHA-256', utf8(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* Canonical JSON: sorted keys, so the same record always hashes the same. */
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }

  function addMonths(iso, months) {
    const d = new Date(iso);
    d.setUTCMonth(d.getUTCMonth() + Number(months));
    return d.toISOString();
  }

  /* --------------------------------------------------------------------------
     Guardrails on a draft, before anything is stored
     Order is fixed so the answer key can assert on it.
     -------------------------------------------------------------------------- */
  function validateDraft(draft, opts) {
    const d = draft || {};
    const now = (opts && opts.now) || new Date().toISOString();
    const errors = [];
    const add = (code, field, message) => errors.push({ code, field, message });

    // R01 — a pseudonym, never a name. The record has to be linkable to a person
    // by the clinic, not by anyone who reads the file.
    if (isBlank(d.participantRef)) {
      add('no_participant_ref', 'participantRef', 'A pseudonymous reference is required (e.g. PT-014). Do not store names here.');
    }

    // R02 — a consent with no expiry is not a consent.
    if (isBlank(d.consentMonths)) {
      add('no_expiry', 'consentMonths', 'Every consent must have an expiry. There is no "indefinite".');
    } else if (!Number.isFinite(Number(d.consentMonths)) || Number(d.consentMonths) < POLICY.minConsentMonths) {
      add('invalid_expiry', 'consentMonths', 'Consent length must be at least ' + POLICY.minConsentMonths + ' month.');
    } else if (Number(d.consentMonths) > POLICY.maxConsentMonths) {
      add('expiry_too_long', 'consentMonths', 'Consent cannot run beyond ' + POLICY.maxConsentMonths + ' months; ask again instead.');
    }

    // R03 — the participant decides what is recorded, so at least one scope.
    const scopes = Array.isArray(d.scopes) ? d.scopes.filter((s) => SCOPES.includes(s)) : [];
    if (scopes.length === 0) {
      add('no_scope', 'scopes', 'Choose at least one category of information the participant allows.');
    }

    // R04 — consent is only consent in a language the person understands.
    if (!POLICY.supportedLanguages.includes(d.language)) {
      add('unsupported_language', 'language', 'Record which language the consent was read in (' + POLICY.supportedLanguages.join(', ') + ').');
    }

    // R05 — every statement must be read (and understood) in that language.
    const confirmed = Array.isArray(d.statementsConfirmed) ? d.statementsConfirmed : [];
    const missing = STATEMENT_KEYS.filter((k) => !confirmed.includes(k));
    if (missing.length) {
      add('statements_not_confirmed', 'statementsConfirmed', 'The participant has not confirmed: ' + missing.join(', ') + '.');
    }

    // R06/R07 — minors need a guardian, and cannot self-consent.
    const ageKnown = d.age !== null && d.age !== undefined && d.age !== '';
    const age = ageKnown ? Number(d.age) : null;
    if (ageKnown && (!Number.isFinite(age) || age < 0 || age > 120)) {
      add('invalid_age', 'age', 'Age must be a number between 0 and 120, or left blank.');
    }
    if (ageKnown && age < POLICY.minAge) {
      if (d.selfConsent) {
        add('minor_self_consent', 'selfConsent', 'A person under ' + POLICY.minAge + ' cannot consent on their own behalf here.');
      }
      if (isBlank(d.guardian)) {
        add('minor_without_guardian', 'guardian', 'A guardian must be named for a participant under ' + POLICY.minAge + '.');
      }
    }

    // R08 — somebody other than the person recording it must be able to attest.
    if (!d.selfConsent && isBlank(d.witness)) {
      add('no_witness', 'witness', 'Name the person who witnessed the consent (role is enough), or mark it self-recorded.');
    }

    // R09 — a purpose a reviewer could not challenge is not a purpose.
    if (words(d.purpose) < POLICY.minPurposeWords) {
      add('purpose_thin', 'purpose', 'State the purpose in at least ' + POLICY.minPurposeWords + ' words, e.g. "review before referral".');
    }

    // R10 — data minimisation: free-text notes are the usual place a phone number
    // or an email address smuggles itself in. Refuse, rather than warn.
    const notes = String(d.notes || '').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
    const looksLikeEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(notes);
    const looksLikePhone = /(\+?\d[\d\s().-]{8,}\d)/.test(notes);
    if (looksLikeEmail || looksLikePhone) {
      add('contact_detail_present', 'notes', 'Notes must not contain phone numbers or email addresses. Record contact separately, with its own consent.');
    }

    return {
      ok: errors.length === 0,
      errors,
      codes: errors.map((e) => e.code),
      normalised: {
        participantRef: String(d.participantRef || '').trim(),
        age,
        language: d.language,
        scopes: scopes.slice().sort(),
        consentMonths: isBlank(d.consentMonths) ? null : Number(d.consentMonths),
        witness: String(d.witness || '').trim(),
        guardian: String(d.guardian || '').trim(),
        selfConsent: Boolean(d.selfConsent),
        purpose: String(d.purpose || '').trim(),
        notes: String(d.notes || '').trim(),
        statementsConfirmed: STATEMENT_KEYS.filter((k) => confirmed.includes(k)),
        capturedAt: now
      }
    };
  }

  /* --------------------------------------------------------------------------
     Create + read + export + revoke
     -------------------------------------------------------------------------- */
  function createRecord(draft, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const checked = validateDraft(draft, { now });
    if (!checked.ok) return { ok: false, errors: checked.errors, record: null };

    const n = checked.normalised;
    const record = {
      id: (opts && opts.id) || 'CR-' + now.slice(0, 10).replace(/-/g, '') + '-' + n.participantRef.replace(/[^A-Za-z0-9]/g, '').slice(0, 10),
      participantRef: n.participantRef,
      status: 'active',
      language: n.language,
      scopes: n.scopes,
      purpose: n.purpose,
      notes: n.notes,
      age: n.age,
      guardian: n.guardian,
      witness: n.witness,
      selfConsent: n.selfConsent,
      capturedAt: n.capturedAt,
      expiresAt: addMonths(n.capturedAt, n.consentMonths),
      consentMonths: n.consentMonths,
      statements: n.statementsConfirmed.map((key) => ({
        key,
        language: n.language,
        text: STATEMENTS[n.language][key],
        confirmedAt: n.capturedAt
      }))
    };
    return { ok: true, errors: [], record };
  }

  function isExpired(record, nowIso) {
    return Date.parse(nowIso) > Date.parse(record.expiresAt);
  }

  /* Reading is an event. It needs a stated reason and it goes in the log. */
  function openRecord(record, request, opts) {
    const req = request || {};
    const now = (opts && opts.now) || new Date().toISOString();
    const errors = [];
    if (!record) errors.push({ code: 'no_record', message: 'No record selected.' });
    else {
      if (record.status === 'revoked') {
        errors.push({ code: 'revoked', message: 'This participant withdrew consent. The record is a tombstone and cannot be read.' });
      } else if (isExpired(record, now)) {
        errors.push({ code: 'expired', message: 'This consent expired on ' + record.expiresAt + '. Ask the participant again.' });
      }
      if (words(req.purpose) < POLICY.minPurposeWords) {
        errors.push({ code: 'no_purpose', message: 'State why you are opening this record — the reason is written to the audit log.' });
      }
      if (isBlank(req.actor)) {
        errors.push({ code: 'no_actor', message: 'Name the role of the person opening the record.' });
      }
    }
    if (errors.length) return { ok: false, errors, record: null };
    return {
      ok: true,
      errors: [],
      record: {
        id: record.id,
        participantRef: record.participantRef,
        scopes: record.scopes.slice(),
        notes: record.notes,
        language: record.language,
        capturedAt: record.capturedAt,
        expiresAt: record.expiresAt
      }
    };
  }

  /* Exporting copies data out of the room, so it needs a named recipient and a
     scope the participant actually agreed to. */
  function exportRecord(record, request, opts) {
    const req = request || {};
    const now = (opts && opts.now) || new Date().toISOString();
    const errors = [];
    if (!record) errors.push({ code: 'no_record', message: 'No record selected.' });
    else {
      if (record.status === 'revoked') errors.push({ code: 'revoked', message: 'Consent withdrawn. Nothing may be exported.' });
      else if (isExpired(record, now)) errors.push({ code: 'expired', message: 'Consent expired on ' + record.expiresAt + '.' });
      if (isBlank(req.recipient)) {
        errors.push({ code: 'no_recipient', message: 'Name the person or organisation receiving this export.' });
      }
      if (words(req.purpose) < POLICY.minPurposeWords) {
        errors.push({ code: 'no_purpose', message: 'State what the recipient will do with it.' });
      }
      const wanted = Array.isArray(req.scopes) && req.scopes.length ? req.scopes : record.scopes;
      const outside = wanted.filter((s) => !record.scopes.includes(s));
      if (outside.length) {
        errors.push({ code: 'scope_not_consented', message: 'Not consented: ' + outside.join(', ') + '.' });
      }
    }
    if (errors.length) return { ok: false, errors, payload: null };
    return {
      ok: true,
      errors: [],
      payload: {
        recordId: record.id,
        participantRef: record.participantRef,
        recipient: String(req.recipient).trim(),
        purpose: String(req.purpose).trim(),
        scopes: record.scopes.slice(),
        notes: record.notes,
        exportedAt: now,
        consentExpiresAt: record.expiresAt
      }
    };
  }

  /* Withdrawal is not deletion of the audit trail: the payload goes, the fact that
     there was a consent and a withdrawal stays, so nobody can quietly restore it. */
  function revokeRecord(record, request, opts) {
    const req = request || {};
    const now = (opts && opts.now) || new Date().toISOString();
    const errors = [];
    if (!record) errors.push({ code: 'no_record', message: 'No record selected.' });
    else if (record.status === 'revoked') errors.push({ code: 'already_revoked', message: 'This record is already withdrawn.' });
    if (words(req.reason) < 2) {
      errors.push({ code: 'no_reason', message: 'Record why consent was withdrawn (two words is enough).' });
    }
    if (errors.length) return { ok: false, errors, record: null };
    return {
      ok: true,
      errors: [],
      record: {
        id: record.id,
        participantRef: record.participantRef,
        status: 'revoked',
        revokedAt: now,
        revokeReason: String(req.reason).trim(),
        capturedAt: record.capturedAt,
        expiresAt: record.expiresAt,
        // The payload is gone. Only the tombstone survives.
        scopes: [],
        notes: '',
        statements: []
      }
    };
  }

  /* --------------------------------------------------------------------------
     Audit log — append-only hash chain
     Each entry commits to the previous one, so editing history is detectable
     even by someone who has write access to the file.
     -------------------------------------------------------------------------- */
  function newAuditLog() {
    return { version: 1, algorithm: POLICY.auditHash, entries: [] };
  }

  async function appendAudit(log, entry, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const prevHash = log.entries.length ? log.entries[log.entries.length - 1].hash : 'GENESIS';
    const body = {
      seq: log.entries.length + 1,
      at: now,
      action: entry.action,
      actor: entry.actor || '',
      subject: entry.subject || '',
      purpose: entry.purpose || '',
      detail: entry.detail || ''
    };
    const hash = await sha256Hex(prevHash + '|' + canonical(body));
    const stored = Object.assign({}, body, { prevHash, hash });
    log.entries.push(stored);
    return stored;
  }

  async function verifyAudit(log) {
    let prevHash = 'GENESIS';
    for (let i = 0; i < log.entries.length; i++) {
      const e = log.entries[i];
      // An entry that is missing its own recorded prevHash is itself evidence.
      if (e.prevHash !== prevHash) return { ok: false, brokenAt: i + 1, reason: 'previous link does not match' };
      const body = {
        seq: e.seq, at: e.at, action: e.action, actor: e.actor,
        subject: e.subject, purpose: e.purpose, detail: e.detail
      };
      const expected = await sha256Hex(prevHash + '|' + canonical(body));
      if (expected !== e.hash) return { ok: false, brokenAt: i + 1, reason: 'entry content does not match its hash' };
      prevHash = e.hash;
    }
    return { ok: true, brokenAt: null, length: log.entries.length };
  }

  /* --------------------------------------------------------------------------
     Sealing — what actually sits on the disk
     -------------------------------------------------------------------------- */
  async function deriveKey(passphrase, salt, iterations) {
    const base = await subtle().importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: POLICY.kdf.hash },
      base,
      { name: 'AES-GCM', length: POLICY.keyBits },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function sealRecord(record, passphrase, opts) {
    if (typeof passphrase !== 'string' || passphrase.length < 8) {
      throw new Error('The passphrase must be at least 8 characters.');
    }
    const iterations = (opts && opts.iterations) || POLICY.kdf.iterations;
    const salt = (opts && opts.salt) || globalThis.crypto.getRandomValues(new Uint8Array(POLICY.kdf.saltBytes));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, iterations);
    const plaintext = utf8(canonical(record));
    const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
      v: 1,
      kdf: { name: POLICY.kdf.name, hash: POLICY.kdf.hash, iterations, salt: toB64(salt) },
      cipher: POLICY.cipher,
      iv: toB64(iv),
      ciphertext: toB64(new Uint8Array(ciphertext))
    };
  }

  async function openSealed(sealed, passphrase) {
    try {
      const salt = fromB64(sealed.kdf.salt);
      const key = await deriveKey(passphrase, salt, sealed.kdf.iterations);
      const plaintext = await subtle().decrypt(
        { name: 'AES-GCM', iv: fromB64(sealed.iv) },
        key,
        fromB64(sealed.ciphertext)
      );
      return { ok: true, record: JSON.parse(decodeUtf8(new Uint8Array(plaintext))) };
    } catch (err) {
      // AES-GCM authentication failure is the wrong passphrase or a modified file.
      // Both mean the same thing to the caller: refuse, and say only that.
      return { ok: false, reason: 'This file cannot be opened with that passphrase.' };
    }
  }

  /* --------------------------------------------------------------------------
     The answer key — written from the rules above, before the implementation was
     run against them. `node consent-lab/consent-engine.js` scores the engine on
     it and exits non-zero on any divergence.
     -------------------------------------------------------------------------- */
  const NOW = '2026-11-02T09:00:00.000Z';

  const baseDraft = {
    participantRef: 'PT-014',
    age: 26,
    language: 'en',
    scopes: ['assessment', 'counselling_notes'],
    consentMonths: 6,
    witness: 'Community health worker',
    guardian: '',
    selfConsent: false,
    purpose: 'review before referral',
    notes: 'Session focused on sleep and school stress.',
    statementsConfirmed: STATEMENT_KEYS.slice()
  };

  const draft = (over) => Object.assign({}, baseDraft, over);

  const ANSWER_KEY = [
    { id: 'C01', intent: 'Adult, English, 6 months, witnessed, two scopes', draft: draft({}), expect: { ok: true } },
    { id: 'C02', intent: 'No expiry given', draft: draft({ consentMonths: null }), expect: { ok: false, codes: ['no_expiry'] } },
    { id: 'C03', intent: 'Expiry of 36 months', draft: draft({ consentMonths: 36 }), expect: { ok: false, codes: ['expiry_too_long'] } },
    { id: 'C04', intent: 'Zero months', draft: draft({ consentMonths: 0 }), expect: { ok: false, codes: ['invalid_expiry'] } },
    { id: 'C05', intent: 'No scope selected', draft: draft({ scopes: [] }), expect: { ok: false, codes: ['no_scope'] } },
    { id: 'C06', intent: 'Scope the policy does not know', draft: draft({ scopes: ['everything'] }), expect: { ok: false, codes: ['no_scope'] } },
    { id: 'C07', intent: 'Language not supported', draft: draft({ language: 'fr' }), expect: { ok: false, codes: ['unsupported_language'] } },
    { id: 'C08', intent: 'Yoruba consent is supported', draft: draft({ language: 'yo' }), expect: { ok: true } },
    { id: 'C09', intent: 'Only three of five statements confirmed', draft: draft({ statementsConfirmed: ['storage', 'access', 'limits'] }), expect: { ok: false, codes: ['statements_not_confirmed'] } },
    { id: 'C10', intent: 'No witness, not self-recorded', draft: draft({ witness: '' }), expect: { ok: false, codes: ['no_witness'] } },
    { id: 'C11', intent: 'Self-recorded with no witness is allowed', draft: draft({ witness: '', selfConsent: true }), expect: { ok: true } },
    { id: 'C12', intent: 'Age 15, guardian named, no self-consent', draft: draft({ age: 15, guardian: 'Mother, present' }), expect: { ok: true } },
    { id: 'C13', intent: 'Age 15, no guardian', draft: draft({ age: 15 }), expect: { ok: false, codes: ['minor_without_guardian'] } },
    { id: 'C14', intent: 'Age 15 trying to self-consent', draft: draft({ age: 15, selfConsent: true, witness: '', guardian: 'Aunt' }), expect: { ok: false, codes: ['minor_self_consent'] } },
    { id: 'C15', intent: 'Age left blank is allowed', draft: draft({ age: null }), expect: { ok: true } },
    { id: 'C16', intent: 'Age 200', draft: draft({ age: 200 }), expect: { ok: false, codes: ['invalid_age'] } },
    { id: 'C17', intent: 'Purpose of one word', draft: draft({ purpose: 'review' }), expect: { ok: false, codes: ['purpose_thin'] } },
    { id: 'C18', intent: 'Phone number hidden in the notes', draft: draft({ notes: 'Call the sister on 0803 123 4567 after the session.' }), expect: { ok: false, codes: ['contact_detail_present'] } },
    { id: 'C19', intent: 'Email address in the notes', draft: draft({ notes: 'She prefers pt14@example.com for follow-up.' }), expect: { ok: false, codes: ['contact_detail_present'] } },
    { id: 'C20', intent: 'A date in the notes is not a phone number', draft: draft({ notes: 'Appointment moved to 2026-11-20, same room.' }), expect: { ok: true } },
    { id: 'C21', intent: 'No pseudonymous reference', draft: draft({ participantRef: '' }), expect: { ok: false, codes: ['no_participant_ref'] } },
    { id: 'C22', intent: 'Blank draft, everything missing', draft: {}, expect: { ok: false, codes: ['no_participant_ref', 'no_expiry', 'no_scope', 'unsupported_language', 'statements_not_confirmed', 'purpose_thin'] } },
    { id: 'C23', intent: 'Maximum permitted consent: 24 months', draft: draft({ consentMonths: 24 }), expect: { ok: true } },
    { id: 'C24', intent: 'Notes left empty is acceptable', draft: draft({ notes: '' }), expect: { ok: true } }
  ];

  function runKey() {
    const runs = ANSWER_KEY.map((c) => {
      const res = validateDraft(c.draft, { now: NOW });
      const missing = (c.expect.codes || []).filter((code) => !res.codes.includes(code));
      const unexpectedOk = res.ok !== c.expect.ok;
      return {
        id: c.id,
        intent: c.intent,
        expected: c.expect,
        actual: { ok: res.ok, codes: res.codes },
        pass: !unexpectedOk && missing.length === 0,
        missing
      };
    });
    const passed = runs.filter((r) => r.pass).length;
    return {
      total: runs.length,
      passed,
      failed: runs.length - passed,
      accuracy: runs.length ? passed / runs.length : 0,
      runs
    };
  }

  return {
    POLICY,
    STATEMENTS,
    STATEMENT_KEYS,
    SCOPES,
    SCOPE_LABELS,
    ANSWER_KEY,
    NOW,
    validateDraft,
    createRecord,
    openRecord,
    exportRecord,
    revokeRecord,
    isExpired,
    newAuditLog,
    appendAudit,
    verifyAudit,
    sealRecord,
    openSealed,
    sha256Hex,
    canonical,
    addMonths,
    runKey,
    pct: (n) => Math.round(n * 1000) / 10
  };
});

/* ---------------------------------------------------------------------------
   CLI: `node consent-lab/consent-engine.js [--json]`
   Scores the engine against the 24-case answer key. Exits non-zero on any
   divergence, so a change cannot quietly weaken a guardrail.
   ------------------------------------------------------------------------- */
if (typeof require === 'function' && typeof module === 'object' && module.exports &&
    typeof process === 'object' && require.main === module) {
  const engine = module.exports;
  const report = engine.runKey();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      accuracy: report.accuracy,
      cases: report.runs
    }, null, 2));
    process.exit(report.failed === 0 ? 0 : 1);
  }

  console.log('\nConsent engine — answer-key suite');
  console.log('='.repeat(64));
  report.runs.forEach((r) => {
    console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.id + ' ' + r.intent);
    if (!r.pass) {
      console.log('          expected ok=' + r.expected.ok + (r.expected.codes ? ' codes=' + r.expected.codes.join(',') : '') +
        ' | got ok=' + r.actual.ok + ' codes=' + (r.actual.codes.join(',') || 'none'));
    }
  });
  console.log('-'.repeat(64));
  console.log('Cases      : ' + report.total);
  console.log('Passed     : ' + report.passed + ' (' + engine.pct(report.accuracy) + '%)');
  console.log('Failed     : ' + report.failed);
  console.log('Rules      : ' + Array.from(new Set(engine.ANSWER_KEY.flatMap((c) => c.expect.codes || []))).join(', '));
  console.log('-'.repeat(64));
  console.log(report.failed === 0 ? 'RESULT: PASS\n' : 'RESULT: FAIL\n');
  process.exit(report.failed === 0 ? 0 : 1);
}
