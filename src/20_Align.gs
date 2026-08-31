/**
 * ============================================================================
 * 20_Align.gs — trimming, row identity, and row alignment
 * ============================================================================
 *
 * Rule 1 of the fifteen lives here, and it is the rule whose absence turns one
 * inserted row into thousands of false diff rows.
 *
 * THE ONE INVARIANT THIS FILE MUST KEEP FOR RULE 15: hashRow contributes
 * LITERAL cells only, never formula-cell values. Alignment therefore cannot be
 * moved by recalculation, which is why turning DERIVED_VALUE on in
 * 30_DiffCell.gs cannot push a tab over the edit-distance cap. "Improving"
 * hashRow to include formula values is the documented way rule 15 fails
 * upstream of the noise ratio, and it fails silently — test '3c' is the guard.
 */

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
