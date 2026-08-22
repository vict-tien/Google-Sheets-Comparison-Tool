/**
 * ============================================================================
 * 30_DiffCell.gs — the comparison taxonomy, and nothing else
 * ============================================================================
 *
 * One function. It is alone in this file because two of its seven rules are
 * ORDERING facts rather than logic, and both are invisible when they break:
 *
 *   RULE 3 MUST PRECEDE RULE 5. A #REF! present in both files has identical
 *   formulas AND identical values; below rule 5 it is suppressed as "not a
 *   change" and never appears. That is the changes-only exception, and the plan
 *   names it the failure an implementation is most likely to ship while looking
 *   correct. Sabotaging it fails tests 19, 29, 30, 31, 33, '2c', '2d' — and
 *   nothing else. The other 72 stay green.
 *
 *   INSIDE RULE 5, ctx.volatile MUST PRECEDE opts.derivedSection (rule 14).
 *   An INDIRECT whose target moved and a formula that merely recalculated are
 *   the same observable state — identical formula text, changed value — and
 *   only the volatile test separates them. Swap the two branches and every
 *   VOLATILE_VALUE is relabelled DERIVED_VALUE and buried in section 2. NOTHING
 *   IS DROPPED AND NO COUNT LOOKS WRONG; tests 27 and 28 are the only guards,
 *   and they guard it by asserting zero DERIVED_VALUE, not by counting rows.
 *
 * Tests 4, 27 and 28 are a three-way contrast over identical observable state,
 * separated only by ctx.volatile and opts.derivedSection. Read them together
 * before touching this file.
 */

/**
 * The comparison taxonomy. Plan Step 2.
 *
 *   vA, vB   raw values from getValues()
 *   fA       A's R1C1 formula, ALREADY RELOCATED by Step 4
 *   fB       B's R1C1 formula, raw
 *   ctx      { fA1A, fA1B, errA, errB, volatile, maskA, maskB }
 *   opts     OPTS
 *
 * Returns { change, old, new, root? } or null.
 *
 * ctx.fA1A / ctx.fA1B are the A1 formulas, needed because rules 1-3 display
 * formulas in A1 while comparing in R1C1 (rule 2). It receives only R1C1 forms,
 * so the display forms have to reach it some other way and this is the least
 * surprising route.
 *
 * ctx.maskA / ctx.maskB are computed by the caller ONLY when both formulas are
 * present and differ — masking is not free. When they are absent the formula
 * difference is treated as verified, which is the safe direction: an unmasked
 * real edit is reported as FORMULA (over-reporting, visible) rather than
 * swallowed as FORMULA_UNVERIFIED (under-reporting, silent). Drop the two
 * undefined guards and `undefined === undefined` is true, so every formula
 * difference from a caller that computed no masks reports as unverifiable.
 * Only 30_DiffCell.test.gs '2i' catches that; no fixture can produce it,
 * because diffTab always computes masks where rule 4 can use them.
 */
function diffCell(vA, vB, fA, fB, ctx, opts) {
  ctx = ctx || {};
  opts = opts || OPTS;

  const a1A = (ctx.fA1A !== undefined && ctx.fA1A !== null) ? ctx.fA1A : fA;
  const a1B = (ctx.fA1B !== undefined && ctx.fA1B !== null) ? ctx.fA1B : fB;
  const errA = ctx.errA || 'none';
  const errB = ctx.errB || 'none';

  // 1. formula appeared where there was a literal
  if (fA === '' && fB !== '') {
    return { change: 'FORMULARIZED', old: displayValue(vA), new: a1B };
  }

  // 2. literal typed over a formula. Wins even if fA was broken, so `old`
  //    shows =Rates!#REF! and the breakage is still visible.
  if (fA !== '' && fB === '') {
    return { change: 'HARDCODED', old: a1A, new: displayValue(vB) };
  }

  // 3. ERROR STATE — MUST precede rules 4-6. See this file's header.
  //
  //    old / new are the A1 formula where the cell has one, else the value. A
  //    root row's `new` therefore reads "=Rates!#REF!" and an inherited row's
  //    reads "#REF!" — the two surfaces stay distinguishable with no extra
  //    column (plan §0.4).
  //
  //    An error is never derived: these rows are section 1 by construction,
  //    which is what test 33 asserts once sectionOf exists.
  if (errA !== 'none' || errB !== 'none') {
    const oldSide = (a1A !== '') ? a1A : displayValue(vA);
    const newSide = (a1B !== '') ? a1B : displayValue(vB);
    let type;
    if (errA === 'none')      type = 'REF_ERROR_NEW';
    else if (errB === 'none') type = 'REF_ERROR_FIXED';
    else                      type = 'REF_ERROR';        // changes-only exception
    // `root` is errorState's classification travelling to Step 6's sort, where
    // roots are ordered above inherited errors. It is not a CSV column — the
    // plan is explicit that the type plus old/new must carry the distinction to
    // a reader — but the sort should use what §4h decided rather than
    // re-deriving it by squinting at the text.
    return { change: type, old: oldSide, new: newSide,
             root: (errA === 'root' || errB === 'root') };
  }

  // 4. both hold formulas, and they differ
  if (fA !== '' && fB !== '' && fA !== fB) {
    const masked = (ctx.maskA !== undefined && ctx.maskB !== undefined &&
                    ctx.maskA === ctx.maskB);
    return { change: masked ? 'FORMULA_UNVERIFIED' : 'FORMULA', old: a1A, new: a1B };
  }

  // 5. both hold the SAME formula, and the value moved anyway.
  //
  //    THE ORDER OF THESE TWO BRANCHES IS RULE 14. Do not tidy it.
  if (fA !== '' && fB !== '' && fA === fB) {
    if (!valuesEqual(vA, vB, opts)) {
      // An INDIRECT/OFFSET whose target moved has identical formula text and a
      // changed value. Sheets does not rewrite the string argument when rows
      // move, so nothing else in the run can tell. Without this branch it
      // produces no output at all — the value layer saw it and the taxonomy
      // threw it away (plan §0.3).
      if (ctx.volatile) {
        return { change: 'VOLATILE_VALUE', old: displayValue(vA), new: displayValue(vB) };
      }
      // Ordinary recalculation: an input somewhere upstream changed. Real
      // information, and one to three orders of magnitude more numerous than
      // authored edits — hence section 2 rather than section 1 (rule 13,
      // routed by sectionOf in 50_Csv.gs, never by a field on the row).
      //
      // The two VALUES, not the formula: the formula is identical by definition
      // of reaching this branch, so printing it wastes the column.
      if (opts.derivedSection) {
        return { change: 'DERIVED_VALUE',
                 old: displayValue(vA), new: displayValue(vB) };
      }
    }
    return null;   // derived value with the section switched off
  }

  // 6. neither holds a formula
  if (fA === '' && fB === '' && !valuesEqual(vA, vB, opts)) {
    return { change: 'VALUE', old: displayValue(vA), new: displayValue(vB) };
  }

  // 7.
  return null;
}
