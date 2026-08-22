/**
 * ============================================================================
 * Google Sheets Diff Tool
 * ============================================================================
 *
 * Built from : "Google Sheets Difference Comparison Tool Implementation Plan.md"
 * Fixtures   : GenerateTestWorkbooks.gs (Step 11 end-to-end run, made repeatable)
 *
 * BUILD STATE — Steps 1 to 10 complete. Step 11 is a live run; see below.
 *
 *   Step 1  test harness, fixtures, multi-tab fixture builder   DONE
 *   Step 2  diffCell, valuesEqual                               DONE
 *   Step 3  trimGrid, hashRow, alignRows                        DONE
 *   Step 4  relocate, maskUnresolvable, isVolatile, errorState  DONE
 *   Step 5  diffTab, scanErrorsUnaligned                        DONE
 *   Step 6  toCsv                                               DONE
 *   Step 7  pairTabs                                            DONE
 *   Step 8  readTab                                             DONE
 *   Step 9  run — two-phase orchestration                       DONE
 *   Step 10 buildSummary                                        DONE
 *   Step 11 end-to-end run on real files                        NOT RUN
 *
 * All thirty-three acceptance tests pass, plus 41 local tests of branches the
 * plan defines but does not number: runTests() reports 74.
 *
 * ENTRY POINTS
 *   verifyReferenceForms(url [, tab])  plan §1.2 — RUN THIS FIRST
 *   run(urlA, urlB [, opts])           the tool
 *   runTests()                         the suite; needs no spreadsheet
 *
 * Everything above the "I/O BOUNDARY" banner near the bottom of this file is
 * pure and touches neither SpreadsheetApp nor DriveApp, which is what lets the
 * whole suite pass on in-memory fixtures. Only readTab, readSheets_, run and
 * verifyReferenceForms do I/O, and none of them writes to either source file.
 *
 * compareWorkbooks() is Step 9's two-phase orchestration over in-memory
 * workbooks; run() is the Sheets/Drive shell around it. The phase ordering lives
 * in compareWorkbooks alone and is deliberately NOT duplicated in run(), because
 * tests 18, 22, 26 and 32 exist to check that ordering — a second copy in the
 * I/O layer would be untested.
 *
 * ---------------------------------------------------------------------------
 * STEP 1.2 GATES STEP 4, AND STEP 4 WAS WRITTEN WITHOUT IT
 * ---------------------------------------------------------------------------
 * Plan §1.2 gates Step 4: observe getFormulasR1C1() against real cells and
 * confirm (a) the reference forms the §4b regex is written against, and (b) that
 * the literal token '#REF!' survives into the R1C1 form. REF_RE is written
 * against the forms the plan TABULATES, and the fixtures assert against those
 * same tabulated forms — SO THE TEST SUITE CANNOT DETECT A MISMATCH WITH
 * REALITY. If the real R1C1 output differs, relocation silently no-ops and every
 * shifted reference is reported as an authored change, with no error and no
 * warning.
 *
 * It is no longer a manual observation. verifyReferenceForms(url) performs both
 * halves against a real file and names every R1C1 formula in which REF_RE finds
 * nothing. Run it before trusting any output of run().
 *
 * buildSummary carries the same check as a field diagnostic (plan Step 11.4):
 * 0 formulas realigned while rows moved and absolute references exist prints a
 * warning naming §1.2a.
 *
 * §1.2b does not gate this code. errorState() is fed the A1 formula, which §4h
 * names as the preferred surface precisely because it is retained for display
 * anyway.
 */

// ===========================================================================
// CONFIG  (plan §1)
// ===========================================================================

const URL_A = 'https://docs.google.com/spreadsheets/d/.../edit';
const URL_B = 'https://docs.google.com/spreadsheets/d/.../edit';

const OPTS = {
  includeDerived:  false,  // also emit VALUE rows where formulas are identical
  expandRows:      false,  // added/deleted rows -> one row per cell, not a preview
  epsilon:         1e-9,   // relative tolerance for numeric comparison
  similarity:      0.5,    // gap-matching threshold in alignment pass 2
  editDistanceCap: 0.30,   // skip a tab if more than this fraction of rows differ
  noiseWarn:       0.30    // warn if more than this fraction of compared cells changed
};

// Reference errors only. NOT #DIV/0!, #VALUE!, #N/A, #NUM! — those are
// computation errors, and including them floods any model containing lookups
// (plan §4h, test 11).
const REF_ERROR_TOKENS = ['#REF!', '#NAME?'];

// Alignment pass 1 refuses to run a DP table larger than this on either side.
const ALIGN_WINDOW_MAX = 2000;

// hashRow field/cell separators. Chosen because no spreadsheet cell can
// contain them.
const HASH_CELL_SEP = '\u0000';
const HASH_FORMULA  = '\u0001';

// ===========================================================================
// STEP 2 — valuesEqual, errorState, diffCell
// ===========================================================================

/**
 * Value comparison for the diff taxonomy.
 *
 * Date normalisation via getTime() is rule 11 of the twelve: two Date objects
 * for the same instant are never ===, so without it every date cell in the
 * file reads as changed (test 9).
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
 * Plan §4h. 'root' = this cell's own pointer is broken; 'inherited' = the cell
 * displays an error sourced upstream.
 *
 * The formula is checked FIRST: a root cell's value also reads #REF!, and root
 * is the more informative classification.
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

/**
 * The comparison taxonomy. Plan Step 2.
 *
 *   vA, vB   raw values from getValues()
 *   fA       A's R1C1 formula, ALREADY RELOCATED by Step 4
 *   fB       B's R1C1 formula, raw
 *   ctx      { fA1A, fA1B, errA, errB, volatile, maskA, maskB }
 *   opts     OPTS
 *
 * Returns { change, old, new } or null.
 *
 * ctx.fA1A / ctx.fA1B are the A1 formulas, needed because rules 1-3 display
 * formulas in A1 while comparing in R1C1 (rule 2 of the twelve). The plan's
 * Step 5 ctx sketch lists only the computed fields; the display forms have to
 * reach diffCell somehow and this is the least surprising route.
 *
 * ctx.maskA / ctx.maskB are computed by the caller ONLY when both formulas are
 * present and differ — masking is not free. When they are absent the formula
 * difference is treated as verified, which is the safe direction: an unmasked
 * real edit is reported as FORMULA rather than swallowed as unverifiable.
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

  // 3. ERROR STATE — MUST precede rules 4-6.
  //
  //    This is the correctness point of the whole taxonomy. A #REF! present in
  //    BOTH files has identical formulas and identical values; if this block
  //    sits after rule 5 it is suppressed as "not a change" and never appears,
  //    which is exactly what the requirement forbids (test 30).
  //
  //    old / new are the A1 formula where the cell has one, else the value. A
  //    root row's `new` therefore reads "=Rates!#REF!" and an inherited row's
  //    reads "#REF!" — the two surfaces stay distinguishable with no extra
  //    column (plan §0.4).
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

  // 5. both hold the SAME formula
  if (fA !== '' && fB !== '' && fA === fB) {
    if (!valuesEqual(vA, vB, opts)) {
      // An INDIRECT/OFFSET whose target moved has identical formula text and a
      // changed value. Without this branch it produces no output at all — the
      // value layer saw it and the taxonomy threw it away (plan §0.3).
      if (ctx.volatile) {
        return { change: 'VOLATILE_VALUE', old: displayValue(vA), new: displayValue(vB) };
      }
      if (opts.includeDerived) {
        return { change: 'VALUE', old: displayValue(vA), new: displayValue(vB) };
      }
    }
    return null;   // derived value, not an authored change
  }

  // 6. neither holds a formula
  if (fA === '' && fB === '' && !valuesEqual(vA, vB, opts)) {
    return { change: 'VALUE', old: displayValue(vA), new: displayValue(vB) };
  }

  // 7.
  return null;
}

/**
 * Rendering for the `old` / `new` CSV fields. Distinct from normaliseValue(),
 * which exists for identity hashing and must never be seen by a reader.
 */
function displayValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ===========================================================================
// STEP 3 — trimGrid, hashRow, alignRows
// ===========================================================================

/**
 * Plan §3.1. getDataRange() returns the *used* range, inflated by stray
 * formatting, so two files with identical content report different dimensions.
 *
 * Drops trailing all-empty rows, then trailing all-empty columns. A cell counts
 * as empty only when its value AND both formula forms are ''. Each file is
 * trimmed independently.
 *
 * Leading rows are NEVER trimmed — rowOffset carries sheet position, and
 * shifting it here would corrupt every absolute-reference lookup in Step 4
 * with no visible symptom.
 */
function trimGrid(tabData) {
  const values = tabData.values || [];
  const fR1C1  = tabData.fR1C1  || [];
  const fA1    = tabData.fA1    || [];

  const cellEmpty = function (r, c) {
    const v = (values[r] && values[r][c] !== undefined) ? values[r][c] : '';
    const f1 = (fR1C1[r] && fR1C1[r][c] !== undefined) ? fR1C1[r][c] : '';
    const f2 = (fA1[r]   && fA1[r][c]   !== undefined) ? fA1[r][c]   : '';
    if (f1 !== '' || f2 !== '') return false;
    if (v === '' || v === null || v === undefined) return true;
    return false;
  };

  let height = values.length;
  let width = 0;
  for (let r = 0; r < height; r++) {
    if (values[r] && values[r].length > width) width = values[r].length;
  }

  while (height > 0) {
    let rowEmpty = true;
    for (let c = 0; c < width; c++) {
      if (!cellEmpty(height - 1, c)) { rowEmpty = false; break; }
    }
    if (!rowEmpty) break;
    height--;
  }

  while (width > 0) {
    let colEmpty = true;
    for (let r = 0; r < height; r++) {
      if (!cellEmpty(r, width - 1)) { colEmpty = false; break; }
    }
    if (!colEmpty) break;
    width--;
  }

  const slice = function (grid) {
    const out = [];
    for (let r = 0; r < height; r++) {
      const row = grid[r] || [];
      const cut = [];
      for (let c = 0; c < width; c++) cut.push(row[c] !== undefined ? row[c] : '');
      out.push(cut);
    }
    return out;
  };

  return {
    values:    slice(values),
    fR1C1:     slice(fR1C1),
    fA1:       slice(fA1),
    rowOffset: tabData.rowOffset,
    colOffset: tabData.colOffset
  };
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
 * Plan §3.2. The row's IDENTITY, not its content.
 *
 * Only literal cells contribute. Formula-cell *values* are derived, and formula
 * *patterns* are identical across every row of a calculation table — either one
 * makes a useless anchor.
 */
function hashRow(values, formulas) {
  const width = Math.max(values ? values.length : 0, formulas ? formulas.length : 0);
  const parts = [];
  for (let c = 0; c < width; c++) {
    const f = (formulas && formulas[c] !== undefined) ? formulas[c] : '';
    parts.push(f === '' ? normaliseValue(values ? values[c] : '') : HASH_FORMULA);
  }
  return parts.join(HASH_CELL_SEP);
}

/**
 * Plan §3.2, special case. A fully formula-driven row hashes to
 * \u0001\u0000\u0001... and collides with every other such row, so it must
 * never be an LCS anchor — it gets positioned relative to the anchors around it
 * instead.
 *
 * A fully BLANK row is extended the same treatment. The plan names only the
 * formula case, but a blank row carries exactly as little identity and collides
 * exactly as widely; anchoring on one mis-pairs two unrelated padding rows and
 * drags the alignment with it. A row is anchorable when it holds at least one
 * literal cell with a non-empty value.
 */
function isAnchorable(values, formulas) {
  const width = Math.max(values ? values.length : 0, formulas ? formulas.length : 0);
  for (let c = 0; c < width; c++) {
    const f = (formulas && formulas[c] !== undefined) ? formulas[c] : '';
    if (f === '' && normaliseValue(values ? values[c] : '') !== '') return true;
  }
  return false;
}

/**
 * Convenience: hashes + anchorability for a whole TabData.
 *
 * `width`, when given, caps how many columns contribute. Callers comparing two
 * tabs pass the OVERLAPPING width — without that cap a single added column
 * appends a field to every hash on one side, nothing matches anything, edit
 * distance comes out at 100%, and the tab is skipped wholesale. The plan's
 * COL_ADDED / COL_DELETED rows (Step 5.1 step 3) would then be unreachable:
 * every column insertion would report as "structure differs" instead.
 */
function hashGrid(tabData, width) {
  const hashes = [];
  const anchorable = [];
  const cut = function (row) {
    return (width === undefined || row.length <= width) ? row : row.slice(0, width);
  };
  for (let r = 0; r < tabData.values.length; r++) {
    const v = cut(tabData.values[r]), f = cut(tabData.fR1C1[r]);
    hashes.push(hashRow(v, f));
    anchorable.push(isAnchorable(v, f));
  }
  return { hashes: hashes, anchorable: anchorable };
}

/**
 * Plan §3.3. Row alignment — rule 1 of the twelve, and the one whose absence
 * turns a single insertion into thousands of false rows.
 *
 * Returns Alignment:
 *   { pairs: [aIdx,bIdx][], added: bIdx[], deleted: aIdx[],
 *     rowMap: Map<sheetRowA, sheetRowB> | null, skipped, reason }
 *
 * rowMap is keyed on SHEET rows, not array indices — R1C1 absolute references
 * are sheet-row numbers, and building the map in index space corrupts Step 4
 * invisibly. rowOffset is applied here, once (plan §2).
 *
 * A skipped alignment returns rowMap: null. Step 9 must then leave that tab out
 * of `rowMaps` entirely — the ABSENCE is what Step 4e keys on.
 */
function alignRows(hashesA, hashesB, tabA, tabB, opts) {
  opts = opts || OPTS;

  const lenA = hashesA.length;
  const lenB = hashesB.length;
  // Anchorability is judged on the overlapping width, for the same reason the
  // hashes are (see hashGrid).
  const common = Math.min(gridWidth_(tabA), gridWidth_(tabB));
  const anchA = hashGrid(tabA, common).anchorable;
  const anchB = hashGrid(tabB, common).anchorable;

  const skipResult = function (reason) {
    return { pairs: [], added: [], deleted: [], rowMap: null,
             skipped: true, reason: reason };
  };

  // --- Pass 0 — prefix / suffix trim ------------------------------------
  // Typically consumes 95%+ of both sequences and keeps the DP below tiny.
  let pre = 0;
  while (pre < lenA && pre < lenB && hashesA[pre] === hashesB[pre]) pre++;

  let suf = 0;
  while (suf < lenA - pre && suf < lenB - pre &&
         hashesA[lenA - 1 - suf] === hashesB[lenB - 1 - suf]) suf++;

  const pairs = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);

  const midAstart = pre, midAend = lenA - suf;   // [start, end)
  const midBstart = pre, midBend = lenB - suf;
  const midA = midAend - midAstart;
  const midB = midBend - midBstart;

  // --- Pass 1 — LCS anchors on the middle only --------------------------
  if (midA > ALIGN_WINDOW_MAX || midB > ALIGN_WINDOW_MAX) {
    return skipResult('alignment window too large (' +
                      Math.max(midA, midB) + ' rows)');
  }

  const idxA = [];   // anchorable A indices inside the middle
  const idxB = [];
  for (let i = midAstart; i < midAend; i++) if (anchA[i]) idxA.push(i);
  for (let i = midBstart; i < midBend; i++) if (anchB[i]) idxB.push(i);

  const lcsPairs = lcsMatch_(idxA, idxB, hashesA, hashesB);

  // Edit distance is measured against the FULL row counts, not the post-trim
  // middle. On the middle alone an isolated one-cell edit scores 2/2 = 1.0 and
  // would skip its own tab, which tests 2, 15 and 16 forbid. (Recorded in §5.1
  // of the fixture-generator documentation; test 20 exceeds the cap under
  // either reading, so it does not distinguish them.)
  const matched = pre + suf + lcsPairs.length;
  const unmatchedA = lenA - matched;
  const unmatchedB = lenB - matched;
  const denom = lenA + lenB;
  const editDistance = denom === 0 ? 0 : (unmatchedA + unmatchedB) / denom;

  if (editDistance > opts.editDistanceCap) {
    return skipResult('edit distance ' + Math.round(editDistance * 100) +
                      '% — structure differs');
  }

  // --- Pass 2 — gap resolution ------------------------------------------
  // Between each consecutive pair of anchors sit a run of unmatched A rows and
  // a run of unmatched B rows. Score every cross pair on literal-cell
  // agreement, take the best greedily, and call the leftovers added/deleted.
  const anchors = lcsPairs.slice();
  const gapPairs = [];
  const added = [];
  const deleted = [];

  let cursorA = midAstart, cursorB = midBstart;
  for (let k = 0; k <= anchors.length; k++) {
    const stopA = (k < anchors.length) ? anchors[k][0] : midAend;
    const stopB = (k < anchors.length) ? anchors[k][1] : midBend;

    const gapA = [], gapB = [];
    for (let i = cursorA; i < stopA; i++) gapA.push(i);
    for (let i = cursorB; i < stopB; i++) gapB.push(i);

    resolveGap_(gapA, gapB, tabA, tabB, opts, gapPairs, deleted, added);

    if (k < anchors.length) {
      gapPairs.push([anchors[k][0], anchors[k][1]]);
      cursorA = stopA + 1;
      cursorB = stopB + 1;
    }
  }

  for (let i = 0; i < gapPairs.length; i++) pairs.push(gapPairs[i]);
  for (let i = 0; i < suf; i++) pairs.push([lenA - 1 - i, lenB - 1 - i]);

  pairs.sort(function (x, y) { return x[0] - y[0]; });
  added.sort(function (x, y) { return x - y; });
  deleted.sort(function (x, y) { return x - y; });

  // --- Pass 3 — rowMap, in SHEET rows -----------------------------------
  const offA = tabA.rowOffset || 1;
  const offB = tabB.rowOffset || 1;
  const rowMap = new Map();
  for (let i = 0; i < pairs.length; i++) {
    rowMap.set(pairs[i][0] + offA, pairs[i][1] + offB);
  }

  return { pairs: pairs, added: added, deleted: deleted, rowMap: rowMap,
           skipped: false, reason: '' };
}

