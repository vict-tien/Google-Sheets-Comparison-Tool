/**
 * 20_Align.test.gs - trimming, row identity, alignment.
 *
 * Two traps live in the FIXTURES here rather than in the code. '3d' needs two
 * DIFFERENT non-1 rowOffsets, because with equal offsets an index-space rowMap
 * agrees with a sheet-space one on most probes by coincidence - the test
 * originally used 5 and 5 and passed against a deliberately sabotaged
 * implementation. And every fixture is padded to 16-20 rows via t_filler,
 * because 2 / (2n) <= 0.30 needs n >= 4 for a single isolated edit and several
 * spread-out edits need considerably more; a short fixture reports TAB_SKIPPED
 * where a cell change was expected.
 */

function t_align_tests() {

  t_test(13, 'Row inserted mid-tab, nothing else changed -> 1 ROW_ADDED only',
    function () {
    const ga = t_filler(18);
    const gb = t_filler(18);
    gb.splice(7, 0, ['Inserted', 999]);
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertNone(changes, 'VALUE');
    t_assertNone(changes, 'FORMULA');
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].bRef, 'A8', 'inserted at sheet row 8');
  });

  t_test(14, 'Row deleted mid-tab -> exactly 1 ROW_DELETED', function () {
    const ga = t_filler(18);
    const gb = t_filler(18);
    gb.splice(7, 1);
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'ROW_DELETED', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].aRef, 'A8', 'deleted from sheet row 8');
  });

  t_test(15, 'Row inserted plus a value changed below it -> refs offset by 1',
    function () {
    const ga = t_filler(18);
    const gb = t_filler(18);
    gb[12][1] = 777;                       // A row 13 -> B row 14 after insert
    gb.splice(5, 0, ['Inserted', 999]);
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertCount(changes, 'VALUE', 1);
    t_assertTotal(changes, 2);
    const v = changes.filter(function (c) { return c.change === 'VALUE'; })[0];
    t_assertEqual([v.aRef, v.bRef], ['B13', 'B14'], 'refs straddle the insert');
  });

  t_test(16, 'Row label edited -> 1 VALUE, not ROW_DELETED + ROW_ADDED',
    function () {
    const ga = t_filler(18), gb = t_filler(18);
    gb[6][0] = 'Row seven (renamed)';
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'VALUE', 1);
    t_assertNone(changes, 'ROW_ADDED');
    t_assertNone(changes, 'ROW_DELETED');
    t_assertTotal(changes, 1);
  });

  t_test(20, '45% of rows differ -> TAB_SKIPPED, no cell rows',
    function () {
    const ga = t_filler(20), gb = t_filler(20);
    for (let i = 0; i < 9; i++) {          // 9/20 rows rewritten wholesale
      gb[i * 2] = ['Wholly different ' + i, 5000 + i];
    }
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'TAB_SKIPPED', 1);
    t_assertTotal(changes, 1);
    t_assertNone(changes, 'VALUE');
  });

  t_test('3a', 'trimGrid drops trailing empty rows and columns',
    function () {
    const t = t_fixture([
      ['a', 'b', '', ''],
      ['c', 'd', '', ''],
      ['',  '',  '', ''],
      ['',  '',  '', '']
    ], null, null, 5, 3);
    const out = trimGrid(t);
    t_assertEqual(out.values, [['a', 'b'], ['c', 'd']], 'trimmed grid');
    t_assertEqual([out.rowOffset, out.colOffset], [5, 3], 'offsets survive');
  });

  t_test('3b', 'trimGrid keeps a trailing row that holds only a formula',
    function () {
    const t = t_sheet([['a', 1], ['', '=SUM(B1:B1)']]);
    t_assertEqual(trimGrid(t).values.length, 2, 'formula-only row is not empty');
  });

  t_test('3c', 'hashRow ignores formula-cell values; formula rows are ' +
                 'not anchorable',
    function () {
    t_assertEqual(hashRow(['x', 5], ['', '=A1']),
                hashRow(['x', 9], ['', '=A1']),
                'derived value does not change row identity');
    t_assertEqual(isAnchorable(['', 5], ['=A1', '=B1']), false, 'all formulas');
    t_assertEqual(isAnchorable(['', ''], ['', '']), false, 'all blank');
    t_assertEqual(isAnchorable(['x', ''], ['', '=B1']), true, 'one literal');
  });

  t_test('3d', 'rowMap is in SHEET rows — rowOffset applied once',
    function () {
    // The two offsets must DIFFER, and neither may equal 1. With equal
    // offsets an index-space map and a sheet-space map agree on most probes
    // by coincidence, and the test passes against the bug it exists to catch.
    const ga = t_filler(18);
    const gb = t_filler(18);
    gb.splice(7, 0, ['Inserted', 999]);
    const a = t_sheet(ga, null, 5, 1);        // A's grid starts at t_sheet row 5
    const b = t_sheet(gb, null, 9, 1);        // B's at t_sheet row 9
    const al = alignRows(hashGrid(a).hashes, hashGrid(b).hashes, a, b, OPTS);
    t_assertEqual(al.skipped, false, 'not skipped');
    t_assertEqual(al.rowMap.get(5), 9, 'first row: A sheet 5 -> B sheet 9');
    t_assertEqual(al.rowMap.get(12), 17, 'below the insert: shifts one further');
    t_assertEqual(al.rowMap.get(1), undefined, 'no key below A rowOffset');
    t_assertEqual(al.rowMap.get(0), undefined, 'array indices are not keys');
    t_assertEqual(al.added, [7], 'added carries the array index');
  });

  t_test('3e', 'A skipped alignment carries no rowMap', function () {
    const ga = t_filler(20), gb = t_filler(20);
    for (let i = 0; i < 9; i++) gb[i * 2] = ['Wholly different ' + i, 5000 + i];
    const a = t_sheet(ga), b = t_sheet(gb);
    const al = alignRows(hashGrid(a).hashes, hashGrid(b).hashes, a, b, OPTS);
    t_assertEqual(al.skipped, true, 'skipped');
    t_assertEqual(al.rowMap, null, 'absence is what Step 4e keys on');
  });

  t_test('3f', 'Alignment window guard fires above 2000 rows',
    function () {
    const ga = [], gb = [];
    for (let i = 0; i < 2100; i++) {
      ga.push(['A' + i, i]);
      gb.push(['B' + i, i + 1]);            // nothing matches -> no pass-0 trim
    }
    const a = t_sheet(ga), b = t_sheet(gb);
    const al = alignRows(hashGrid(a).hashes, hashGrid(b).hashes, a, b, OPTS);
    t_assertEqual(al.skipped, true, 'skipped');
    t_assertEqual(al.reason.indexOf('window too large') >= 0, true, al.reason);
  });

  t_test('3g', 'Pass 0 alone resolves an append with no DP work',
    function () {
    const ga = t_filler(16);
    const gb = t_filler(16).concat([['Row 17', 170], ['Row 18', 180]]);
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'ROW_ADDED', 2);
    t_assertTotal(changes, 2);
  });

}
