/**
 * 41_Names.test.gs — defined names, and the change nothing else can see.
 *
 * '9b' IS THE TEST THIS FEATURE EXISTS TO SURVIVE. Everything else here checks
 * a shape; '9b' checks that the new pass does not reintroduce the false
 * positives Step 4 spent four hundred lines suppressing.
 */

function t_names_tests() {

  t_test('9a', 'a repointed name is reported; an unchanged one is not',
    function () {
    const tables = { tabMap: {}, rowMaps: {} };
    const A = [
      { name: 'BaseRate', scope: '', sheet: 'Rates', row: 4, col: 2,
        numRows: 1, numCols: 1 },
      { name: 'Steady', scope: '', sheet: 'Rates', row: 9, col: 3,
        numRows: 1, numCols: 1 }
    ];
    const B = [
      { name: 'BaseRate', scope: '', sheet: 'Rates', row: 9, col: 2,
        numRows: 1, numCols: 1 },
      { name: 'Steady', scope: '', sheet: 'Rates', row: 9, col: 3,
        numRows: 1, numCols: 1 }
    ];
    const out = diffNames(A, B, tables);
    t_assertTotal(out, 1);
    t_assertCount(out, 'NAME_REDEFINED', 1);
    t_assertEqual(out[0].column, 'BaseRate', 'the name lives in `column`');
    t_assertEqual(out[0].old, 'Rates!B4', 'old shows what A actually says');
    t_assertEqual(out[0].new, 'Rates!B9', 'new shows what B says');
    t_assertEqual(out[0].tab, '', 'workbook-scoped, so no tab');
    t_assertEqual(out[0].aRef, '', 'a name has no cell reference');
  });

  t_test('9b', 'a name whose target moved because a row was inserted emits NOTHING',
    function () {
    // Compare definitions raw and every name pointing below an inserted row
    // reads as redefined. That is the false-positive class Step 4 exists to
    // suppress, walking back in through a new door.
    const tables = { tabMap: { Rates: 'Rates' },
                     rowMaps: { Rates: new Map([[4, 5]]) } };
    const A = [{ name: 'BaseRate', scope: '', sheet: 'Rates', row: 4, col: 2,
                 numRows: 1, numCols: 1 }];
    const B = [{ name: 'BaseRate', scope: '', sheet: 'Rates', row: 5, col: 2,
                 numRows: 1, numCols: 1 }];
    t_assertEqual(diffNames(A, B, tables).length, 0,
                'relocated through the row map, so silent');

    // With no map for Rates the relocation cannot happen, and the same pair
    // reports. Over-reporting is visible and dismissible; under-reporting is
    // silent — doc §4.4's direction, applied here.
    t_assertEqual(diffNames(A, B, { tabMap: {}, rowMaps: {} }).length, 1,
                'unrelocatable, so reported rather than swallowed');
  });

  t_test('9c', 'a sheet-scoped name travels with its tab when the tab is renamed',
    function () {
    const tables = { tabMap: { Rates: 'Rates 2026' }, rowMaps: {} };
    const A = [{ name: 'Local', scope: 'Rates', sheet: 'Rates', row: 4, col: 2,
                 numRows: 1, numCols: 1 }];
    const same = [{ name: 'Local', scope: 'Rates 2026', sheet: 'Rates 2026',
                    row: 4, col: 2, numRows: 1, numCols: 1 }];
    // Key the scope on A's tab name and the pair never meets, so a renamed tab
    // turns every sheet-scoped name into an unmatched pair — silently.
    t_assertEqual(diffNames(A, same, tables).length, 0,
                'same name, same target, renamed tab');

    const moved = [{ name: 'Local', scope: 'Rates 2026', sheet: 'Rates 2026',
                     row: 7, col: 2, numRows: 1, numCols: 1 }];
    const out = diffNames(A, moved, tables);
    t_assertTotal(out, 1);
    t_assertEqual(out[0].tab, 'Rates 2026', "reported against B's tab name");
    t_assertEqual(out[0].new, "'Rates 2026'!B7",
                'quoted, because it now needs quoting');
  });

  t_test('9d', 'added and deleted names are silent; a block renders as a range',
    function () {
    const tables = { tabMap: {}, rowMaps: {} };
    const one = [{ name: 'Gone', scope: '', sheet: 'Rates', row: 4, col: 2,
                   numRows: 1, numCols: 1 }];
    // A deleted name that is still used breaks its formulas, and those surface
    // as #NAME? through the error scan. A name added and not yet used changes
    // nothing. Reporting either double-counts what the taxonomy already has.
    t_assertEqual(diffNames(one, [], tables).length, 0, 'deleted: silent');
    t_assertEqual(diffNames([], one, tables).length, 0, 'added: silent');

    const A = [{ name: 'Block', scope: '', sheet: 'Rates', row: 2, col: 2,
                 numRows: 3, numCols: 2 }];
    const B = [{ name: 'Block', scope: '', sheet: 'Rates', row: 2, col: 2,
                 numRows: 4, numCols: 2 }];
    const out = diffNames(A, B, tables);
    t_assertTotal(out, 1);
    t_assertEqual(out[0].old, 'Rates!B2:C4', 'a block renders as a range');
    t_assertEqual(out[0].new, 'Rates!B2:C5', 'and a resize is a redefinition');
  });

}