/**
 * Standard DP LCS over two index lists, comparing their hashes. Returns the
 * matched [aIdx, bIdx] pairs in ascending order.
 *
 * Only anchorable rows reach here, so the table is normally far smaller than
 * the ALIGN_WINDOW_MAX guard allows.
 */
function lcsMatch_(idxA, idxB, hashesA, hashesB) {
  const m = idxA.length, n = idxB.length;
  if (m === 0 || n === 0) return [];

  const w = n + 1;
  const dp = new Int32Array((m + 1) * w);

  for (let i = m - 1; i >= 0; i--) {
    const ha = hashesA[idxA[i]];
    for (let j = n - 1; j >= 0; j--) {
      dp[i * w + j] = (ha === hashesB[idxB[j]])
        ? dp[(i + 1) * w + (j + 1)] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (hashesA[idxA[i]] === hashesB[idxB[j]]) {
      out.push([idxA[i], idxB[j]]);
      i++; j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/**
 * Plan §3.3 pass 2. Greedy similarity matching inside one gap.
 *
 * score = (# positions where both cells are literal and their values agree)
 *       / (# positions where either cell is literal)
 *
 * A row edited in place scores high and is paired, so it reports as one VALUE
 * rather than a ROW_DELETED plus a ROW_ADDED (test 16).
 */
function resolveGap_(gapA, gapB, tabA, tabB, opts, outPairs, outDeleted, outAdded) {
  if (gapA.length === 0 && gapB.length === 0) return;

  const candidates = [];
  for (let x = 0; x < gapA.length; x++) {
    for (let y = 0; y < gapB.length; y++) {
      const s = rowSimilarity_(tabA.values[gapA[x]], tabA.fR1C1[gapA[x]],
                               tabB.values[gapB[y]], tabB.fR1C1[gapB[y]]);
      if (s >= opts.similarity) candidates.push([gapA[x], gapB[y], s]);
    }
  }
  candidates.sort(function (p, q) { return q[2] - p[2]; });

  const usedA = {}, usedB = {};
  for (let k = 0; k < candidates.length; k++) {
    const a = candidates[k][0], b = candidates[k][1];
    if (usedA[a] || usedB[b]) continue;
    usedA[a] = true; usedB[b] = true;
    outPairs.push([a, b]);
  }

  for (let x = 0; x < gapA.length; x++) if (!usedA[gapA[x]]) outDeleted.push(gapA[x]);
  for (let y = 0; y < gapB.length; y++) if (!usedB[gapB[y]]) outAdded.push(gapB[y]);
}

function rowSimilarity_(vA, fA, vB, fB) {
  const width = Math.max(vA ? vA.length : 0, vB ? vB.length : 0);
  let matches = 0, considered = 0;
  for (let c = 0; c < width; c++) {
    const litA = (fA && fA[c] !== undefined ? fA[c] : '') === '';
    const litB = (fB && fB[c] !== undefined ? fB[c] : '') === '';
    if (!litA && !litB) continue;
    considered++;
    if (litA && litB &&
        normaliseValue(vA ? vA[c] : '') === normaliseValue(vB ? vB[c] : '')) {
      matches++;
    }
  }
  return considered === 0 ? 0 : matches / considered;
}

// ===========================================================================
// REFERENCE HELPERS  (used by Step 5 and by the harness)
// ===========================================================================

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

function a1(row, col) {
  return columnLetter(col) + row;
}

// ===========================================================================
// STEP 4 — relocate, maskUnresolvable, isVolatile
//          (errorState — §4h — is delivered up in Step 2, where diffCell
//           rule 3 consumes it)
// ===========================================================================
//
// STILL UNGATED: plan §1.2a. The regex below is written against the reference
// forms the plan TABULATES, not against forms observed from a live
// getFormulasR1C1() call. If the real output differs, REF_RE matches nothing,
// relocation silently no-ops, and every shifted reference is reported as an
// authored change — with no error and no warning. Plan Step 11.4 is the field
// check for exactly this: 0 formulas realigned while a referenced tab shows a
// row change means come back here.
//
// §1.2b (does the literal '#REF!' survive into R1C1?) does not gate this code:
// errorState is fed the A1 form, which §4h names as the preferred surface.
//
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

// ===========================================================================
// STEP 5 — diffTab, scanErrorsUnaligned
// ===========================================================================

/**
 * Plan §5.1. Compares one aligned tab pair and returns Change rows.
 *
 *   Change = { tab, change, aRef, bRef, column, old, new }
 *
 * `stats` is optional and is filled in for Step 10's summary:
 *   { compared, emitted, relocated, volatileCells, noise, rowsAdded, ... }
 * It carries the noise check (plan §5.1 step 6) — a warning belongs in the
 * summary, not in the CSV, so it is recorded rather than emitted as a row.
 */
function diffTab(tabA, tabB, alignment, tables, tabName, opts, stats) {
  opts = opts || OPTS;
  stats = stats || {};
  stats.compared = 0; stats.emitted = 0; stats.relocated = 0;
  stats.volatileCells = 0; stats.volatileEmitted = 0;
  stats.unverified = 0; stats.noise = false;
  stats.rowsAdded = 0; stats.rowsDeleted = 0; stats.colsAdded = 0;
  stats.colsDeleted = 0; stats.skipped = false; stats.reason = '';
  // For Step 10's two mandatory diagnostic lines. derivedSuppressed is the
  // count behind "downstream tabs may show no rows even where numbers moved";
  // unverifiedTargets attributes each unverifiable reference to the tab whose
  // row map is missing, which is the tab a reader has to go and look at.
  stats.derivedSuppressed = 0; stats.unverifiedTargets = {};
  // Gates Step 10's "0 formulas realigned" field check (plan Step 11.4). Without
  // it the check fires on any workbook that has row movement and no absolute
  // references at all — where there is nothing to realign and nothing wrong.
  stats.absRefs = 0;

  const out = [];
  const row = function (change, aRef, bRef, column, oldV, newV) {
    return { tab: tabName, change: change, aRef: aRef, bRef: bRef,
             column: column, old: oldV, new: newV };
  };

  // 1. Skipped by alignment — but still scanned. The error scan depends on
  //    nothing but a single cell in a single file (plan §5.2), and that
  //    decoupling is what makes "flag ALL reference errors" true rather than
  //    "flag all the ones in tabs we could align".
  if (alignment.skipped) {
    stats.skipped = true; stats.reason = alignment.reason;
    out.push(row('TAB_SKIPPED', '', '', '', '', alignment.reason));
    return out.concat(scanErrorsUnaligned(tabB, tabName));
  }

  // 2. Header guard.
  const bad = headerMismatch_(tabA, tabB, alignment);
  if (bad !== null) {
    stats.skipped = true; stats.reason = 'header mismatch at column ' + bad;
    out.push(row('TAB_SKIPPED', '', '', bad, '', stats.reason));
    return out.concat(scanErrorsUnaligned(tabB, tabName));
  }

  // 3. Column delta. Column alignment is a non-goal; a column insertion is
  //    caught by the dimension guard only, and the overlapping width is
  //    compared positionally.
  const widthA = gridWidth_(tabA), widthB = gridWidth_(tabB);
  const overlap = Math.min(widthA, widthB);
  for (let c = overlap; c < widthB; c++) {
    stats.colsAdded++;
    out.push(row('COL_ADDED', '', a1(tabB.rowOffset, c + tabB.colOffset),
                 columnLetter(c + tabB.colOffset), '',
                 displayValue(tabB.values[0] ? tabB.values[0][c] : '')));
  }
  for (let c = overlap; c < widthA; c++) {
    stats.colsDeleted++;
    out.push(row('COL_DELETED', a1(tabA.rowOffset, c + tabA.colOffset), '',
                 columnLetter(c + tabA.colOffset),
                 displayValue(tabA.values[0] ? tabA.values[0][c] : ''), ''));
  }

  // 4. Cells, over aligned pairs only. Never row N against row N.
  for (let p = 0; p < alignment.pairs.length; p++) {
    const aIdx = alignment.pairs[p][0], bIdx = alignment.pairs[p][1];
    for (let c = 0; c < overlap; c++) {
      const rawA = tabA.fR1C1[aIdx][c];
      const fB   = tabB.fR1C1[bIdx][c];
      const fA   = relocate(rawA, tables, tabName);
      if (fA !== rawA) stats.relocated++;
      if (rawA !== '' && ABS_ROW_RE.test(rawA)) stats.absRefs++;

      const ctx = {
        fA1A: tabA.fA1[aIdx][c],
        fA1B: tabB.fA1[bIdx][c],
        errA: errorState(tabA.values[aIdx][c], tabA.fA1[aIdx][c]),
        errB: errorState(tabB.values[bIdx][c], tabB.fA1[bIdx][c]),
        volatile: rawA !== '' && (isVolatile(rawA) || isVolatile(fB))
      };
      if (ctx.volatile) stats.volatileCells++;

      // Masking is not free, so it is computed only where rule 4 can use it.
      if (fA !== '' && fB !== '' && fA !== fB) {
        ctx.maskA = maskUnresolvable(fA, tables, tabName);
        ctx.maskB = maskUnresolvable(fB, tables, tabName);
      }

      stats.compared++;
      const r = diffCell(tabA.values[aIdx][c], tabB.values[bIdx][c],
                         fA, fB, ctx, opts);
      if (r) {
        stats.emitted++;
        if (r.change === 'VOLATILE_VALUE')      stats.volatileEmitted++;
        if (r.change === 'FORMULA_UNVERIFIED') {
          stats.unverified++;
          const targets = unresolvableTargets(fA, tables, tabName);
          for (let t = 0; t < targets.length; t++) {
            stats.unverifiedTargets[targets[t]] =
              (stats.unverifiedTargets[targets[t]] || 0) + 1;
          }
        }
        const rec = row(r.change,
                        a1(aIdx + tabA.rowOffset, c + tabA.colOffset),
                        a1(bIdx + tabB.rowOffset, c + tabB.colOffset),
                        headerText_(tabA, c) || columnLetter(c + tabA.colOffset),
                        r.old, r.new);
        if (r.root !== undefined) rec._root = r.root;   // for Step 6's sort only
        out.push(rec);
      } else if (fA !== '' && fA === fB &&
                 !valuesEqual(tabA.values[aIdx][c], tabB.values[bIdx][c], opts)) {
        // diffCell rule 5 suppressed a derived value. It returns null without
        // saying why, so the condition is re-tested here rather than plumbed
        // back out — the only other null branch that could reach this test is
        // rule 5's volatile/includeDerived path, and both of those return a row.
        stats.derivedSuppressed++;
      }
    }
  }

  // 5. Whole rows.
  for (let i = 0; i < alignment.added.length; i++) {
    const b = alignment.added[i];
    stats.rowsAdded++;
    if (opts.expandRows) {
      for (let c = 0; c < gridWidth_(tabB); c++) {
        if (displayValue(tabB.values[b][c]) === '' && tabB.fA1[b][c] === '') continue;
        out.push(row('ROW_ADDED', '', a1(b + tabB.rowOffset, c + tabB.colOffset),
                     headerText_(tabA, c) || columnLetter(c + tabB.colOffset), '',
                     tabB.fA1[b][c] !== '' ? tabB.fA1[b][c]
                                           : displayValue(tabB.values[b][c])));
      }
    } else {
      out.push(row('ROW_ADDED', '', a1(b + tabB.rowOffset, tabB.colOffset), '',
                   '', preview_(tabB.values[b])));
    }

    // A row added ALREADY BROKEN must still be flagged (plan §5.1 step 5).
    // REF_ERROR_NEW, not REF_ERROR: the cell did not exist in A, so its A-side
    // error state is 'none' by construction and the taxonomy's own rule 3 gives
    // that name. aRef stays empty because there is no A-side cell to point at.
    for (let c = 0; c < gridWidth_(tabB); c++) {
      const st = errorState(tabB.values[b][c], tabB.fA1[b][c]);
      if (st === 'none') continue;
      const rec = row('REF_ERROR_NEW', '',
                      a1(b + tabB.rowOffset, c + tabB.colOffset),
                      columnLetter(c + tabB.colOffset), '',
                      tabB.fA1[b][c] !== '' ? tabB.fA1[b][c]
                                            : displayValue(tabB.values[b][c]));
      rec._root = (st === 'root');
      out.push(rec);
    }
  }
  for (let i = 0; i < alignment.deleted.length; i++) {
    const a = alignment.deleted[i];
    stats.rowsDeleted++;
    if (opts.expandRows) {
      for (let c = 0; c < gridWidth_(tabA); c++) {
        if (displayValue(tabA.values[a][c]) === '' && tabA.fA1[a][c] === '') continue;
        out.push(row('ROW_DELETED', a1(a + tabA.rowOffset, c + tabA.colOffset), '',
                     headerText_(tabA, c) || columnLetter(c + tabA.colOffset),
                     tabA.fA1[a][c] !== '' ? tabA.fA1[a][c]
                                           : displayValue(tabA.values[a][c]), ''));
      }
    } else {
      out.push(row('ROW_DELETED', a1(a + tabA.rowOffset, tabA.colOffset), '', '',
                   preview_(tabA.values[a]), ''));
    }
  }

  // 6. Noise check. Recorded, not emitted — Step 10 prints it.
  stats.noise = stats.compared > 0 &&
                (stats.emitted / stats.compared) > opts.noiseWarn;

  return out;
}

/**
 * Plan §5.2. Walks every cell of ONE file's tab and emits a REF_ERROR row for
 * each reference error found. No row map, no alignment, no pairing.
 *
 * aRef is left empty on purpose: in an unaligned tab there is no reliable
 * A-side counterpart, and inventing one would be worse than saying so.
 *
 * Called for skipped tabs (both guards), header-mismatch tabs, and TAB_ADDED
 * tabs (plan Step 9, phase 1).
 */
function scanErrorsUnaligned(tabB, tabName) {
  const out = [];
  const width = gridWidth_(tabB);
  for (let r = 0; r < tabB.values.length; r++) {
    for (let c = 0; c < width; c++) {
      const fA1 = tabB.fA1[r] ? tabB.fA1[r][c] : '';
      const v   = tabB.values[r][c];
      const st  = errorState(v, fA1);
      if (st === 'none') continue;
      out.push({
        tab: tabName, change: 'REF_ERROR', aRef: '',
        bRef: a1(r + tabB.rowOffset, c + tabB.colOffset),
        column: columnLetter(c + tabB.colOffset),
        old: '', new: fA1 !== '' ? fA1 : displayValue(v),
        _root: (st === 'root')
      });
    }
  }
  return out;
}

/**
 * Plan §5.1 step 2, with one deliberate change: the header row of A is compared
 * against THE B ROW IT IS ALIGNED TO, not against B's row 0 positionally.
 *
 * Positionally is what the plan says, and it contradicts test 7 — a row
 * inserted at the top of a tab puts a new row in B's position 0, the guard
 * fires, and the tab is skipped rather than reported as one ROW_ADDED. Reading
 * the pair keeps the guard doing its actual job (catching a tab whose COLUMNS
 * no longer line up, test 12) without firing on a row insertion, which
 * alignment has already handled.
 *
 * Columns where either side holds a formula are skipped: a formula cell's value
 * is derived, and comparing derived values here would skip tabs over ordinary
 * recalculation.
 *
 * Returns the offending column letter, or null.
 */
function headerMismatch_(tabA, tabB, alignment) {
  if (tabA.values.length === 0 || tabB.values.length === 0) return null;

  let bHeader = -1;
  for (let p = 0; p < alignment.pairs.length; p++) {
    if (alignment.pairs[p][0] === 0) { bHeader = alignment.pairs[p][1]; break; }
  }
  if (bHeader === -1) return null;   // A's first row was deleted; nothing to compare

  const overlap = Math.min(gridWidth_(tabA), gridWidth_(tabB));
  for (let c = 0; c < overlap; c++) {
    if (tabA.fA1[0][c] !== '' || tabB.fA1[bHeader][c] !== '') continue;
    if (normaliseValue(tabA.values[0][c]) !==
        normaliseValue(tabB.values[bHeader][c])) {
      return columnLetter(c + tabA.colOffset);
    }
  }
  return null;
}

/** Column header text from A's trimmed row 0. '' where that cell is a formula. */
function headerText_(tabA, c) {
  if (!tabA.values.length) return '';
  if (tabA.fA1[0][c] !== '') return '';
  return normaliseValue(tabA.values[0][c]);
}

function gridWidth_(tab) {
  return tab.values.length ? tab.values[0].length : 0;
}

/** Pipe-joined row content for a ROW_ADDED / ROW_DELETED preview. */
function preview_(row) {
  const s = row.map(displayValue).join('|');
  return s.length > 200 ? s.substring(0, 200) : s;
}

// ===========================================================================
// STEP 6 — toCsv
// ===========================================================================

const CSV_HEADER = 'tab,change,a_ref,b_ref,column,old,new';

/**
 * Plan Step 6. RFC 4180, with a formula-injection guard in front of it.
 *
 * The order matters: prefixing must happen BEFORE quoting, or the apostrophe
 * lands inside the quotes and neutralises nothing. Cells hold literal newlines
 * via Alt+Enter, and formulas hold commas as a matter of course, so both
 * branches fire on real data constantly.
 */
function csvField(v) {
  let s = (v === null || v === undefined) ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;                            // 1. neutralise
  if (/["\r\n,]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';  // 2. RFC 4180
  return s;
}

/**
 * Plan Step 6. Reference errors sort to the top as a block — roots before
 * inherited, and within each, NEW then FIXED then pre-existing. Everything else
 * keeps workbook order.
 *
 * Errors are the class a reader wants to see as a SET, and a broken reference
 * outranks any value change in a model review.
 *
 * Root-versus-inherited comes from errorState (§4h) via the internal `_root`
 * field, which is NOT a CSV column — the plan is explicit that the type plus
 * old/new must carry the distinction to a reader, and they do: a root row's
 * new field reads "=Rates!#REF!", an inherited row's reads "#REF!" (§0.4).
 * Rows assembled by hand, without `_root`, fall back to reading exactly that.
 */
function toCsv(changes) {
  const rank = { REF_ERROR_NEW: 0, REF_ERROR_FIXED: 1, REF_ERROR: 2 };

  const keyed = changes.map(function (c, i) {
    const isErr = Object.prototype.hasOwnProperty.call(rank, c.change);
    return {
      c: c, i: i,
      k0: isErr ? 0 : 1,
      k1: isErr ? (changeIsRoot_(c) ? 0 : 1) : 0,
      k2: isErr ? rank[c.change] : 0
    };
  });

  keyed.sort(function (x, y) {
    return (x.k0 - y.k0) || (x.k1 - y.k1) || (x.k2 - y.k2) || (x.i - y.i);
  });

  const lines = [CSV_HEADER];
  for (let i = 0; i < keyed.length; i++) {
    const c = keyed[i].c;
    lines.push([c.tab, c.change, c.aRef, c.bRef, c.column, c.old, c.new]
               .map(csvField).join(','));
  }
  return lines.join('\n');
}

function changeIsRoot_(c) {
  if (c._root !== undefined) return c._root;
  return sideIsRoot_(c.new) || sideIsRoot_(c.old);
}

function sideIsRoot_(s) {
  s = String(s === null || s === undefined ? '' : s);
  if (s.charAt(0) !== '=') return false;
  for (let i = 0; i < REF_ERROR_TOKENS.length; i++) {
    if (s.indexOf(REF_ERROR_TOKENS[i]) !== -1) return true;
  }
  return false;
}

// ===========================================================================
// STEP 7 — pairTabs
// ===========================================================================

/**
 * Plan Step 7. Pairs A's tabs to B's by name.
 *
 *   1. exact name match
 *   2. normalised match on what remains -> pair, and emit TAB_RENAMED
 *   3. unmatched in A -> TAB_DELETED;  unmatched in B -> TAB_ADDED
 *
 * Returns { tabMap, pairs, added, deleted, changes, warnings }. `tabMap` is the
 * { aTabName: bTabName } map Step 4d consumes to relocate sheet names; `pairs`
 * drives Step 9's two phases.
 *
 * Normalisation is lowercase with punctuation and whitespace stripped, and
 * NOTHING else. It will not pair "Rates" with "Rates v2" — a version suffix is
 * a different name under this rule, and those two tabs are reported as one
 * TAB_DELETED plus one TAB_ADDED. That is the plan's rule working as specified:
 * a wrong pairing generates a full-tab phantom diff, so it never guesses.
 *
 * If two A tabs normalise to the same string, both are withdrawn from
 * normalised matching and a warning is recorded — same on the B side.
 */
function pairTabs(namesA, namesB) {
  const tabMap = {}, pairs = [], added = [], deleted = [];
  const changes = [], warnings = [];

  const takenB = {};
  const leftA = [];

  // 1. exact
  for (let i = 0; i < namesA.length; i++) {
    const a = namesA[i];
    if (namesB.indexOf(a) !== -1 && !takenB[a]) {
      tabMap[a] = a; pairs.push([a, a]); takenB[a] = true;
    } else {
      leftA.push(a);
    }
  }
  const leftB = namesB.filter(function (b) { return !takenB[b]; });

  // 2. normalised, on the remainder only
  const norm = function (s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const bucket = function (names) {
    const m = {};
    for (let i = 0; i < names.length; i++) {
      const k = norm(names[i]);
      (m[k] = m[k] || []).push(names[i]);
    }
    return m;
  };
  const bA = bucket(leftA), bB = bucket(leftB);
  const pairedA = {}, pairedB = {};

  Object.keys(bA).forEach(function (k) {
    if (!bB[k]) return;
    if (bA[k].length > 1 || bB[k].length > 1) {
      warnings.push('ambiguous tab name normalisation "' + k + '": [' +
                    bA[k].join(', ') + '] vs [' + bB[k].join(', ') +
                    '] — left unpaired rather than guessed');
      return;
    }
    const a = bA[k][0], b = bB[k][0];
    tabMap[a] = b; pairs.push([a, b]);
    pairedA[a] = true; pairedB[b] = true;
    changes.push({ tab: a, change: 'TAB_RENAMED', aRef: '', bRef: '',
                   column: '', old: a, new: b });
  });

  // 3. leftovers
  for (let i = 0; i < leftA.length; i++) {
    if (pairedA[leftA[i]]) continue;
    deleted.push(leftA[i]);
    changes.push({ tab: leftA[i], change: 'TAB_DELETED', aRef: '', bRef: '',
                   column: '', old: leftA[i], new: '' });
  }
  for (let i = 0; i < leftB.length; i++) {
    if (pairedB[leftB[i]]) continue;
    added.push(leftB[i]);
    changes.push({ tab: leftB[i], change: 'TAB_ADDED', aRef: '', bRef: '',
                   column: '', old: '', new: leftB[i] });
  }

  return { tabMap: tabMap, pairs: pairs, added: added, deleted: deleted,
           changes: changes, warnings: warnings };
}

// ===========================================================================
// STEP 9 (pure half) — compareWorkbooks
// ===========================================================================

/**
 * Two-phase orchestration over IN-MEMORY workbooks. This is everything Step 9's
 * run() does apart from the Sheets and Drive calls: run() will read each tab
 * into a { name: TabData } map, hand both maps to this function, and write
 * toCsv(result.changes) to Drive.
 *
 *   workbook = { tabs: { name: TabData }, names: [name] }
 *
 * PHASE 1 reads and ALIGNS EVERY paired tab before PHASE 2 compares ANY tab.
 * This is load-bearing, not tidiness: relocating Rates!R4C2 inside the HVAC tab
 * needs the Rates row map, and a single-pass loop that aligns and compares one
 * tab at a time cannot have it. The symptom is false FORMULA rows across every
 * referencing tab — plausible enough to be believed.
 *
 * Order WITHIN a phase is free, because relocation is single-hop (plan §0.2).
 *
 * It lives here rather than in the harness because the tests that exercise
 * two-phase ordering (18, 22, 26) would otherwise be testing a copy of it.
 */
function compareWorkbooks(wbA, wbB, opts) {
  opts = opts || OPTS;

  // PHASE 0 — pair
  const pairing = pairTabs(wbA.names, wbB.names);
  const changes = pairing.changes.slice();

  // PHASE 1 — read (already in memory) and align every paired tab
  const rowMaps = {};
  const prepared = [];
  for (let i = 0; i < pairing.pairs.length; i++) {
    const aName = pairing.pairs[i][0], bName = pairing.pairs[i][1];
    const tabA = wbA.tabs[aName], tabB = wbB.tabs[bName];
    const common = Math.min(gridWidth_(tabA), gridWidth_(tabB));
    const alignment = alignRows(hashGrid(tabA, common).hashes,
                                hashGrid(tabB, common).hashes,
                                tabA, tabB, opts);
    // A skipped tab gets NO entry. The absence is what Step 4e keys on.
    if (!alignment.skipped) rowMaps[aName] = alignment.rowMap;
    prepared.push({ aName: aName, bName: bName, tabA: tabA, tabB: tabB,
                    alignment: alignment });
  }
  for (let i = 0; i < pairing.added.length; i++) {
    const name = pairing.added[i];
    changes.push.apply(changes, scanErrorsUnaligned(wbB.tabs[name], name));
  }

  // ---- every tab is aligned before any tab is compared ----

  // PHASE 2 — compare
  const tables = { rowMaps: rowMaps, tabMap: pairing.tabMap };
  const results = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    const stats = {};
    changes.push.apply(changes,
      diffTab(p.tabA, p.tabB, p.alignment, tables, p.aName, opts, stats));
    stats.tab = p.aName;
    stats.renamedTo = (p.aName !== p.bName) ? p.bName : '';
    results.push(stats);
  }

  return { changes: changes, tables: tables, results: results,
           pairing: pairing };
}

// ===========================================================================
// STEP 10 — buildSummary
// ===========================================================================
//
// Pure: it reads the bundle compareWorkbooks returned and formats text. Nothing
// below this comment touches SpreadsheetApp either, so the summary is testable
// on fixtures like everything else above the I/O boundary.

/**
 * Numeric columns, in the plan's order. REF IS FIRST AND STAYS FIRST: a broken
 * reference outranks any value change in a model review (plan Step 10).
 */
const SUMMARY_COLS = [
  { key: 'REF',    w: 6 },
  { key: 'VAL',    w: 6 },
  { key: 'FORM',   w: 7 },
  { key: 'UNVER',  w: 8 },
  { key: 'VOL',    w: 6 },
  { key: 'HARD',   w: 7 },
  { key: 'FMLZD',  w: 8 },
  { key: '±ROW', w: 7 },
  { key: '±COL', w: 7 }
];

/** Change type -> summary column. Types absent from this map are structural. */
const SUMMARY_TYPE_COL = {
  REF_ERROR: 'REF', REF_ERROR_NEW: 'REF', REF_ERROR_FIXED: 'REF',
  VALUE: 'VAL', FORMULA: 'FORM', FORMULA_UNVERIFIED: 'UNVER',
  VOLATILE_VALUE: 'VOL', HARDCODED: 'HARD', FORMULARIZED: 'FMLZD'
};

/**
 * Plan Step 10. Fixed-width, no colour, no dependencies.
 *
 * Signature note: the plan's module map says buildSummary(results), but a
 * summary needs the pairing (added / deleted / renamed tabs and the
 * ambiguous-name warnings), the change rows themselves (the per-type tallies and
 * the root-versus-inherited split live there, not in stats) and the run's own
 * facts (file names, row count, elapsed). So it takes the whole report:
 *
 *   { titleA, titleB, tabCountA, tabCountB, result, fileName, fileUrl,
 *     csvRows, elapsedMs }
 *
 * `result` is compareWorkbooks' return value. Everything else is optional and
 * degrades to a placeholder, which is what lets the tests call it on a bare
 * comparison with no Drive file behind it.
 *
 * BOTH ERROR LINES ARE MANDATORY when their counts are non-zero (plan Step 10):
 * one for what broke in this revision, one making explicit that pre-existing
 * errors are a STATE REPORT rather than a change. Without the second, a reader
 * filters them out as diff noise — which is precisely the requirement this tool
 * exists to serve.
 */
function buildSummary(report) {
  report = report || {};
  const result  = report.result;
  const changes = result.changes;
  const pairing = result.pairing;
  const L = [];

  // ---- tally the change rows per tab -------------------------------------
  // Per-type counts come from the rows, not from stats: stats knows how many
  // cells were emitted but not what they were called, and the error split is
  // only visible on the rows.
  const byTab = {};
  const bucket = function (name) {
    if (!byTab[name]) {
      byTab[name] = { REF: 0, VAL: 0, FORM: 0, UNVER: 0, VOL: 0, HARD: 0,
                      FMLZD: 0, cells: 0 };
    }
    return byTab[name];
  };

  let refNew = 0, refFixed = 0, refPre = 0, refRoot = 0, refInherited = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const col = SUMMARY_TYPE_COL[c.change];
    if (col) { const b = bucket(c.tab); b[col]++; b.cells++; }
    if (c.change === 'REF_ERROR_NEW')        refNew++;
    else if (c.change === 'REF_ERROR_FIXED') refFixed++;
    else if (c.change === 'REF_ERROR')       refPre++;
    if (col === 'REF') {
      if (changeIsRoot_(c)) refRoot++; else refInherited++;
    }
  }
  const refTotal = refNew + refFixed + refPre;

  // ---- one table row per tab --------------------------------------------
  // Paired tabs in A's order (exact matches first, then renames — pairTabs
  // builds `pairs` that way), then deleted, then added.
  const rows = [];
  let nChanged = 0, nUnchanged = 0, nSkipped = 0;

  for (let i = 0; i < result.results.length; i++) {
    const s = result.results[i];
    const b = bucket(s.tab);
    const structural = s.rowsAdded + s.rowsDeleted + s.colsAdded + s.colsDeleted;
    let status;
    if (s.skipped) {
      status = 'SKIPPED'; nSkipped++;
    } else if (b.cells > 0 || structural > 0) {
      // A renamed tab whose cells also changed must not read as merely
      // "renamed" — that would hide every row in it.
      status = s.renamedTo ? 'ren+mod' : 'modified'; nChanged++;
    } else if (s.renamedTo) {
      status = 'renamed'; nChanged++;
    } else {
      status = 'unchanged'; nUnchanged++;
    }
    rows.push({
      label: s.renamedTo ? (s.tab + ' → ' + s.renamedTo) : s.tab,
      status: status,
      tally: b,
      stats: s,
      // A skipped tab's cells were never compared, so every column but REF is a
      // dash. Printing 0 there would assert "no value changes", which is a lie.
      numeric: !s.skipped
    });
  }

  for (let i = 0; i < pairing.deleted.length; i++) {
    rows.push({ label: pairing.deleted[i], status: 'deleted', tally: null,
                stats: null, numeric: false, refDash: true });
    nChanged++;
  }
  for (let i = 0; i < pairing.added.length; i++) {
    // Added tabs are error-scanned and nothing else (plan Step 9, phase 1), so
    // REF is real and the rest are dashes.
    rows.push({ label: pairing.added[i], status: 'added',
                tally: bucket(pairing.added[i]), stats: null, numeric: false });
  }

  // ---- render -----------------------------------------------------------
  let tabW = 20;
  for (let i = 0; i < rows.length; i++) tabW = Math.max(tabW, rows[i].label.length);
  const statusW = 11;

  let header = padR_('TAB', tabW + 2) + padR_('STATUS', statusW);
  for (let i = 0; i < SUMMARY_COLS.length; i++) {
    header += padL_(SUMMARY_COLS[i].key, SUMMARY_COLS[i].w);
  }
  const rule = repeat_('─', header.length);

  L.push('A: ' + padR_(String(report.titleA || '(A)'), tabW + 2) +
         '(' + (report.tabCountA !== undefined ? report.tabCountA : '?') + ' tabs)');
  L.push('B: ' + padR_(String(report.titleB || '(B)'), tabW + 2) +
         '(' + (report.tabCountB !== undefined ? report.tabCountB : '?') + ' tabs)');
  L.push('');
  L.push(header);
  L.push(rule);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let line = padR_(r.label, tabW + 2) + padR_(r.status, statusW);
    for (let k = 0; k < SUMMARY_COLS.length; k++) {
      const col = SUMMARY_COLS[k];
      line += padL_(summaryCell_(r, col.key), col.w);
    }
    L.push(line);
  }
  L.push(rule);

  // ---- totals -----------------------------------------------------------
  let totals = nChanged + ' changed, ' + nUnchanged + ' unchanged, ' +
               nSkipped + ' skipped.';
  if (pairing.added.length) totals += '  ' + pairing.added.length + ' added in B.';
  const sum = function (key) {
    let n = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].tally) n += rows[i].tally[key];
    return n;
  };
  totals += '  ' + sum('VAL') + ' values, ' + sum('FORM') + ' formulas, ' +
            sum('HARD') + ' hardcodes, ' + sum('VOL') + ' volatile.';
  L.push(totals);

  if (refTotal === 0) {
    L.push('REFERENCE ERRORS: none in either file.');
  } else {
    L.push('REFERENCE ERRORS: ' + refTotal + ' total — ' + refNew + ' new, ' +
           refFixed + ' fixed, ' + refPre + ' pre-existing.  ' +
           refRoot + ' root, ' + refInherited + ' inherited.');
  }

  let footer = '→ ' + (report.fileName || '(no file written)') +
               ' (' + (report.csvRows !== undefined ? report.csvRows
                                                    : changes.length) + ' rows';
  if (report.elapsedMs !== undefined) {
    footer += ', ' + Math.round(report.elapsedMs / 1000) + 's';
  }
  L.push(footer + ')');
  if (report.fileUrl) L.push('  ' + report.fileUrl);

  // ---- the warning block ------------------------------------------------
  L.push('');
  const notes = summaryNotes_(result, {
    refNew: refNew, refPre: refPre, refTotal: refTotal, rows: rows
  });
  for (let i = 0; i < notes.length; i++) L.push(notes[i]);

  return L.join('\n');
}

/** One table cell: a right-aligned number, or a dash where nothing was measured. */
function summaryCell_(r, key) {
  const DASH = '—';
  if (key === 'REF') {
    return r.refDash ? DASH : String(r.tally ? r.tally.REF : 0);
  }
  if (!r.numeric) return DASH;
  if (key === '±ROW') return signed_(r.stats.rowsAdded - r.stats.rowsDeleted);
  if (key === '±COL') return signed_(r.stats.colsAdded - r.stats.colsDeleted);
  return String(r.tally[key]);
}

/**
 * Plan Step 10's warning block, in the plan's order. Each note is suppressed
 * when its count is zero, EXCEPT the two error lines, which are mandatory
 * whenever any error exists — see buildSummary's header comment.
 */
function summaryNotes_(result, t) {
  const out = [];
  const results = result.results;

  if (t.refNew > 0) {
    out.push('⚠ ' + t.refNew + ' reference' + (t.refNew === 1 ? '' : 's') +
             ' broke in this revision (REF_ERROR_NEW). Read these first.');
  }
  if (t.refPre > 0) {
    out.push('⚠ ' + t.refPre + ' pre-existing reference error' +
             (t.refPre === 1 ? ' was' : 's were') +
             ' already present in both files (REF_ERROR).');
    out.push('  These are not changes — they are flagged because the scan ' +
             'reports state, not deltas.');
  }

  // Skipped tabs, each with the errors that were still scanned inside it.
  for (let i = 0; i < results.length; i++) {
    const s = results[i];
    if (!s.skipped) continue;
    let refs = 0;
    for (let k = 0; k < t.rows.length; k++) {
      if (t.rows[k].stats === s) { refs = t.rows[k].tally.REF; break; }
    }
    out.push('⚠ ' + s.tab + ' skipped: ' + s.reason + '.');
    out.push(refs === 0
      ? '  It was still scanned and holds no reference errors; its cells were ' +
        'not compared.'
      : '  Its ' + refs + ' reference error' + (refs === 1 ? ' was' : 's were') +
        ' still scanned; its cells were not compared.');
  }

  // Unverifiable references, attributed to the tab whose row map is missing —
  // which is the tab a reader has to go and look at (plan Step 11.6).
  let unverified = 0;
  const targets = {};
  for (let i = 0; i < results.length; i++) {
    unverified += results[i].unverified;
    const ut = results[i].unverifiedTargets || {};
    Object.keys(ut).forEach(function (k) {
      targets[k] = (targets[k] || 0) + ut[k];
    });
  }
  if (unverified > 0) {
    const parts = Object.keys(targets).map(function (k) {
      return k + ' (' + targets[k] + ')';
    });
    out.push('⚠ ' + unverified + (unverified === 1 ? ' formula holds'
                                                   : ' formulas hold') +
             ' unverifiable references' +
             (parts.length ? ' into: ' + parts.join(', ') : '') + '.');
    out.push('  A large count means a referenced tab was skipped or unpaired.');
  }

  // Volatile. The gap between emitted and total is the point: a volatile
  // formula whose value happened not to change is NOT detected (plan §0.3).
  let volEmitted = 0, volCells = 0;
  for (let i = 0; i < results.length; i++) {
    volEmitted += results[i].volatileEmitted;
    volCells   += results[i].volatileCells;
  }
  if (volEmitted > 0) {
    out.push('⚠ ' + volEmitted + ' INDIRECT/OFFSET formula' +
             (volEmitted === 1 ? '' : 's') +
             ' changed value with identical text (VOLATILE_VALUE).');
  }
  if (volCells > 0) {
    out.push('  ' + volCells + (volCells === 1 ? ' volatile formula exists'
                                              : ' volatile formulas exist') +
             ' in total — any whose value happened not to change are ' +
             'NOT detected.');
  }

  let derived = 0;
  for (let i = 0; i < results.length; i++) derived += results[i].derivedSuppressed;
  if (derived > 0) {
    out.push('ℹ Derived values suppressed: ' + derived +
             ' cell' + (derived === 1 ? '' : 's') +
             ' changed value with identical formulas.');
    out.push('  Downstream tabs may show no rows even where numbers moved — ' +
             'the cause is reported at');
    out.push('  its root, which in a reference chain can sit several tabs away.');
  }

  // Relocation footer. Plan Step 11.4 reads this as the field check for §1.2a.
  let relocated = 0, moved = 0;
  const movedTabs = [];
  for (let i = 0; i < results.length; i++) {
    const s = results[i];
    relocated += s.relocated;
    if (s.rowsAdded || s.rowsDeleted) {
      moved += s.rowsAdded + s.rowsDeleted;
      // A net delta of zero still moved rows. Reporting "0 rows in X" hides an
      // insertion and a deletion that cancelled, so both counts are shown.
      const d = s.rowsAdded - s.rowsDeleted;
      movedTabs.push((s.rowsAdded && s.rowsDeleted)
        ? ('+' + s.rowsAdded + '/-' + s.rowsDeleted + ' rows in ' + s.tab)
        : (signed_(d) + ' row' + (Math.abs(d) === 1 ? '' : 's') + ' in ' + s.tab));
    }
  }
  if (relocated > 0 || moved > 0) {
    out.push('ℹ References relocated: ' +
             (movedTabs.length ? movedTabs.join(', ') + ', ' : '') +
             relocated + ' formula' + (relocated === 1 ? '' : 's') + ' realigned.');
  }

  // Plan Step 11.4, automated. 0 realigned while rows moved AND absolute
  // references exist is the signature of REF_RE matching nothing — the one
  // failure mode of Step 4 that is otherwise completely silent, and the reason
  // plan §1.2a gates the whole build. The absRefs gate keeps it from firing on a
  // workbook that simply has nothing to realign.
  let absRefs = 0;
  for (let i = 0; i < results.length; i++) absRefs += results[i].absRefs;
  if (relocated === 0 && moved > 0 && absRefs > 0) {
    out.push('⚠ 0 formulas realigned while ' + moved + ' row' +
             (moved === 1 ? '' : 's') + ' moved, yet ' + absRefs +
             ' formula' + (absRefs === 1 ? '' : 's') + ' hold absolute row');
    out.push('  references. Step 4 may be matching nothing: verify the R1C1 ' +
             'reference forms against');
    out.push('  plan §1.2a before trusting the FORMULA rows in this run.');
  }

  for (let i = 0; i < results.length; i++) {
    if (!results[i].noise) continue;
    out.push('⚠ ' + results[i].tab + ': ' + results[i].emitted + ' of ' +
             results[i].compared + ' compared cells changed — above the ' +
             'noise threshold. Check the alignment.');
  }

  const warnings = result.pairing.warnings || [];
  for (let i = 0; i < warnings.length; i++) out.push('⚠ ' + warnings[i]);

  return out;
}

function padR_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function padL_(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}

function repeat_(ch, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ch;
  return s;
}

function signed_(n) {
  return n > 0 ? ('+' + n) : String(n);
}

// ===========================================================================
// I/O BOUNDARY — everything below this line touches SpreadsheetApp / DriveApp
// ===========================================================================
//
// Steps 8 and 9's shell. Nothing above this line does any I/O, which is what
// lets all 33 acceptance tests run on fixtures. Nothing here is unit-tested
// against a live spreadsheet — plan Step 11 is that verification, and it is a
// manual run.
//
// NOTHING HERE WRITES TO EITHER SOURCE SPREADSHEET. Read-only by construction is
// what makes the tool safe to point at a live model.

// Plan Step 8: quota is 6T + 4 calls for T paired tabs. Above ~10 tabs per file,
// pace the reads.
const READ_PACE_TABS = 10;
const READ_PACE_MS   = 1000;

/**
 * Plan Step 8. The ONLY Sheets I/O in the tool: three grids and the two offsets
 * of one tab, trimmed.
 *
 * getDataRange() DOES NOT NECESSARILY START AT A1. If the first populated cell
 * is C5 then rowOffset is 5 and colOffset is 3, and ignoring them corrupts every
 * emitted reference AND every absolute-row lookup in relocate() — the second with
 * no visible symptom, because a formula relocated through a map keyed on the
 * wrong rows still comes out looking like a formula.
 *
 * All three arrays have identical dimensions and non-formula cells return '' from
 * both formula methods. getValues() returns error tokens as plain strings, which
 * is what makes errorState (§4h) free.
 *
 * Takes anything with getDataRange() — a Sheet, or a stub. That is deliberate:
 * it is the one I/O function whose contract can be tested without a spreadsheet.
 */
function readTab(sheet) {
  const range = sheet.getDataRange();
  return trimGrid({
    values:    range.getValues(),
    fR1C1:     range.getFormulasR1C1(),
    fA1:       range.getFormulas(),
    rowOffset: range.getRow(),
    colOffset: range.getColumn()
  });
}

/**
 * Reads the tabs named in `wanted` into the { tabs, names } shape
 * compareWorkbooks consumes.
 *
 * `names` carries EVERY tab in the file even though `tabs` holds only the wanted
 * ones. That is not an inconsistency: pairTabs must see the full name list to
 * pair correctly, while a tab deleted in B needs no grid read — TAB_DELETED
 * carries no cell rows. Reading it would cost 3 API calls to produce nothing.
 */
function readSheets_(sheets, names, wanted) {
  const tabs = {};
  const pace = sheets.length > READ_PACE_TABS;
  for (let i = 0; i < sheets.length; i++) {
    if (wanted && !wanted[names[i]]) continue;
    tabs[names[i]] = readTab(sheets[i]);
    if (pace && i < sheets.length - 1) Utilities.sleep(READ_PACE_MS);
  }
  return { tabs: tabs, names: names };
}

function sheetNames_(sheets) {
  return sheets.map(function (s) { return s.getName(); });
}

/**
 * Plan Step 9. Opens both files, compares them, writes one CSV to Drive and logs
 * the summary.
 *
 * The two-phase ordering — every tab aligned before any tab is compared — lives
 * inside compareWorkbooks and is NOT re-implemented here. That is load-bearing:
 * relocating Rates!R4C2 inside the HVAC tab needs the Rates row map, and a
 * single-pass loop that reads, aligns and compares one tab at a time cannot have
 * it. The symptom is false FORMULA rows across every referencing tab, plausible
 * enough to be believed. Tests 18, 22 and 26 hold that ordering.
 *
 * Phase 0 pairs on NAMES ONLY, before any grid is read, so that the read in
 * phase 1 can skip tabs that no comparison will ever look at.
 *
 * console.log gets the summary and NEVER the CSV — Apps Script truncates large
 * log payloads with no documented ceiling, so a logged CSV silently loses rows.
 */
function run(urlA, urlB, opts) {
  const t0 = Date.now();
  opts = opts || OPTS;

  // PHASE 0 — pair, on names alone.
  const ssA = SpreadsheetApp.openByUrl(urlA || URL_A);
  const ssB = SpreadsheetApp.openByUrl(urlB || URL_B);
  const shA = ssA.getSheets(), shB = ssB.getSheets();
  const namesA = sheetNames_(shA), namesB = sheetNames_(shB);

  // Advisory only. compareWorkbooks pairs again and that call is authoritative;
  // this one exists to decide what is worth reading. pairTabs is deterministic
  // over the same inputs, so the two cannot disagree.
  const plan = pairTabs(namesA, namesB);
  const wantA = {}, wantB = {};
  for (let i = 0; i < plan.pairs.length; i++) {
    wantA[plan.pairs[i][0]] = true;
    wantB[plan.pairs[i][1]] = true;
  }
  for (let i = 0; i < plan.added.length; i++) wantB[plan.added[i]] = true;

  // PHASES 1 and 2 — read, align every tab, then compare every tab.
  const wbA = readSheets_(shA, namesA, wantA);
  const wbB = readSheets_(shB, namesB, wantB);
  const result = compareWorkbooks(wbA, wbB, opts);

  // PHASE 3 — emit.
  const fileName = 'changes-' + stamp_() + '.csv';
  const file = DriveApp.createFile(fileName, toCsv(result.changes), MimeType.CSV);

  const summary = buildSummary({
    titleA: ssA.getName(), titleB: ssB.getName(),
    tabCountA: namesA.length, tabCountB: namesB.length,
    result: result,
    fileName: fileName, fileUrl: file.getUrl(),
    csvRows: result.changes.length,
    elapsedMs: Date.now() - t0
  });
  console.log(summary);

  return { fileId: file.getId(), fileUrl: file.getUrl(),
           rows: result.changes.length, summary: summary };
}

/** yyyyMMdd-HHmm in the script's own timezone. */
function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
                              'yyyyMMdd-HHmm');
}

