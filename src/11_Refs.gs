/**
 * ============================================================================
 * 11_Refs.gs — A1 coordinate rendering
 * ============================================================================
 *
 * Everything that turns a (row, column) pair into text a reader can paste into
 * a Sheets name box. Nothing here knows about R1C1 — that is 21_Relocate.gs.
 */

/** Bijective base-26: 1 -> A, 26 -> Z, 27 -> AA. */
function columnLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheet row + sheet column -> 'B7'. Both arguments are 1-based SHEET numbers. */
function a1(row, col) {
  return columnLetter(col) + row;
}

/**
 * Column header text from A's trimmed row 0, for the CSV's `column` field.
 * '' where that cell is a formula — a derived header is not a name, and the
 * caller falls back to the column letter.
 */
function headerText_(tabA, c) {
  if (!tabA.values.length) return '';
  if (tabA.fA1[0][c] !== '') return '';
  return normaliseValue(tabA.values[0][c]);
}
