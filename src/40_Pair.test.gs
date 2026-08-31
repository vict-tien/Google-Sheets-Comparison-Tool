/**
 * 40_Pair.test.gs - Step 7.
 *
 * Test 21 does not use the plan's own fixture, and '7b' records why: the plan
 * renames "Rates" to "Rates v2", which its OWN pairing rule cannot pair -
 * normalisation lowercases and strips punctuation and nothing else, so "rates"
 * and "ratesv2" are two different tabs. Widening normalisation was rejected
 * (a wrong pairing generates a full-tab phantom diff), so 21 tests the same
 * rule through a rename the rule does catch.
 */

function t_pair_tests() {

  t_test(10, 'Tab added, deleted, renamed -> one row each, no cell rows',
    function () {
    const A = t_workbook({ Cover: t_sheet(t_filler(16)),
                         'Q1 Rates': t_sheet(t_filler(16)),
                         Scratch: t_sheet(t_filler(16)) });
    const B = t_workbook({ Cover: t_sheet(t_filler(16)),
                         'Q1_Rates': t_sheet(t_filler(16)),
                         Notes: t_sheet(t_filler(16)) });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'TAB_RENAMED', 1);
    t_assertCount(changes, 'TAB_DELETED', 1);
    t_assertCount(changes, 'TAB_ADDED', 1);
    t_assertTotal(changes, 3);
  });

  t_test(21, 'A referenced tab is renamed; referencing formulas untouched ' +
               '-> 1 TAB_RENAMED, 0 FORMULA',
    function () {
    // The plan's own fixture for this test renames "Rates" to "Rates v2",
    // which its Step 7 rule cannot pair — normalisation strips punctuation
    // and whitespace, and nothing else, so "rates" and "ratesv2" are two
    // different tabs (see test '7b', which pins that down). The rename here
    // is one the rule does catch, and it tests the same thing: rule 5, the
    // sheet name relocated through tabMap so a rename does not fire on every
    // referencing cell.
    const A = t_workbook({
      HVAC: t_plant(16, [[9, 2, "='Q1 Rates'!$B$4", "='Q1 Rates'!R4C2", 40]]),
      'Q1 Rates': t_sheet(t_filler(16))
    });
    const B = t_workbook({
      HVAC: t_plant(16, [[9, 2, '=Q1_Rates!$B$4', '=Q1_Rates!R4C2', 40]]),
      'Q1_Rates': t_sheet(t_filler(16))
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'TAB_RENAMED', 1);
    t_assertNone(changes, 'FORMULA');
    t_assertTotal(changes, 1);
  });

  t_test('7a', 'pairTabs — exact beats normalised; ambiguity is never guessed',
    function () {
    const p = pairTabs(['Cover', 'Q1 Rates'], ['Q1_Rates', 'Cover']);
    t_assertEqual(p.tabMap, { Cover: 'Cover', 'Q1 Rates': 'Q1_Rates' }, 'tabMap');
    t_assertEqual(p.added, [], 'nothing added');
    t_assertEqual(p.deleted, [], 'nothing deleted');

    const amb = pairTabs(['Rates', 'RATES'], ['rates']);
    t_assertEqual(amb.tabMap, {}, 'two A tabs normalise alike -> no pairing');
    t_assertEqual(amb.warnings.length, 1, 'and a warning is recorded');
    t_assertEqual(amb.deleted.length, 2, 'both fall through to TAB_DELETED');
  });

  t_test('7b', 'pairTabs — a version suffix is a different tab, by design',
    function () {
    const p = pairTabs(['Rates'], ['Rates v2']);
    t_assertEqual(p.tabMap, {}, 'not paired');
    t_assertEqual([p.deleted, p.added], [['Rates'], ['Rates v2']],
                'reported as a delete plus an add — a wrong pairing would ' +
                'generate a full-tab phantom diff');
  });

}
