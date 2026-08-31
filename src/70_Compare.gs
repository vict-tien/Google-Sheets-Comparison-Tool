/**
 * ============================================================================
 * 70_Compare.gs — Step 9's two-phase orchestration, PURE
 * ============================================================================
 *
 * A DELIBERATE DEVIATION FROM THE PLAN'S FILE TABLE, recorded here rather than
 * silently taken. The plan describes phases 0-2 as part of the impure entry
 * point, which would put them in 90_Main.gs. They are extracted instead,
 * because tests 18, 22, 26 and 32 exist to check the phase ordering, and
 * folding it into the one file the suite cannot reach moves the guarantee those
 * four tests exist for out of their reach. It costs one row in a table; the
 * alternative costs four tests their subject.
 *
 * PHASE 1 ALIGNS EVERY PAIRED TAB BEFORE PHASE 2 COMPARES ANY TAB. This is
 * load-bearing, not tidiness: relocating Rates!R4C2 inside the HVAC tab needs
 * the Rates row map, and a single-pass loop that aligns and compares one tab at
 * a time cannot have it. The symptom is false FORMULA rows across every
 * referencing tab — plausible enough to be believed. Test 18 lists HVAC BEFORE
 * Rates for exactly this reason. The mutation "single-pass" fails tests 18, 23,
 * 24, 25, 26 and '5e'.
 *
 * Order WITHIN a phase is free, because relocation is single-hop: a reference
 * points at a LOCATION, so the immediate target's own map is the final answer
 * however many tabs the chain crosses (plan §0.2). No dependency graph, no
 * topological sort, no cycle detection. Test 26 says so out loud.
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

  const tables = { rowMaps: rowMaps, tabMap: pairing.tabMap };

  // PHASE 1b — defined names.
  //
  // A WORKBOOK-LEVEL COMPARISON, so it is a pass of its own rather than part of
  // the per-tab loop. Its position is load-bearing for the same reason the
  // phase 1 / phase 2 split is: a definition must be RELOCATED before it is
  // compared, and relocation needs every tab's row map. Run it above the phase
  // 1 loop and it reports every name below an inserted row as redefined —
  // 41_Names.test.gs '9b' is that guard.
  changes.push.apply(changes,
    diffNames(wbA.definedNames, wbB.definedNames, tables));

  // PHASE 2 — compare
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
