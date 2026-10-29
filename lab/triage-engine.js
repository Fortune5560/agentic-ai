/* ============================================================================
   triage-engine.js
   ----------------------------------------------------------------------------
   Tier-1 log triage exercise: a deterministic detector plus a drill with an
   answer key.

   Two honest claims, and no others:
     1. The DETECTOR really runs. It parses the bundled sample auth log and
        derives every alert from rules in this file — nothing is hardcoded.
     2. The LOG IS SYNTHETIC. It is a hand-written practice log, not traffic from
        a client, an employer or a live network. Nothing here says anything about
        a real SOC.

   No clock, no randomness, no network: the same input always yields the same
   alerts, so the results can be re-run and compared.

   Browser: attaches `Triage` to the global object.
   Node:    require('./triage-engine.js')     or run the CLI below.
   ========================================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Triage = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* --------------------------------------------------------------------------
     Policy
     -------------------------------------------------------------------------- */
  const POLICY = {
    bruteForceFailures: 5,        // failures from one source before it counts
    bruteForceWindowMin: 10,      // within this many minutes
    sprayDistinctUsers: 5,        // distinct accounts from one source
    loginAfterFailures: 3,        // failures before a success = suspicious
    businessStartHour: 7,         // UTC; outside this is "off hours"
    businessEndHour: 19
  };

  const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

  /* --------------------------------------------------------------------------
     The sample log — synthetic, hand-written, deliberately messy.
     Format: ISO8601Z host process[pid]: message
     -------------------------------------------------------------------------- */
  const SAMPLE_LOG = [
    '2026-10-14T01:58:12Z auth sshd[2199]: Accepted publickey for t.okafor from 10.0.0.12 port 51221 ssh2',
    '2026-10-14T02:03:41Z auth sshd[2210]: Failed password for invalid user admin from 198.51.100.23 port 44012 ssh2',
    '2026-10-14T02:03:58Z auth sshd[2210]: Failed password for invalid user admin from 198.51.100.23 port 44088 ssh2',
    '2026-10-14T02:04:11Z auth sshd[2210]: Failed password for root from 198.51.100.23 port 44102 ssh2',
    '2026-10-14T02:04:29Z auth sshd[2211]: Failed password for root from 198.51.100.23 port 44150 ssh2',
    '2026-10-14T02:04:47Z auth sshd[2211]: Failed password for invalid user oracle from 198.51.100.23 port 44188 ssh2',
    '2026-10-14T02:05:02Z auth sshd[2211]: Failed password for root from 198.51.100.23 port 44210 ssh2',
    '2026-10-14T02:05:19Z auth sshd[2212]: Failed password for invalid user test from 198.51.100.23 port 44266 ssh2',
    '2026-10-14T02:11:07Z auth sshd[2214]: Failed password for j.adeyemi from 203.0.113.44 port 55112 ssh2',
    '2026-10-14T02:11:22Z auth sshd[2214]: Failed password for t.okafor from 203.0.113.44 port 55140 ssh2',
    '2026-10-14T02:11:39Z auth sshd[2215]: Failed password for m.bello from 203.0.113.44 port 55190 ssh2',
    '2026-10-14T02:11:55Z auth sshd[2215]: Failed password for admin from 203.0.113.44 port 55220 ssh2',
    '2026-10-14T02:12:10Z auth sshd[2215]: Failed password for svc_backup from 203.0.113.44 port 55261 ssh2',
    '2026-10-14T02:12:31Z auth sshd[2216]: Failed password for j.adeyemi from 203.0.113.44 port 55302 ssh2',
    '2026-10-14T02:13:04Z auth sshd[2217]: Failed password for j.adeyemi from 203.0.113.44 port 55380 ssh2',
    '2026-10-14T02:14:02Z auth sshd[2220]: Accepted password for j.adeyemi from 203.0.113.44 port 55410 ssh2',
    '2026-10-14T02:14:03Z auth sshd[2220]: pam_unix(sshd:session): session opened for user j.adeyemi by (uid=0)',
    '2026-10-14T02:19:44Z auth sudo[2231]: j.adeyemi : TTY=pts/0 ; PWD=/home/j.adeyemi ; USER=root ; COMMAND=/usr/bin/tar -czf /tmp/.cache.tgz /home',
    '2026-10-14T03:02:17Z auth useradd[2244]: new user: name=svc_backup, UID=1002, GID=1002, home=/home/svc_backup, shell=/bin/bash',
    '2026-10-14T03:04:51Z auth sudo[2246]: j.adeyemi : TTY=pts/0 ; PWD=/home/j.adeyemi ; USER=root ; COMMAND=/usr/sbin/useradd svc_backup',
    '2026-10-14T03:11:02Z auth sshd[2250]: Failed password for invalid user temp_contractor from 203.0.113.90 port 61002 ssh2',
    '2026-10-14T07:42:18Z auth sshd[2301]: Accepted publickey for t.okafor from 10.0.0.12 port 51488 ssh2',
    '2026-10-14T08:15:33Z auth sshd[2310]: Accepted password for m.bello from 10.0.0.31 port 52011 ssh2',
    '2026-10-14T09:20:05Z auth sudo[2340]: m.bello : TTY=pts/1 ; PWD=/srv/app ; USER=root ; COMMAND=/usr/bin/systemctl restart nginx',
    '2026-10-14T10:02:47Z auth sshd[2360]: Failed password for invalid user guest from 192.0.2.77 port 33210 ssh2',
    '2026-10-14T11:05:12Z auth sudo[2390]: t.okafor : TTY=pts/0 ; PWD=/root ; USER=root ; COMMAND=/bin/systemctl restart sshd',
    '2026-10-14T11:05:13Z auth sshd[2391]: Received signal 15; terminating.',
    '2026-10-14T11:05:44Z auth sshd[2400]: Server listening on 0.0.0.0 port 22.',
    '2026-10-14T13:27:59Z auth sshd[2455]: Accepted publickey for j.adeyemi from 10.0.0.18 port 53622 ssh2',
    '2026-10-14T14:10:23Z auth sshd[2470]: Failed password for m.bello from 10.0.0.55 port 54001 ssh2',
    '2026-10-14T14:10:29Z auth sshd[2470]: Accepted password for m.bello from 10.0.0.55 port 54019 ssh2',
    '2026-10-14T16:44:07Z auth sshd[2510]: Accepted password for svc_backup from 10.0.0.40 port 54890 ssh2',
    '2026-10-14T17:02:31Z auth sudo[2520]: svc_backup : TTY=pts/2 ; PWD=/opt/backup ; USER=root ; COMMAND=/usr/bin/rsync -a /var/data /mnt/nas',
    '2026-10-14T18:55:12Z auth sshd[2560]: Failed password for invalid user ubuntu from 198.51.100.23 port 44880 ssh2',
    '2026-10-14T18:55:29Z auth sshd[2560]: Failed password for invalid user ubuntu from 198.51.100.23 port 44901 ssh2',
    '2026-10-14T18:55:44Z auth sshd[2561]: Failed password for invalid user admin from 198.51.100.23 port 44933 ssh2',
    '2026-10-14T19:30:08Z auth sshd[2580]: Accepted publickey for t.okafor from 10.0.0.12 port 55340 ssh2'
  ];

  /* --------------------------------------------------------------------------
     Parser — anything it cannot parse is reported, not silently dropped
     -------------------------------------------------------------------------- */
  const LINE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+(\S+)\s+([\w.-]+)\[(\d+)\]:\s+(.*)$/;

  function parseLog(lines) {
    const events = [];
    const unparsed = [];

    (lines || SAMPLE_LOG).forEach(function (line, index) {
      const m = LINE_RE.exec(line);
      if (!m) {
        unparsed.push({ line: index + 1, text: line });
        return;
      }

      const ev = {
        line: index + 1,
        raw: line,
        ts: m[1],
        epoch: Date.parse(m[1]),
        host: m[2],
        process: m[3],
        pid: m[4],
        message: m[5],
        type: 'other',
        user: null,
        sourceIp: null,
        success: null
      };

      const failUser = /^Failed password for (?:invalid user )?(\S+) from (\S+)/.exec(ev.message);
      const acceptUser = /^Accepted (?:password|publickey) for (\S+) from (\S+)/.exec(ev.message);
      const newUser = /^new user: name=([^,]+)/.exec(ev.message);
      const sudoCmd = /^(\S+) : .*USER=root ; COMMAND=(.+)$/.exec(ev.message);

      if (failUser) {
        ev.type = 'auth_fail';
        ev.user = failUser[1];
        ev.sourceIp = failUser[2];
        ev.success = false;
        ev.invalidUser = /invalid user/.test(ev.message);
      } else if (acceptUser) {
        ev.type = 'auth_ok';
        ev.user = acceptUser[1];
        ev.sourceIp = acceptUser[2];
        ev.success = true;
        ev.method = /publickey/.test(ev.message) ? 'publickey' : 'password';
      } else if (newUser) {
        ev.type = 'user_created';
        ev.user = newUser[1].trim();
      } else if (sudoCmd) {
        ev.type = 'sudo';
        ev.user = sudoCmd[1];
        ev.command = sudoCmd[2];
      }

      events.push(ev);
    });

    return { events, unparsed };
  }

  /* --------------------------------------------------------------------------
     Detector — every alert below is derived from the parsed events
     -------------------------------------------------------------------------- */
  function hourOf(ev) {
    return Number(ev.ts.slice(11, 13));
  }

  function isOffHours(ev) {
    const h = hourOf(ev);
    return h < POLICY.businessStartHour || h >= POLICY.businessEndHour;
  }

  function isInternal(ip) {
    return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  }

  /* Returns an array of groups — an array keeps the two rule loops below
     readable and preserves insertion order. */
  function groupBy(list, keyFn) {
    const order = [];
    const buckets = {};
    list.forEach(function (item) {
      const k = keyFn(item);
      if (!buckets[k]) {
        buckets[k] = [];
        order.push(k);
      }
      buckets[k].push(item);
    });
    return order.map(function (k) { return buckets[k]; });
  }

  function detect(parsed) {
    const events = parsed.events;
    const alerts = [];

    function push(alert) {
      alerts.push(alert);
    }

    const failures = events.filter(function (e) { return e.type === 'auth_fail'; });
    const successes = events.filter(function (e) { return e.type === 'auth_ok'; });

    /* Rule 1 — brute force: many failures from one source inside the window. */
    groupBy(failures.filter(function (e) { return e.sourceIp; }), function (e) { return e.sourceIp; })
      .forEach(function (hits) {
        const sorted = hits.slice().sort(function (a, b) { return a.epoch - b.epoch; });
        let best = null;
        for (let i = 0; i < sorted.length; i++) {
          const window = sorted.filter(function (e) {
            return e.epoch >= sorted[i].epoch &&
              e.epoch - sorted[i].epoch <= POLICY.bruteForceWindowMin * 60000;
          });
          if (!best || window.length > best.length) best = window;
        }
        if (best && best.length >= POLICY.bruteForceFailures) {
          const users = Array.from(new Set(best.map(function (e) { return e.user; })));
          push({
            id: 'brute_force',
            severity: 'high',
            title: 'Brute-force pattern from ' + sorted[0].sourceIp,
            subject: sorted[0].sourceIp,
            detail: best.length + ' failed logins in ' + POLICY.bruteForceWindowMin +
              ' minutes against ' + users.length + ' account(s): ' + users.slice(0, 5).join(', '),
            evidence: best.map(function (e) { return e.line; }),
            firstSeen: best[0].ts,
            lastSeen: best[best.length - 1].ts
          });
        }
      });

    /* Rule 2 — password spray: one source, many distinct accounts. */
    groupBy(failures.filter(function (e) { return e.sourceIp; }), function (e) { return e.sourceIp; })
      .forEach(function (hits) {
        const users = Array.from(new Set(hits.map(function (e) { return e.user; })));
        if (users.length >= POLICY.sprayDistinctUsers) {
          push({
            id: 'password_spray',
            severity: 'high',
            title: 'Password spray from ' + hits[0].sourceIp,
            subject: hits[0].sourceIp,
            detail: users.length + ' distinct accounts tried from one source (' +
              hits.length + ' attempts total)',
            evidence: hits.map(function (e) { return e.line; }),
            firstSeen: hits[0].ts,
            lastSeen: hits[hits.length - 1].ts
          });
        }
      });

    /* Rule 3 — success after failures: the one that actually matters. */
    groupBy(failures, function (e) { return e.user + '|' + e.sourceIp; }).forEach(function (fails) {
      const key = fails[0].user + '|' + fails[0].sourceIp;
      const ok = successes.filter(function (e) {
        return (e.user + '|' + e.sourceIp) === key && e.epoch > fails[fails.length - 1].epoch;
      });
      if (fails.length >= POLICY.loginAfterFailures && ok.length > 0) {
        push({
          id: 'success_after_failure',
          severity: 'critical',
          title: 'Successful login after repeated failures — ' + fails[0].user,
          subject: fails[0].user + ' from ' + fails[0].sourceIp,
          detail: fails.length + ' failed attempts followed by a successful login at ' +
            ok[0].ts + '; treat as possible account compromise',
          evidence: fails.map(function (e) { return e.line; }).concat([ok[0].line]),
          firstSeen: fails[0].ts,
          lastSeen: ok[0].ts
        });
      }
    });

    /* Rule 4 — sudo outside business hours. */
    events.filter(function (e) { return e.type === 'sudo' && isOffHours(e); })
      .forEach(function (e) {
        push({
          id: 'off_hours_sudo',
          severity: 'medium',
          title: 'Off-hours privilege use — ' + e.user,
          subject: e.user,
          detail: 'sudo at ' + e.ts + ' ran: ' + e.command,
          evidence: [e.line],
          firstSeen: e.ts,
          lastSeen: e.ts
        });
      });

    /* Rule 5 — account creation outside business hours. */
    events.filter(function (e) { return e.type === 'user_created' && isOffHours(e); })
      .forEach(function (e) {
        push({
          id: 'off_hours_account_creation',
          severity: 'medium',
          title: 'Account created off-hours — ' + e.user,
          subject: e.user,
          detail: 'New local account at ' + e.ts + ' with no matching change window',
          evidence: [e.line],
          firstSeen: e.ts,
          lastSeen: e.ts
        });
      });

    /* Rule 6 — external users attempting logins (low, but worth a count). */
    const externalInvalid = failures.filter(function (e) {
      return e.sourceIp && !isInternal(e.sourceIp) && e.invalidUser;
    });
    if (externalInvalid.length > 0) {
      const ips = Array.from(new Set(externalInvalid.map(function (e) { return e.sourceIp; })));
      push({
        id: 'external_invalid_users',
        severity: 'low',
        title: 'External logins against non-existent accounts',
        subject: ips.join(', '),
        detail: externalInvalid.length + ' attempts against invalid usernames from ' +
          ips.length + ' external address(es)',
        evidence: externalInvalid.map(function (e) { return e.line; }),
        firstSeen: externalInvalid[0].ts,
        lastSeen: externalInvalid[externalInvalid.length - 1].ts
      });
    }

    /* Correlate: an off-hours sudo or account creation by a subject that also
       has a success-after-failure alert is part of the same intrusion, not a
       separate medium finding. */
    const compromised = alerts
      .filter(function (a) { return a.id === 'success_after_failure'; })
      .map(function (a) { return a.subject.split(' from ')[0]; });

    alerts.forEach(function (a) {
      if (a.id === 'off_hours_sudo' || a.id === 'off_hours_account_creation') {
        if (compromised.indexOf(a.subject) !== -1) {
          a.severity = 'critical';
          a.correlatedWith = 'success_after_failure';
          a.detail += ' — same account as the suspected compromise, treat as one incident';
        }
      }
    });

    alerts.sort(function (a, b) {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return s !== 0 ? s : a.firstSeen < b.firstSeen ? -1 : 1;
    });

    alerts.forEach(function (a, i) { a.position = i + 1; });
    return alerts;
  }

  /* --------------------------------------------------------------------------
     Drill — an answer key written from Tier-1 triage reasoning, not from the
     detector's output. `prompt` is what the screen shows; `why` explains why.
     All four dispositions are the correct answer at least once (see tests).
     -------------------------------------------------------------------------- */
  const DRILL = [
    {
      id: 'D1',
      prompt: '7 failed root/admin logins from 198.51.100.23 between 02:03 and 02:05. No success.',
      answer: 'block',
      why: 'Internet-facing brute force against privileged accounts at 2 a.m. is not something to wait on. Block the source and confirm no success followed — that is the standard Tier-1 containment step, and it is reversible if it turns out to be noise.'
    },
    {
      id: 'D2',
      prompt: 'Six failed logins across five accounts from 203.0.113.44, then Accepted password for j.adeyemi from the same address.',
      answer: 'escalate',
      why: 'A successful login after repeated failures from one source is the signature of a working credential. This is beyond containment: it goes to incident response now, and the account gets treated as compromised until proven otherwise.'
    },
    {
      id: 'D3',
      prompt: 'sudo systemctl restart sshd by t.okafor at 11:05 from the office subnet, during a maintenance window.',
      answer: 'benign',
      why: 'A known admin, privileged but expected command, business hours, internal source. Note the change record and close it — escalating every sudo event is how real alerts get ignored.'
    },
    {
      id: 'D4',
      prompt: 'One failed login for "temp_contractor" (account does not exist) from an external IP. Nothing else from that address all day.',
      answer: 'benign',
      why: 'A single attempt against a non-existent account is background internet noise. Log it, let it contribute to a trend, and move on — escalating individual internet scans is how a queue becomes useless.'
    },
    {
      id: 'D5',
      prompt: 'New local account svc_backup created at 03:02, minutes after a successful login that followed six failures.',
      answer: 'escalate',
      why: 'Persistence. Creating an account off-hours, immediately after a suspicious successful login, is the attacker building a way back in. This is the same incident as D2 and it is now urgent.'
    },
    {
      id: 'D6',
      prompt: 'Five accounts tried from one source in 90 seconds, one attempt each, no successes.',
      answer: 'block',
      why: 'Password spraying spreads attempts to stay under per-account lockout thresholds. Blocking the source stops the campaign; per-account lockout rules alone would never trigger.'
    },
    {
      id: 'D7',
      prompt: 'Three external addresses made nine attempts against non-existent usernames across the day. No successes, no repeats, spread over nine hours.',
      answer: 'investigate',
      why: 'Not urgent and not containable as one action: nothing succeeded and there is no single source to block. But a sustained pattern across several addresses is worth a look — check whether those addresses appear elsewhere in the estate before closing it as noise.'
    }
  ];

  const DRILL_OPTIONS = [
    { id: 'benign', label: 'Benign — close it and note the evidence' },
    { id: 'investigate', label: 'Needs investigation — pull more context first' },
    { id: 'block', label: 'Block the source, then verify nothing succeeded' },
    { id: 'escalate', label: 'Escalate to incident response now' }
  ];

  /* --------------------------------------------------------------------------
     Public surface
     -------------------------------------------------------------------------- */
  function run(lines) {
    const parsed = parseLog(lines);
    const alerts = detect(parsed);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    alerts.forEach(function (a) { counts[a.severity]++; });

    return {
      events: parsed.events.length,
      unparsed: parsed.unparsed,
      alerts,
      counts,
      externalIps: Array.from(new Set(parsed.events
        .filter(function (e) { return e.sourceIp && !isInternal(e.sourceIp); })
        .map(function (e) { return e.sourceIp; }))),
      firstEvent: parsed.events.length ? parsed.events[0].ts : null,
      lastEvent: parsed.events.length ? parsed.events[parsed.events.length - 1].ts : null
    };
  }

  function scoreDrill(answers) {
    let correct = 0;
    const results = DRILL.map(function (item) {
      const chosen = answers[item.id] || null;
      const ok = chosen === item.answer;
      if (ok) correct++;
      return { id: item.id, chosen: chosen, answer: item.answer, correct: ok };
    });
    return {
      total: DRILL.length,
      answered: results.filter(function (r) { return r.chosen; }).length,
      correct: correct,
      accuracy: correct / DRILL.length,
      results
    };
  }

  return {
    POLICY,
    SAMPLE_LOG,
    DRILL,
    DRILL_OPTIONS,
    parseLog,
    detect,
    run,
    scoreDrill,
    pct: function (n) { return Math.round(n * 1000) / 10; }
  };
});

