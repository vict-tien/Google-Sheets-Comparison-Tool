/**
 * 50_Csv.test.gs - Step 6 and the section boundary.
 *
 * 35, 36 and 37 are the three ways the two-block layout goes wrong, and only
 * one of them fails loudly.
 *
 *   35 asserts POSITION. An implementation that emits every row into one
 *      merged table satisfies every count in it; the marker-relative loops are
 *      what fail it.
 *   36 asserts ABSENCE, byte for byte. "Almost identical" is meant to fail.
 *   37 asserts ORDER OF OPERATIONS. Truncating before the sort satisfies the
 *      count and produces a file whose contents depend on nothing stable.
 */

function t_csv_tests() {

  t_test(8, 'CSV — comma, quote and newline survive as one field',
    function () {
    const csv = toCsv([{ tab: 'T', change: 'VALUE', aRef: 'B2', bRef: 'B2',
                         column: 'Cost', old: 'a,b',
                         new: 'say "hi"\nthere' }]);
    const lines = csv.split('\n');
    t_assertEqual(lines[0], CSV_HEADER, 'header, exactly');
    t_assertEqual(lines[1], 'T,VALUE,B2,B2,Cost,"a,b","say ""hi""',
                'comma quoted, inner quotes doubled');
    t_assertEqual(lines[2], 'there"',
                'the newline stays inside the quoted field');
    t_assertEqual(csvField('=1+1'), "'=1+1", 'leading = is neutralised');
    t_assertEqual(csvField('=A1,B1'), '"\'=A1,B1"',
                'the prefix lands OUTSIDE the quotes, where it works');
    t_assertEqual(csvField(null), '', 'null is an empty field');
  });

  t_test(33, 'Broken chain -> root and inherited both emitted, root sorts ' +
              'first, and BOTH are section 1',
    function () {
    // Both cells are broken in BOTH files, so every rule except the error
    // check would suppress the pair entirely.
    const mk = function () {
      return t_workbook({
        // HVAC first, so workbook order alone would put the inherited row on
        // top. Only the sort puts the root there.
        HVAC: t_plant(16, [[9, 2, '=Assumptions!$C$7', '=Assumptions!R7C3',
                            '#REF!']]),
        Assumptions: t_plant(16, [[6, 2, '=Rates!#REF!', '=Rates!#REF!',
                                   '#REF!']])
      });
    };
    const changes = t_cmp(mk(), mk()).changes;
    t_assertCount(changes, 'REF_ERROR', 2);
    t_assertTotal(changes, 2);

    // AN ERROR IS NEVER DERIVED. Both cells have identical formulas AND
    // identical values, which is exactly the shape rule 5 routes to section 2 -
    // and rule 3 sits above rule 5, so they never reach it.
    t_assertEqual(changes.map(function (c) { return sectionOf(c); }), [1, 1],
                'both in section 1');

    const lines = toCsv(changes).split('\n');
    t_assertEqual(lines.length, 3, 'one header and two rows: no second table');
    t_assertEqual(lines[1].indexOf('Assumptions,REF_ERROR') === 0, true,
                'root first: ' + lines[1]);
    t_assertEqual(lines[1].indexOf("'=Rates!#REF!") > 0, true,
                'a root row carries a formula: ' + lines[1]);
    t_assertEqual(lines[2].indexOf('HVAC,REF_ERROR') === 0, true,
                'inherited second: ' + lines[2]);
  });

  t_test(35, 'Two blocks: section 1 error-first and two rows long, every ' +
              'DERIVED_VALUE below the marker and none above it',
    function () {
    // 40 recalculated cells over two formula columns, plus one authored
    // formula edit and one reference that broke. Row hashes ignore formula
    // cells, so all 40 recalculations leave the alignment untouched.
    const build = function (bump, edited, broken, brokenVal) {
      const cells = [];
      for (let i = 0; i < 20; i++) {
        cells.push([i, 2, '=B' + (i + 1) + '*2', '=RC[-1]*2', 100 + i + bump]);
        cells.push([i, 3, '=B' + (i + 1) + '*3', '=RC[-2]*3', 300 + i + bump]);
      }
      cells.push([5, 4, edited, edited, 7]);
      cells.push([7, 5, broken, broken, brokenVal]);
      return t_workbook({ T: t_plant(20, cells) });
    };
    const A = build(0, '=B6*2', '=Rates!$B$4', 9);
    const B = build(1, '=B6*3', '=Rates!#REF!', '#REF!');
    const changes = t_cmp(A, B).changes;
    t_assertCount(changes, 'DERIVED_VALUE', 40);
    t_assertCount(changes, 'FORMULA', 1);
    t_assertCount(changes, 'REF_ERROR_NEW', 1);
    t_assertTotal(changes, 42);

    const csv = toCsv(changes, OPTS).split('\n');
    const marker = csv.indexOf(CSV_SECTION_2_MARKER);
    t_assertEqual(csv[0], CSV_HEADER, 'section 1 header');
    t_assertEqual(marker, 4, 'header, 2 rows, blank line, marker');
    t_assertEqual(csv[marker - 1], '', 'a blank line separates the tables');
    t_assertEqual(csv[marker + 1], CSV_HEADER, 'the header is repeated');
    t_assertEqual(csv[1].split(',')[1], 'REF_ERROR_NEW', 'error first: ' + csv[1]);
    t_assertEqual(csv[2].split(',')[1], 'FORMULA', 'then the authored edit');

    // POSITION, NOT PRESENCE. Every count above is satisfied by an
    // implementation that emits all 42 rows into one merged table; only these
    // two loops fail it.
    for (let i = 1; i < marker; i++) {
      t_assertEqual(csv[i].indexOf('DERIVED_VALUE'), -1,
                  'no DERIVED_VALUE above the marker: ' + csv[i]);
    }
    let below = 0;
    for (let i = marker + 2; i < csv.length; i++) {
      if (csv[i].split(',')[1] === 'DERIVED_VALUE') below++;
    }
    t_assertEqual(below, 40, 'all 40 sit below the repeated header');
    t_assertEqual(csv.length, marker + 2 + 40, 'and nothing else does');
  });

  t_test(36, 'derivedSection: false reproduces the pre-revision file exactly',
    function () {
    // Test 34's fixture with the section switched off. The pre-revision output
    // for it was one header line and nothing else, so that is what
    // byte-identity means here - and "almost identical" is meant to fail: a
    // stray blank line, or an empty second block carrying its marker and
    // repeated header, is precisely the regression this guards. The file-level
    // comparison against the captured golden CSV is Step 11's job.
    const mk = function (v) {
      return t_workbook({ T: t_plant(16, [[9, 2, '=B4*2', '=R4C2*2', v]]) });
    };
    const off = t_opts({ derivedSection: false });
    const changes = t_cmp(mk(20), mk(24), off).changes;
    t_assertTotal(changes, 0);

    const csv = toCsv(changes, off);
    t_assertEqual(csv, CSV_HEADER, 'the whole file, exactly');
    t_assertEqual(csv.indexOf('#'), -1, 'no marker');
    t_assertEqual(csv.indexOf('\n'), -1, 'no blank line and no second header');
  });

  t_test(37, 'derivedCap truncates AFTER sorting: section 1 untouched, the ' +
              'file deterministic, a re-run identical',
    function () {
    const build = function (bump, edit) {
      const g = t_filler(25);
      if (edit) g[6][1] = 999;
      const cells = [];
      for (let i = 0; i < 25; i++) {
        cells.push([i, 2, '=B' + (i + 1) + '*2', '=RC[-1]*2', 100 + i + bump]);
      }
      return t_workbook({ T: t_plantG(g, cells) });
    };
    const changes = t_cmp(build(0, false), build(1, true)).changes;
    t_assertCount(changes, 'VALUE', 1);
    t_assertCount(changes, 'DERIVED_VALUE', 25);
    t_assertTotal(changes, 26);

    const capped = t_opts({ derivedCap: 10 });
    const csv = toCsv(changes, capped);
    const L = csv.split('\n');
    const marker = L.indexOf(CSV_SECTION_2_MARKER);

    // A section 2 cap does not reach into section 1.
    t_assertEqual(L.slice(1, marker - 1).length, 1, 'the one VALUE row survives');
    t_assertEqual(L[1].split(',')[1], 'VALUE', L[1]);

    const body = L.slice(marker + 2);
    t_assertEqual(body.length, 11, '10 kept rows plus the truncation row');
    t_assertEqual(body[10],
                ',DERIVED_TRUNCATED,,,,,15 further derived rows suppressed ' +
                '\u2014 raise OPTS.derivedCap',
                'the truncation row names the count and the remedy');

    // TRUNCATED AFTER THE SORT, so the kept rows are the first ten in workbook
    // order. Truncating before the sort passes every count above, and fails
    // this - and fails the re-run check below intermittently, which is worse.
    const kept = body.slice(0, 10).map(function (l) { return l.split(',')[2]; });
    t_assertEqual(kept, ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9',
                       'C10'], 'the first ten in workbook order');
    t_assertEqual(toCsv(changes, capped), csv, 'a re-run is byte-identical');
  });

  t_test('6a', 'Error rows sort NEW, then FIXED, then pre-existing, above ' +
                 'everything else',
    function () {
    const r = function (tab, change, oldV, newV) {
      return { tab: tab, change: change, aRef: '', bRef: '', column: '',
               old: oldV || '', new: newV || '' };
    };
    const csv = toCsv([
      r('T', 'VALUE'),
      r('T', 'REF_ERROR', '#REF!', '#REF!'),          // inherited
      r('T', 'REF_ERROR_FIXED', '=A!#REF!', '=A!B1'), // root
      r('T', 'HARDCODED'),
      r('T', 'REF_ERROR_NEW', '=A!B1', '=A!#REF!')    // root
    ]);
    const order = csv.split('\n').slice(1).map(function (l) {
      return l.split(',')[1];
    });
    t_assertEqual(order, ['REF_ERROR_NEW', 'REF_ERROR_FIXED', 'REF_ERROR',
                        'VALUE', 'HARDCODED'],
                'roots first, then inherited, then workbook order');
  });

}
