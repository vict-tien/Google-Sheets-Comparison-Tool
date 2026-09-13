/**
 * 70_Compare.test.gs - Step 9's pure half.
 *
 * These three exist to check ONE property: every tab is aligned before any tab
 * is compared. Test 18 lists Fleet BEFORE Rates for exactly that reason - a
 * single-pass implementation reaches the referencing tab first, has no Rates
 * row map, cannot relocate, and reports a false FORMULA. If that ordering lived
 * in the test file instead of in compareWorkbooks, these tests would be
 * checking a copy of it and run() would be free to get it wrong.
 */

function t_compare_tests() {

  t_test(18, 'Row inserted in Rates; another tab holds =Rates!$B$4 -> ' +
               '1 ROW_ADDED, 0 FORMULA in the referencing tab',
    function () {
    // Fleet is listed FIRST on purpose. A single-pass implementation that
    // reads, aligns and compares one tab at a time reaches Fleet before Rates
    // has a row map, cannot relocate, and reports a false FORMULA.
    const A = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
      Rates: t_sheet(t_filler(16))
    });
    const B = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
      Rates: t_inserted(16, 2)
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertNone(changes, 'FORMULA');
    t_assertTotal(changes, 1);
  });

  t_test(22, 'Rates skipped by a guard; a referencing formula shifted -> ' +
               'FORMULA_UNVERIFIED',
    function () {
    const A = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
      Rates: t_sheet(t_filler(20))
    });
    const B = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
      Rates: t_unalignable()
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'FORMULA_UNVERIFIED', 1);
    t_assertNone(changes, 'FORMULA');
    t_assertCount(changes, 'TAB_SKIPPED', 1);
    t_assertTotal(changes, 2);
  });

  t_test(26, 'Chain Fleet -> Assumptions -> Rates with a row inserted in ' +
               'BOTH -> 2 ROW_ADDED, 0 FORMULA',
    function () {
    // The test that validates the diff half: alignment, R1C1 comparison,
    // per-reference relocation across distinct targets, chain independence
    // and two-phase ordering, all at once. Each hop is resolved by its own
    // target's map — no dependency graph, no topological sort.
    const A = t_workbook({
      Fleet:        t_plant(16, [[9, 2, '=Assumptions!$C$7',
                                      '=Assumptions!R7C3', 40]]),
      Assumptions: t_plant(16, [[6, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
      Rates:       t_sheet(t_filler(16))
    });
    const B = t_workbook({
      Fleet:        t_plant(16, [[9, 2, '=Assumptions!$C$8',
                                      '=Assumptions!R8C3', 40]]),
      // Row inserted above row 7, so the formula cell itself moves down one
      // AND its own reference into Rates shifts.
      Assumptions: t_inserted(16, 5, [[7, 2, '=Rates!$B$5',
                                            '=Rates!R5C2', 40]]),
      Rates:       t_inserted(16, 2)
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'ROW_ADDED', 2);
    t_assertNone(changes, 'FORMULA');
    t_assertNone(changes, 'FORMULA_UNVERIFIED');
    t_assertTotal(changes, 2);
  });

}
