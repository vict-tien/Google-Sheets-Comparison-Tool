/**
 * ============================================================================
 * 21_Relocate.gs — the reference engine
 * ============================================================================
 *
 * ONE REGEX ENGINE, PER-MATCH TARGET RESOLUTION. rewriteRefs_ walks a formula's
 * references with a global regex and a callback, and the callback resolves each
 * reference's target tab independently. relocate, maskUnresolvable and
 * unresolvableTargets are all that callback with a different body.
 *
 * The obvious alternative — find the formula's sheet name, look up that tab's
 * row map, rewrite the formula — is correct on single-reference formulas, which
 * is every formula in the first six tests, and fails on
 * `=Rates!$B$4 * Escalation!$C$7`. The mutation "one row map per formula" fails
 * ten tests.
 *
 * STILL UNGATED: plan §1.2a. REF_RE is written against the reference forms the
 * plan TABULATES, not against forms observed from a live getFormulasR1C1()
 * call, and every fixture writes its R1C1 by hand in that same syntax — SO THE
 * SUITE PROVES THE REGEX SELF-CONSISTENT, NOT CORRECT. If the real output
 * differs, relocation silently no-ops and every shifted reference is reported
 * as an authored FORMULA change, with no error and no warning. Run
 * verifyReferenceForms() (90_Main.gs) against a real file before trusting any
 * output of run().
 */

// The problem Step 4 solves: R1C1 makes RELATIVE references shift-invariant and
// does nothing for absolute ones. Insert a row above row 4 and R4C2 becomes
// R5C2 — a formula change that nobody authored. Across tabs, Rates!R4C2 shifts
// whenever a row is inserted in Rates, and the sheet token itself moves if
// Rates is renamed.

/**
 * Plan §4b. One reference. The sheet prefix is optional; a quoted name may
 * contain doubled quotes; row and column parts are each an absolute integer, a
 * bracketed relative offset, or absent (bare R / bare C = zero offset).
 */
const REF_RE =
  /(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!)?R(\d+|\[-?\d+\])?C(\d+|\[-?\d+\])?/g;

/**
 * Plan §4a / §4f. Replaces every double-quoted span with a placeholder so that
 * substitution cannot reach inside it, and restores them afterwards.
 *
 * Two things depend on this. A formula may legitimately contain the text
 * ="R4C2". And INDIRECT's string argument is data, not a reference — rewriting
 * it would change what the formula means (plan §0.3).
 *
 * The placeholder is \u0001<n>\u0002: no R, no C, so REF_RE cannot match it.
 */
function protectStrings_(f) {
  const literals = [];
  const text = String(f).replace(/"(?:[^"]|"")*"/g, function (m) {
    literals.push(m);
    return '\u0001' + (literals.length - 1) + '\u0002';
  });
  return { text: text, literals: literals };
}

function restoreStrings_(text, literals) {
  return text.replace(/\u0001(\d+)\u0002/g, function (m, i) {
    return literals[Number(i)];
  });
}

/**
 * REF_RE's shortest possible match is the two characters "RC", so it can fire
 * inside an ordinary identifier. A match is only a reference when neither
 * neighbouring character continues a word.
 *
 * Not in the plan; the plan's regex has no boundary condition. Without one, a
 * name or function containing R...C is rewritten as though it were a reference.
 */
function isRefBoundary_(whole, offset, len) {
  const before = offset > 0 ? whole.charAt(offset - 1) : '';
  const after  = (offset + len < whole.length) ? whole.charAt(offset + len) : '';
  if (before && /[A-Za-z0-9_.]/.test(before)) return false;
  if (after  && /[A-Za-z0-9_.]/.test(after))  return false;
  return true;
}

/**
 * Renders one reference back to text. Re-quotes the sheet name only when it
 * needs quoting, matching what Sheets itself emits — both sides of a comparison
 * pass through here, so the rendering only has to be consistent.
 */