// ===========================================================================
// STEP 1.2 — the gate, executable
// ===========================================================================

/**
 * Plan §1.2, run against a real file instead of by hand. RUN THIS BEFORE
 * TRUSTING ANY OUTPUT OF run().
 *
 * §1.2 gates Step 4 and it is the one thing in this plan that cannot be
 * discharged from fixtures: REF_RE is written against the reference forms the
 * plan TABULATES, and the fixtures assert against those same tabulated forms, so
 * THE TEST SUITE CANNOT DETECT A MISMATCH WITH REALITY. If the real
 * getFormulasR1C1() output differs, relocation silently no-ops and every shifted
 * reference is reported as an authored change — no error, no warning.
 *
 * What it reports:
 *   (a) every formula cell's A1 and R1C1 form side by side, and — the part that
 *       matters — every R1C1 formula in which REF_RE finds NO reference. A
 *       cross-sheet or absolute-row formula in that list means the regex is
 *       broken for this workbook.
 *   (b) for each cell whose A1 form carries #REF! or #NAME?, whether the literal
 *       token SURVIVES into the R1C1 form. §4h's root-versus-inherited test is a
 *       substring match against it; if R1C1 drops or transforms the token, every
 *       broken reference is misclassified as inherited. This rendering is not
 *       documented anywhere — it has to be observed.
 *
 * Read-only. Pass a tab name to narrow it, or omit for every tab.
 */
