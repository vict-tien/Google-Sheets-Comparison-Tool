/**
 * ============================================================================
 * 31_DiffTab.gs — one aligned tab pair -> Change rows
 * ============================================================================
 *
 * Six stages, in order: skip guard, header guard, column delta, cells over
 * aligned pairs, whole rows, noise ratio.
 *
 * scanErrorsUnaligned HAS THREE CALL SITES AND EACH NEEDS ITS OWN TEST. The
 * skipped-alignment return, the header-mismatch return, and 70_Compare.gs's
 * phase 1 for tabs added in B. Delete any one of them and exactly one test goes
 * red ('5a', 32, '5b' respectively) — three separate one-test guards, which is
 * why all three exist. The scan depends on nothing but a single cell in a
 * single file, and that decoupling is what makes "flag ALL reference errors"
 * true rather than "flag all the ones in tabs we could align".
 *
 * sectionOf() lives in 50_Csv.gs and is called from here — a call "backwards"
 * through the load order. That is safe: function declarations hoist across
 * every file in the shared scope, and SECTION_2_TYPES is a top-level const in
 * 00_Config.gs, which loads first.
 */

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
  // `emitted` counts SECTION 1 ONLY and `derived` counts section 2. Splitting
  // them is rule 15: the noise ratio below divides by `compared`, and a
  // recalculated cell is a function of how connected the model is, not of how
  // badly the tab aligned. Count section 2 in it and one input change trips the
  // warning on every downstream tab of a correct run — test 38.
  stats.compared = 0; stats.emitted = 0; stats.derived = 0; stats.relocated = 0;
  stats.volatileCells = 0; stats.volatileEmitted = 0;
  stats.unverified = 0; stats.noise = false;
  stats.rowsAdded = 0; stats.rowsDeleted = 0; stats.colsAdded = 0;
  stats.colsDeleted = 0; stats.skipped = false; stats.reason = '';
  // unverifiedTargets attributes each unverifiable reference to the tab whose
  // row map is missing, which is the tab a reader has to go and look at.
  stats.unverifiedTargets = {};
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
        // Rule 15's split, taken from the row that exists rather than from
        // re-testing why a row does not. The duplicated copy of diffCell rule
        // 5's condition that used to sit on the null branch is gone with it.
        if (sectionOf(r) === 2) stats.derived++;
        else                    stats.emitted++;
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

  // 6. Noise check. Recorded, not emitted — Step 10 prints it. A warning about
  //    the diff is not part of the diff, and a NOISE_WARNING row would be
  //    filtered out along with the noise it warns about.
  //
  //    SECTION 1 ONLY (rule 15). stats.derived is deliberately absent from this
  //    ratio; see the initialiser above.
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
function gridWidth_(tab) {
  return tab.values.length ? tab.values[0].length : 0;
}

/** Pipe-joined row content for a ROW_ADDED / ROW_DELETED preview. */
function preview_(row) {
  const s = row.map(displayValue).join('|');
  return s.length > 200 ? s.substring(0, 200) : s;
}
