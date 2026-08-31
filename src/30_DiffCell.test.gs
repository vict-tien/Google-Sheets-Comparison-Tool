/**
 * 30_DiffCell.test.gs - the taxonomy.
 *
 * TESTS 4, 27, 28 AND '2h' ARE ONE TEST IN FOUR PARTS. All four put identical
 * observable state in front of diffCell rule 5 - the same formula text on both
 * sides and a changed value - and differ only in ctx.volatile and
 * opts.derivedSection. That is the whole content of rule 14, and the reason 27
 * and 28 assert ZERO DERIVED_VALUE rather than counting rows: swapping rule 5's
 * two branches MISLABELS rather than drops, so every total stays right.
 */

function t_diffCell_tests() {

  t_test(1, 'Identical grids -> 0 changes', function () {
    const a = t_sheet(t_filler(16));
    const b = t_sheet(t_filler(16));
    t_assertTotal(t_diffFixture(a, b), 0);
  });

  t_test(2, 'One literal changed, no formulas in the row -> exactly 1 VALUE',
    function () {
    const ga = t_filler(16), gb = t_filler(16);
    gb[6][1] = 999;
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'VALUE', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].old, '70', 'old');
    t_assertEqual(changes[0].new, '999', 'new');
    t_assertEqual(changes[0].aRef, 'B7', 'aRef');
  });

  t_test(3, 'Formula rewritten, result unchanged -> 1 FORMULA, 0 VALUE',
    function () {
    const ga = t_filler(16), gb = t_filler(16);
    ga[5][1] = '=A1+B1';  gb[5][1] = '=A1+B1+0';
    const a = t_sheet(ga), b = t_sheet(gb);
    a.values[5][1] = 42;  b.values[5][1] = 42;   // same result either way
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'FORMULA', 1);
    t_assertNone(changes, 'VALUE');
    t_assertNone(changes, 'FORMULA_UNVERIFIED');
    t_assertTotal(changes, 1);
  });

  t_test(4, 'Input changed; downstream formula identical, non-volatile -> ' +
             '1 VALUE in section 1, 1 DERIVED_VALUE in section 2',
    function () {
    // One leg of the three-way contrast with 27 and 28. All three fixtures put
    // IDENTICAL observable state in front of diffCell rule 5 - same formula
    // text on both sides, changed value - and only ctx.volatile and
    // opts.derivedSection separate the three answers.
    const ga = t_filler(16), gb = t_filler(16);
    ga[3][1] = 10;  gb[3][1] = 12;
    ga[9][1] = '=B4*2';  gb[9][1] = '=B4*2';
    const a = t_sheet(ga), b = t_sheet(gb);
    a.values[9][1] = 20;  b.values[9][1] = 24;   // recalculated, not authored
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'VALUE', 1);
    t_assertCount(changes, 'DERIVED_VALUE', 1);
    t_assertTotal(changes, 2);

    const v = changes.filter(function (c) { return c.change === 'VALUE'; })[0];
    const d = changes.filter(function (c) { return c.change === 'DERIVED_VALUE'; })[0];
    t_assertEqual(v.aRef, 'B4', 'the input cell');
    t_assertEqual(sectionOf(v), 1, 'the authored edit is section 1');
    t_assertEqual(d.aRef, 'B10', 'the downstream cell');
    t_assertEqual(sectionOf(d), 2, 'the recalculation is section 2');

    // AND NOWHERE ELSE. With the section off it is absent entirely, not
    // relabelled and not moved up into section 1.
    const off = t_diffFixture(a, b, t_opts({ derivedSection: false }));
    t_assertCount(off, 'VALUE', 1);
    t_assertTotal(off, 1);
  });

  t_test(5, 'Literal typed over a formula -> HARDCODED, old=formula',
    function () {
    const ga = t_filler(16), gb = t_filler(16);
    ga[6][1] = '=B2*3';
    const a = t_sheet(ga), b = t_sheet(gb);
    a.values[6][1] = 60;  b.values[6][1] = 60;
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'HARDCODED', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].old, '=B2*3', 'old');
    t_assertEqual(changes[0].new, '60', 'new');
  });

  t_test(6, 'Literal island inside a calculated zone changed -> 1 VALUE',
    function () {
    // Every row carries a formula in column C; only the literal in B8 moves.
    // A pivot-scan implementation that treats the block as "the calc zone"
    // never looks at B8 and fails this.
    const build = function (islandValue) {
      const g = [];
      for (let i = 0; i < 16; i++) {
        g.push(['Row ' + (i + 1), i === 7 ? islandValue : (i + 1) * 10, '=B1*2']);
      }
      const t = t_sheet(g);
      for (let i = 0; i < 16; i++) t.values[i][2] = (i + 1) * 20;
      return t;
    };
    const changes = t_diffFixture(build(80), build(85));
    t_assertCount(changes, 'VALUE', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].aRef, 'B8', 'aRef');
  });

  t_test(30, '#REF! in both files, formulas identical -> 1 REF_ERROR',
    function () {
    // The changes-only exception. If diffCell's rule 3 sits after the
    // identical-formula suppression rule this emits nothing and looks right.
    const ga = t_filler(16), gb = t_filler(16);
    ga[5][1] = "='Ref Src'!#REF!";  gb[5][1] = "='Ref Src'!#REF!";
    const a = t_sheet(ga), b = t_sheet(gb);
    a.values[5][1] = '#REF!';  b.values[5][1] = '#REF!';
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'REF_ERROR', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].new, "='Ref Src'!#REF!", 'root shows its own formula');
  });

  t_test(34, 'Identical formulas, differing values, non-volatile -> ' +
              '1 DERIVED_VALUE in section 2, carrying the two VALUES',
    function () {
    const mk = function (v) {
      return t_workbook({ T: t_plant(16, [[9, 2, '=B4*2', '=R4C2*2', v]]) });
    };
    const changes = t_cmp(mk(20), mk(24)).changes;
    t_assertCount(changes, 'DERIVED_VALUE', 1);
    t_assertTotal(changes, 1);

    const d = changes[0];
    t_assertEqual(sectionOf(d), 2, 'sectionOf routes it to the second table');
    t_assertEqual(sectionOf({ change: 'VALUE' }), 1,
                'and leaves everything else in the first');
    t_assertEqual([d.old, d.new], ['20', '24'],
                'the two VALUES - the formula is identical by definition of ' +
                'reaching this branch, so printing it would waste the column');
    t_assertEqual(d.old.charAt(0) === '=' || d.new.charAt(0) === '=', false,
                'neither side is a formula');
    t_assertEqual([d.aRef, d.bRef], ['C10', 'C10'], 'both sides located');
  });

  // Unnumbered taxonomy branches the plan defines but does not test.
  t_test('2b', 'FORMULARIZED — literal in A, formula in B', function () {
    const ga = t_filler(16), gb = t_filler(16);
    gb[6][1] = '=B2*3';
    const a = t_sheet(ga), b = t_sheet(gb);
    b.values[6][1] = 70;
    const changes = t_diffFixture(a, b);
    t_assertCount(changes, 'FORMULARIZED', 1);
    t_assertTotal(changes, 1);
    t_assertEqual(changes[0].old, '70', 'old is the A-side literal');
    t_assertEqual(changes[0].new, '=B2*3', 'new is the B-side A1 formula');
  });

  t_test('2c', 'REF_ERROR_NEW / REF_ERROR_FIXED direction', function () {
    const mk = function (formula, value) {
      const g = t_filler(16);
      g[5][1] = formula;
      const t = t_sheet(g);
      t.values[5][1] = value;
      return t;
    };
    const clean  = function () { return mk('=Rates!B4', 55); };
    const broken = function () { return mk('=Rates!#REF!', '#REF!'); };

    let c = t_diffFixture(clean(), broken());
    t_assertCount(c, 'REF_ERROR_NEW', 1);
    t_assertTotal(c, 1);

    c = t_diffFixture(broken(), clean());
    t_assertCount(c, 'REF_ERROR_FIXED', 1);
    t_assertTotal(c, 1);
  });

  t_test('2d', 'Inherited error — clean formula, value reads #REF!',
    function () {
    const mk = function () {
      const g = t_filler(16);
      g[5][1] = '=Assumptions!C7';
      const t = t_sheet(g);
      t.values[5][1] = '#REF!';
      return t;
    };
    const changes = t_diffFixture(mk(), mk());
    t_assertCount(changes, 'REF_ERROR', 1);
    t_assertEqual(changes[0].new, '=Assumptions!C7',
                'inherited row still shows its own clean formula');
  });

  t_test('2e', 'HARDCODED wins over a broken formula in A', function () {
    const ga = t_filler(16), gb = t_filler(16);
    ga[5][1] = '=Rates!#REF!';
    gb[5][1] = 55;
    const a = t_sheet(ga);
    a.values[5][1] = '#REF!';
    const changes = t_diffFixture(a, t_sheet(gb));
    t_assertCount(changes, 'HARDCODED', 1);
    t_assertNone(changes, 'REF_ERROR_FIXED');
    t_assertEqual(changes[0].old, '=Rates!#REF!', 'the breakage stays visible');
  });

  t_test('2g', 'derivedSection off suppresses the section-2 rows entirely',
    function () {
    // This test used to cover includeDerived, which emitted these cells as
    // VALUE into the one and only table - precisely the merged output rule 13
    // exists to forbid. That switch is GONE rather than aliased: an alias would
    // have left a config key that quietly produces the output the revision
    // exists to prevent. Off means absent; on means section 2; there is no
    // third state.
    const ga = t_filler(16), gb = t_filler(16);
    ga[9][1] = '=B4*2';  gb[9][1] = '=B4*2';
    const a = t_sheet(ga), b = t_sheet(gb);
    a.values[9][1] = 20;  b.values[9][1] = 24;

    const on = t_diffFixture(a, b);
    t_assertCount(on, 'DERIVED_VALUE', 1);
    t_assertNone(on, 'VALUE');
    t_assertTotal(on, 1);

    t_assertTotal(t_diffFixture(a, b, t_opts({ derivedSection: false })), 0);
  });

  // Two branches reached by calling diffCell directly. Tests 22, 27 and 28 now
  // cover FORMULA_UNVERIFIED and VOLATILE_VALUE through the real pipeline, but
  // these stay: no fixture can produce ctx.maskA/maskB === undefined, because
  // diffTab always computes masks where rule 4 can use them, and that default
  // is the difference between over-reporting and silently losing an edit.

  t_test('2h', 'Rule 14 at the source: volatile is tested BEFORE derived',
    function () {
    const ctx = { fA1A: '=INDIRECT("Rates!B" & A1)',
                  fA1B: '=INDIRECT("Rates!B" & A1)', volatile: true };
    const r = diffCell(55, 77, 'R4C2', 'R4C2', ctx, OPTS);
    t_assertEqual(r.change, 'VOLATILE_VALUE', 'volatile ctx wins');
    t_assertEqual([r.old, r.new], ['55', '77'], 'values, not formulas');

    ctx.volatile = false;                    // contrast with test 4
    t_assertEqual(diffCell(55, 77, 'R4C2', 'R4C2', ctx, OPTS).change,
                'DERIVED_VALUE',
                'identical state, non-volatile: recalculation, not a move');

    t_assertEqual(diffCell(55, 77, 'R4C2', 'R4C2', ctx,
                         t_opts({ derivedSection: false })), null,
                'and with the section off, nothing at all');

    ctx.volatile = true;                     // values equal -> still no row
    t_assertEqual(diffCell(55, 55, 'R4C2', 'R4C2', ctx, OPTS), null,
                'volatile but unchanged value emits nothing');
  });

  t_test('2i', 'FORMULA_UNVERIFIED only when the masked forms match',
    function () {
    const base = { fA1A: '=Rates!$B$4', fA1B: '=Rates!$B$5' };
    const mk = function (mA, mB) {
      const c = { fA1A: base.fA1A, fA1B: base.fA1B };
      if (mA !== undefined) { c.maskA = mA; c.maskB = mB; }
      return diffCell(1, 1, 'Rates!R4C2', 'Rates!R5C2', c, OPTS).change;
    };
    t_assertEqual(mk('Rates!R#C2', 'Rates!R#C2'), 'FORMULA_UNVERIFIED',
                'both references unverifiable');
    t_assertEqual(mk('Rates!R#C2*2', 'Rates!R#C2'), 'FORMULA',
                'a real edit survives masking — test 24 in miniature');
    t_assertEqual(mk(), 'FORMULA',
                'absent masks default to FORMULA, never to unverified');
  });

}