/* ---------------------------------------------------------------------------
   CLI: node lab/triage-engine.js [--json]
   Exits non-zero if the sample log fails to parse fully, if a documented rule
   stops firing, or if the critical chain disappears — i.e. if the demo regresses.
   -------------------------------------------------------------------------- */
if (typeof require === 'function' && typeof module === 'object' && module.exports &&
    typeof process === 'object' && require.main === module) {
  const engine = module.exports;
  const report = engine.run();

  const required = ['brute_force', 'password_spray', 'success_after_failure',
    'off_hours_sudo', 'off_hours_account_creation', 'external_invalid_users'];
  const found = report.alerts.map(function (a) { return a.id; });
  const missing = required.filter(function (r) { return found.indexOf(r) === -1; });
  const critical = report.alerts.filter(function (a) { return a.severity === 'critical'; });
  const ok = report.unparsed.length === 0 && missing.length === 0 && critical.length >= 2;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      sampleLog: 'synthetic',
      events: report.events,
      counts: report.counts,
      rulesFired: found,
      alerts: report.alerts.map(function (a) {
        return { id: a.id, severity: a.severity, subject: a.subject, evidenceLines: a.evidence.length };
      })
    }, null, 2));
    process.exit(ok ? 0 : 1);
  }

  console.log('\nTier-1 log triage — deterministic detector over the SYNTHETIC sample log');
  console.log('='.repeat(70));
  console.log('Parsed events      : ' + report.events);
  console.log('Unparsed lines     : ' + report.unparsed.length);
  console.log('Window             : ' + report.firstEvent + ' → ' + report.lastEvent);
  console.log('External sources   : ' + report.externalIps.join(', '));
  console.log('-'.repeat(70));
  report.alerts.forEach(function (a) {
    console.log('  [' + a.severity.toUpperCase() + '] ' + a.title);
    console.log('           ' + a.detail);
  });
  console.log('-'.repeat(70));
  console.log('Alerts by severity: critical ' + report.counts.critical + ', high ' + report.counts.high +
    ', medium ' + report.counts.medium + ', low ' + report.counts.low);
  if (missing.length) console.log('MISSING RULES      : ' + missing.join(', '));
  console.log(ok ? '\nRESULT: PASS\n' : '\nRESULT: FAIL\n');
  process.exit(ok ? 0 : 1);
}