function formatRef_(sheetName, rowPart, colPart) {
  let prefix = '';
  if (sheetName !== null && sheetName !== undefined) {
    prefix = /^[A-Za-z0-9_.]+$/.test(sheetName)
      ? sheetName + '!'
      : "'" + String(sheetName).replace(/'/g, "''") + "'!";
  }
  return prefix + 'R' + (rowPart === undefined ? '' : rowPart) +
                  'C' + (colPart === undefined ? '' : colPart);
}

/**
 * The engine both relocate() and maskUnresolvable() run on.
 *
 * Plan §4b–§4c: String.replace over a GLOBAL regex with a per-match callback —
 * never "find the sheet name, then rewrite the formula". A single formula may
 * hold several references pointing at several different tabs
 * (=Rates!R4C2 * Escalation!R7C3 needs two maps in one pass, test 23), and the
 * target tab is resolved per match, not per formula.
 *
 * `transform` receives { sheet, rowPart, colPart } and returns replacement text.
 * `sheet` is null for a same-tab reference — the caller resolves that to the
 * current tab, and must NOT then emit a sheet prefix that was not there.
 */
function rewriteRefs_(f, transform) {
  if (f === '' || f === null || f === undefined) return '';
  const held = protectStrings_(f);
  const out = held.text.replace(REF_RE,
    function (m, quoted, unquoted, rowPart, colPart, offset, whole) {
      if (!isRefBoundary_(whole, offset, m.length)) return m;
      let sheetName = null;
      if (quoted !== undefined)        sheetName = quoted.replace(/''/g, "'");
      else if (unquoted !== undefined) sheetName = unquoted;
      return transform({ sheet: sheetName, rowPart: rowPart, colPart: colPart });
    });
  return restoreStrings_(out, held.literals);
}

/**
 * Plan §4c/§4d. Rewrites A's R1C1 formula into the coordinates it WOULD have if
 * the edits made to B had been made to A. Applied to A's formulas ONLY —
 * relocating both sides double-shifts.
 *
 * Per match:
 *   targetTab = the reference's own sheet name, or currentTab if it has none
 *   sheet name -> tables.tabMap[targetTab]        (rule 5: renamed tabs)
 *   absolute row n -> tables.rowMaps[targetTab].get(n)   (rule 3)
 *   relative row (R[-1]) and the whole column part -> untouched
 *
 * No chain resolution. A reference points at a LOCATION, not at a value, so the
 * immediate target's own map is always the final answer however deep the chain
 * runs (plan §0.2). No dependency graph, no topological sort.
 *
 * Where rowMaps has no entry for the target the row is left ALONE, not guessed.
 * §4e then masks it and diffCell files the cell as FORMULA_UNVERIFIED.
 * Where the map exists but the specific row is missing, the row is also left
 * alone — that is a dangling reference into a deleted row, and Sheets will have
 * rewritten B's copy to #REF!, so it surfaces as REF_ERROR_NEW (test 19).
 */
function relocate(f, tables, currentTab) {
  tables = tables || {};
  const tabMap  = tables.tabMap  || {};
  const rowMaps = tables.rowMaps || {};

  return rewriteRefs_(f, function (ref) {
    const target = (ref.sheet === null) ? currentTab : ref.sheet;

    // Only re-emit a sheet prefix if the reference carried one.
    const name = (ref.sheet === null)
      ? null
      : (tabMap[target] !== undefined ? tabMap[target] : target);

    let rowPart = ref.rowPart;
    if (rowPart !== undefined && /^\d+$/.test(rowPart)) {   // absolute only
      const map = rowMaps[target];
      if (map) {
        const mapped = map.get(Number(rowPart));
        if (mapped !== undefined) rowPart = String(mapped);
      }
    }
    return formatRef_(name, rowPart, ref.colPart);
  });
}

/**
 * Plan §4e. A reference cannot be VERIFIED when its target tab has no entry in
 * rowMaps — the tab was skipped, added, deleted or unpaired, so nothing knows
 * where its rows went. Replace those row parts with a '#' sentinel; leave every
 * other reference exactly as it is. Applied symmetrically to both sides.
 *
 * Masking ONLY the unresolvable references is the whole point (test 24). If a
 * formula mixes a verified reference that genuinely changed with an unverified
 * one, the masked forms still differ and the cell is correctly reported as
 * FORMULA. Masking every absolute row makes a real edit indistinguishable from
 * noise and silently loses it.
 *
 * A reference whose tab HAS a map but whose specific row is missing is NOT
 * masked — see relocate().
 */
function maskUnresolvable(f, tables, currentTab) {
  tables = tables || {};
  const rowMaps = tables.rowMaps || {};

  return rewriteRefs_(f, function (ref) {
    const target = (ref.sheet === null) ? currentTab : ref.sheet;
    let rowPart = ref.rowPart;
    if (rowPart !== undefined && /^\d+$/.test(rowPart) && !rowMaps[target]) {
      rowPart = '#';
    }
    // The sheet name is NOT re-mapped here: this runs on A's already-relocated
    // formula and on B's raw one, so both sides already carry B's names.
    return formatRef_(ref.sheet, rowPart, ref.colPart);
  });
}

/**
 * "Does this formula contain at least one ABSOLUTE row reference?" — the only
 * kind relocation can act on. Not part of relocation; it gates one Step 10
 * diagnostic. Deliberately loose: a false positive only makes a warning
 * available, it never changes a classification.
 */
const ABS_ROW_RE = /(?:^|[^A-Za-z0-9_.])R\d+C/;

/**
 * The target tabs a formula references that have NO row map — i.e. exactly the
 * references maskUnresolvable() just masked, named.
 *
 * Not a function the plan lists, but Step 10's unverified line attributes its
 * count to the REFERENCED tab ("Rates (4), Escalation (2)"), and Step 11.6 reads
 * that line to conclude "a referenced tab was skipped". maskUnresolvable knows
 * which target failed and throws the name away, so the attribution needs its own
 * pass. It reuses rewriteRefs_ with the same per-match target resolution, so the
 * two can never disagree about what is unresolvable.
 *
 * Called only for cells already classified FORMULA_UNVERIFIED, so the cost is
 * bounded by the size of that class rather than by the grid.
 */
function unresolvableTargets(f, tables, currentTab) {
  tables = tables || {};
  const rowMaps = tables.rowMaps || {};
  const seen = {}, out = [];

  rewriteRefs_(f, function (ref) {
    const target = (ref.sheet === null) ? currentTab : ref.sheet;
    if (ref.rowPart !== undefined && /^\d+$/.test(ref.rowPart) && !rowMaps[target]) {
      if (!seen[target]) { seen[target] = true; out.push(target); }
    }
    return '';   // a scan, not a rewrite — the returned string is discarded
  });

  return out;
}

/**
 * Plan §4g. INDIRECT and OFFSET build their target at runtime, so Sheets does
 * not rewrite them when rows move: the formula text is identical in both files
 * while the formula now resolves somewhere else (plan §0.3).
 *
 * Run against the RAW formula. A false positive from a string literal that
 * happens to contain the word is harmless — it only exempts one cell from value
 * suppression.
 */
function isVolatile(f) {
  if (f === '' || f === null || f === undefined) return false;
  return /\b(INDIRECT|OFFSET)\s*\(/i.test(String(f));
}

