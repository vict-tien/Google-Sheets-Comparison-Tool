/**
 * 21_Relocate.test.gs - Step 4, and the error rules that consume it.
 *
 * INSERTION INDICES MATTER, and getting one wrong makes a test pass while
 * proving nothing. t_inserted(16, 2, ...) splices at array index 2, which is
 * sheet row 3, which is ABOVE row 4 - so the row map sends 4 -> 5. Splice at or
 * below the referenced row and the map becomes an identity: relocate looks
 * correct while doing nothing.
 *
 * Every fixture that reaches Step 4 uses t_plant / t_plantG, never t_sheet()
 * alone. t_sheet() stores the A1 text in fR1C1 when no R1C1 grid is given, which
 * is harmless for Steps 2-3 and gives Step 4 A1 text where it expects R1C1 -
 * REF_RE then silently matches nothing.
 */

function t_relocate_tests() {

  t_test(17, '=$B$4 with a row inserted above row 4, same tab -> 0 FORMULA',
    function () {
    // The same-tab absolute case. R1C1 leaves R4C2 alone when a row moves, so
    // without relocation this reads as an authored formula edit.
    const a = t_plant(16,     [[9, 2, '=$B$4', '=R4C2', 40]]);
    const b = t_inserted(16, 2, [[10, 2, '=$B$5', '=R5C2', 40]]);
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertNone(changes, 'FORMULA');
    t_assertNone(changes, 'FORMULA_UNVERIFIED');
    t_assertTotal(changes, 1);
  });

  t_test(19, 'Row deleted in Rates; Assumptions referenced it -> ' +
               'ROW_DELETED + REF_ERROR_NEW (root)',
    function () {
    const gb = t_filler(16);
    gb.splice(3, 1);                                   // sheet row 4 deleted
    const A = t_workbook({
      Assumptions: t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
      Rates: t_sheet(t_filler(16))
    });
    const B = t_workbook({
      Assumptions: t_plant(16, [[9, 2, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]),
      Rates: t_sheet(gb)
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'ROW_DELETED', 1);
    t_assertCount(changes, 'REF_ERROR_NEW', 1);
    t_assertTotal(changes, 2);
    const e = changes.filter(function (c) { return c.change === 'REF_ERROR_NEW'; })[0];
    t_assertEqual(e.new, '=Rates!#REF!', 'root: new shows the broken formula');
    t_assertEqual(e.tab, 'Assumptions', 'reported where the pointer is, not in Rates');
  });

  t_test(23, '=Rates!$B$4 * Escalation!$C$7 with a row inserted in BOTH ' +
               '-> 0 FORMULA',
    function () {
    // One map per formula passes every earlier test and fails this one: the
    // two references resolve to different tabs and need different maps in a
    // single pass.
    const A = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$4*Escalation!$C$7',
                               '=Rates!R4C2*Escalation!R7C3', 40]]),
      Rates: t_sheet(t_filler(16)),
      Escalation: t_sheet(t_filler(16))
    });
    const B = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$5*Escalation!$C$8',
                               '=Rates!R5C2*Escalation!R8C3', 40]]),
      Rates: t_inserted(16, 2),        // above row 4  -> 4 maps to 5
      Escalation: t_inserted(16, 5)    // above row 7  -> 7 maps to 8
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'ROW_ADDED', 2);
    t_assertNone(changes, 'FORMULA');
    t_assertNone(changes, 'FORMULA_UNVERIFIED');
    t_assertTotal(changes, 2);
  });

  t_test(24, 'Rates mapped and genuinely edited, Escalation skipped ' +
               '-> FORMULA, not FORMULA_UNVERIFIED',
    function () {
    // Mask-everything files this real edit as unverifiable and loses it.
    //
    // The edit has to be to the ROW of the mapped reference, not to anything
    // else in the formula. Rates row 4 maps to row 5, and B points at row 9:
    // someone repointed it by hand. Mask every absolute row and both sides
    // collapse to Rates!R#C2, the difference disappears, and the edit is
    // filed as unverifiable. An edit elsewhere in the formula (a trailing
    // "+1", say) survives masking and would let a mask-everything
    // implementation pass this test while still losing real repointings.
    const A = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$4*Escalation!$C$7',
                               '=Rates!R4C2*Escalation!R7C3', 40]]),
      Rates: t_sheet(t_filler(16)),
      Escalation: t_sheet(t_filler(20))
    });
    const B = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$9*Escalation!$C$7',
                               '=Rates!R9C2*Escalation!R7C3', 90]]),
      Rates: t_inserted(16, 2),
      Escalation: t_unalignable()
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'FORMULA', 1);
    t_assertNone(changes, 'FORMULA_UNVERIFIED');
    t_assertCount(changes, 'TAB_SKIPPED', 1);
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertTotal(changes, 3);
  });

  t_test(25, '=Rates!$B$4 * $B$7 — cross-tab and same-tab absolute, rows ' +
               'inserted in both -> 0 FORMULA',
    function () {
    const A = t_workbook({
      Fleet: t_plant(16, [[9, 2, '=Rates!$B$4*$B$7', '=Rates!R4C2*R7C2', 40]]),
      Rates: t_sheet(t_filler(16))
    });
    const B = t_workbook({
      // A row inserted in Fleet itself: the same-tab R7C2 resolves through
      // Fleet's own map, and the referencing cell has moved down one row too.
      Fleet: t_inserted(16, 5, [[10, 2, '=Rates!$B$5*$B$8',
                                      '=Rates!R5C2*R8C2', 40]]),
      Rates: t_inserted(16, 2)
    });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'ROW_ADDED', 2);
    t_assertNone(changes, 'FORMULA');
    t_assertTotal(changes, 2);
  });

  t_test(27, 'INDIRECT, formula identical, value differs -> VOLATILE_VALUE, ' +
              'and ZERO DERIVED_VALUE',
    function () {
    // Contrast with test 4: same shape of input, opposite expected output.
    // Sheets does not rewrite the string argument when rows move, so the
    // formula text is identical and only the value betrays the move.
    //
    // THE ZERO IS THE ASSERTION THAT BITES. Swap diffCell rule 5's two
    // branches and this cell is relabelled DERIVED_VALUE and buried in section
    // 2: nothing is dropped, the total is still 2, and every count except this
    // one still reads correctly.
    const mk = function (v) {
      return t_plant(16, [[9, 2, '=INDIRECT("Rates!B" & A10)',
                                 '=INDIRECT("Rates!B" & RC[-1])', v]]);
    };
    const A = t_workbook({ Fleet: mk(55), Rates: t_sheet(t_filler(16)) });
    const B = t_workbook({ Fleet: mk(77), Rates: t_inserted(16, 2) });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'VOLATILE_VALUE', 1);
    t_assertCount(changes, 'DERIVED_VALUE', 0);
    t_assertNone(changes, 'FORMULA');
    t_assertCount(changes, 'ROW_ADDED', 1);
    t_assertTotal(changes, 2);
  });

  t_test(28, 'OFFSET, anchor relocates cleanly, value differs -> ' +
              'VOLATILE_VALUE, and ZERO DERIVED_VALUE',
    function () {
    // See test 27 for why the zero is the assertion that matters here.
    const mk = function (v) {
      return t_plant(16, [[9, 2, '=OFFSET(Rates!$A$1,3,1)',
                                 '=OFFSET(Rates!R1C1,3,1)', v]]);
    };
    const A = t_workbook({ Fleet: mk(30), Rates: t_sheet(t_filler(16)) });
    // Inserted BELOW row 1, so the anchor maps to itself and the formula text
    // stays identical - the numeric offset is what silently moved.
    const B = t_workbook({ Fleet: mk(40), Rates: t_inserted(16, 5) });
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'VOLATILE_VALUE', 1);
    t_assertCount(changes, 'DERIVED_VALUE', 0);
    t_assertNone(changes, 'FORMULA');
    t_assertTotal(changes, 2);
  });

  t_test(29, 'Clean formula in A, =Rates!#REF! in B -> REF_ERROR_NEW',
    function () {
    const a = t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 55]]);
    const b = t_plant(16, [[9, 2, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]);
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'REF_ERROR_NEW', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].new, '=Rates!#REF!', 'new shows the broken formula');
    t_assertEqual(changes[0].old, '=Rates!$B$4', 'old shows what it used to be');
  });

  t_test(31, '=Rates!#REF! in A, valid formula in B -> REF_ERROR_FIXED',
    function () {
    const a = t_plant(16, [[9, 2, '=Rates!#REF!', '=Rates!#REF!', '#REF!']]);
    const b = t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 55]]);
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'REF_ERROR_FIXED', 1);
    t_assertTotal(changes, 1);
  });

  t_test('4a', 'relocate — per-match tab resolution; relative rows and ' +
                 'columns untouched',
    function () {
    const tables = {
      tabMap:  { Rates: 'Rates', Escalation: 'Escalation', T: 'T' },
      rowMaps: {
        Rates:      new Map([[4, 5]]),
        Escalation: new Map([[7, 8]]),
        T:          new Map([[7, 9]])
      }
    };
    t_assertEqual(relocate('=Rates!R4C2*Escalation!R7C3', tables, 'T'),
                '=Rates!R5C2*Escalation!R8C3', 'two tabs, one pass');
    t_assertEqual(relocate('=R7C3', tables, 'T'), '=R9C3',
                'no sheet prefix resolves to the current tab');
    t_assertEqual(relocate('=R[-1]C[2]+RC[-1]', tables, 'T'), '=R[-1]C[2]+RC[-1]',
                'relative references are already shift-invariant');
    t_assertEqual(relocate('=Rates!R4C4', tables, 'T'), '=Rates!R5C4',
                'the column part is never touched');
    t_assertEqual(relocate('=Missing!R4C2', tables, 'T'), '=Missing!R4C2',
                'no map for the target: left alone, never guessed');
    t_assertEqual(relocate('=Rates!R9C2', tables, 'T'), '=Rates!R9C2',
                'mapped tab, unmapped row: left alone (dangling, not shifted)');
    t_assertEqual(relocate('', tables, 'T'), '', 'a non-formula cell stays empty');
  });

  t_test('4b', 'relocate — sheet names through tabMap, quoting either way',
    function () {
    const tables = {
      tabMap: { 'Q1 Rates': 'Q1_Rates', Rates: 'Q2 Rates' },
      rowMaps: { 'Q1 Rates': new Map([[4, 4]]), Rates: new Map([[4, 4]]) }
    };
    t_assertEqual(relocate("='Q1 Rates'!R4C2", tables, 'T'), '=Q1_Rates!R4C2',
                'quotes dropped when the new name does not need them');
    t_assertEqual(relocate('=Rates!R4C2', tables, 'T'), "='Q2 Rates'!R4C2",
                'quotes added when it does');
  });

  t_test('4c', 'relocate — string literals are protected, identifiers are ' +
                 'not references',
    function () {
    const tables = { tabMap: {}, rowMaps: { Rates: new Map([[4, 5]]) } };
    t_assertEqual(relocate('=INDIRECT("Rates!R4C2")+Rates!R4C2', tables, 'T'),
                '=INDIRECT("Rates!R4C2")+Rates!R5C2',
                'the quoted argument is data; only the bare reference moves');
    t_assertEqual(relocate('=IF(A1="R4C2",Rates!R4C2,0)', tables, 'T'),
                '=IF(A1="R4C2",Rates!R5C2,0)', 'a literal that looks like one');
    t_assertEqual(relocate('=Total_RC+1', tables, 'T'), '=Total_RC+1',
                'RC inside an identifier is not a reference');
  });

  t_test('4d', 'maskUnresolvable masks ONLY references with no row map',
    function () {
    const tables = { tabMap: {}, rowMaps: { Rates: new Map([[4, 5]]) } };
    t_assertEqual(maskUnresolvable('=Rates!R5C2*Escalation!R7C3', tables, 'T'),
                '=Rates!R5C2*Escalation!R#C3',
                'the verified reference survives so a real edit still shows');
    t_assertEqual(maskUnresolvable('=R7C3', tables, 'Rates'), '=R7C3',
                'current tab has a map: not masked');
    t_assertEqual(maskUnresolvable('=R7C3', tables, 'Other'), '=R#C3',
                'current tab has none: masked');
    t_assertEqual(maskUnresolvable('=Escalation!R[-1]C3', tables, 'T'),
                '=Escalation!R[-1]C3', 'relative rows need no verification');
  });

  t_test('4e', 'isVolatile', function () {
    t_assertEqual(isVolatile('=INDIRECT("A" & B1)'), true, 'INDIRECT');
    t_assertEqual(isVolatile('=offset(A1,1,1)'), true, 'case-insensitive');
    t_assertEqual(isVolatile('=SUM(A1:A9)'), false, 'ordinary formula');
    t_assertEqual(isVolatile(''), false, 'empty');
  });

  t_test('4z', 'unresolvableTargets names the tab whose row map is missing, ' +
                 'and only that one',
    function () {
    // Rates has a map, Escalation does not. maskUnresolvable would mask one
    // and leave the other; this must name exactly the one it masked.
    const tables = { tabMap: {}, rowMaps: { Rates: new Map([[4, 5]]) } };
    t_assertEqual(unresolvableTargets('=Rates!R4C2 * Escalation!R7C3', tables, 'Fleet'),
                ['Escalation'], 'only the unmapped target');
    t_assertEqual(unresolvableTargets('=Rates!R4C2', tables, 'Fleet'),
                [], 'a mapped target is not unresolvable');
    // A same-tab absolute reference resolves to currentTab, which here has no
    // map either — the caller's own tab is a legitimate answer.
    t_assertEqual(unresolvableTargets('=R7C3', tables, 'Fleet'),
                ['Fleet'], 'same-tab absolute resolves to currentTab');
    // Relative rows are shift-invariant, so nothing about them is unverifiable.
    t_assertEqual(unresolvableTargets('=Escalation!R[-1]C3', tables, 'Fleet'),
                [], 'a relative row is never unresolvable');
    // De-duplicated, not once per reference.
    t_assertEqual(unresolvableTargets('=Escalation!R7C3 + Escalation!R9C3',
                                    tables, 'Fleet'),
                ['Escalation'], 'de-duplicated');
    // A string literal holding the text of a reference is protected (§4a).
    t_assertEqual(unresolvableTargets('=INDIRECT("Escalation!R7C3")', tables, 'Fleet'),
                [], 'string literals are not scanned');
  });

  // --- whole-row and whole-column references (v1.2.0) -----------------------
  //
  // Before v1.2.0 the literal R and the literal C in REF_RE were both
  // mandatory, so `Rates!R4` and `Rates!C2` matched NOTHING. Two separate bugs
  // came out of that, and only the first is the obvious one. See 21_Relocate.gs.

  t_test('4f', 'relocate - a whole-row reference carries an absolute row, and must move',
    function () {
    // =SUM(Rates!$4:$4) is `Rates!R4`. No column part at all. Unmatched, the row
    // never moved, and every row inserted above Rates!4 reported a FORMULA that
    // nobody authored.
    const tables = { tabMap: { Rates: 'Rates' },
                     rowMaps: { Rates: new Map([[4, 5]]) } };
    t_assertEqual(relocate('=SUM(Rates!R4)', tables, 'Fleet'), '=SUM(Rates!R5)',
                'the absolute row moves');
    // Each endpoint resolves independently, and R6 - which has no sheet prefix -
    // resolves to the CURRENT tab, which has no map, so it is left alone.
    t_assertEqual(relocate('=SUM(Rates!R4:R6)', tables, 'Fleet'),
                '=SUM(Rates!R5:R6)', 'per-match resolution still holds');
    t_assertEqual(
      relocate('=R4', { tabMap: {}, rowMaps: { Fleet: new Map([[4, 9]]) } }, 'Fleet'),
      '=R9', 'same-tab whole row, and no C is invented');

    // Unverifiable exactly as an R4C2 would be, and masked the same way.
    const noMap = { tabMap: {}, rowMaps: {} };
    t_assertEqual(maskUnresolvable('=SUM(Rates!R4)', noMap, 'Fleet'),
                '=SUM(Rates!R#)', 'masked, and still a whole row');
    t_assertEqual(unresolvableTargets('=SUM(Rates!R4)', noMap, 'Fleet'),
                ['Rates'], 'and the tab is named');

    // The Step 10 relocation warning is gated on absRefs, so its regex has to
    // see this form too or the warning goes quiet on exactly the workbooks that
    // need it.
    t_assertEqual(ABS_ROW_RE.test('=SUM(Rates!R4)'), true,
                'the absRefs gate sees a whole row');
    t_assertEqual(ABS_ROW_RE.test('=SUM(Rates!C2)'), false,
                'and does not see a whole column');
  });

  t_test('4g', 'relocate - a whole-column reference has no row, and still needs its sheet name',
    function () {
    // =SUM(Rates!$B:$B) is `Rates!C2`. THIS IS THE ONE THAT LOOKED HARMLESS.
    // There is no row to relocate - but it still carries a SHEET NAME, and
    // tabMap never reached it, so a renamed tab produced a false FORMULA on
    // every whole-column reference in the workbook.
    const tables = { tabMap: { Rates: 'Rates 2026' },
                     rowMaps: { Rates: new Map([[4, 5]]) } };
    t_assertEqual(relocate('=SUM(Rates!C2)', tables, 'Fleet'),
                "=SUM('Rates 2026'!C2)",
                'renamed, requoted because it now needs quoting, column untouched');
    t_assertEqual(relocate('=SUM(C2)', tables, 'Fleet'), '=SUM(C2)',
                'no sheet prefix is invented where none was written');

    // Nothing about a column is unverifiable: there is no row that could fail
    // to map. Masking one would make a real edit indistinguishable from noise.
    const noMap = { tabMap: {}, rowMaps: {} };
    t_assertEqual(maskUnresolvable('=SUM(Rates!C2)', noMap, 'Fleet'),
                '=SUM(Rates!C2)', 'a column is never masked');
    t_assertEqual(unresolvableTargets('=SUM(Rates!C2)', noMap, 'Fleet'), [],
                'and never named as unresolvable');
  });

  t_test('4h', 'REF_RE - the boundary check now guards a much wider class',
    function () {
    // isRefBoundary_ was written when the shortest possible match was `RC`. It
    // is now `R4` or `C1`, which collide with far more ordinary text. The check
    // is load-bearing for a class it never had to cover.
    const scan = function (f) {
      const seen = [];
      rewriteRefs_(f, function (r) {
        seen.push(formatRef_(r.sheet, r.rowPart, r.colPart, r.form));
        return 'X';
      });
      return seen;
    };
    t_assertEqual(scan('=R4'),      ['R4'],   'a whole row is a reference');
    t_assertEqual(scan('=C1'),      ['C1'],   'a whole column is a reference');
    t_assertEqual(scan('=RC'),      ['RC'],   'the self reference still matches');
    t_assertEqual(scan('=R1C1'),    ['R1C1'], 'the full form still wins over R-only');
    t_assertEqual(scan('=C1_RATE'), [], 'an identifier starting C1 is not a reference');
    t_assertEqual(scan('=R2D2'),    [], 'nor one starting R2');
    t_assertEqual(scan('=MYR4'),    [], 'nor one ending R4');
    t_assertEqual(scan('=SUM(R)'),  [], 'a bare R has no operand and is not a reference');
    t_assertEqual(scan('=SUM(C)'),  [], 'nor a bare C');
    t_assertEqual(scan('="C1"'),    [], 'and a string literal is still protected');
  });

  t_test('4i', 'formatRef_ re-emits the form it was given, and never invents the other half',
    function () {
    // Emitting `R4C` for a whole-row reference would corrupt every one it
    // touched, and the corruption is SILENT - the result still looks like a
    // reference. An identity rewrite is the cheapest way to hold that.
    const id = function (f) {
      return rewriteRefs_(f, function (r) {
        return formatRef_(r.sheet, r.rowPart, r.colPart, r.form);
      });
    };
    ['=Rates!R4', '=Rates!C2', '=RC', '=R1C1', "='It''s'!R4C2",
     '=R[-1]C[2]', '=SUM(Rates!R4:R6)', '=Rates!R4+Rates!C2'
    ].forEach(function (f) {
      t_assertEqual(id(f), f, 'identity: ' + f);
    });
  });

}
