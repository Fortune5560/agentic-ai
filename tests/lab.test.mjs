import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const engine = require('../lab/triage-engine.js');

const report = engine.run();

test('sample log parses with no unparsed lines', () => {
  assert.equal(report.unparsed.length, 0, 'unparsed: ' + JSON.stringify(report.unparsed));
  assert.ok(report.events > 30, 'expected a log of more than 30 events');
});

test('every documented rule fires at least once', () => {
  const fired = new Set(report.alerts.map((a) => a.id));
  const expected = [
    'brute_force',
    'password_spray',
    'success_after_failure',
    'off_hours_sudo',
    'off_hours_account_creation',
    'external_invalid_users'
  ];
  for (const id of expected) {
    assert.ok(fired.has(id), 'rule did not fire: ' + id);
  }
  assert.equal(fired.size, expected.length, 'unexpected extra rule fired');
});

test('at least two critical alerts are raised', () => {
  assert.ok(report.counts.critical >= 2, 'critical alerts: ' + report.counts.critical);
});

test('every alert carries evidence that maps to real log lines', () => {
  const lines = engine.SAMPLE_LOG.length;
  for (const alert of report.alerts) {
    assert.ok(alert.evidence.length > 0, alert.id + ' has no evidence');
    for (const line of alert.evidence) {
      assert.ok(line >= 1 && line <= lines, alert.id + ' cites line ' + line);
    }
    assert.ok(alert.firstSeen, alert.id + ' has no firstSeen timestamp');
    assert.ok(['critical', 'high', 'medium', 'low'].includes(alert.severity));
  }
});

test('the detector is deterministic', () => {
  const a = JSON.stringify(engine.run().alerts);
  const b = JSON.stringify(engine.run().alerts);
  assert.equal(a, b);
});

test('alerts are ordered by severity then time', () => {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  for (let i = 1; i < report.alerts.length; i++) {
    const prev = report.alerts[i - 1];
    const next = report.alerts[i];
    if (rank[prev.severity] === rank[next.severity]) {
      assert.ok(prev.firstSeen <= next.firstSeen, 'out of time order at index ' + i);
    } else {
      assert.ok(rank[prev.severity] < rank[next.severity], 'out of severity order at index ' + i);
    }
  }
});

test('the success-after-failure alert is critical and names a user', () => {
  const found = report.alerts.find((a) => a.id === 'success_after_failure');
  assert.ok(found, 'no success_after_failure alert');
  assert.equal(found.severity, 'critical');
  assert.ok(found.title.length > 10);
});

test('external sources are non-private addresses', () => {
  assert.ok(report.externalIps.length > 0);
  for (const ip of report.externalIps) {
    assert.ok(
      !/^10\./.test(ip) && !/^192\.168\./.test(ip),
      'private address counted as external: ' + ip
    );
    assert.ok(
      /^(198\.51\.100|203\.0\.113|192\.0\.2)\./.test(ip),
      'unexpected external address: ' + ip
    );
  }
});

test('a malformed line is reported, not silently dropped', () => {
  const withJunk = engine.SAMPLE_LOG.concat(['this is not a log line']);
  const result = engine.run(withJunk);
  assert.equal(result.unparsed.length, 1);
  assert.equal(result.unparsed[0].line, withJunk.length);
});

test('drill has seven cases and covers all four dispositions', () => {
  assert.equal(engine.DRILL.length, 7);
  const answers = new Set(engine.DRILL.map((d) => d.answer));
  assert.deepEqual([...answers].sort(), ['benign', 'block', 'escalate', 'investigate']);
});

test('every drill case has a prompt, an answer and a reason', () => {
  const ids = new Set(engine.DRILL_OPTIONS.map((o) => o.id));
  for (const item of engine.DRILL) {
    assert.ok(item.id && item.prompt.length > 20, 'thin prompt for ' + item.id);
    assert.ok(ids.has(item.answer), 'unknown answer for ' + item.id);
    assert.ok(item.why.length > 40, 'thin rationale for ' + item.id);
  }
});

test('a perfect drill scores 7 of 7', () => {
  const answers = {};
  engine.DRILL.forEach((item) => { answers[item.id] = item.answer; });
  const result = engine.scoreDrill(answers);
  assert.equal(result.correct, 7);
  assert.equal(result.total, 7);
  assert.equal(result.answered, 7);
  assert.equal(result.accuracy, 1);
  assert.equal(engine.pct(result.accuracy), 100);
});

test('an empty drill scores zero but still reports the total', () => {
  const result = engine.scoreDrill({});
  assert.equal(result.correct, 0);
  assert.equal(result.answered, 0);
  assert.equal(result.total, 7);
  assert.equal(engine.pct(result.accuracy), 0);
  for (const row of result.results) assert.equal(row.chosen, null);
});

test('the CLI exits 0 and reports PASS', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.join(here, '..', 'lab', 'triage-engine.js');
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'CLI exited non-zero:\n' + result.stdout + result.stderr);
  assert.match(result.stdout, /RESULT: PASS/);
  assert.match(result.stdout, /critical 3/);
});

test('the JSON CLI emits a parseable report', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.join(here, '..', 'lab', 'triage-engine.js');
  const result = spawnSync(process.execPath, [cli, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.events, report.events);
  assert.equal(parsed.alerts.length, report.alerts.length);
});