function verifyReferenceForms(url, tabName) {
  const ss = SpreadsheetApp.openByUrl(url || URL_A);
  const sheets = tabName ? [ss.getSheetByName(tabName)] : ss.getSheets();
  if (!sheets[0]) throw new Error('no such tab: ' + tabName);

  const L = ['STEP 1.2 — reference forms observed in "' + ss.getName() + '"', ''];
  const unmatched = [], errCells = [];
  let formulaCells = 0, withRefs = 0, brokenNoMatch = 0;

  for (let s = 0; s < sheets.length; s++) {
    const name = sheets[s].getName();
    const tab = readTab(sheets[s]);
    const width = gridWidth_(tab);

    for (let r = 0; r < tab.fA1.length; r++) {
      for (let c = 0; c < width; c++) {
        const a1f = tab.fA1[r][c], rcf = tab.fR1C1[r][c];
        if (a1f === '' && rcf === '') continue;
        formulaCells++;
        const ref = a1(r + tab.rowOffset, c + tab.colOffset);
        L.push(pad_(name + '!' + ref, 28) + pad_(a1f, 44) + rcf);

        // (b) does the error token survive into R1C1? Computed first because (a)
        //     needs to know whether an unmatched formula is merely broken.
        const tok = REF_ERROR_TOKENS.filter(function (t) {
          return a1f.indexOf(t) !== -1 || rcf.indexOf(t) !== -1;
        })[0];

        // (a) does REF_RE see anything at all in this R1C1 form?
        const found = [];
        rewriteRefs_(rcf, function (m) {
          found.push(formatRef_(m.sheet, m.rowPart, m.colPart));
          return '';
        });
        if (found.length) withRefs++;
        // A formula whose reference is already #REF! has no R/C form left to
        // match, and one like =TODAY() never had one. Neither says anything about
        // REF_RE, so they are counted apart to keep the actionable list short.
        else if (tok) brokenNoMatch++;
        else unmatched.push(name + '!' + ref + '  ' + rcf);

        if (tok) {
          errCells.push(name + '!' + ref + '  A1 has ' + tok + ', R1C1 ' +
                        (rcf.indexOf(tok) !== -1 ? 'KEEPS it  ' + rcf
                                                 : 'DROPS it  ' + rcf));
        }
      }
    }
  }

  L.push('');
  L.push('(a) ' + formulaCells + ' formula cells, ' + withRefs +
         ' in which REF_RE matched at least one reference.');
  if (brokenNoMatch) {
    L.push('    ' + brokenNoMatch + (brokenNoMatch === 1 ? ' more holds' : ' more hold') +
           ' a reference error and so have no R/C form left to match — expected.');
  }
  if (unmatched.length) {
    L.push('    ' + unmatched.length + ' with NO match and no error token. A ' +
           'reference-free formula such as');
    L.push('    =TODAY() belongs here; a cross-sheet or absolute-row reference ' +
           'does NOT — that means');
    L.push('    REF_RE is wrong for this workbook and Step 4 is silently ' +
           'no-opping. Read each one:');
    for (let i = 0; i < Math.min(unmatched.length, 20); i++) {
      L.push('      ' + unmatched[i]);
    }
    if (unmatched.length > 20) {
      L.push('      ... and ' + (unmatched.length - 20) + ' more');
    }
  }

  L.push('');
  if (!errCells.length) {
    L.push('(b) No cell in this file carries #REF! or #NAME? in its A1 formula, ' +
           'so §1.2b is');
    L.push('    UNVERIFIED. Break one reference deliberately and re-run. Note ' +
           'that errorState()');
    L.push('    reads the A1 form, which §4h names as the preferred surface, so ' +
           'this is a');
    L.push('    diagnostic rather than a blocker.');
  } else {
    for (let i = 0; i < errCells.length; i++) L.push('(b) ' + errCells[i]);
  }

  const report = L.join('\n');
  console.log(report);
  return report;
}

