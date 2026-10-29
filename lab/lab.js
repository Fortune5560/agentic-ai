/* ============================================================================
   lab.js — wires the triage page to triage-engine.js
   Progressive enhancement: without JS the page still explains the exercise and
   how to run it from a terminal.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof Triage === 'undefined') return;

  var engine = Triage;
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function label(severity) {
    return severity.charAt(0).toUpperCase() + severity.slice(1);
  }

  /* ------------------------------------------------------------- detection */
  var runs = 0;

  function renderDetection() {
    var report = engine.run();
    var flagged = {};
    report.alerts.forEach(function (a) {
      a.evidence.forEach(function (line) { flagged[line] = a.severity; });
    });

    /* Log viewer — every line is rendered, flagged ones highlighted. */
    var view = $('log-view');
    if (view) {
      view.textContent = '';
      engine.SAMPLE_LOG.forEach(function (line, i) {
        var lineNo = i + 1;
        var span = el('span', 'log-line', line.trim());
        if (flagged[lineNo]) {
          span.classList.add('log-flag');
          span.title = 'Matches a ' + flagged[lineNo] + ' alert';
        }
        view.appendChild(span);
      });
    }

    /* Metrics — computed from the run, never written into the HTML. */
    var metrics = $('lab-metrics');
    if (metrics) {
      metrics.textContent = '';
      [
        { label: 'Events parsed', value: String(report.events), note: 'unparsed: ' + report.unparsed.length },
        { label: 'Alerts raised', value: String(report.alerts.length), note: 'by ' + countRules(report) + ' rules' },
        { label: 'Critical', value: String(report.counts.critical), note: 'possible compromise chain' },
        { label: 'External sources', value: String(report.externalIps.length), note: 'non-RFC1918 addresses' }
      ].forEach(function (t) {
        var tile = el('div', 'metric' + (t.label === 'Critical' && Number(t.value) > 0 ? ' metric-good' : ''));
        tile.appendChild(el('p', 'metric-label', t.label));
        tile.appendChild(el('p', 'metric-value', t.value));
        tile.appendChild(el('p', 'metric-note', t.note));
        metrics.appendChild(tile);
      });
    }

    /* Alert table. */
    var rows = $('alert-rows');
    if (rows) {
      rows.textContent = '';
      report.alerts.forEach(function (a) {
        var tr = el('tr');
        tr.appendChild(el('td', 'mono', String(a.position)));
        var sev = el('td');
        sev.appendChild(el('span', 'pill ' + severityClass(a.severity), label(a.severity)));
        tr.appendChild(sev);
        var title = el('td');
        title.appendChild(el('strong', null, a.title));
        title.appendChild(el('div', 'muted', a.detail));
        tr.appendChild(title);
        tr.appendChild(el('td', 'mono', String(a.evidence.length)));
        tr.appendChild(el('td', 'mono', a.firstSeen.slice(11, 19)));
        rows.appendChild(tr);
      });
    }

    var status = $('lab-status');
    if (status) {
      runs += 1;
      status.textContent = 'Run ' + runs + ' over the same bundled log: ' + report.events +
        ' events parsed, ' + report.alerts.length + ' alerts raised, of which ' +
        report.counts.critical + ' are critical.' +
        (runs > 1 ? ' Identical to the previous run — no clock, no randomness.' : '');
    }
  }

  function countRules(report) {
    var ids = {};
    report.alerts.forEach(function (a) { ids[a.id] = true; });
    return Object.keys(ids).length;
  }

  function severityClass(sev) {
    return { critical: 'pill-bad', high: 'pill-warn', medium: 'pill-neutral', low: 'pill-ok' }[sev] || 'pill-neutral';
  }

  /* ----------------------------------------------------------------- drill */
  var answers = {};

  function renderDrill() {
    var wrap = $('drill-list');
    if (!wrap) return;
    wrap.textContent = '';

    engine.DRILL.forEach(function (item, index) {
      var q = el('div', 'drill-question');
      q.setAttribute('data-question', item.id);

      q.appendChild(el('p', 'drill-q-label', 'Case ' + (index + 1) + ' of ' + engine.DRILL.length));
      q.appendChild(el('p', 'drill-q-title', 'What is the disposition?'));
      q.appendChild(el('p', 'drill-q-body', item.prompt));

      var list = el('ul', 'drill-options');
      engine.DRILL_OPTIONS.forEach(function (opt) {
        var li = el('li');
        var btn = el('button', 'drill-option', opt.label);
        btn.type = 'button';
        btn.setAttribute('data-choice', opt.id);
        btn.addEventListener('click', function () {
          if (answers[item.id]) return;
          answers[item.id] = opt.id;
          markQuestion(q, item);
          updateScore();
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
      q.appendChild(list);

      var feedback = el('p', 'drill-feedback');
      feedback.setAttribute('aria-live', 'polite');
      feedback.setAttribute('data-feedback', item.id);
      feedback.hidden = true;
      q.appendChild(feedback);

      wrap.appendChild(q);
    });

    updateScore();
  }

  function markQuestion(q, item) {
    var chosen = answers[item.id];
    Array.prototype.forEach.call(q.querySelectorAll('.drill-option'), function (btn) {
      btn.disabled = true;
      var choice = btn.getAttribute('data-choice');
      if (choice === item.answer) btn.classList.add('is-correct');
      if (choice === chosen && chosen !== item.answer) btn.classList.add('is-wrong');
    });

    var feedback = q.querySelector('[data-feedback]');
    var right = chosen === item.answer;
    var answerLabel = engine.DRILL_OPTIONS.filter(function (o) { return o.id === item.answer; })[0].label;
    feedback.hidden = false;
    feedback.textContent = '';
    feedback.appendChild(el('strong', null, right ? 'Correct. ' : 'Not quite. '));
    feedback.appendChild(document.createTextNode(
      (right ? '' : 'Best answer: ' + answerLabel + '. ') + item.why
    ));
  }

  function updateScore() {
    var score = $('drill-score');
    if (!score) return;
    var result = engine.scoreDrill(answers);
    var answered = result.answered;
    score.textContent = '';
    if (answered === 0) {
      score.appendChild(el('p', null, 'No answers yet — ' + result.total + ' cases to go.'));
      return;
    }
    var p = el('p');
    p.appendChild(document.createTextNode('Scored '));
    var strong = el('strong', null, result.correct + ' / ' + result.total);
    p.appendChild(strong);
    p.appendChild(document.createTextNode(
      ' (' + engine.pct(result.accuracy) + ' accuracy). ' +
      (answered < result.total ? (result.total - answered) + ' case(s) unanswered.' : 'All cases answered.')
    ));
    score.appendChild(p);

    var reset = el('button', 'cta cta-ghost', 'Reset drill');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      answers = {};
      renderDrill();
    });
    score.appendChild(reset);
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    renderDetection();
    renderDrill();

    var runBtn = $('run-detector');
    if (runBtn) {
      runBtn.addEventListener('click', function () {
        renderDetection();
        runBtn.textContent = 'Run it again';
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
