/* ============================================================================
   consent-lab.js — wires the page to consent-engine.js
   Progressive enhancement: without JavaScript the page still explains the rules
   and the demo is simply absent.

   Nothing here decides anything. Every accept/refuse on this page comes from a
   function in consent-engine.js, which is the same file the Node tests import.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof Consent === 'undefined') return;
  var C = Consent;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    record: null,
    sealed: null,
    log: C.newAuditLog(),
    tampered: false
  };

  /* A single clock for the whole page, so a record and the audit entries about it
     cannot disagree about what time it is. */
  function nowIso() { return new Date().toISOString(); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* -------------------------------------------------------------- the form */
  function readForm() {
    var scopes = Array.prototype.slice
      .call(document.querySelectorAll('input[name="scopes"]:checked'))
      .map(function (i) { return i.value; });

    var monthsRaw = $('consentMonths').value;
    var ageRaw = $('age').value;

    var confirmAll = $('confirmAll').checked;

    return {
      participantRef: $('participantRef').value,
      age: ageRaw === '' ? null : Number(ageRaw),
      language: $('language').value,
      scopes: scopes,
      consentMonths: monthsRaw === 'Null' ? null : Number(monthsRaw),
      witness: $('witness').value,
      guardian: $('guardian').value,
      selfConsent: $('selfConsent').checked,
      purpose: $('purpose').value,
      notes: $('notes').value,
      statementsConfirmed: confirmAll ? C.STATEMENT_KEYS.slice() : ['storage', 'access']
    };
  }

  function renderVerdict(ok, headline, reason, facts) {
    var card = $('verdict');
    card.className = 'decision-card' + (ok ? ' decision-ok' : ' decision-bad');
    $('verdict-headline').textContent = headline;
    $('verdict-reason').textContent = reason;

    var list = $('verdict-facts');
    list.textContent = '';
    (facts || []).forEach(function (f) {
      var li = el('li');
      if (f.code) {
        li.appendChild(el('span', 'pill pill-bad', f.code));
        li.appendChild(document.createTextNode(' ' + f.message));
      } else {
        li.appendChild(document.createTextNode(f.text));
      }
      list.appendChild(li);
    });
  }

  function showRecord(record) {
    var view = $('record-view');
    if (!record) { view.textContent = 'No record yet.'; return; }
    var lines = [
      'id            ' + record.id,
      'participant   ' + record.participantRef,
      'status        ' + record.status,
      'language      ' + record.language,
      'scopes        ' + (record.scopes.length ? record.scopes.join(', ') : '(none — withdrawn)'),
      'captured      ' + record.capturedAt,
      'expires       ' + record.expiresAt,
      'statements    ' + record.statements.length + ' of ' + C.STATEMENT_KEYS.length + ' confirmed',
      'note          ' + (record.notes ? record.notes.slice(0, 90) + (record.notes.length > 90 ? '…' : '') : '(cleared)')
    ];
    view.textContent = lines.join('\n');
  }

  async function onRecord(event) {
    event.preventDefault();
    var draft = readForm();
    var result = C.createRecord(draft, { now: nowIso() });

    if (!result.ok) {
      renderVerdict(false, 'Refused — ' + result.errors.length + ' rule(s)',
        'Nothing was stored. The record cannot exist in this state.',
        result.errors.map(function (e) { return { code: e.code, message: e.message }; }));
      showRecord(null);
      state.record = null;
      state.sealed = null;
      $('sealed-view').textContent = 'Nothing sealed, because nothing was accepted.';
      return;
    }

    state.record = result.record;
    state.tampered = false;
    state.log = C.newAuditLog();

    renderVerdict(true, 'Recorded',
      'Accepted, with ' + result.record.statements.length + ' statements confirmed in ' +
      (result.record.language === 'yo' ? 'Yorùbá (draft translation)' : 'English') + '.',
      [
        { text: 'Expires ' + result.record.expiresAt + ' — after that, reading is refused.' },
        { text: 'Scopes: ' + result.record.scopes.join(', ') },
        { text: result.record.age !== null && result.record.age < C.POLICY.minAge
            ? 'Under ' + C.POLICY.minAge + ': guardian recorded as "' + result.record.guardian + '".'
            : 'Adult record.' }
      ]);

    showRecord(result.record);
    await addAudit('consent.recorded', result.record.participantRef, draft.purpose || 'consent capture',
      result.record.scopes.join(', '));

    var passphrase = $('passphrase').value;
    try {
      var sealed = await C.sealRecord(result.record, passphrase);
      state.sealed = sealed;
      var blob = JSON.stringify(sealed, null, 2);
      $('sealed-view').textContent = blob.length > 900 ? blob.slice(0, 900) + '\n… (truncated for display)' : blob;
    } catch (err) {
      $('sealed-view').textContent = 'Could not seal: ' + err.message;
    }
  }

  /* ------------------------------------------------------------ audit log */
  async function addAudit(action, subject, purpose, detail) {
    await C.appendAudit(state.log, {
      action: action,
      actor: $('actor') ? $('actor').value : 'health worker',
      subject: subject || '',
      purpose: purpose || '',
      detail: detail || ''
    }, { now: nowIso() });
    renderAudit();
  }

  function renderAudit() {
    var list = $('audit-log');
    list.textContent = '';
    if (!state.log.entries.length) {
      var li0 = el('li');
      li0.appendChild(el('span', 'audit-step', '01'));
      li0.appendChild(el('span', null, 'Nothing logged yet.'));
      list.appendChild(li0);
      return;
    }
    state.log.entries.forEach(function (entry) {
      var li = el('li', entry.action.indexOf('refused') === 0 ? 'audit-warn' : '');
      li.appendChild(el('span', 'audit-step', String(entry.seq).padStart(2, '0')));
      var body = el('span');
      body.appendChild(el('strong', 'audit-hash', entry.action));
      body.appendChild(document.createTextNode(' · ' + entry.actor + ' · ' + entry.purpose));
      body.appendChild(el('span', 'audit-hash', 'hash ' + entry.hash.slice(0, 12) + '…'));
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  /* ---------------------------------------------------------------- actions */
  function requireRecord() {
    if (!state.record) {
      $('action-status').textContent = 'Record a consent first — there is nothing to act on.';
      return false;
    }
    return true;
  }

  async function onRead() {
    if (!requireRecord()) return;
    var req = { actor: $('actor').value, purpose: $('actionPurpose').value };
    var res = C.openRecord(state.record, req, { now: nowIso() });
    if (!res.ok) {
      await addAudit('read.refused', state.record.participantRef, req.purpose, res.errors[0].code);
      $('action-status').textContent = 'Refused: ' + res.errors.map(function (e) { return e.message; }).join(' ');
      return;
    }
    await addAudit('record.read', state.record.participantRef, req.purpose, 'scopes: ' + res.record.scopes.join(', '));
    $('action-status').textContent = 'Read by ' + req.actor + ' for "' + req.purpose + '". The entry is in the log.';
  }

  async function onExport() {
    if (!requireRecord()) return;
    var req = {
      recipient: $('recipient').value,
      purpose: $('actionPurpose').value
    };
    var res = C.exportRecord(state.record, req, { now: nowIso() });
    if (!res.ok) {
      await addAudit('export.refused', state.record.participantRef, req.purpose, res.errors[0].code);
      $('action-status').textContent = 'Refused: ' + res.errors.map(function (e) { return e.message; }).join(' ');
      return;
    }
    await addAudit('record.exported', state.record.participantRef, req.purpose, res.payload.recipient);
    $('action-status').textContent = 'Exported to ' + res.payload.recipient + ', logged with its purpose and expiry.';
  }

  async function onRevoke() {
    if (!requireRecord()) return;
    var res = C.revokeRecord(state.record, { reason: $('actionPurpose').value }, { now: nowIso() });
    if (!res.ok) {
      await addAudit('revoke.refused', state.record.participantRef, '', res.errors[0].code);
      $('action-status').textContent = 'Refused: ' + res.errors.map(function (e) { return e.message; }).join(' ');
      return;
    }
    state.record = res.record;
    showRecord(res.record);
    await addAudit('consent.withdrawn', res.record.participantRef, res.record.revokeReason, 'payload cleared');
    $('action-status').textContent = 'Consent withdrawn. The note is gone; the tombstone and this log remain.';
    renderVerdict(true, 'Withdrawn',
      'The payload has been cleared. The record now exists only as evidence that there was a consent and a withdrawal.',
      [{ text: 'Record ' + res.record.id + ' · revoked ' + res.record.revokedAt }]);
  }

  async function onVerify() {
    var result = await C.verifyAudit(state.log);
    var status = $('verify-status');
    if (result.ok) {
      status.textContent = 'Chain intact: ' + result.length + ' entries, each committing to the one before.';
    } else {
      status.textContent = 'Chain broken at entry ' + result.brokenAt + ' — ' + result.reason + '. This is what tampering looks like from the inside.';
    }
  }

  async function onTamper() {
    if (!state.log.entries.length) {
      $('verify-status').textContent = 'Nothing to tamper with yet. Record a consent first.';
      return;
    }
    state.log.entries[0].purpose = 'nothing to see here';
    state.tampered = true;
    renderAudit();
    $('verify-status').textContent = 'Entry 01 has been edited. Press "Verify chain" to see the log notice.';
  }

  /* ------------------------------------------------------------------ unlock */
  async function onUnlock() {
    if (!state.sealed) {
      $('unlock-status').textContent = 'Nothing sealed yet — record a consent first.';
      return;
    }
    var result = await C.openSealed(state.sealed, $('passphrase').value);
    $('unlock-status').textContent = result.ok
      ? 'Opened. The passphrase is the only thing that made that possible — the file itself names no one.'
      : result.reason;
  }

  /* ------------------------------------------------------------------- init */
  function renderRules() {
    var rows = $('rule-rows');
    if (!rows) return;
    var RULES = [
      ['no_participant_ref', 'No pseudonymous reference', 'A name in the file is a name in every copy of it'],
      ['no_expiry', 'No expiry given', 'A consent with no end is not a consent'],
      ['expiry_too_long', 'Longer than ' + C.POLICY.maxConsentMonths + ' months', 'Ask again instead of assuming forever'],
      ['no_scope', 'No category of information allowed', 'The participant decides what is written'],
      ['unsupported_language', 'Consent language not English or Yorùbá', 'Consent read in a language you do not speak is not consent'],
      ['statements_not_confirmed', 'Statement not confirmed', 'Each of the five statements is attested, not implied'],
      ['minor_without_guardian', 'Under ' + C.POLICY.minAge + ' with no guardian', 'A child cannot sign this away'],
      ['minor_self_consent', 'Under ' + C.POLICY.minAge + ' self-consenting', 'Same rule, enforced twice'],
      ['no_witness', 'Not witnessed and not self-recorded', 'Somebody must be able to attest to the conversation'],
      ['purpose_thin', 'Purpose under ' + C.POLICY.minPurposeWords + ' words', 'A purpose nobody could challenge is not a purpose'],
      ['contact_detail_present', 'Phone number or email in the note', 'Data minimisation: contact needs its own consent'],
      ['no_recipient', 'Export with no named recipient', 'Copying data out of the room is an event'],
      ['scope_not_consented', 'Export beyond the agreed scopes', 'The export cannot be wider than the consent'],
      ['revoked', 'Record withdrawn', 'The tombstone stays; the payload does not'],
      ['expired', 'Consent passed its expiry', 'Time is an access control']
    ];
    rows.textContent = '';
    RULES.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'mono', r[0]));
      tr.appendChild(el('td', null, r[1]));
      tr.appendChild(el('td', null, r[2]));
      rows.appendChild(tr);
    });
  }

  var started = false;

  function init() {
    // Guard: a second DOMContentLoaded must not bind the submit handler twice.
    if (started) return;
    started = true;

    renderRules();
    renderAudit();
    showRecord(null);

    $('consent-form').addEventListener('submit', onRecord);
    $('reset-btn').addEventListener('click', function () {
      $('consent-form').reset();
      state.record = null;
      state.sealed = null;
      state.log = C.newAuditLog();
      renderAudit();
      showRecord(null);
      $('sealed-view').textContent = 'Sealing happens when a record is created.';
      renderVerdict(true, 'Reset', 'The form and the log are back to their starting state.', []);
    });

    $('read-btn').addEventListener('click', onRead);
    $('export-btn').addEventListener('click', onExport);
    $('revoke-btn').addEventListener('click', onRevoke);
    $('verify-btn').addEventListener('click', onVerify);
    $('tamper-btn').addEventListener('click', onTamper);
    $('unlock-btn').addEventListener('click', onUnlock);

    // Yorùbá is a draft: say so the moment it is selected, not in a footnote.
    $('language').addEventListener('change', function () {
      var isYo = $('language').value === 'yo';
      $('verdict-reason').textContent = isYo
        ? 'Yorùbá is selected: these strings are an unreviewed draft translation, marked "draft" in the data.'
        : 'English statements are the reviewed wording.';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
