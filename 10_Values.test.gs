/**
 * 10_Values.test.gs - the value layer.
 *
 * These three exist because valuesEqual and errorState decide, between them,
 * whether a cell is a change at all. Everything downstream is classification.
 */

function t_values_tests() {

  t_test(9, 'Date cell unchanged between files -> 0 rows', function () {
    const ga = t_filler(16), gb = t_filler(16);
    ga[4][1] = new Date(2026, 0, 15);
    gb[4][1] = new Date(2026, 0, 15);           // distinct object, same instant
    t_assertTotal(t_diffFixture(t_sheet(ga), t_sheet(gb)), 0);
  });

  t_test(11, '#DIV/0! in B where A had a number -> 1 VALUE, not REF_ERROR',
    function () {
    const ga = t_filler(16), gb = t_filler(16);
    ga[8][1] = 90;  gb[8][1] = '#DIV/0!';
    const changes = t_diffFixture(t_sheet(ga), t_sheet(gb));
    t_assertCount(changes, 'VALUE', 1);
    t_assertNone(changes, 'REF_ERROR');
    t_assertNone(changes, 'REF_ERROR_NEW');
    t_assertTotal(changes, 1);
  });

  t_test('2f', 'valuesEqual — epsilon, trim, Date, mixed types',
    function () {
    t_assertEqual(valuesEqual(1, 1 + 1e-12, OPTS), true, 'below epsilon');
    t_assertEqual(valuesEqual(1, 1.1, OPTS), false, 'above epsilon');
    t_assertEqual(valuesEqual(' a ', 'a', OPTS), true, 'trimmed');
    t_assertEqual(valuesEqual(new Date(0), new Date(0), OPTS), true, 'dates');
    t_assertEqual(valuesEqual(new Date(0), '1970', OPTS), false, 'date vs string');
    t_assertEqual(valuesEqual('', '', OPTS), true, 'both empty');
    t_assertEqual(valuesEqual(0, '', OPTS), false, 'zero is not empty');
  });

}
