/**
 * 90_Main.test.gs - readTab's contract, and Step 10.
 *
 * readTab is the one I/O function whose CONTRACT is testable without a
 * spreadsheet, because it takes anything with getDataRange(). It must keep
 * taking a duck-typed object, or '8a' and '8b' cannot construct an input.
 *
 * Nothing here reaches the Sheets or Drive API. run(), runWith() and
 * verifyReferenceForms() are verified by the stubbed dry run and by Step 11,
 * neither of which is a unit test.
 *
 * Summary lines are asserted BY THEIR TEXT, not by their counts. Asserting only
 * a number lets a rewording silently drop the sentence that gave the number its
 * meaning, and two of these sentences are mandatory.
 */

function t_main_tests() {

  t_test('8a', 'readTab carries rowOffset / colOffset through and trims',
    function () {
    // getDataRange() starting at C5 is the case that corrupts every emitted
    // reference AND every absolute-row lookup in relocate() if the offsets are
    // dropped — the second silently.
    const t = readTab(t_stubSheet({
      values:  [['H', 'I'], ['x', 1], ['', '']],
      fR1C1:   [['', ''], ['', '=RC[-1]'], ['', '']],
      fA1:     [['', ''], ['', '=B6'], ['', '']],
      row: 5, col: 3
    }));
    t_assertEqual(t.rowOffset, 5, 'rowOffset');
    t_assertEqual(t.colOffset, 3, 'colOffset');
    t_assertEqual(t.values.length, 2, 'trailing blank row trimmed');
    // The offsets must reach the emitted refs: array [1][1] is sheet D6.
    t_assertEqual(a1(1 + t.rowOffset, 1 + t.colOffset), 'D6', 'ref from offsets');
  });

  t_test('8b', 'readTab on an empty sheet yields an empty grid, not a phantom row',
    function () {
    // getDataRange() on a blank sheet returns A1:A1 holding ''. Left untrimmed
    // it becomes a one-row tab that pairs and compares against real content.
    const t = readTab(t_stubSheet({
      values: [['']], fR1C1: [['']], fA1: [['']], row: 1, col: 1
    }));
    t_assertEqual(t.values.length, 0, 'no rows');
    t_assertEqual(gridWidth_(t), 0, 'no width');
  });

  t_test('10a', 'Summary header puts REF first, DERIV last past the rule, ' +
                 'and each type lands in its own column',
    function () {
    // One VALUE, one HARDCODED, one pre-existing REF_ERROR, one row added.
    const A = t_workbook({ T: t_plant(16, [
      [3, 1, '=SUM(RC[-1])', '=SUM(RC[-1])', 5],
      [5, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']
    ]) });
    const B = t_workbook({ T: t_plantG(function () {
      const g = t_filler(16);
      g[2][0] = 'Row 3 edited';
      g.splice(8, 0, ['Inserted', 999]);
      return g;
    }(), [
      [3, 1, 42, 42, 42],                                   // hardcoded over
      [5, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']
    ]) });
    const text = buildSummary({ result: t_cmp(A, B), titleA: 'A', titleB: 'B',
                               tabCountA: 1, tabCountB: 1 });
    const L = text.split('\n');

    // Located by PATTERN, not by line index. The head block gained a VERSION
    // line; a test that counts lines from the top breaks on every future
    // addition to it while proving nothing about the table.
    const head = L.filter(function (l) { return /^TAB\s+STATUS/.test(l); })[0];
    t_assertEqual(head.indexOf('REF') < head.indexOf('VAL'), true,
                'REF column comes first');
    t_assertEqual(head.indexOf('\u00b1COL') < head.indexOf('DERIV'), true,
                'DERIV sits past every other column');
    t_assertEqual(head.indexOf('\u2502') < head.indexOf('DERIV'), true,
                'and past the rule');

    // Each count must land in its own column, which is only checkable by
    // reading the rendered row back.
    const line = L.filter(function (l) { return /^T\s+modified/.test(l); })[0];
    const cells = line.replace(/^T\s+modified\s+/, '')
                      .replace('\u2502', ' ').trim().split(/\s+/);
    t_assertEqual(cells, ['1', '1', '0', '0', '0', '1', '0', '+1', '0', '0'],
                'REF VAL FORM UNVER VOL HARD FMLZD \u00b1ROW \u00b1COL | DERIV');
    t_assertEqual(/^sheets-diff v/.test(L[0]), true, 'the head carries VERSION');
  });

  t_test('10b', 'Both mandatory error lines appear, and the pre-existing one ' +
                  'says state-not-delta',
    function () {
    // Test 30's shape (broken in both) plus test 29's (broke in B). The second
    // line is mandatory because without it a reader filters pre-existing errors
    // out as diff noise — which is exactly what the requirement forbids.
    const A = t_workbook({ T: t_plant(16, [
      [3, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!'],
      [5, 1, '=Rates!$B$4',  '=Rates!R4C2',  40]
    ]) });
    const B = t_workbook({ T: t_plant(16, [
      [3, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!'],
      [5, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']
    ]) });
    const s = buildSummary({ result: t_cmp(A, B) });
    t_assertEqual(/REFERENCE ERRORS: 2 total — 1 new, 0 fixed, 1 pre-existing/.test(s),
                true, 'error tally line');
    t_assertEqual(/1 reference broke in this revision \(REF_ERROR_NEW\)/.test(s),
                true, 'the what-broke-now line');
    t_assertEqual(/1 pre-existing reference error was already present in both files/
                .test(s), true, 'the pre-existing line');
    t_assertEqual(/reports state, not deltas/.test(s), true,
                'the state-not-delta sentence');
  });

  t_test('10c', 'A skipped tab shows dashes, not zeros, in every column but REF',
    function () {
    // Printing 0 under VAL for a tab whose cells were never compared asserts
    // "no value changes here", which is a lie about the strongest kind. DERIV
    // takes the same rule: 0 there would assert "nothing recalculated".
    const A = t_workbook({ T: t_sheet(t_filler(20)) });
    const B = t_workbook({ T: t_plantG(t_unalignable().values.map(function (r) {
      return r.slice();
    }), [[1, 1, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]) });
    const s = buildSummary({ result: t_cmp(A, B) });
    const line = s.split('\n').filter(function (l) {
      return /^T\s+SKIPPED/.test(l);
    })[0];
    t_assertEqual(!!line, true, 'the skipped tab has a row');
    const cells = line.replace(/^T\s+SKIPPED\s+/, '')
                      .replace('\u2502', ' ').trim().split(/\s+/);
    t_assertEqual(cells, ['1', '\u2014', '\u2014', '\u2014', '\u2014', '\u2014',
                        '\u2014', '\u2014', '\u2014', '\u2014'],
                'REF is real, the other nine are dashes');
    t_assertEqual(/still scanned; its cells were not compared/.test(s), true,
                'and the note says so');
  });

  t_test('10d', 'Recalculated cells are counted into DERIV and explained',
    function () {
    // Test 4's fixture: the input changed, the downstream formula is identical
    // and non-volatile. The row now EXISTS, in section 2 - but the summary is
    // still the only place a reader learns that a tab showing nothing in
    // section 1 nevertheless moved.
    const A = t_workbook({ T: t_plant(16, [[3, 1, '=RC[-1]*2', '=RC[-1]*2', 60]]) });
    const g = t_filler(16); g[3][0] = 'Row 4';
    const B = t_workbook({ T: t_plantG(g, [[3, 1, '=RC[-1]*2', '=RC[-1]*2', 99]]) });
    const r = t_cmp(A, B);
    t_assertNone(r.changes, 'VALUE');
    t_assertCount(r.changes, 'DERIVED_VALUE', 1);

    // The counter comes from the row that EXISTS. The previous build re-tested
    // diffCell rule 5's condition on the null branch to get this number; that
    // duplicated condition is gone along with the suppression it counted.
    t_assertEqual(r.results[0].derived, 1, 'counted, for the DERIV column');
    t_assertEqual(r.results[0].emitted, 0,
                'and kept OUT of the section-1 noise ratio');

    const s = buildSummary({ result: r });
    t_assertEqual(
      /DERIVED: 1 cell recalculated with unchanged formulas \(section 2\)\./.test(s),
      true, 'the totals line');
    t_assertEqual(/Derived values: 1 cell changed value with identical formulas/
                .test(s), true, 'the note');
    t_assertEqual(/its root, which in a reference chain can sit several tabs away/
                .test(s), true, 'and the chain caveat');
    t_assertEqual(/The CSV holds two tables/.test(s), true,
                'and the warning that a plain import reads three extra rows');
  });

  t_test('10e', 'Unverifiable references are attributed to the tab that lacks a map',
    function () {
    // Test 22's fixture. Step 11.6 reads this line to conclude "a referenced
    // tab was skipped", so it has to name the REFERENCED tab, not the one
    // holding the formula.
    const A = t_workbook({
      HVAC:  t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
      Rates: t_sheet(t_filler(20))
    });
    const B = t_workbook({
      HVAC:  t_plant(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
      Rates: t_unalignable()
    });
    const s = buildSummary({ result: t_cmp(A, B) });
    t_assertEqual(/1 formula holds unverifiable references into: Rates \(1\)/.test(s),
                true, 'attributed to Rates, the tab without a map');
  });

  t_test('10f', 'The 0-realigned field check fires only when absolute ' +
                  'references actually exist',
    function () {
    // Plan Step 11.4, automated: 0 realigned while rows moved is the signature
    // of REF_RE matching nothing. It must NOT fire on a workbook that has
    // nothing to realign, or it trains the reader to ignore it.
    const plainA = t_workbook({ T: t_sheet(t_filler(16)) });
    const plainB = t_workbook({ T: t_inserted(16, 5) });
    const quiet = buildSummary({ result: t_cmp(plainA, plainB) });
    t_assertEqual(/may be matching nothing/.test(quiet), false,
                'silent with no absolute references');

    // Same row movement, but now a formula holds an absolute reference into a
    // tab that has no map — sabotage relocate() and this is the only warning.
    const r = t_cmp(plainA, plainB);
    r.results[0].absRefs = 3;
    const loud = buildSummary({ result: r });
    t_assertEqual(/3 formulas hold absolute row/.test(loud), true,
                'fires once absolute references are present');
    t_assertEqual(/plan §1.2a/.test(loud), true, 'and points at the gate');
  });

  t_test('10g', 'Added, deleted and renamed tabs each get a row with the ' +
                  'right status',
    function () {
    const A = t_workbook({ Keep: t_sheet(t_filler(16)), Scratch: t_sheet(t_filler(16)),
                         Cover: t_sheet(t_filler(16)) });
    const B = t_workbook({ Keep: t_sheet(t_filler(16)), 'C o v e r': t_sheet(t_filler(16)),
                         New: t_plant(16, [[2, 1, '=Rates!#REF!',
                                                 '=Rates!#REF!', '#REF!']]) });
    const s = buildSummary({ result: t_cmp(A, B), titleA: 'A', titleB: 'B',
                             tabCountA: 3, tabCountB: 3 });
    t_assertEqual(/^Keep\s+unchanged/m.test(s), true, 'unchanged');
    t_assertEqual(/^Cover → C o v e r\s+renamed/m.test(s), true, 'renamed, both names');
    t_assertEqual(/^Scratch\s+deleted\s+—/m.test(s), true, 'deleted, REF dashed');
    // An added tab IS error-scanned, so its REF column is real while the rest
    // are dashes.
    t_assertEqual(/^New\s+added\s+1\s+—/m.test(s), true, 'added, REF real');
    t_assertEqual(/2 changed, 1 unchanged, 0 skipped\.  1 added in B\./.test(s),
                true, 'totals line counts A tabs and reports B additions apart');
  });

  t_test('10h', 'A renamed tab whose cells also changed does not read as ' +
                  'merely renamed',
    function () {
    const g = t_filler(16); g[3][0] = 'Row 4 edited';
    const A = t_workbook({ Cover: t_sheet(t_filler(16)) });
    const B = t_workbook({ 'C o v e r': t_sheet(g) });
    const s = buildSummary({ result: t_cmp(A, B) });
    t_assertEqual(/^Cover → C o v e r\s+ren\+mod\s+0\s+1/m.test(s), true,
                'status shows both, and the VALUE row is not hidden');
  });

  t_test('10i', 'Zero changes reports no reference errors explicitly',
    function () {
    // Silence about errors reads as "not checked". It has to say none.
    const s = buildSummary({
      result: t_cmp(t_workbook({ T: t_sheet(t_filler(16)) }),
                   t_workbook({ T: t_sheet(t_filler(16)) })),
      titleA: 'v1', titleB: 'v2', tabCountA: 1, tabCountB: 1,
      fileName: 'changes-x.csv', csvRows: 0, elapsedMs: 4000
    });
    t_assertEqual(/REFERENCE ERRORS: none in either file\./.test(s), true,
                'explicit none');
    t_assertEqual(/→ changes-x\.csv \(0 rows, 4s\)/.test(s), true,
                'footer names the file, the row count and the elapsed time');
    t_assertEqual(/^T\s+unchanged/m.test(s), true, 'the tab is listed as unchanged');
  });

}
