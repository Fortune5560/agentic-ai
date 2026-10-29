/* ============================================================================
   demo.js — wires the sandbox page to ops-agent-engine.js
   Progressive enhancement: without JS the page still explains what the demo is,
   how to run it from the terminal, and how to read the results.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof OpsAgent === 'undefined') return;

  var engine = OpsAgent;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------------------------------------------------------- helpers */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function pct(n) { return engine.pct(n) + '%'; }
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function num(n) { return Number(n).toLocaleString('en-US'); }

  /* =============================================================== suite UI */
  function renderSuite() {
    var report = engine.runSuite();
    var rows = $('suite-rows');
    var metrics = $('suite-metrics');
    var status = $('suite-status');
    if (!rows || !metrics) return;

    rows.textContent = '';
    report.runs.forEach(function (r) {
      var tr = el('tr', r.pass ? 'row-pass' : 'row-fail');

      tr.appendChild(el('td', 'mono', r.id));
      tr.appendChild(el('td', null, r.title));

      var key = el('td');
      key.appendChild(el('span', 'pill pill-neutral', label(r.expected)));
      tr.appendChild(key);

      var actual = el('td');
      actual.appendChild(el('span', 'pill ' + (r.pass ? 'pill-ok' : 'pill-bad'), label(r.actual)));
      tr.appendChild(actual);

      tr.appendChild(el('td', 'muted', r.blockingGuards.length ? r.blockingGuards.join(', ') : '—'));
      rows.appendChild(tr);
    });

    var tiles = [
      { label: 'Scenarios run', value: String(report.total), note: 'every run, same inputs' },
      { label: 'Decision accuracy', value: report.passed + '/' + report.total, note: pct(report.decisionAccuracy) + ' vs answer key' },
      { label: 'Auto-resolved', value: String(report.autoResolved), note: pct(report.autoResolveRate) + ' of incidents' },
      { label: 'Escalated to a human', value: String(report.escalated), note: 'guardrail fired' },
      { label: 'Unsafe executions', value: String(report.unsafe), note: report.unsafe === 0 ? 'none — the one that matters' : 'regression' },
      { label: 'Deterministic replay', value: report.deterministic ? 'Yes' : 'No', note: 're-run matched exactly' }
    ];

    metrics.textContent = '';
    tiles.forEach(function (t) {
      var tile = el('div', 'metric' + (t.value === '0' && t.label === 'Unsafe executions' ? ' metric-good' : ''));
      tile.appendChild(el('p', 'metric-label', t.label));
      tile.appendChild(el('p', 'metric-value', t.value));
      tile.appendChild(el('p', 'metric-note', t.note));
      metrics.appendChild(tile);
    });

    if (status) {
      var allGood = report.failed === 0 && report.unsafe === 0 && report.deterministic;
      status.textContent = allGood
        ? 'Measured just now: ' + report.passed + '/' + report.total + ' scenarios match the answer key, ' +
          report.unsafe + ' unsafe executions, replay deterministic.'
        : 'Measured just now: ' + report.passed + '/' + report.total + ' matched, ' +
          report.unsafe + ' unsafe execution(s) — investigate.';
      status.classList.toggle('bad', !allGood);
    }
  }

  function label(decision) {
    return {
      auto_resolve: 'Auto-resolve',
      escalate: 'Escalate'
    }[decision] || decision;
  }

  /* ============================================== single-incident playground */
  var EXTRA = {
    worker_backlog: {
      label: 'Queue depth (jobs)', min: 0, max: 6000, step: 10, value: 300, to: function (v) { return v; },
      hint: 'Jobs waiting. The scale-out playbook reads queue depth; under ~200 jobs it is noise.'
    },
    stale_cache: {
      label: 'Cache hit-rate drop', min: 0, max: 100, step: 1, value: 10, to: function (v) { return v / 100; },
      hint: 'Percentage points lost from the baseline hit rate.'
    },
    db_connection_exhaustion: {
      label: 'Connection pool utilisation', min: 0, max: 100, step: 1, value: 60, to: function (v) { return v / 100; },
      hint: 'Share of the pool in use. The playbook needs it well above 50%.'
    },
    zombie_locks: {
      label: 'Locks held by dead workers', min: 0, max: 60, step: 1, value: 5, to: function (v) { return v; },
      hint: 'Count of stale locks blocking the batch job.'
    },
    traffic_hotspot: {
      label: 'Regional saturation', min: 0, max: 100, step: 1, value: 70, to: function (v) { return v / 100; },
      hint: 'Capacity utilisation of the hottest region.'
    }
  };

  function buildIncident() {
    var symptom = $('symptom').value;
    var extra = EXTRA[symptom];
    var signals = {
      errorRate: Number($('errorRate').value) / 100,
      affectedUsers: Number($('affectedUsers').value),
      revenueAtRiskUsd: Number($('revenueAtRisk').value)
    };

    if (extra) {
      var map = {};
      map[symptom === 'worker_backlog' ? 'queueDepth'
        : symptom === 'stale_cache' ? 'cacheHitRateDrop'
        : symptom === 'db_connection_exhaustion' ? 'poolUtilization'
        : symptom === 'zombie_locks' ? 'staleLocks' : 'saturation'] = extra.to(Number($('extra').value));
      Object.keys(map).forEach(function (k) { signals[k] = map[k]; });
    }

    return {
      id: 'AD-HOC',
      title: 'Ad-hoc incident from the sandbox',
      symptom: symptom,
      signals: signals,
      requestedAction: $('requestedAction').value.trim()
    };
  }

  function syncExtraControl() {
    var symptom = $('symptom').value;
    var extra = EXTRA[symptom];
    var input = $('extra');
    var field = input.closest('.field');

    if (!extra) {
      input.disabled = true;
      if (field) field.classList.add('is-disabled');
      $('extra-hint').textContent = 'This symptom\'s playbook does not read a signal-specific value.';
      $('extra-out').textContent = 'n/a';
      return;
    }

    input.disabled = false;
    if (field) field.classList.remove('is-disabled');
    input.min = extra.min;
    input.max = extra.max;
    input.step = extra.step;
    input.value = extra.value;
    input.labels[0].firstChild.nodeValue = extra.label + ' ';
    $('extra-hint').textContent = extra.hint;
    syncOutput(input);
  }

  function syncOutput(input) {
    var outId = input.id + '-out';
    var out = $(outId);
    if (!out) return;
    var v = Number(input.value);
    if (input.id === 'errorRate') out.textContent = v + '%';
    else if (input.id === 'affectedUsers') out.textContent = num(v);
    else if (input.id === 'revenueAtRisk') out.textContent = money(v);
    else out.textContent = num(v);
  }

  function renderDecision() {
    var incident = buildIncident();
    var result = engine.decide(incident);

    var card = $('decision-card');
    if (!card) return;
    card.textContent = '';
    card.classList.toggle('is-escalate', result.decision !== 'auto_resolve');

    var badge = el('span', 'pill ' + (result.decision === 'auto_resolve' ? 'pill-ok' : 'pill-warn'),
      result.decision === 'auto_resolve' ? 'Auto-resolved' : 'Escalated to a human');
    card.appendChild(badge);

    card.appendChild(el('p', 'decision-headline', result.action));
    card.appendChild(el('p', 'decision-reason', result.reason));

    var facts = el('dl', 'decision-facts');
    [
      ['Severity', result.severity],
      ['Risk tier', result.risk],
      ['Confidence', result.confidence.toFixed(2)],
      ['Executed', result.executed ? 'yes' : 'no'],
      ['Blocking guardrail', result.blockingGuards.length ? result.blockingGuards.join(', ') : 'none tripped']
    ].forEach(function (pair) {
      facts.appendChild(el('dt', null, pair[0]));
      facts.appendChild(el('dd', null, pair[1]));
    });
    card.appendChild(facts);

    var audit = $('audit');
    audit.textContent = '';
    result.audit.forEach(function (entry) {
      var li = el('li', 'audit-' + entry.level);
      li.appendChild(el('span', 'audit-step', String(entry.step).padStart(2, '0')));
      li.appendChild(el('span', null, entry.message));
      audit.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------- init */
  function init() {
    var form = $('incident-form');
    var ranges = ['errorRate', 'affectedUsers', 'revenueAtRisk', 'extra'];

    ranges.forEach(function (id) {
      var input = $(id);
      if (!input) return;
      syncOutput(input);
      input.addEventListener('input', function () {
        syncOutput(input);
        renderDecision();
      });
    });

    if ($('symptom')) {
      $('symptom').addEventListener('change', function () {
        syncExtraControl();
        renderDecision();
      });
      syncExtraControl();
    }

    if ($('requestedAction')) {
      $('requestedAction').addEventListener('input', renderDecision);
    }

    if ($('run-suite')) {
      $('run-suite').addEventListener('click', function () {
        var btn = $('run-suite');
        btn.disabled = true;
        btn.textContent = 'Running…';
        // A tick lets the label paint before the suite blocks the main thread.
        window.setTimeout(function () {
          renderSuite();
          btn.disabled = false;
          btn.textContent = 'Run again';
        }, 30);
      });
    }

    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });

    renderSuite();
    renderDecision();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