// ===========================================================================
// STEP 1 — TEST HARNESS
// ===========================================================================

/**
 * A TabData fixture. Plan Step 1.
 *   fixture(values, fR1C1, fA1, rowOffset, colOffset)
 * fR1C1 / fA1 default to same-shaped grids of ''.
 */
function fixture(values, fR1C1, fA1, rowOffset, colOffset) {
  return {
    values: values,
    fR1C1: fR1C1 || emptyFormulas(values),
    fA1:   fA1   || emptyFormulas(values),
    rowOffset: rowOffset || 1,
    colOffset: colOffset || 1
  };
}

/** Same-shaped grid of ''. */
function emptyFormulas(values) {
  return values.map(function (row) {
    return row.map(function () { return ''; });
  });
}

/**
 * Multi-tab workbook fixture. Plan Step 1 requires this now rather than as a
 * Step 9 retrofit — tests 18 and 21-33 need at least three tabs each.
 *
 *   workbook({ Rates: fixture(...), HVAC: fixture(...) })
 *
 * Returns { tabs: {name: TabData}, names: [...] } with insertion order kept,
 * which is what pairTabs (Step 7) will consume.
 */
function workbook(tabs) {
  const names = Object.keys(tabs);
  for (let i = 0; i < names.length; i++) {
    const t = tabs[names[i]];
    if (!t || !t.values || !t.fR1C1 || !t.fA1) {
      throw new Error('workbook(): tab "' + names[i] + '" is not a TabData fixture');
    }
  }
  return { tabs: tabs, names: names };
}

/**
 * Builds a TabData from a compact spec: a grid where any string starting with
 * '=' becomes a formula. `r1c1` supplies the R1C1 forms positionally; where it
 * is omitted the A1 text is reused, which is fine for tests that never compare
 * across a row shift.
 *
 *   sheet([['Label', 10], ['Total', '=SUM(B1:B1)']])
 */
function sheet(grid, r1c1, rowOffset, colOffset) {
  const values = [], fA1 = [], fR = [];
  for (let r = 0; r < grid.length; r++) {
    const vr = [], ar = [], rr = [];
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (typeof cell === 'string' && cell.charAt(0) === '=') {
        vr.push('');           // tests that care about the value set it explicitly
        ar.push(cell);
        rr.push((r1c1 && r1c1[r] && r1c1[r][c] !== undefined) ? r1c1[r][c] : cell);
      } else {
        vr.push(cell === undefined || cell === null ? '' : cell);
        ar.push('');
        rr.push('');
      }
    }
    values.push(vr); fA1.push(ar); fR.push(rr);
  }
  return fixture(values, fR, fA1, rowOffset, colOffset);
}

// --- assertions ------------------------------------------------------------

let TEST_STATE = null;

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) fail_(label + ': expected ' + e + ', got ' + a);
}

function assertCount(changes, type, n) {
  const got = changes.filter(function (c) { return c.change === type; });
  if (got.length !== n) {
    fail_('expected ' + n + ' ' + type + ', got ' + got.length +
          ' [' + got.map(describe_).join('; ') + ']');
  }
}

function assertNone(changes, type) {
  assertCount(changes, type, 0);
}

function assertTotal(changes, n) {
  if (changes.length !== n) {
    fail_('expected ' + n + ' change(s) in total, got ' + changes.length +
          ' [' + changes.map(describe_).join('; ') + ']');
  }
}

function fail_(msg) {
  TEST_STATE.failures.push(msg);
}

function describe_(c) {
  return c.change + '@' + (c.aRef || '-') + '/' + (c.bRef || '-') +
         ' "' + c.old + '"->"' + c.new + '"';
}

// --- runner ----------------------------------------------------------------

/**
 * Runs every acceptance test that the current build state supports and logs
 * PASS / FAIL per test, with expected-vs-actual on failure. Tests whose step is
 * not built yet are listed as PENDING and are NOT counted as passes.
 */
function runTests() {
  const lines = [];
  let pass = 0, fail = 0;

  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i];
    TEST_STATE = { failures: [] };
    let thrown = null;
    try {
      t.fn();
    } catch (e) {
      thrown = (e && e.stack) ? e.stack : String(e);
    }
    if (thrown) TEST_STATE.failures.push('THREW ' + thrown);

    if (TEST_STATE.failures.length === 0) {
      pass++;
      lines.push('PASS  ' + pad_('#' + t.n, 5) + ' ' + t.name);
    } else {
      fail++;
      lines.push('FAIL  ' + pad_('#' + t.n, 5) + ' ' + t.name);
      for (let k = 0; k < TEST_STATE.failures.length; k++) {
        lines.push('        ' + TEST_STATE.failures[k]);
      }
    }
  }
  TEST_STATE = null;

  for (let i = 0; i < PENDING.length; i++) {
    lines.push('PEND  ' + pad_('#' + PENDING[i].n, 5) + ' ' + PENDING[i].name +
               '   (needs step ' + PENDING[i].step + ')');
  }

  // Two separate tallies on purpose. TESTS holds the plan's numbered acceptance
  // tests (numeric `n`) AND local tests of branches the plan defines but does
  // not number (string `n`, e.g. '2b'). Reporting one combined figure "of 33"
  // overstates plan coverage — 27 passed + 19 pending does not equal 33, and
  // the mismatch is invisible unless both numbers are printed.
  const planRun = TESTS.filter(function (t) { return typeof t.n === 'number'; }).length;
  const localRun = TESTS.length - planRun;

  lines.push('');
  lines.push(pass + ' passed, ' + fail + ' failed, ' + PENDING.length + ' pending.');
  lines.push('Plan acceptance tests: ' + planRun + ' implemented, ' +
             PENDING.length + ' pending on unbuilt steps, ' +
             (planRun + PENDING.length) + ' total.');
  lines.push('Local tests of unnumbered branches: ' + localRun + '.');

  const report = lines.join('\n');
  if (typeof console !== 'undefined' && console.log) console.log(report);
  return report;
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/**
 * One tab against one tab, through the WHOLE pipeline — pairing, alignment,
 * relocation, masking, comparison. The shape most single-tab tests want.
 *
 * This replaced the walkAligned_ scaffolding that stood in for Step 5 while it
 * did not exist. Every test written against the scaffolding now runs against
 * the real diffTab, which is the point: the scaffolding never relocated, never
 * masked, never checked headers and never scanned unaligned tabs, so a test
 * that passed under it proved less than it looked like it did.
 */
function diffFixture_(tabA, tabB, opts) {
  return cmp_(workbook({ T: tabA }), workbook({ T: tabB }), opts).changes;
}

/** Multi-tab: the full two-phase compare over two workbook fixtures. */
function cmp_(wbA, wbB, opts) {
  return compareWorkbooks(wbA, wbB, opts || OPTS);
}

/**
 * Builds a padded filler grid: `n` rows of [label i, i*10]. Tabs need ~16 rows
 * before an isolated one-cell edit stops tripping the edit-distance cap
 * (2 / (2n) <= 0.30 needs n >= 4, and several spread edits need many more).
 */
function filler_(n, startAt) {
  const g = [];
  for (let i = 0; i < n; i++) {
    const k = (startAt || 1) + i;
    g.push(['Row ' + k, k * 10]);
  }
  return g;
}

/**
 * Plants formulas into a grid and returns the TabData.
 *
 *   plantG_(grid, [[rowIdx, colIdx, a1Formula, r1c1Formula, value], ...])
 *
 * The R1C1 form is given explicitly because that is what Step 4 operates on and
 * what the tests are actually about — a fixture that let A1 stand in for R1C1
 * would be testing nothing. `value` is the formula cell's displayed result.
 * Rows are padded to a common width so the grid stays rectangular.
 */
function plantG_(grid, cells, rowOffset, colOffset) {
  const r1c1 = [];
  for (let i = 0; i < cells.length; i++) {
    const r = cells[i][0], c = cells[i][1];
    while (grid[r].length <= c) grid[r].push('');
    grid[r][c] = cells[i][2];
    if (!r1c1[r]) r1c1[r] = [];
    r1c1[r][c] = cells[i][3];
  }
  let w = 0;
  for (let i = 0; i < grid.length; i++) w = Math.max(w, grid[i].length);
  for (let i = 0; i < grid.length; i++) while (grid[i].length < w) grid[i].push('');

  const t = sheet(grid, r1c1, rowOffset, colOffset);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i][4] !== undefined) t.values[cells[i][0]][cells[i][1]] = cells[i][4];
  }
  return t;
}

/** plantG_ over a fresh `n`-row filler grid. */
function plant_(n, cells) {
  return plantG_(filler_(n), cells);
}

/** An `n`-row filler tab with one row inserted at array index `idx`. */
function inserted_(n, idx, cells) {
  const g = filler_(n);
  g.splice(idx, 0, ['Inserted', 999]);
  return plantG_(g, cells || []);
}

/**
 * A stand-in for a Sheet, for the two Step 8 tests.
 *
 * readTab is the one I/O function whose contract is testable without a
 * spreadsheet: it calls five methods on getDataRange() and hands the results to
 * trimGrid. What the tests check is that the two OFFSETS survive that hand-off —
 * dropping them corrupts every absolute-row lookup in relocate() with no visible
 * symptom, which is the failure plan Step 8 calls out.
 *
 * It does not and cannot verify what the real API returns. That is plan §1.2 and
 * Step 11, both manual.
 */
function stubSheet_(spec) {
  return {
    getDataRange: function () {
      return {
        getValues:        function () { return spec.values; },
        getFormulasR1C1:  function () { return spec.fR1C1; },
        getFormulas:      function () { return spec.fA1; },
        getRow:           function () { return spec.row; },
        getColumn:        function () { return spec.col; }
      };
    }
  };
}

/** A 20-row tab rewritten past the edit-distance cap — always skipped. */
function unalignable_() {
  const g = filler_(20);
  for (let i = 0; i < 9; i++) g[i * 2] = ['Wholly different ' + i, 5000 + i];
  return sheet(g);
}

// ===========================================================================
// ACCEPTANCE TESTS  (plan "Verification" table)
// ===========================================================================

