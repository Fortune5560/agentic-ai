/* ============================================================================
   ops-agent-engine.js
   ----------------------------------------------------------------------------
   A small, deterministic, rules-based "triage -> decide -> act/escalate"
   engine that models how I gate an operations agent.

   It is deliberately NOT an LLM call: the whole point of the demo is that the
   decision logic is inspectable, deterministic, and testable without network
   access or API keys. Given the same incident it always returns the same
   decision, which is what makes the test harness repeatable.

   Loads in a browser (attaches `OpsAgent` to the global object) or in Node
   (`require('./ops-agent-engine.js')`), so the exact same code that runs in the
   demo page is the code the test suite exercises.

   Run the suite:   node demo/ops-agent-engine.js
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OpsAgent = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* --------------------------------------------------------------------------
     Policy constants
     These are the knobs a human operator would tune. They are stated up front
     so the demo's behaviour is auditable rather than mysterious.
     -------------------------------------------------------------------------- */
  const POLICY = {
    // Below this evidence score the agent does not trust itself and escalates.
    minConfidence: 0.55,
    // Blast-radius guard: even a safe, reversible playbook gets a human when
    // the incident is this large. Tune to your own risk appetite.
    maxAffectedUsers: 25000,
    maxRevenueAtRiskUsd: 100000,
    // Evidence is clamped to [0, 1].
    evidenceCeiling: 1
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /* --------------------------------------------------------------------------
     Approved playbooks
     `risk` describes how hard an action is to undo, not how loud it is.
     Anything marked 'high' can never be executed autonomously.
     -------------------------------------------------------------------------- */
  const PLAYBOOKS = [
    {
      id: 'restart_service',
      symptom: 'http_5xx_spike',
      action: 'Restart the API service pods (rolling, one at a time)',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.errorRate - 0.02) / 0.25, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'scale_out_replicas',
      symptom: 'worker_backlog',
      action: 'Scale worker replicas from 4 to 12',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.queueDepth - 200) / 3000, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'clear_cache',
      symptom: 'stale_cache',
      action: 'Flush the edge cache for the affected route prefix',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.cacheHitRateDrop || 0) / 0.4, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'rotate_connection_pool',
      symptom: 'db_connection_exhaustion',
      action: 'Recycle the database connection pool',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.poolUtilization - 0.5) / 0.45, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'disable_feature_flag',
      symptom: 'bad_feature_flag',
      action: 'Disable feature flag `checkout_v3` and re-route traffic to the stable path',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.errorRate - 0.01) / 0.3, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'purge_stale_locks',
      symptom: 'zombie_locks',
      action: 'Release locks held by dead worker IDs',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.staleLocks || 0) / 40, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'reroute_traffic',
      symptom: 'traffic_hotspot',
      action: 'Shift 30% of traffic to the secondary region',
      risk: 'low',
      reversible: true,
      evidence: (s) => clamp((s.saturation - 0.6) / 0.35, 0, POLICY.evidenceCeiling)
    },
    {
      id: 'rollback_deploy',
      symptom: 'post_deploy_regression',
      action: 'Roll back release 2026.10.27 to the previous known-good build',
      risk: 'medium',
      reversible: true,
      evidence: (s) => clamp((s.errorRate - 0.05) / 0.4, 0, POLICY.evidenceCeiling)
    }
  ];

  /* Actions an operator sometimes asks for that are never safe to auto-run,
     however plausible the request sounds. */
  const DESTRUCTIVE_ACTIONS = [
    { pattern: /\bdelete\b|\bdrop\b|truncate|purge_all|rm -rf/i, action: 'Destructive data operation' },
    { pattern: /\bmigrat(e|ion)\b/i, action: 'Schema migration' },
    { pattern: /rotate.*(secret|credential|key)/i, action: 'Credential rotation' },
    { pattern: /\bpause\b.*\b(billing|collection|invoice)/i, action: 'Billing pause' }
  ];

  /* --------------------------------------------------------------------------
     Step 1 — classify
     Severity is derived from the signals, never from the incident's own label.
     -------------------------------------------------------------------------- */
  function classify(incident) {
    const s = incident.signals || {};
    let score = 0;
    if (s.errorRate >= 0.5) score += 3;
    else if (s.errorRate >= 0.15) score += 2;
    else if (s.errorRate >= 0.05) score += 1;

    if (s.affectedUsers >= 25000) score += 3;
    else if (s.affectedUsers >= 5000) score += 2;
    else if (s.affectedUsers >= 500) score += 1;

    if (s.revenueAtRiskUsd >= 100000) score += 3;
    else if (s.revenueAtRiskUsd >= 10000) score += 2;
    else if (s.revenueAtRiskUsd >= 1000) score += 1;

    const severity =
      score >= 7 ? 'critical' : score >= 4 ? 'high' : score >= 2 ? 'moderate' : 'low';

    return { severity, severityScore: score };
  }

  /* --------------------------------------------------------------------------
     Step 2 — pick a candidate action
     -------------------------------------------------------------------------- */
  function selectCandidate(incident) {
    const requested = (incident.requestedAction || '').trim();

    if (requested) {
      const blocked = DESTRUCTIVE_ACTIONS.find((d) => d.pattern.test(requested));
      if (blocked) {
        return {
          kind: 'blocked_request',
          playbook: null,
          action: blocked.action + ': "' + requested + '"',
          risk: 'high',
          reversible: false,
          confidence: 1,
          reason: 'The requested action matches a category I never run without a human signing off.'
        };
      }
      return {
        kind: 'unverified_request',
        playbook: null,
        action: '"' + requested + '"',
        risk: 'high',
        reversible: false,
        confidence: 0,
        reason: 'A free-text instruction is not an approved playbook, so I cannot verify its blast radius.'
      };
    }

    const s = incident.signals || {};
    const matches = PLAYBOOKS.filter((p) => p.symptom === incident.symptom);

    if (matches.length === 0) {
      return {
        kind: 'no_playbook',
        playbook: null,
        action: 'No approved playbook for this symptom',
        risk: 'unknown',
        reversible: false,
        confidence: 0,
        reason: 'I have no approved runbook for "' + (incident.symptom || 'unknown') + '".'
      };
    }

    const best = matches[0];
    const confidence = best.evidence(s);

    return {
      kind: 'playbook',
      playbook: best,
      action: best.action,
      risk: best.risk,
      reversible: best.reversible,
      confidence: confidence,
      reason:
        confidence >= POLICY.minConfidence
          ? 'Signals match the approved playbook with enough evidence to act.'
          : 'Signals match the playbook but the evidence is too thin to act on alone.'
    };
  }

  /* --------------------------------------------------------------------------
     Step 3 — decide, with every guard recorded in the audit trail
     -------------------------------------------------------------------------- */
  function decide(incident) {
    const s = incident.signals || {};
    const audit = [];
    let clock = 0;
    const log = (message, level) => {
      clock += 1;
      audit.push({ step: clock, level: level || 'info', message });
    };

    log('Incident received: ' + incident.title);

    const { severity, severityScore } = classify(incident);
    log('Classified severity ' + severity + ' (score ' + severityScore + ') from error rate, affected users and revenue at risk.');

    const candidate = selectCandidate(incident);
    log('Candidate action: ' + candidate.action + ' [' + candidate.risk + ' risk]');

    const guards = [];

    if (candidate.kind === 'blocked_request') {
      guards.push({ guard: 'destructive-action blocklist', tripped: true, detail: 'High-impact request can never run unattended.' });
    }
    if (candidate.kind === 'unverified_request') {
      guards.push({ guard: 'unverified-instruction guard', tripped: true, detail: 'Free-text instructions are not an approved playbook.' });
    }
    if (candidate.kind === 'no_playbook') {
      guards.push({ guard: 'runbook coverage', tripped: true, detail: 'No approved playbook for this symptom.' });
    }
    if (candidate.kind === 'playbook') {
      guards.push({
        guard: 'confidence threshold',
        tripped: candidate.confidence < POLICY.minConfidence,
        detail: 'Evidence ' + candidate.confidence.toFixed(2) + ' vs required ' + POLICY.minConfidence.toFixed(2)
      });
      guards.push({
        guard: 'risk tier',
        tripped: candidate.risk !== 'low',
        detail: candidate.risk === 'low' ? 'Reversible, low-impact action.' : 'Action is not low risk, so a human approves it.'
      });
    }

    const blastRadius = s.affectedUsers >= POLICY.maxAffectedUsers || s.revenueAtRiskUsd >= POLICY.maxRevenueAtRiskUsd;
    guards.push({
      guard: 'blast-radius cap',
      tripped: blastRadius,
      detail:
        'affectedUsers ' + (s.affectedUsers || 0) + ' / cap ' + POLICY.maxAffectedUsers +
        ', revenueAtRisk ' + (s.revenueAtRiskUsd || 0) + ' / cap ' + POLICY.maxRevenueAtRiskUsd
    });

    guards.forEach((g) => {
      log(g.guard + ': ' + (g.tripped ? 'TRIPPED' : 'clear') + ' — ' + g.detail, g.tripped ? 'warn' : 'info');
    });

    const tripped = guards.filter((g) => g.tripped);

    if (tripped.length > 0) {
      log('Decision: escalate to on-call with a prepared remediation plan. No action executed.');
      return {
        incidentId: incident.id,
        decision: 'escalate',
        executed: false,
        action: candidate.action,
        risk: candidate.risk,
        severity,
        confidence: candidate.confidence,
        reason: candidate.reason,
        blockingGuards: tripped.map((g) => g.guard),
        guards,
        audit
      };
    }

    log('All guards clear. Executing approved playbook "' + candidate.playbook.id + '".');
    log('Verification scheduled: re-check signals after 120s; auto-rollback plan attached.');
    return {
      incidentId: incident.id,
      decision: 'auto_resolve',
      executed: true,
      action: candidate.action,
      risk: candidate.risk,
      severity,
      confidence: candidate.confidence,
      reason: candidate.reason,
      blockingGuards: [],
      guards,
      audit
    };
  }

  /* --------------------------------------------------------------------------
     Answer key
     Each scenario states independently what a competent on-call engineer should
     do. The expectations were written from ops reasoning, not from the engine's
     output; the harness reports where the two disagree.
     -------------------------------------------------------------------------- */
  const SCENARIOS = [
    {
      id: 'S01',
      title: 'API error rate spikes after a deploy',
      symptom: 'http_5xx_spike',
      signals: { errorRate: 0.22, affectedUsers: 3200, revenueAtRiskUsd: 8000 },
      expect: { decision: 'auto_resolve', executed: false }
    },
    {
      id: 'S02',
      title: 'Three 5xx alerts, almost no traffic affected',
      symptom: 'http_5xx_spike',
      signals: { errorRate: 0.06, affectedUsers: 40, revenueAtRiskUsd: 0 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S03',
      title: 'Background worker queue backs up',
      symptom: 'worker_backlog',
      signals: { errorRate: 0.01, affectedUsers: 800, revenueAtRiskUsd: 2000, queueDepth: 4200 },
      expect: { decision: 'auto_resolve' }
    },
    {
      id: 'S04',
      title: 'Edge cache serves stale prices',
      symptom: 'stale_cache',
      signals: { errorRate: 0.0, affectedUsers: 5000, revenueAtRiskUsd: 15000, cacheHitRateDrop: 0.35 },
      expect: { decision: 'auto_resolve' }
    },
    {
      id: 'S05',
      title: 'Database connection pool saturated',
      symptom: 'db_connection_exhaustion',
      signals: { errorRate: 0.12, affectedUsers: 12000, revenueAtRiskUsd: 20000, poolUtilization: 0.94 },
      expect: { decision: 'auto_resolve' }
    },
    {
      id: 'S06',
      title: 'Checkout flag rollout causing errors',
      symptom: 'bad_feature_flag',
      signals: { errorRate: 0.19, affectedUsers: 6000, revenueAtRiskUsd: 30000 },
      expect: { decision: 'auto_resolve' }
    },
    {
      id: 'S07',
      title: 'Stale locks blocking a batch job',
      symptom: 'zombie_locks',
      signals: { errorRate: 0.0, affectedUsers: 300, revenueAtRiskUsd: 0, staleLocks: 31 },
      expect: { decision: 'auto_resolve' }
    },
    {
      id: 'S08',
      title: 'Single-region saturation during a sale',
      symptom: 'traffic_hotspot',
      signals: { errorRate: 0.04, affectedUsers: 40000, revenueAtRiskUsd: 60000, saturation: 0.92 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S09',
      title: 'Scheduler drift, symptom never seen before',
      symptom: 'unknown_scheduler_drift',
      signals: { errorRate: 0.08, affectedUsers: 900, revenueAtRiskUsd: 3000 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S10',
      title: 'Operator asks the agent to delete old orders',
      symptom: 'manual_request',
      requestedAction: 'delete old orders older than 90 days',
      signals: { errorRate: 0.0, affectedUsers: 0, revenueAtRiskUsd: 0 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S11',
      title: 'Total outage with huge blast radius',
      symptom: 'http_5xx_spike',
      signals: { errorRate: 0.8, affectedUsers: 50000, revenueAtRiskUsd: 250000 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S12',
      title: 'Queue noise: 30 jobs deep, two users',
      symptom: 'worker_backlog',
      signals: { errorRate: 0.0, affectedUsers: 2, revenueAtRiskUsd: 0, queueDepth: 30 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S13',
      title: 'Post-deploy regression on the payments path',
      symptom: 'post_deploy_regression',
      signals: { errorRate: 0.31, affectedUsers: 7000, revenueAtRiskUsd: 45000 },
      expect: { decision: 'escalate' }
    },
    {
      id: 'S14',
      title: 'Regional cache miss storm, mid-size impact',
      symptom: 'stale_cache',
      signals: { errorRate: 0.02, affectedUsers: 1800, revenueAtRiskUsd: 4000, cacheHitRateDrop: 0.28 },
      expect: { decision: 'auto_resolve' }
    }
  ];

  /* --------------------------------------------------------------------------
     Harness
     -------------------------------------------------------------------------- */
  function runScenario(scenario) {
    const result = decide(scenario);
    const decisionOK = result.decision === scenario.expect.decision;
    // "Executed" is the dangerous direction: acting when the answer key said
    // do not act. Acting on an incident that should have been escalated is
    // counted separately from merely mislabeling a decision.
    const unsafe =
      result.executed === true && scenario.expect.decision !== 'auto_resolve';
    return {
      id: scenario.id,
      title: scenario.title,
      expected: scenario.expect.decision,
      actual: result.decision,
      pass: decisionOK,
      unsafe,
      severity: result.severity,
      confidence: Number(result.confidence.toFixed(2)),
      blockingGuards: result.blockingGuards,
      result
    };
  }

  function runSuite() {
    const runs = SCENARIOS.map(runScenario);
    const total = runs.length;
    const autoResolved = runs.filter((r) => r.actual === 'auto_resolve').length;
    const escalated = total - autoResolved;
    const passed = runs.filter((r) => r.pass).length;
    const unsafe = runs.filter((r) => r.unsafe).length;

    // Determinism check: the same inputs must produce byte-identical decisions.
    const replay = SCENARIOS.map(runScenario);
    const deterministic = JSON.stringify(runs.map((r) => r.result)) === JSON.stringify(replay.map((r) => r.result));

    // Coverage: every guard in the policy should actually be exercised.
    const trippedGuards = new Set();
    runs.forEach((r) => r.blockingGuards.forEach((g) => trippedGuards.add(g)));
    const allGuards = new Set(
      runs.flatMap((r) => r.result.guards.map((g) => g.guard))
    );
    const exercised = Array.from(trippedGuards).sort();

    return {
      total,
      autoResolved,
      escalated,
      passed,
      failed: total - passed,
      unsafe,
      deterministic,
      autoResolveRate: autoResolved / total,
      decisionAccuracy: passed / total,
      guardedCoverage: exercised.length / allGuards.size,
      exercisedGuards: exercised,
      runs
    };
  }

  return {
    POLICY,
    PLAYBOOKS,
    SCENARIOS,
    classify,
    selectCandidate,
    decide,
    runSuite,
    pct: (n) => Math.round(n * 1000) / 10
  };
});

/* ---------------------------------------------------------------------------
   CLI: `node demo/ops-agent-engine.js`
   Exits non-zero when any scenario diverges from the answer key or when the
   engine is not deterministic, so it can gate a change in CI.
   ------------------------------------------------------------------------- */
if (typeof require === 'function' && typeof module === 'object' && module.exports && typeof process === 'object' && require.main === module) {
  const engine = module.exports;
  const report = engine.runSuite();

  // `--json` emits the machine-readable report, e.g. to diff results between runs.
  if (process.argv.includes('--json')) {
    const { runs, ...summary } = report;
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      summary,
      scenarios: runs.map((r) => ({
        id: r.id, title: r.title, expected: r.expected, actual: r.actual, pass: r.pass, unsafe: r.unsafe
      }))
    }, null, 2));
    process.exit(report.failed === 0 && report.unsafe === 0 && report.deterministic ? 0 : 1);
  }

  const line = (ok, text) => console.log((ok ? '  PASS  ' : '  FAIL  ') + text);

  console.log('\nOps-agent demo — repeatable test suite');
  console.log('='.repeat(64));
  report.runs.forEach((r) => {
    line(r.pass, r.id + ' ' + r.title);
    if (!r.pass) {
      console.log('          expected ' + r.expected + ', got ' + r.actual +
        (r.blockingGuards.length ? ' (blocked by: ' + r.blockingGuards.join(', ') + ')' : ''));
    }
  });

  console.log('-'.repeat(64));
  console.log('Scenarios            : ' + report.total);
  console.log('Auto-resolved        : ' + report.autoResolved + ' (' + engine.pct(report.autoResolveRate) + '%)');
  console.log('Escalated to a human : ' + report.escalated);
  console.log('Decision accuracy    : ' + report.passed + '/' + report.total + ' (' + engine.pct(report.decisionAccuracy) + '%)');
  console.log('Unsafe executions    : ' + report.unsafe);
  console.log('Deterministic replay : ' + (report.deterministic ? 'yes' : 'NO'));
  console.log('Guards exercised     : ' + report.exercisedGuards.join(', '));
  console.log('-'.repeat(64));

  const ok = report.failed === 0 && report.unsafe === 0 && report.deterministic;
  console.log(ok ? 'RESULT: PASS\n' : 'RESULT: FAIL\n');
  process.exit(ok ? 0 : 1);
}
