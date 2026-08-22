/**
 * ============================================================================
 * 10_Values.gs — the value layer
 * ============================================================================
 *
 * valuesEqual, normaliseValue, displayValue, errorState. Pure, no dependency
 * on anything but 00_Config.gs.
 *
 * normaliseValue AND displayValue BOTH EXIST, AND MUST STAY DISTINCT.
 * normaliseValue renders a Date as 'D' + getTime() and feeds row hashing, gap
 * scoring and the header guard — identity, never seen by a reader. displayValue
 * renders it as toISOString() and feeds `old`/`new`, previews and the CSV.
 * Collapsing them puts a D-prefixed epoch integer in the CSV, or a
 * locale-formatted date into a row hash, where a timezone shift changes row
 * identity and desynchronises alignment.
 */

/**
 * Value comparison for the diff taxonomy.
 *
 * Date normalisation via getTime() is rule 11: two Date objects for the same
 * instant are never ===, so without it every date cell in the file reads as
 * changed (test 9).
 */
function valuesEqual(a, b, opts) {
  if (a instanceof Date) a = a.getTime();
  if (b instanceof Date) b = b.getTime();
  if (typeof a === 'string') a = a.trim();
  if (typeof b === 'string') b = b.trim();
  if (typeof a === 'number' && typeof b === 'number') {
    const eps = (opts && opts.epsilon !== undefined) ? opts.epsilon : OPTS.epsilon;
    return Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

/**
 * Identity normalisation for hashing and gap scoring. Not for display.
 * Dates collapse to their epoch millis for the same reason valuesEqual does it.
 */
function normaliseValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return 'D' + v.getTime();
  if (typeof v === 'string') return v.trim();
  return String(v);
}

/**
 * Rendering for the `old` / `new` CSV fields. Distinct from normaliseValue —
 * see this file's header.
 */
function displayValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Plan §4h. 'root' = this cell's own pointer is broken; 'inherited' = the cell
 * displays an error sourced upstream.
 *
 * The formula is checked FIRST: a root cell's value also reads #REF!, and root
 * is the more informative classification. Before this distinction existed as a
 * field, the mutation "check the value only" failed no test at all; it now
 * fails test 33.
 *
 * `formula` is the A1 form — §4h names it as the preferred surface because it
 * is retained for display anyway. If §1.2b establishes that the token does not
 * survive into A1 but does into R1C1, pass the R1C1 form here instead; the
 * function itself does not care which it is given.
 */
function errorState(value, formula) {
  if (formula !== '' && formula !== null && formula !== undefined) {
    const f = String(formula);
    for (let i = 0; i < REF_ERROR_TOKENS.length; i++) {
      if (f.indexOf(REF_ERROR_TOKENS[i]) !== -1) return 'root';
    }
  }
  if (REF_ERROR_TOKENS.indexOf(String(value).trim()) !== -1) return 'inherited';
  return 'none';
}