const TESTS = [

  // --- Step 2 ------------------------------------------------------------

  { n: 1, name: 'Identical grids -> 0 changes', fn: function () {
      const a = sheet(filler_(16));
      const b = sheet(filler_(16));
      assertTotal(diffFixture_(a, b), 0);
  }},

  { n: 2, name: 'One literal changed, no formulas in the row -> exactly 1 VALUE',
    fn: function () {
      const ga = filler_(16), gb = filler_(16);
      gb[6][1] = 999;
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'VALUE', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].old, '70', 'old');
      assertEqual(changes[0].new, '999', 'new');
      assertEqual(changes[0].aRef, 'B7', 'aRef');
  }},

  { n: 3, name: 'Formula rewritten, result unchanged -> 1 FORMULA, 0 VALUE',
    fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[5][1] = '=A1+B1';  gb[5][1] = '=A1+B1+0';
      const a = sheet(ga), b = sheet(gb);
      a.values[5][1] = 42;  b.values[5][1] = 42;   // same result either way
      const changes = diffFixture_(a, b);
      assertCount(changes, 'FORMULA', 1);
      assertNone(changes, 'VALUE');
      assertNone(changes, 'FORMULA_UNVERIFIED');
      assertTotal(changes, 1);
  }},

  { n: 4, name: 'Input changed; downstream formulas identical, non-volatile ' +
                '-> 1 VALUE, no derived rows',
    fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[3][1] = 10;  gb[3][1] = 12;
      ga[9][1] = '=B4*2';  gb[9][1] = '=B4*2';
      const a = sheet(ga), b = sheet(gb);
      a.values[9][1] = 20;  b.values[9][1] = 24;   // derived: moved, suppressed
      const changes = diffFixture_(a, b);
      assertCount(changes, 'VALUE', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].aRef, 'B4', 'the input cell, not the derived one');
  }},

  { n: 5, name: 'Literal typed over a formula -> HARDCODED, old=formula',
    fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[6][1] = '=B2*3';
      const a = sheet(ga), b = sheet(gb);
      a.values[6][1] = 60;  b.values[6][1] = 60;
      const changes = diffFixture_(a, b);
      assertCount(changes, 'HARDCODED', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].old, '=B2*3', 'old');
      assertEqual(changes[0].new, '60', 'new');
  }},

  { n: 6, name: 'Literal island inside a calculated zone changed -> 1 VALUE',
    fn: function () {
      // Every row carries a formula in column C; only the literal in B8 moves.
      // A pivot-scan implementation that treats the block as "the calc zone"
      // never looks at B8 and fails this.
      const build = function (islandValue) {
        const g = [];
        for (let i = 0; i < 16; i++) {
          g.push(['Row ' + (i + 1), i === 7 ? islandValue : (i + 1) * 10, '=B1*2']);
        }
        const t = sheet(g);
        for (let i = 0; i < 16; i++) t.values[i][2] = (i + 1) * 20;
        return t;
      };
      const changes = diffFixture_(build(80), build(85));
      assertCount(changes, 'VALUE', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].aRef, 'B8', 'aRef');
  }},

  { n: 9, name: 'Date cell unchanged between files -> 0 rows', fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[4][1] = new Date(2026, 0, 15);
      gb[4][1] = new Date(2026, 0, 15);           // distinct object, same instant
      assertTotal(diffFixture_(sheet(ga), sheet(gb)), 0);
  }},

  { n: 11, name: '#DIV/0! in B where A had a number -> 1 VALUE, not REF_ERROR',
    fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[8][1] = 90;  gb[8][1] = '#DIV/0!';
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'VALUE', 1);
      assertNone(changes, 'REF_ERROR');
      assertNone(changes, 'REF_ERROR_NEW');
      assertTotal(changes, 1);
  }},

  { n: 30, name: '#REF! in both files, formulas identical -> 1 REF_ERROR',
    fn: function () {
      // The changes-only exception. If diffCell's rule 3 sits after the
      // identical-formula suppression rule this emits nothing and looks right.
      const ga = filler_(16), gb = filler_(16);
      ga[5][1] = "='Ref Src'!#REF!";  gb[5][1] = "='Ref Src'!#REF!";
      const a = sheet(ga), b = sheet(gb);
      a.values[5][1] = '#REF!';  b.values[5][1] = '#REF!';
      const changes = diffFixture_(a, b);
      assertCount(changes, 'REF_ERROR', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].new, "='Ref Src'!#REF!", 'root shows its own formula');
  }},

  // Unnumbered taxonomy branches the plan defines but does not test.

  { n: '2b', name: 'FORMULARIZED — literal in A, formula in B', fn: function () {
      const ga = filler_(16), gb = filler_(16);
      gb[6][1] = '=B2*3';
      const a = sheet(ga), b = sheet(gb);
      b.values[6][1] = 70;
      const changes = diffFixture_(a, b);
      assertCount(changes, 'FORMULARIZED', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].old, '70', 'old is the A-side literal');
      assertEqual(changes[0].new, '=B2*3', 'new is the B-side A1 formula');
  }},

  { n: '2c', name: 'REF_ERROR_NEW / REF_ERROR_FIXED direction', fn: function () {
      const mk = function (formula, value) {
        const g = filler_(16);
        g[5][1] = formula;
        const t = sheet(g);
        t.values[5][1] = value;
        return t;
      };
      const clean  = function () { return mk('=Rates!B4', 55); };
      const broken = function () { return mk('=Rates!#REF!', '#REF!'); };

      let c = diffFixture_(clean(), broken());
      assertCount(c, 'REF_ERROR_NEW', 1);
      assertTotal(c, 1);

      c = diffFixture_(broken(), clean());
      assertCount(c, 'REF_ERROR_FIXED', 1);
      assertTotal(c, 1);
  }},

  { n: '2d', name: 'Inherited error — clean formula, value reads #REF!',
    fn: function () {
      const mk = function () {
        const g = filler_(16);
        g[5][1] = '=Assumptions!C7';
        const t = sheet(g);
        t.values[5][1] = '#REF!';
        return t;
      };
      const changes = diffFixture_(mk(), mk());
      assertCount(changes, 'REF_ERROR', 1);
      assertEqual(changes[0].new, '=Assumptions!C7',
                  'inherited row still shows its own clean formula');
  }},

  { n: '2e', name: 'HARDCODED wins over a broken formula in A', fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[5][1] = '=Rates!#REF!';
      gb[5][1] = 55;
      const a = sheet(ga);
      a.values[5][1] = '#REF!';
      const changes = diffFixture_(a, sheet(gb));
      assertCount(changes, 'HARDCODED', 1);
      assertNone(changes, 'REF_ERROR_FIXED');
      assertEqual(changes[0].old, '=Rates!#REF!', 'the breakage stays visible');
  }},

  { n: '2f', name: 'valuesEqual — epsilon, trim, Date, mixed types',
    fn: function () {
      assertEqual(valuesEqual(1, 1 + 1e-12, OPTS), true, 'below epsilon');
      assertEqual(valuesEqual(1, 1.1, OPTS), false, 'above epsilon');
      assertEqual(valuesEqual(' a ', 'a', OPTS), true, 'trimmed');
      assertEqual(valuesEqual(new Date(0), new Date(0), OPTS), true, 'dates');
      assertEqual(valuesEqual(new Date(0), '1970', OPTS), false, 'date vs string');
      assertEqual(valuesEqual('', '', OPTS), true, 'both empty');
      assertEqual(valuesEqual(0, '', OPTS), false, 'zero is not empty');
  }},

  { n: '2g', name: 'includeDerived: true surfaces the suppressed VALUE rows',
    fn: function () {
      const ga = filler_(16), gb = filler_(16);
      ga[9][1] = '=B4*2';  gb[9][1] = '=B4*2';
      const a = sheet(ga), b = sheet(gb);
      a.values[9][1] = 20;  b.values[9][1] = 24;
      assertTotal(diffFixture_(a, b), 0);
      const on = { includeDerived: true, epsilon: 1e-9, similarity: 0.5,
                   editDistanceCap: 0.30, noiseWarn: 0.30 };
      assertCount(diffFixture_(a, b, on), 'VALUE', 1);
  }},

  // Two branches reached by calling diffCell directly. Tests 22, 27 and 28 now
  // cover FORMULA_UNVERIFIED and VOLATILE_VALUE through the real pipeline, but
  // these stay: no fixture can produce ctx.maskA/maskB === undefined, because
  // diffTab always computes masks where rule 4 can use them, and that default
  // is the difference between over-reporting and silently losing an edit.

  { n: '2h', name: 'VOLATILE_VALUE — identical formula, changed value, volatile ctx',
    fn: function () {
      const ctx = { fA1A: '=INDIRECT("Rates!B" & A1)',
                    fA1B: '=INDIRECT("Rates!B" & A1)', volatile: true };
      const r = diffCell(55, 77, 'R4C2', 'R4C2', ctx, OPTS);
      assertEqual(r.change, 'VOLATILE_VALUE', 'volatile ctx');
      assertEqual([r.old, r.new], ['55', '77'], 'values, not formulas');

      ctx.volatile = false;                    // contrast with test 4
      assertEqual(diffCell(55, 77, 'R4C2', 'R4C2', ctx, OPTS), null,
                  'non-volatile identical formula stays suppressed');

      ctx.volatile = true;                     // values equal -> still no row
      assertEqual(diffCell(55, 55, 'R4C2', 'R4C2', ctx, OPTS), null,
                  'volatile but unchanged value emits nothing');
  }},

  { n: '2i', name: 'FORMULA_UNVERIFIED only when the masked forms match',
    fn: function () {
      const base = { fA1A: '=Rates!$B$4', fA1B: '=Rates!$B$5' };
      const mk = function (mA, mB) {
        const c = { fA1A: base.fA1A, fA1B: base.fA1B };
        if (mA !== undefined) { c.maskA = mA; c.maskB = mB; }
        return diffCell(1, 1, 'Rates!R4C2', 'Rates!R5C2', c, OPTS).change;
      };
      assertEqual(mk('Rates!R#C2', 'Rates!R#C2'), 'FORMULA_UNVERIFIED',
                  'both references unverifiable');
      assertEqual(mk('Rates!R#C2*2', 'Rates!R#C2'), 'FORMULA',
                  'a real edit survives masking — test 24 in miniature');
      assertEqual(mk(), 'FORMULA',
                  'absent masks default to FORMULA, never to unverified');
  }},

  // --- Step 3 ------------------------------------------------------------

  { n: 13, name: 'Row inserted mid-tab, nothing else changed -> 1 ROW_ADDED only',
    fn: function () {
      const ga = filler_(18);
      const gb = filler_(18);
      gb.splice(7, 0, ['Inserted', 999]);
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'ROW_ADDED', 1);
      assertNone(changes, 'VALUE');
      assertNone(changes, 'FORMULA');
      assertTotal(changes, 1);
      assertEqual(changes[0].bRef, 'A8', 'inserted at sheet row 8');
  }},

  { n: 14, name: 'Row deleted mid-tab -> exactly 1 ROW_DELETED', fn: function () {
      const ga = filler_(18);
      const gb = filler_(18);
      gb.splice(7, 1);
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'ROW_DELETED', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].aRef, 'A8', 'deleted from sheet row 8');
  }},

  { n: 15, name: 'Row inserted plus a value changed below it -> refs offset by 1',
    fn: function () {
      const ga = filler_(18);
      const gb = filler_(18);
      gb[12][1] = 777;                       // A row 13 -> B row 14 after insert
      gb.splice(5, 0, ['Inserted', 999]);
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'ROW_ADDED', 1);
      assertCount(changes, 'VALUE', 1);
      assertTotal(changes, 2);
      const v = changes.filter(function (c) { return c.change === 'VALUE'; })[0];
      assertEqual([v.aRef, v.bRef], ['B13', 'B14'], 'refs straddle the insert');
  }},

  { n: 16, name: 'Row label edited -> 1 VALUE, not ROW_DELETED + ROW_ADDED',
    fn: function () {
      const ga = filler_(18), gb = filler_(18);
      gb[6][0] = 'Row seven (renamed)';
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'VALUE', 1);
      assertNone(changes, 'ROW_ADDED');
      assertNone(changes, 'ROW_DELETED');
      assertTotal(changes, 1);
  }},

  { n: 20, name: '45% of rows differ -> TAB_SKIPPED, no cell rows',
    fn: function () {
      const ga = filler_(20), gb = filler_(20);
      for (let i = 0; i < 9; i++) {          // 9/20 rows rewritten wholesale
        gb[i * 2] = ['Wholly different ' + i, 5000 + i];
      }
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'TAB_SKIPPED', 1);
      assertTotal(changes, 1);
      assertNone(changes, 'VALUE');
  }},

  { n: '3a', name: 'trimGrid drops trailing empty rows and columns',
    fn: function () {
      const t = fixture([
        ['a', 'b', '', ''],
        ['c', 'd', '', ''],
        ['',  '',  '', ''],
        ['',  '',  '', '']
      ], null, null, 5, 3);
      const out = trimGrid(t);
      assertEqual(out.values, [['a', 'b'], ['c', 'd']], 'trimmed grid');
      assertEqual([out.rowOffset, out.colOffset], [5, 3], 'offsets survive');
  }},

  { n: '3b', name: 'trimGrid keeps a trailing row that holds only a formula',
    fn: function () {
      const t = sheet([['a', 1], ['', '=SUM(B1:B1)']]);
      assertEqual(trimGrid(t).values.length, 2, 'formula-only row is not empty');
  }},

  { n: '3c', name: 'hashRow ignores formula-cell values; formula rows are ' +
                   'not anchorable',
    fn: function () {
      assertEqual(hashRow(['x', 5], ['', '=A1']),
                  hashRow(['x', 9], ['', '=A1']),
                  'derived value does not change row identity');
      assertEqual(isAnchorable(['', 5], ['=A1', '=B1']), false, 'all formulas');
      assertEqual(isAnchorable(['', ''], ['', '']), false, 'all blank');
      assertEqual(isAnchorable(['x', ''], ['', '=B1']), true, 'one literal');
  }},

  { n: '3d', name: 'rowMap is in SHEET rows — rowOffset applied once',
    fn: function () {
      // The two offsets must DIFFER, and neither may equal 1. With equal
      // offsets an index-space map and a sheet-space map agree on most probes
      // by coincidence, and the test passes against the bug it exists to catch.
      const ga = filler_(18);
      const gb = filler_(18);
      gb.splice(7, 0, ['Inserted', 999]);
      const a = sheet(ga, null, 5, 1);        // A's grid starts at sheet row 5
      const b = sheet(gb, null, 9, 1);        // B's at sheet row 9
      const al = alignRows(hashGrid(a).hashes, hashGrid(b).hashes, a, b, OPTS);
      assertEqual(al.skipped, false, 'not skipped');
      assertEqual(al.rowMap.get(5), 9, 'first row: A sheet 5 -> B sheet 9');
      assertEqual(al.rowMap.get(12), 17, 'below the insert: shifts one further');
      assertEqual(al.rowMap.get(1), undefined, 'no key below A rowOffset');
      assertEqual(al.rowMap.get(0), undefined, 'array indices are not keys');
      assertEqual(al.added, [7], 'added carries the array index');
  }},

  { n: '3e', name: 'A skipped alignment carries no rowMap', fn: function () {
      const ga = filler_(20), gb = filler_(20);
      for (let i = 0; i < 9; i++) gb[i * 2] = ['Wholly different ' + i, 5000 + i];
      const a = sheet(ga), b = sheet(gb);
      const al = alignRows(hashGrid(a).hashes, hashGrid(b).hashes, a, b, OPTS);
      assertEqual(al.skipped, true, 'skipped');
      assertEqual(al.rowMap, null, 'absence is what Step 4e keys on');
  }},

  { n: '3f', name: 'Alignment window guard fires above 2000 rows',
    fn: function () {
      const ga = [], gb = [];
      for (let i = 0; i < 2100; i++) {
        ga.push(['A' + i, i]);
        gb.push(['B' + i, i + 1]);            // nothing matches -> no pass-0 trim
      }
      const a = sheet(ga), b = sheet(gb);
      const al = alignRows(hashGrid(a).hashes, hashGrid(b).hashes, a, b, OPTS);
      assertEqual(al.skipped, true, 'skipped');
      assertEqual(al.reason.indexOf('window too large') >= 0, true, al.reason);
  }},

  { n: '3g', name: 'Pass 0 alone resolves an append with no DP work',
    fn: function () {
      const ga = filler_(16);
      const gb = filler_(16).concat([['Row 17', 170], ['Row 18', 180]]);
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'ROW_ADDED', 2);
      assertTotal(changes, 2);
  }},

  // --- Step 4 --------------------------------------------------------------

  { n: 17, name: '=$B$4 with a row inserted above row 4, same tab -> 0 FORMULA',
    fn: function () {
      // The same-tab absolute case. R1C1 leaves R4C2 alone when a row moves, so
      // without relocation this reads as an authored formula edit.
      const a = plant_(16,     [[9, 2, '=$B$4', '=R4C2', 40]]);
      const b = inserted_(16, 2, [[10, 2, '=$B$5', '=R5C2', 40]]);
      const changes = diffFixture_(a, b);
      assertCount(changes, 'ROW_ADDED', 1);
      assertNone(changes, 'FORMULA');
      assertNone(changes, 'FORMULA_UNVERIFIED');
      assertTotal(changes, 1);
  }},

  { n: 19, name: 'Row deleted in Rates; Assumptions referenced it -> ' +
                 'ROW_DELETED + REF_ERROR_NEW (root)',
    fn: function () {
      const gb = filler_(16);
      gb.splice(3, 1);                                   // sheet row 4 deleted
      const A = workbook({
        Assumptions: plant_(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
        Rates: sheet(filler_(16))
      });
      const B = workbook({
        Assumptions: plant_(16, [[9, 2, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]),
        Rates: sheet(gb)
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'ROW_DELETED', 1);
      assertCount(changes, 'REF_ERROR_NEW', 1);
      assertTotal(changes, 2);
      const e = changes.filter(function (c) { return c.change === 'REF_ERROR_NEW'; })[0];
      assertEqual(e.new, '=Rates!#REF!', 'root: new shows the broken formula');
      assertEqual(e.tab, 'Assumptions', 'reported where the pointer is, not in Rates');
  }},

  { n: 23, name: '=Rates!$B$4 * Escalation!$C$7 with a row inserted in BOTH ' +
                 '-> 0 FORMULA',
    fn: function () {
      // One map per formula passes every earlier test and fails this one: the
      // two references resolve to different tabs and need different maps in a
      // single pass.
      const A = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$4*Escalation!$C$7',
                                 '=Rates!R4C2*Escalation!R7C3', 40]]),
        Rates: sheet(filler_(16)),
        Escalation: sheet(filler_(16))
      });
      const B = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$5*Escalation!$C$8',
                                 '=Rates!R5C2*Escalation!R8C3', 40]]),
        Rates: inserted_(16, 2),        // above row 4  -> 4 maps to 5
        Escalation: inserted_(16, 5)    // above row 7  -> 7 maps to 8
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'ROW_ADDED', 2);
      assertNone(changes, 'FORMULA');
      assertNone(changes, 'FORMULA_UNVERIFIED');
      assertTotal(changes, 2);
  }},

  { n: 24, name: 'Rates mapped and genuinely edited, Escalation skipped ' +
                 '-> FORMULA, not FORMULA_UNVERIFIED',
    fn: function () {
      // Mask-everything files this real edit as unverifiable and loses it.
      //
      // The edit has to be to the ROW of the mapped reference, not to anything
      // else in the formula. Rates row 4 maps to row 5, and B points at row 9:
      // someone repointed it by hand. Mask every absolute row and both sides
      // collapse to Rates!R#C2, the difference disappears, and the edit is
      // filed as unverifiable. An edit elsewhere in the formula (a trailing
      // "+1", say) survives masking and would let a mask-everything
      // implementation pass this test while still losing real repointings.
      const A = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$4*Escalation!$C$7',
                                 '=Rates!R4C2*Escalation!R7C3', 40]]),
        Rates: sheet(filler_(16)),
        Escalation: sheet(filler_(20))
      });
      const B = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$9*Escalation!$C$7',
                                 '=Rates!R9C2*Escalation!R7C3', 90]]),
        Rates: inserted_(16, 2),
        Escalation: unalignable_()
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'FORMULA', 1);
      assertNone(changes, 'FORMULA_UNVERIFIED');
      assertCount(changes, 'TAB_SKIPPED', 1);
      assertCount(changes, 'ROW_ADDED', 1);
      assertTotal(changes, 3);
  }},

  { n: 25, name: '=Rates!$B$4 * $B$7 — cross-tab and same-tab absolute, rows ' +
                 'inserted in both -> 0 FORMULA',
    fn: function () {
      const A = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$4*$B$7', '=Rates!R4C2*R7C2', 40]]),
        Rates: sheet(filler_(16))
      });
      const B = workbook({
        // A row inserted in HVAC itself: the same-tab R7C2 resolves through
        // HVAC's own map, and the referencing cell has moved down one row too.
        HVAC: inserted_(16, 5, [[10, 2, '=Rates!$B$5*$B$8',
                                        '=Rates!R5C2*R8C2', 40]]),
        Rates: inserted_(16, 2)
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'ROW_ADDED', 2);
      assertNone(changes, 'FORMULA');
      assertTotal(changes, 2);
  }},

  { n: 27, name: 'INDIRECT, formula identical, value differs -> VOLATILE_VALUE',
    fn: function () {
      // Contrast with test 4: same shape of input, opposite expected output.
      // Sheets does not rewrite the string argument when rows move, so the
      // formula text is identical and only the value betrays the move.
      const mk = function (v) {
        return plant_(16, [[9, 2, '=INDIRECT("Rates!B" & A10)',
                                  '=INDIRECT("Rates!B" & RC[-1])', v]]);
      };
      const A = workbook({ HVAC: mk(55), Rates: sheet(filler_(16)) });
      const B = workbook({ HVAC: mk(77), Rates: inserted_(16, 2) });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'VOLATILE_VALUE', 1);
      assertNone(changes, 'FORMULA');
      assertCount(changes, 'ROW_ADDED', 1);
      assertTotal(changes, 2);
  }},

  { n: 28, name: 'OFFSET, anchor relocates cleanly, value differs -> ' +
                 'VOLATILE_VALUE',
    fn: function () {
      const mk = function (v) {
        return plant_(16, [[9, 2, '=OFFSET(Rates!$A$1,3,1)',
                                  '=OFFSET(Rates!R1C1,3,1)', v]]);
      };
      const A = workbook({ HVAC: mk(30), Rates: sheet(filler_(16)) });
      // Inserted BELOW row 1, so the anchor maps to itself and the formula text
      // stays identical — the numeric offset is what silently moved.
      const B = workbook({ HVAC: mk(40), Rates: inserted_(16, 5) });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'VOLATILE_VALUE', 1);
      assertNone(changes, 'FORMULA');
      assertTotal(changes, 2);
  }},

  { n: 29, name: 'Clean formula in A, =Rates!#REF! in B -> REF_ERROR_NEW',
    fn: function () {
      const a = plant_(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 55]]);
      const b = plant_(16, [[9, 2, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]);
      const changes = diffFixture_(a, b);
      assertCount(changes, 'REF_ERROR_NEW', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].new, '=Rates!#REF!', 'new shows the broken formula');
      assertEqual(changes[0].old, '=Rates!$B$4', 'old shows what it used to be');
  }},

  { n: 31, name: '=Rates!#REF! in A, valid formula in B -> REF_ERROR_FIXED',
    fn: function () {
      const a = plant_(16, [[9, 2, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]);
      const b = plant_(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 55]]);
      const changes = diffFixture_(a, b);
      assertCount(changes, 'REF_ERROR_FIXED', 1);
      assertTotal(changes, 1);
  }},

  { n: '4a', name: 'relocate — per-match tab resolution; relative rows and ' +
                   'columns untouched',
    fn: function () {
      const tables = {
        tabMap:  { Rates: 'Rates', Escalation: 'Escalation', T: 'T' },
        rowMaps: {
          Rates:      new Map([[4, 5]]),
          Escalation: new Map([[7, 8]]),
          T:          new Map([[7, 9]])
        }
      };
      assertEqual(relocate('=Rates!R4C2*Escalation!R7C3', tables, 'T'),
                  '=Rates!R5C2*Escalation!R8C3', 'two tabs, one pass');
      assertEqual(relocate('=R7C3', tables, 'T'), '=R9C3',
                  'no sheet prefix resolves to the current tab');
      assertEqual(relocate('=R[-1]C[2]+RC[-1]', tables, 'T'), '=R[-1]C[2]+RC[-1]',
                  'relative references are already shift-invariant');
      assertEqual(relocate('=Rates!R4C4', tables, 'T'), '=Rates!R5C4',
                  'the column part is never touched');
      assertEqual(relocate('=Missing!R4C2', tables, 'T'), '=Missing!R4C2',
                  'no map for the target: left alone, never guessed');
      assertEqual(relocate('=Rates!R9C2', tables, 'T'), '=Rates!R9C2',
                  'mapped tab, unmapped row: left alone (dangling, not shifted)');
      assertEqual(relocate('', tables, 'T'), '', 'a non-formula cell stays empty');
  }},

  { n: '4b', name: 'relocate — sheet names through tabMap, quoting either way',
    fn: function () {
      const tables = {
        tabMap: { 'Q1 Rates': 'Q1_Rates', Rates: 'Q2 Rates' },
        rowMaps: { 'Q1 Rates': new Map([[4, 4]]), Rates: new Map([[4, 4]]) }
      };
      assertEqual(relocate("='Q1 Rates'!R4C2", tables, 'T'), '=Q1_Rates!R4C2',
                  'quotes dropped when the new name does not need them');
      assertEqual(relocate('=Rates!R4C2', tables, 'T'), "='Q2 Rates'!R4C2",
                  'quotes added when it does');
  }},

  { n: '4c', name: 'relocate — string literals are protected, identifiers are ' +
                   'not references',
    fn: function () {
      const tables = { tabMap: {}, rowMaps: { Rates: new Map([[4, 5]]) } };
      assertEqual(relocate('=INDIRECT("Rates!R4C2")+Rates!R4C2', tables, 'T'),
                  '=INDIRECT("Rates!R4C2")+Rates!R5C2',
                  'the quoted argument is data; only the bare reference moves');
      assertEqual(relocate('=IF(A1="R4C2",Rates!R4C2,0)', tables, 'T'),
                  '=IF(A1="R4C2",Rates!R5C2,0)', 'a literal that looks like one');
      assertEqual(relocate('=Total_RC+1', tables, 'T'), '=Total_RC+1',
                  'RC inside an identifier is not a reference');
  }},

  { n: '4d', name: 'maskUnresolvable masks ONLY references with no row map',
    fn: function () {
      const tables = { tabMap: {}, rowMaps: { Rates: new Map([[4, 5]]) } };
      assertEqual(maskUnresolvable('=Rates!R5C2*Escalation!R7C3', tables, 'T'),
                  '=Rates!R5C2*Escalation!R#C3',
                  'the verified reference survives so a real edit still shows');
      assertEqual(maskUnresolvable('=R7C3', tables, 'Rates'), '=R7C3',
                  'current tab has a map: not masked');
      assertEqual(maskUnresolvable('=R7C3', tables, 'Other'), '=R#C3',
                  'current tab has none: masked');
      assertEqual(maskUnresolvable('=Escalation!R[-1]C3', tables, 'T'),
                  '=Escalation!R[-1]C3', 'relative rows need no verification');
  }},

  { n: '4e', name: 'isVolatile', fn: function () {
      assertEqual(isVolatile('=INDIRECT("A" & B1)'), true, 'INDIRECT');
      assertEqual(isVolatile('=offset(A1,1,1)'), true, 'case-insensitive');
      assertEqual(isVolatile('=SUM(A1:A9)'), false, 'ordinary formula');
      assertEqual(isVolatile(''), false, 'empty');
  }},

  // --- Step 5 --------------------------------------------------------------

  { n: 7, name: 'Row inserted at the top of a tab -> zero FORMULA rows',
    fn: function () {
      // Every row carries a relative formula whose A1 text differs row by row.
      // Comparing in A1 reports all sixteen as changed; R1C1 reports none.
      const build = function (grid) {
        const cells = [];
        for (let i = 0; i < grid.length; i++) {
          if (grid[i][0] === 'Inserted') continue;
          cells.push([i, 2, '=B' + (i + 1) + '*2', '=RC[-1]*2', grid[i][1] * 2]);
        }
        return plantG_(grid, cells);
      };
      const gb = filler_(16);
      gb.splice(0, 0, ['Inserted', 999]);
      const changes = diffFixture_(build(filler_(16)), build(gb));
      assertCount(changes, 'ROW_ADDED', 1);
      assertNone(changes, 'FORMULA');
      assertNone(changes, 'VALUE');
      assertTotal(changes, 1);
  }},

  { n: 12, name: 'Headers differ at column C -> TAB_SKIPPED, zero cell rows',
    fn: function () {
      const build = function (third) {
        const g = [['ID', 'Name', third]];
        for (let i = 1; i <= 15; i++) g.push(['R' + i, 'n' + i, i * 10]);
        return sheet(g);
      };
      const changes = diffFixture_(build('Cost'), build('Price'));
      assertCount(changes, 'TAB_SKIPPED', 1);
      assertTotal(changes, 1);
      assertEqual(changes[0].column, 'C', 'names the offending column');
  }},

  { n: 32, name: 'Reference error inside a tab skipped by the header guard ' +
                 '-> TAB_SKIPPED and REF_ERROR with bRef only',
    fn: function () {
      // The scan depends on nothing but a single cell in a single file. If it
      // is folded into the comparison loop, skipped tabs go unscanned and
      // "flag all reference errors" is a lie.
      const build = function (third, broken) {
        const g = [['ID', 'Name', third]];
        for (let i = 1; i <= 15; i++) g.push(['R' + i, 'n' + i, i * 10]);
        const t = sheet(g);
        if (broken) t.values[5][2] = '#REF!';
        return t;
      };
      const changes = diffFixture_(build('Cost', false), build('Price', true));
      assertCount(changes, 'TAB_SKIPPED', 1);
      assertCount(changes, 'REF_ERROR', 1);
      assertTotal(changes, 2);
      const e = changes.filter(function (c) { return c.change === 'REF_ERROR'; })[0];
      assertEqual([e.aRef, e.bRef], ['', 'C6'],
                  'no A-side counterpart is invented');
  }},

  { n: '5a', name: 'A tab skipped on edit distance is still scanned',
    fn: function () {
      const g = filler_(20);
      for (let i = 0; i < 9; i++) g[i * 2] = ['Wholly different ' + i, 5000 + i];
      g[1][1] = '#REF!';
      const changes = diffFixture_(sheet(filler_(20)), sheet(g));
      assertCount(changes, 'TAB_SKIPPED', 1);
      assertCount(changes, 'REF_ERROR', 1);
      assertTotal(changes, 2);
  }},

  { n: '5b', name: 'A tab added in B is scanned even though nothing pairs with it',
    fn: function () {
      const g = filler_(16);
      g[3][1] = '#REF!';
      const A = workbook({ Cover: sheet(filler_(16)) });
      const B = workbook({ Cover: sheet(filler_(16)), Fresh: sheet(g) });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'TAB_ADDED', 1);
      assertCount(changes, 'REF_ERROR', 1);
      assertTotal(changes, 2);
  }},

  { n: '5c', name: 'A row added already broken is flagged, not just previewed',
    fn: function () {
      const gb = filler_(16);
      gb.splice(7, 0, ['Inserted', '#REF!']);
      const changes = diffFixture_(sheet(filler_(16)), sheet(gb));
      assertCount(changes, 'ROW_ADDED', 1);
      assertCount(changes, 'REF_ERROR_NEW', 1);
      assertTotal(changes, 2);
      const e = changes.filter(function (c) { return c.change === 'REF_ERROR_NEW'; })[0];
      assertEqual([e.aRef, e.bRef], ['', 'B8'], 'B-side only — the row is new');
  }},

  { n: '5d', name: 'Column added / deleted, overlapping width still compared',
    fn: function () {
      const ga = filler_(16);
      const gb = filler_(16);
      for (let i = 0; i < 16; i++) gb[i].push(i === 3 ? 'extra' : '');
      gb[6][1] = 999;
      const changes = diffFixture_(sheet(ga), sheet(gb));
      assertCount(changes, 'COL_ADDED', 1);
      assertCount(changes, 'VALUE', 1);
      assertTotal(changes, 2);
  }},

  { n: '5e', name: 'The noise ratio is recorded for the summary, not emitted ' +
                   'as a row',
    fn: function () {
      const gc = filler_(20), gd = filler_(20);
      for (let i = 1; i <= 4; i++) gd[i][1] = i * 999;   // not row 0: that is
                                                         // the header guard's
      const quiet = cmp_(workbook({ T: sheet(gc) }), workbook({ T: sheet(gd) }));
      assertEqual(quiet.results[0].compared, 40, 'cells compared');
      assertEqual(quiet.results[0].emitted, 4, 'rows emitted');
      assertEqual(quiet.results[0].noise, false, '4/40 is below noiseWarn');

      // A mass formula rewrite is the shape that trips the noise check without
      // tripping the edit-distance cap first: row hashes ignore formula cells,
      // so alignment stays perfect while a third of the compared cells change.
      const build = function (expr) {
        const cells = [];
        for (let i = 0; i < 20; i++) cells.push([i, 2, expr, expr, 7]);
        return plant_(20, cells);
      };
      const loud = cmp_(workbook({ T: build('=RC[-1]*2') }),
                        workbook({ T: build('=RC[-1]*3') }));
      assertEqual(loud.results[0].skipped, false, 'alignment is untroubled');
      assertEqual([loud.results[0].compared, loud.results[0].emitted], [60, 20],
                  '20 of 60 cells');
      assertEqual(loud.results[0].noise, true, '33% > noiseWarn');
      assertNone(loud.changes, 'NOISE');
      assertCount(loud.changes, 'FORMULA', 20);
  }},

  { n: '5f', name: 'expandRows: one row per populated cell instead of a preview',
    fn: function () {
      const gb = filler_(16);
      gb.splice(7, 0, ['Inserted', 999]);
      const A = workbook({ T: sheet(filler_(16)) });
      const B = workbook({ T: sheet(gb) });

      const packed = cmp_(A, B).changes;
      assertCount(packed, 'ROW_ADDED', 1);
      assertEqual(packed[0].new, 'Inserted|999', 'pipe-joined preview');

      const opts = { includeDerived: false, expandRows: true, epsilon: 1e-9,
                     similarity: 0.5, editDistanceCap: 0.30, noiseWarn: 0.30 };
      const spread = cmp_(A, B, opts).changes;
      assertCount(spread, 'ROW_ADDED', 2);
      assertEqual([spread[0].bRef, spread[0].new], ['A8', 'Inserted'], 'cell 1');
      assertEqual([spread[1].bRef, spread[1].new], ['B8', '999'], 'cell 2');
  }},

  // --- Step 6 --------------------------------------------------------------

  { n: 8, name: 'CSV — comma, quote and newline survive as one field',
    fn: function () {
      const csv = toCsv([{ tab: 'T', change: 'VALUE', aRef: 'B2', bRef: 'B2',
                           column: 'Cost', old: 'a,b',
                           new: 'say "hi"\nthere' }]);
      const lines = csv.split('\n');
      assertEqual(lines[0], CSV_HEADER, 'header, exactly');
      assertEqual(lines[1], 'T,VALUE,B2,B2,Cost,"a,b","say ""hi""',
                  'comma quoted, inner quotes doubled');
      assertEqual(lines[2], 'there"',
                  'the newline stays inside the quoted field');
      assertEqual(csvField('=1+1'), "'=1+1", 'leading = is neutralised');
      assertEqual(csvField('=A1,B1'), '"\'=A1,B1"',
                  'the prefix lands OUTSIDE the quotes, where it works');
      assertEqual(csvField(null), '', 'null is an empty field');
  }},

  { n: 33, name: 'Broken chain -> root and inherited both emitted, root sorts ' +
                 'first',
    fn: function () {
      // Both cells are broken in BOTH files, so every rule except the error
      // check would suppress the pair entirely.
      const mk = function () {
        return workbook({
          // HVAC first, so workbook order alone would put the inherited row on
          // top. Only the sort puts the root there.
          HVAC: plant_(16, [[9, 2, '=Assumptions!$C$7', '=Assumptions!R7C3',
                             '#REF!']]),
          Assumptions: plant_(16, [[6, 2, '=Rates!#REF!', '=Rates!#REF!',
                                    '#REF!']])
        });
      };
      const changes = cmp_(mk(), mk()).changes;
      assertCount(changes, 'REF_ERROR', 2);
      assertTotal(changes, 2);

      const lines = toCsv(changes).split('\n');
      assertEqual(lines[1].indexOf('Assumptions,REF_ERROR') === 0, true,
                  'root first: ' + lines[1]);
      assertEqual(lines[1].indexOf("'=Rates!#REF!") > 0, true,
                  'a root row carries a formula: ' + lines[1]);
      assertEqual(lines[2].indexOf('HVAC,REF_ERROR') === 0, true,
                  'inherited second: ' + lines[2]);
  }},

  { n: '6a', name: 'Error rows sort NEW, then FIXED, then pre-existing, above ' +
                   'everything else',
    fn: function () {
      const r = function (tab, change, oldV, newV) {
        return { tab: tab, change: change, aRef: '', bRef: '', column: '',
                 old: oldV || '', new: newV || '' };
      };
      const csv = toCsv([
        r('T', 'VALUE'),
        r('T', 'REF_ERROR', '#REF!', '#REF!'),          // inherited
        r('T', 'REF_ERROR_FIXED', '=A!#REF!', '=A!B1'), // root
        r('T', 'HARDCODED'),
        r('T', 'REF_ERROR_NEW', '=A!B1', '=A!#REF!')    // root
      ]);
      const order = csv.split('\n').slice(1).map(function (l) {
        return l.split(',')[1];
      });
      assertEqual(order, ['REF_ERROR_NEW', 'REF_ERROR_FIXED', 'REF_ERROR',
                          'VALUE', 'HARDCODED'],
                  'roots first, then inherited, then workbook order');
  }},

  // --- Step 7 --------------------------------------------------------------

  { n: 10, name: 'Tab added, deleted, renamed -> one row each, no cell rows',
    fn: function () {
      const A = workbook({ Cover: sheet(filler_(16)),
                           'Q1 Rates': sheet(filler_(16)),
                           Scratch: sheet(filler_(16)) });
      const B = workbook({ Cover: sheet(filler_(16)),
                           'Q1_Rates': sheet(filler_(16)),
                           Notes: sheet(filler_(16)) });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'TAB_RENAMED', 1);
      assertCount(changes, 'TAB_DELETED', 1);
      assertCount(changes, 'TAB_ADDED', 1);
      assertTotal(changes, 3);
  }},

  { n: 21, name: 'A referenced tab is renamed; referencing formulas untouched ' +
                 '-> 1 TAB_RENAMED, 0 FORMULA',
    fn: function () {
      // The plan's own fixture for this test renames "Rates" to "Rates v2",
      // which its Step 7 rule cannot pair — normalisation strips punctuation
      // and whitespace, and nothing else, so "rates" and "ratesv2" are two
      // different tabs (see test '7b', which pins that down). The rename here
      // is one the rule does catch, and it tests the same thing: rule 5, the
      // sheet name relocated through tabMap so a rename does not fire on every
      // referencing cell.
      const A = workbook({
        HVAC: plant_(16, [[9, 2, "='Q1 Rates'!$B$4", "='Q1 Rates'!R4C2", 40]]),
        'Q1 Rates': sheet(filler_(16))
      });
      const B = workbook({
        HVAC: plant_(16, [[9, 2, '=Q1_Rates!$B$4', '=Q1_Rates!R4C2', 40]]),
        'Q1_Rates': sheet(filler_(16))
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'TAB_RENAMED', 1);
      assertNone(changes, 'FORMULA');
      assertTotal(changes, 1);
  }},

  { n: '7a', name: 'pairTabs — exact beats normalised; ambiguity is never guessed',
    fn: function () {
      const p = pairTabs(['Cover', 'Q1 Rates'], ['Q1_Rates', 'Cover']);
      assertEqual(p.tabMap, { Cover: 'Cover', 'Q1 Rates': 'Q1_Rates' }, 'tabMap');
      assertEqual(p.added, [], 'nothing added');
      assertEqual(p.deleted, [], 'nothing deleted');

      const amb = pairTabs(['Rates', 'RATES'], ['rates']);
      assertEqual(amb.tabMap, {}, 'two A tabs normalise alike -> no pairing');
      assertEqual(amb.warnings.length, 1, 'and a warning is recorded');
      assertEqual(amb.deleted.length, 2, 'both fall through to TAB_DELETED');
  }},

  { n: '7b', name: 'pairTabs — a version suffix is a different tab, by design',
    fn: function () {
      const p = pairTabs(['Rates'], ['Rates v2']);
      assertEqual(p.tabMap, {}, 'not paired');
      assertEqual([p.deleted, p.added], [['Rates'], ['Rates v2']],
                  'reported as a delete plus an add — a wrong pairing would ' +
                  'generate a full-tab phantom diff');
  }},

  // --- Step 9, pure half ---------------------------------------------------

  { n: 18, name: 'Row inserted in Rates; another tab holds =Rates!$B$4 -> ' +
                 '1 ROW_ADDED, 0 FORMULA in the referencing tab',
    fn: function () {
      // HVAC is listed FIRST on purpose. A single-pass implementation that
      // reads, aligns and compares one tab at a time reaches HVAC before Rates
      // has a row map, cannot relocate, and reports a false FORMULA.
      const A = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
        Rates: sheet(filler_(16))
      });
      const B = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
        Rates: inserted_(16, 2)
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'ROW_ADDED', 1);
      assertNone(changes, 'FORMULA');
      assertTotal(changes, 1);
  }},

  { n: 22, name: 'Rates skipped by a guard; a referencing formula shifted -> ' +
                 'FORMULA_UNVERIFIED',
    fn: function () {
      const A = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
        Rates: sheet(filler_(20))
      });
      const B = workbook({
        HVAC: plant_(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
        Rates: unalignable_()
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'FORMULA_UNVERIFIED', 1);
      assertNone(changes, 'FORMULA');
      assertCount(changes, 'TAB_SKIPPED', 1);
      assertTotal(changes, 2);
  }},

  { n: 26, name: 'Chain HVAC -> Assumptions -> Rates with a row inserted in ' +
                 'BOTH -> 2 ROW_ADDED, 0 FORMULA',
    fn: function () {
      // The test that validates the diff half: alignment, R1C1 comparison,
      // per-reference relocation across distinct targets, chain independence
      // and two-phase ordering, all at once. Each hop is resolved by its own
      // target's map — no dependency graph, no topological sort.
      const A = workbook({
        HVAC:        plant_(16, [[9, 2, '=Assumptions!$C$7',
                                        '=Assumptions!R7C3', 40]]),
        Assumptions: plant_(16, [[6, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
        Rates:       sheet(filler_(16))
      });
      const B = workbook({
        HVAC:        plant_(16, [[9, 2, '=Assumptions!$C$8',
                                        '=Assumptions!R8C3', 40]]),
        // Row inserted above row 7, so the formula cell itself moves down one
        // AND its own reference into Rates shifts.
        Assumptions: inserted_(16, 5, [[7, 2, '=Rates!$B$5',
                                              '=Rates!R5C2', 40]]),
        Rates:       inserted_(16, 2)
      });
      const changes = cmp_(A, B).changes;
      assertCount(changes, 'ROW_ADDED', 2);
      assertNone(changes, 'FORMULA');
      assertNone(changes, 'FORMULA_UNVERIFIED');
      assertTotal(changes, 2);
  }},

  // ------------------------------------------------------------------------
  // STEP 4 — the Step 10 attribution helper
  // ------------------------------------------------------------------------

  { n: '4z', name: 'unresolvableTargets names the tab whose row map is missing, ' +
                   'and only that one',
    fn: function () {
      // Rates has a map, Escalation does not. maskUnresolvable would mask one
      // and leave the other; this must name exactly the one it masked.
      const tables = { tabMap: {}, rowMaps: { Rates: new Map([[4, 5]]) } };
      assertEqual(unresolvableTargets('=Rates!R4C2 * Escalation!R7C3', tables, 'HVAC'),
                  ['Escalation'], 'only the unmapped target');
      assertEqual(unresolvableTargets('=Rates!R4C2', tables, 'HVAC'),
                  [], 'a mapped target is not unresolvable');
      // A same-tab absolute reference resolves to currentTab, which here has no
      // map either — the caller's own tab is a legitimate answer.
      assertEqual(unresolvableTargets('=R7C3', tables, 'HVAC'),
                  ['HVAC'], 'same-tab absolute resolves to currentTab');
      // Relative rows are shift-invariant, so nothing about them is unverifiable.
      assertEqual(unresolvableTargets('=Escalation!R[-1]C3', tables, 'HVAC'),
                  [], 'a relative row is never unresolvable');
      // De-duplicated, not once per reference.
      assertEqual(unresolvableTargets('=Escalation!R7C3 + Escalation!R9C3',
                                      tables, 'HVAC'),
                  ['Escalation'], 'de-duplicated');
      // A string literal holding the text of a reference is protected (§4a).
      assertEqual(unresolvableTargets('=INDIRECT("Escalation!R7C3")', tables, 'HVAC'),
                  [], 'string literals are not scanned');
  }},

  // ------------------------------------------------------------------------
  // STEP 8 — readTab, against a stub. The contract, not the API.
  // ------------------------------------------------------------------------

  { n: '8a', name: 'readTab carries rowOffset / colOffset through and trims',
    fn: function () {
      // getDataRange() starting at C5 is the case that corrupts every emitted
      // reference AND every absolute-row lookup in relocate() if the offsets are
      // dropped — the second silently.
      const t = readTab(stubSheet_({
        values:  [['H', 'I'], ['x', 1], ['', '']],
        fR1C1:   [['', ''], ['', '=RC[-1]'], ['', '']],
        fA1:     [['', ''], ['', '=B6'], ['', '']],
        row: 5, col: 3
      }));
      assertEqual(t.rowOffset, 5, 'rowOffset');
      assertEqual(t.colOffset, 3, 'colOffset');
      assertEqual(t.values.length, 2, 'trailing blank row trimmed');
      // The offsets must reach the emitted refs: array [1][1] is sheet D6.
      assertEqual(a1(1 + t.rowOffset, 1 + t.colOffset), 'D6', 'ref from offsets');
  }},

  { n: '8b', name: 'readTab on an empty sheet yields an empty grid, not a phantom row',
    fn: function () {
      // getDataRange() on a blank sheet returns A1:A1 holding ''. Left untrimmed
      // it becomes a one-row tab that pairs and compares against real content.
      const t = readTab(stubSheet_({
        values: [['']], fR1C1: [['']], fA1: [['']], row: 1, col: 1
      }));
      assertEqual(t.values.length, 0, 'no rows');
      assertEqual(gridWidth_(t), 0, 'no width');
  }},

  // ------------------------------------------------------------------------
  // STEP 10 — buildSummary
  // ------------------------------------------------------------------------

  { n: '10a', name: 'Summary header puts REF first and tallies each type into its column',
    fn: function () {
      // One VALUE, one HARDCODED, one pre-existing REF_ERROR, one row added.
      const A = workbook({ T: plant_(16, [
        [3, 1, '=SUM(RC[-1])', '=SUM(RC[-1])', 5],
        [5, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']
      ]) });
      const B = workbook({ T: plantG_(function () {
        const g = filler_(16);
        g[2][0] = 'Row 3 edited';
        g.splice(8, 0, ['Inserted', 999]);
        return g;
      }(), [
        [3, 1, 42, 42, 42],                                   // hardcoded over
        [5, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']
      ]) });
      const s = buildSummary({ result: cmp_(A, B), titleA: 'A', titleB: 'B',
                               tabCountA: 1, tabCountB: 1 });
      const head = s.split('\n')[3];
      assertEqual(head.indexOf('REF') < head.indexOf('VAL'), true,
                  'REF column comes first');
      // Each count must land in its own column, which is only checkable by
      // reading the rendered row back.
      const cells = s.split('\n')[5].replace(/.*modified\s+/, '').trim().split(/\s+/);
      assertEqual(cells, ['1', '1', '0', '0', '0', '1', '0', '+1', '0'],
                  'REF VAL FORM UNVER VOL HARD FMLZD ±ROW ±COL');
  }},

  { n: '10b', name: 'Both mandatory error lines appear, and the pre-existing one ' +
                    'says state-not-delta',
    fn: function () {
      // Test 30's shape (broken in both) plus test 29's (broke in B). The second
      // line is mandatory because without it a reader filters pre-existing errors
      // out as diff noise — which is exactly what the requirement forbids.
      const A = workbook({ T: plant_(16, [
        [3, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!'],
        [5, 1, '=Rates!$B$4',  '=Rates!R4C2',  40]
      ]) });
      const B = workbook({ T: plant_(16, [
        [3, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!'],
        [5, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']
      ]) });
      const s = buildSummary({ result: cmp_(A, B) });
      assertEqual(/REFERENCE ERRORS: 2 total — 1 new, 0 fixed, 1 pre-existing/.test(s),
                  true, 'error tally line');
      assertEqual(/1 reference broke in this revision \(REF_ERROR_NEW\)/.test(s),
                  true, 'the what-broke-now line');
      assertEqual(/1 pre-existing reference error was already present in both files/
                  .test(s), true, 'the pre-existing line');
      assertEqual(/reports state, not deltas/.test(s), true,
                  'the state-not-delta sentence');
  }},

  { n: '10c', name: 'A skipped tab shows dashes, not zeros, in every column but REF',
    fn: function () {
      // Printing 0 under VAL for a tab whose cells were never compared asserts
      // "no value changes here", which is a lie about the strongest kind.
      const A = workbook({ T: sheet(filler_(20)) });
      const B = workbook({ T: plantG_(unalignable_().values.map(function (r) {
        return r.slice();
      }), [[1, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]) });
      const s = buildSummary({ result: cmp_(A, B) });
      const line = s.split('\n').filter(function (l) {
        return /^T\s+SKIPPED/.test(l);
      })[0];
      assertEqual(!!line, true, 'the skipped tab has a row');
      const cells = line.replace(/^T\s+SKIPPED\s+/, '').trim().split(/\s+/);
      assertEqual(cells, ['1', '—', '—', '—', '—', '—', '—', '—', '—'],
                  'REF is real, the rest are dashes');
      assertEqual(/still scanned; its cells were not compared/.test(s), true,
                  'and the note says so');
  }},

  { n: '10d', name: 'Suppressed derived values are counted and explained',
    fn: function () {
      // Test 4's fixture: the input changed, the downstream formula is identical
      // and non-volatile, so no row is emitted. The summary is the ONLY place a
      // reader can learn that cells moved and were deliberately withheld.
      const A = workbook({ T: plant_(16, [[3, 1, '=RC[-1]*2', '=RC[-1]*2', 60]]) });
      const g = filler_(16); g[3][0] = 'Row 4';
      const B = workbook({ T: plantG_(g, [[3, 1, '=RC[-1]*2', '=RC[-1]*2', 99]]) });
      const r = cmp_(A, B);
      assertNone(r.changes, 'VALUE');
      assertEqual(r.results[0].derivedSuppressed, 1, 'one suppression recorded');
      const s = buildSummary({ result: r });
      assertEqual(/Derived values suppressed: 1 cell changed value with identical formulas/
                  .test(s), true, 'the suppression line');
      assertEqual(/its root, which in a reference chain can sit several tabs away/
                  .test(s), true, 'and the chain caveat');
  }},

  { n: '10e', name: 'Unverifiable references are attributed to the tab that lacks a map',
    fn: function () {
      // Test 22's fixture. Step 11.6 reads this line to conclude "a referenced
      // tab was skipped", so it has to name the REFERENCED tab, not the one
      // holding the formula.
      const A = workbook({
        HVAC:  plant_(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
        Rates: sheet(filler_(20))
      });
      const B = workbook({
        HVAC:  plant_(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
        Rates: unalignable_()
      });
      const s = buildSummary({ result: cmp_(A, B) });
      assertEqual(/1 formula holds unverifiable references into: Rates \(1\)/.test(s),
                  true, 'attributed to Rates, the tab without a map');
  }},

  { n: '10f', name: 'The 0-realigned field check fires only when absolute ' +
                    'references actually exist',
    fn: function () {
      // Plan Step 11.4, automated: 0 realigned while rows moved is the signature
      // of REF_RE matching nothing. It must NOT fire on a workbook that has
      // nothing to realign, or it trains the reader to ignore it.
      const plainA = workbook({ T: sheet(filler_(16)) });
      const plainB = workbook({ T: inserted_(16, 5) });
      const quiet = buildSummary({ result: cmp_(plainA, plainB) });
      assertEqual(/may be matching nothing/.test(quiet), false,
                  'silent with no absolute references');

      // Same row movement, but now a formula holds an absolute reference into a
      // tab that has no map — sabotage relocate() and this is the only warning.
      const r = cmp_(plainA, plainB);
      r.results[0].absRefs = 3;
      const loud = buildSummary({ result: r });
      assertEqual(/3 formulas hold absolute row/.test(loud), true,
                  'fires once absolute references are present');
      assertEqual(/plan §1.2a/.test(loud), true, 'and points at the gate');
  }},

  { n: '10g', name: 'Added, deleted and renamed tabs each get a row with the ' +
                    'right status',
    fn: function () {
      const A = workbook({ Keep: sheet(filler_(16)), Scratch: sheet(filler_(16)),
                           Cover: sheet(filler_(16)) });
      const B = workbook({ Keep: sheet(filler_(16)), 'C o v e r': sheet(filler_(16)),
                           New: plant_(16, [[2, 1, '=Rates!#REF!',
                                                   '=Rates!#REF!', '#REF!']]) });
      const s = buildSummary({ result: cmp_(A, B), titleA: 'A', titleB: 'B',
                               tabCountA: 3, tabCountB: 3 });
      assertEqual(/^Keep\s+unchanged/m.test(s), true, 'unchanged');
      assertEqual(/^Cover → C o v e r\s+renamed/m.test(s), true, 'renamed, both names');
      assertEqual(/^Scratch\s+deleted\s+—/m.test(s), true, 'deleted, REF dashed');
      // An added tab IS error-scanned, so its REF column is real while the rest
      // are dashes.
      assertEqual(/^New\s+added\s+1\s+—/m.test(s), true, 'added, REF real');
      assertEqual(/2 changed, 1 unchanged, 0 skipped\.  1 added in B\./.test(s),
                  true, 'totals line counts A tabs and reports B additions apart');
  }},

  { n: '10h', name: 'A renamed tab whose cells also changed does not read as ' +
                    'merely renamed',
    fn: function () {
      const g = filler_(16); g[3][0] = 'Row 4 edited';
      const A = workbook({ Cover: sheet(filler_(16)) });
      const B = workbook({ 'C o v e r': sheet(g) });
      const s = buildSummary({ result: cmp_(A, B) });
      assertEqual(/^Cover → C o v e r\s+ren\+mod\s+0\s+1/m.test(s), true,
                  'status shows both, and the VALUE row is not hidden');
  }},

  { n: '10i', name: 'Zero changes reports no reference errors explicitly',
    fn: function () {
      // Silence about errors reads as "not checked". It has to say none.
      const s = buildSummary({
        result: cmp_(workbook({ T: sheet(filler_(16)) }),
                     workbook({ T: sheet(filler_(16)) })),
        titleA: 'v1', titleB: 'v2', tabCountA: 1, tabCountB: 1,
        fileName: 'changes-x.csv', csvRows: 0, elapsedMs: 4000
      });
      assertEqual(/REFERENCE ERRORS: none in either file\./.test(s), true,
                  'explicit none');
      assertEqual(/→ changes-x\.csv \(0 rows, 4s\)/.test(s), true,
                  'footer names the file, the row count and the elapsed time');
      assertEqual(/^T\s+unchanged/m.test(s), true, 'the tab is listed as unchanged');
  }}
];

/**
 * Acceptance tests whose implementation step is not built yet. Empty: all
 * thirty-three now run. Steps 8, 10 and the I/O half of 9 are what remain
 * unbuilt, and the plan lists no acceptance test against any of them — they are
 * verified by the Step 11 end-to-end run instead.
 */
const PENDING = [];
