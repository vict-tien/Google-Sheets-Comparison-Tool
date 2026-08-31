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
 * Plan §4b, WIDENED in v1.2.0. One reference. The sheet prefix is optional; a
 * quoted name may contain doubled quotes; row and column parts are each an
 * absolute integer, a bracketed relative offset, or absent.
 *
 * THREE ALTERNATIVES, AND THE ORDER OF THE FIRST TWO IS LOAD-BEARING.
 *
 *   R…C   both parts optional — R4C2, RC, R[-1]C[2]
 *   R…    a WHOLE ROW      — =SUM(Rates!$4:$4) renders as `Rates!R4`
 *   C…    a WHOLE COLUMN   — =SUM(Rates!$B:$B) renders as `Rates!C2`
 *
 * The plan's regex made the literal R and the literal C both mandatory, so
 * neither single-part form matched, and TWO SEPARATE BUGS followed. Only the
 * first is the obvious one:
 *
 *   1. `Rates!R4` carries an ABSOLUTE ROW that was never relocated. Insert a
 *      row above Rates!4 and B reads R5 while A stays R4 — a FORMULA row that
 *      nobody authored.
 *   2. `Rates!C2` has no row to relocate, WHICH IS WHY IT LOOKED HARMLESS, and
 *      still carries a sheet name that tabMap never reached. Rename Rates and
 *      every whole-column reference in the workbook reports FORMULA.
 *
 * The R…C alternative MUST come first: put the R-only branch ahead of it and
 * `R1C1` matches as the whole row `R1`, leaving `C1` to match separately — one
 * reference silently becomes two.
 *
 * The two single-part branches REQUIRE an operand. Make it optional and a bare
 * `R` or `C` matches, which fires inside ordinary text and rewrites it.
 * isRefBoundary_ is the second half of that defence and is now load-bearing for
 * a much wider class than it was — see its own comment.
 */
const REF_RE =
  /(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!)?(?:R(\d+|\[-?\d+\])?C(\d+|\[-?\d+\])?|R(\d+|\[-?\d+\])|C(\d+|\[-?\d+\]))/g;

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
 * REF_RE's shortest possible match WAS the two characters "RC". Since v1.2.0 it
 * is `R4` or `C1`, which collide with far more ordinary text — a defined name
 * `C1_RATE`, an identifier `R2D2`. This check therefore guards a much wider
 * class than it was written for, and test '4h' is what holds it.
 *
 * A match is only a reference when neither neighbouring character continues a
 * word.
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
 *
 * `form` IS NOT OPTIONAL AND MUST NOT BE GUESSED. A whole-row reference has no
 * column part, and emitting `R4C` for it corrupts every one it touches — the
 * result still looks like a reference, so nothing downstream complains and the
 * two sides simply stop matching. rewriteRefs_ supplies it; test '4i' holds it
 * by rewriting every form through this function and asserting identity.
 */
function formatRef_(sheetName, rowPart, colPart, form) {
  let prefix = '';
  if (sheetName !== null && sheetName !== undefined) {
    prefix = sheetPrefix_(sheetName);      // 11_Refs.gs — shared with A1 names
  }
  const r = 'R' + (rowPart === undefined ? '' : rowPart);
  const c = 'C' + (colPart === undefined ? '' : colPart);
  if (form === 'R') return prefix + r;
  if (form === 'C') return prefix + c;
  return prefix + r + c;
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
 * `transform` receives { sheet, rowPart, colPart, form } and returns
 * replacement text. `sheet` is null for a same-tab reference — the caller
 * resolves that to the current tab, and must NOT then emit a sheet prefix that
 * was not there.
 *
 * THE SINGLE-PART ALTERNATIVES ARE FOLDED HERE, ONCE. REF_RE's R-only and
 * C-only branches land in their own capture groups; every transform wants them
 * as an ordinary rowPart or colPart plus a `form` to re-emit. Folding it in
 * each of the three transforms instead is how the three drift apart — the
 * failure the "one row map per formula" sabotage row already records for the
 * per-match resolution.
 */
function rewriteRefs_(f, transform) {
  if (f === '' || f === null || f === undefined) return '';
  const held = protectStrings_(f);
  const out = held.text.replace(REF_RE,
    function (m, quoted, unquoted, rowPart, colPart, rowOnly, colOnly,
              offset, whole) {
      if (!isRefBoundary_(whole, offset, m.length)) return m;
      let sheetName = null;
      if (quoted !== undefined)        sheetName = quoted.replace(/''/g, "'");
      else if (unquoted !== undefined) sheetName = unquoted;

      let form = 'RC';
      if (rowOnly !== undefined)      { form = 'R'; rowPart = rowOnly; }
      else if (colOnly !== undefined) { form = 'C'; colPart = colOnly; }

      return transform({ sheet: sheetName, rowPart: rowPart, colPart: colPart,
                         form: form });
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
    return formatRef_(name, rowPart, ref.colPart, ref.form);
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
    return formatRef_(ref.sheet, rowPart, ref.colPart, ref.form);
  });
}

/**
 * "Does this formula contain at least one ABSOLUTE row reference?" — the only
 * kind relocation can act on. Not part of relocation; it gates one Step 10
 * diagnostic. Deliberately loose: a false positive only makes a warning
 * available, it never changes a classification.
 */
const ABS_ROW_RE = /(?:^|[^A-Za-z0-9_.])R\d+(?:C|(?![A-Za-z0-9_.]))/;

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

