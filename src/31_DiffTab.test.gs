/**
 * 31_DiffTab.test.gs - one aligned tab pair.
 *
 * '5a' and 32 (here) and '5b' (70_Compare.test.gs) are three separate one-test
 * guards over the three call sites of scanErrorsUnaligned. Delete any one call
 * site and exactly one of them goes red; that is why all three exist rather
 * than one "the scan runs" test.
 */

function t_diffTab_tests() {

  t_test(7, 'Row inserted at the top of a tab -> zero FORMULA rows',
    function () {
    // Every row carries a relative formula whose A1 text differs row by row.
    // Comparing in A1 reports all sixteen as changed; R1C1 reports none.
    const build = function (grid) {
      const cells = [];
      for (let i = 0; i < grid.length; i++) {
        if (grid[i][0] === 'Inserted') continue;
        cells.push([i, 2, '=B' + (i + 1) + '*2', '=RC[-1]*2', grid[i][1] * 2]);
      }
      return t_plantG(grid, cells);
    };
    const gb = t_filler(16);
    gb.splice(0, 0, ['Inserted', 999]);
    const changes = t_diffFixture(build(t_filler(16)), build(gb));
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertNone(changes, 'FORMULA');
    t_assertNone(changes, 'VALUE');
    t_assertTotal(changes, 1);
  });

  t_test(12, 'Headers differ at column C -> TAB_SKIPPED, zero cell rows',
    function () {
    const build = function (third) {
      const g = [['ID', 'Name', third]];
      for (let i = 1; i <= 15; i++) g.push(['R' + i, 'n' + i, i * 10]);
      return t_sheet(g);
    };
    const changes = t_diffFixture(build('Cost'), build('Price'));
    t_assertCount(changes, 'TAB_SKIPPED', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].column, 'C', 'names the offending column');
  });

  t_test(32, 'Reference error inside a tab skipped by the header guard ' +
               '-> TAB_SKIPPED and REF_ERROR with bRef only',
    function () {
    // The scan depends on nothing but a single cell in a single file. If it
    // is folded into the comparison loop, skipped tabs go unscanned and
    // "flag all reference errors" is a lie.
    const build = function (third, broken) {
      const g = [['ID', 'Name', third]];
      for (let i = 1; i <= 15; i++) g.push(['R' + i, 'n' + i, i * 10]);
      const t = t_sheet(g);
      if (broken) t.values[5][2] = '#REF!';
      return t;
    };
    const changes = t_diffFixture(build('Cost', false), build('Price', true));
    t_assertCount(changes, 'TAB_SKIPPED', 1);
    t_assertCount(changes, 'REF_ERROR', 1);
    t_assertTotal(changes, 2);
    const e = changes.filter(function (c) { return c.change === 'REF_ERROR'; })[0];
    t_assertEqual([e.aRef, e.bRef], ['', 'C6'],
                'no A-side counterpart is invented');
  });

  t_test(38, 'A tab that recalculates 90% of itself raises NO noise warning',
    function () {
    // RULE 15. A recalculation shadow is a function of how CONNECTED the model
    // is, not of how badly the tab aligned. Count section 2 in the noise ratio
    // and one input change trips the warning on every downstream tab of a
    // perfectly good run - and a warning that fires on correct runs is not read
    // on the run where it matters.
    //
    // The fixture is built so a section-2-counting implementation CERTAINLY
    // trips: 19 of 40 compared cells would change, against a 30% threshold.
    // The input sits at row 1, not row 0, because row 0 is the header guard's.
    const build = function (input, bump) {
      const g = t_filler(20);
      g[1][1] = input;
      const cells = [];
      for (let i = 2; i < 20; i++) {
        cells.push([i, 1, '=B2*' + i, '=R2C2*' + i, 10 + i + bump]);
      }
      return t_workbook({ T: t_plantG(g, cells) });
    };
    const r = t_cmp(build(5, 0), build(6, 1));
    const s = r.results[0];
    t_assertEqual(s.skipped, false, 'the tab aligned cleanly');
    t_assertEqual([s.compared, s.emitted, s.derived], [40, 1, 18],
                '40 compared, 1 authored change, 18 recalculated');
    t_assertEqual(s.noise, false,
                '1/40 is the ratio that matters; 19/40 is not');
    t_assertEqual(/above the noise threshold/.test(buildSummary({ result: r })),
                false, 'and no warning reaches the summary');
  });

  t_test('5a', 'A tab skipped on edit distance is still scanned',
    function () {
    const g = t_filler(20);
    for (let i = 0; i < 9; i++) g[i * 2] = ['Wholly different ' + i, 5000 + i];
    g[1][1] = '#REF!';
    const changes = t_diffFixture(t_sheet(t_filler(20)), t_sheet(g));
    t_assertCount(changes, 'TAB_SKIPPED', 1);
    t_assertCount(changes, 'REF_ERROR', 1);
    t_assertTotal(changes, 2);
  });

  t_test('5b', 'A tab added in B is scanned even though nothing pairs with it',
    function () {
    const g = t_filler(16);
    g[3][1] = '#REF!';
    const A = t_workbook({ Cover: t_sheet(t_filler(16)) });
    const B = t_workbook({ Cover: t_sheet(t_filler(16)), Fresh: t_sheet(g) });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'TAB_ADDED', 1);
    t_assertCount(changes, 'REF_ERROR', 1);
    t_assertTotal(changes, 2);
  });

  t_test('5c', 'A row added already broken is flagged, not just previewed',
    function () {
    const gb = t_filler(16);
    gb.splice(7, 0, ['Inserted', '#REF!']);
    const changes = t_diffFixture(t_sheet(t_filler(16)), t_sheet(gb));
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertCount(changes, 'REF_ERROR_NEW', 1);
    t_assertTotal(changes, 2);
    const e = changes.filter(function (c) { return c.change === 'REF_ERROR_NEW'; })[0];
    t_assertEqual([e.aRef, e.bRef], ['', 'B8'], 'B-side only — the row is new');
  });

  t_test('5d', 'Column added / deleted, overlapping width still compared',
    function () {
    const ga = t_filler(16);
    const gb = t_filler(16);
    for (let i = 0; i < 16; i++) gb[i].push(i === 3 ? 'extra' : '');
    gb[6][1] = 999;
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'COL_ADDED', 1);
    t_assertCount(changes, 'VALUE', 1);
    t_assertTotal(changes, 2);
  });

  t_test('5e', 'The noise ratio is recorded for the summary, not emitted ' +
                 'as a row',
    function () {
    const gc = t_filler(20), gd = t_filler(20);
    for (let i = 1; i <= 4; i++) gd[i][1] = i * 999;   // not row 0: that is
                                                       // the header guard's
    const quiet = t_cmp(t_workbook({ T: t_sheet(gc) }), t_workbook({ T: t_sheet(gd) }));
    t_assertEqual(quiet.results[0].compared, 40, 'cells compared');
    t_assertEqual(quiet.results[0].emitted, 4, 'rows emitted');
    t_assertEqual(quiet.results[0].noise, false, '4/40 is below noiseWarn');

    // A mass formula rewrite is the shape that trips the noise check without
    // tripping the edit-distance cap first: row hashes ignore formula cells,
    // so alignment stays perfect while a third of the compared cells change.
    const build = function (expr) {
      const cells = [];
      for (let i = 0; i < 20; i++) cells.push([i, 2, expr, expr, 7]);
      return t_plant(20, cells);
    };
    const loud = t_cmp(t_workbook({ T: build('=RC[-1]*2') }),
                      t_workbook({ T: build('=RC[-1]*3') }));
    t_assertEqual(loud.results[0].skipped, false, 'alignment is untroubled');
    t_assertEqual([loud.results[0].compared, loud.results[0].emitted], [60, 20],
                '20 of 60 cells');
    t_assertEqual(loud.results[0].noise, true, '33% > noiseWarn');
    t_assertNone(loud.changes, 'NOISE');
    t_assertCount(loud.changes, 'FORMULA', 20);
  });

  t_test('5f', 'expandRows: one row per populated cell instead of a preview',
    function () {
    const gb = t_filler(16);
    gb.splice(7, 0, ['Inserted', 999]);
    const A = t_workbook({ T: t_sheet(t_filler(16)) });
    const B = t_workbook({ T: t_sheet(gb) });

    const packed = t_cmp(A, B).changes;
    t_assertCount(packed, 'ROW_ADDED', 1);
    t_assertEqual(packed[0].new, 'Inserted|999', 'pipe-joined preview');

    const opts = t_opts({ expandRows: true });
    const spread = t_cmp(A, B, opts).changes;
    t_assertCount(spread, 'ROW_ADDED', 2);
    t_assertEqual([spread[0].bRef, spread[0].new], ['A8', 'Inserted'], 'cell 1');
    t_assertEqual([spread[1].bRef, spread[1].new], ['B8', '999'], 'cell 2');
  });

}
