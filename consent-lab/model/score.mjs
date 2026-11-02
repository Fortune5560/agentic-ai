/* ============================================================================
   score.mjs — scoring for the consent model harness
   Kept separate from measure.mjs so it can be tested without a model running.
   ========================================================================== */

export const FIELDS = [
  'decision',
  'reject_reason',
  'consent_months',
  'scopes',
  'language',
  'witness_required',
  'contains_contact_details'
];

const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

export function normalise(actual) {
  const a = actual && typeof actual === 'object' ? actual : {};
  const scopes = Array.isArray(a.scopes)
    ? a.scopes.map(norm).filter(Boolean).sort()
    : [];
  const months = a.consent_months === null || a.consent_months === undefined || a.consent_months === ''
    ? null
    : Number(a.consent_months);
  return {
    decision: norm(a.decision),
    reject_reason: norm(a.reject_reason) || '',
    consent_months: Number.isFinite(months) ? months : null,
    scopes,
    language: norm(a.language),
    witness_required: a.witness_required === true || a.witness_required === 'true',
    contains_contact_details: a.contains_contact_details === true || a.contains_contact_details === 'true'
  };
}

export function scoreItem(expect, actual) {
  const e = normalise(expect);
  const a = normalise(actual);
  const fields = {};
  for (const field of FIELDS) {
    if (field === 'scopes') {
      fields.scopes = JSON.stringify(e.scopes) === JSON.stringify(a.scopes);
    } else {
      fields[field] = e[field] === a[field];
    }
  }
  const matched = FIELDS.filter((f) => fields[f]).length;
  return {
    ok: matched === FIELDS.length,
    fields,
    matched,
    total: FIELDS.length,
    expected: e,
    actual: a
  };
}

export function summarise(rows) {
  const items = rows.length;
  const correct = rows.filter((r) => r.score.ok).length;
  const perField = {};
  for (const field of FIELDS) {
    perField[field] = rows.filter((r) => r.score.fields[field]).length;
  }
  const dangerous = rows.filter((r) =>
    r.score.expected.decision === 'reject' && r.score.actual.decision === 'accept'
  ).length;

  return {
    items,
    correct,
    accuracy: items ? correct / items : 0,
    perField,
    perFieldAccuracy: Object.fromEntries(
      Object.entries(perField).map(([k, v]) => [k, items ? v / items : 0])
    ),
    unparseable: rows.filter((r) => r.parseError).length,
    // The failure that matters: the model says yes where policy says no.
    unsafeAccepts: dangerous,
    failures: rows.filter((r) => !r.score.ok).map((r) => ({
      id: r.id,
      parseError: r.parseError || null,
      raw: r.raw || null,
      expected: r.score.expected,
      actual: r.score.actual,
      wrongFields: FIELDS.filter((f) => !r.score.fields[f])
    }))
  };
}

export function pct(n) {
  return Math.round(n * 1000) / 10;
}
