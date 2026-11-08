// Pure, DOM-free Workday rules. Plain JS so they can be tested with `node --test`
// (same pattern as scanCoalescer.js).

/** Workday-hosted career sites only. */
export function isWorkdayHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  return host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com');
}

/** Whitespace-normalised, case-sensitive exact comparison (Playwright `exact: true`). */
export function isExactName(name, expected) {
  return String(name ?? '').replace(/\s+/g, ' ').trim() === expected;
}

/**
 * 'exists' -> section already has an entry form: never click Add (no duplicates)
 * 'add'    -> no entry yet and the exact "Add" button is visible: click it once
 * 'none'   -> nothing to do (section not on this page / no Add button)
 */
export function decideSectionAction({ hasEntry, hasAddButton }) {
  if (hasEntry) return 'exists';
  return hasAddButton ? 'add' : 'none';
}

/** DOM is settled: fields rendered, nothing busy, count stable, no mutations for quietMs. */
export function isSettled({ fieldCount, previousFieldCount, busy, lastMutationAt, now, quietMs }) {
  return fieldCount > 0 && !busy && fieldCount === previousFieldCount && now - lastMutationAt >= quietMs;
}
