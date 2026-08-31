/**
 * ============================================================================
 * 99_TestRunner.gs — the runner, and the two numbers it is TOLD to expect
 * ============================================================================
 *
 * THE RUNNER MUST NOT COMPUTE ITS OWN TOTAL. The previous build did: it
 * reported "33 total" because it happened to hold 33 numeric ids, and stayed
 * green for the entire period in which the plan's acceptance table ran to 38
 * and five tests were simply absent. A suite that grades itself measures
 * nothing.
 *
 * So the totals below are DECLARED, and the run fails when they are not met —
 * naming the missing ids by number, because "5 missing" sends someone hunting
 * and "missing 34, 35, 36, 37, 38" does not.
 *
 * This is also the only defence against the failure mode a multi-file test
 * layout introduces: a .test.gs file whose suite is never registered in
 * t_registerAll_ below contributes nothing, fails nothing, and says nothing.
 * To confirm the defence still works, comment out one line of t_registerAll_
 * and check that the run goes red.
 */

/** The plan's acceptance-test table. Numeric ids must cover 1..38 exactly. */
const T_PLAN_TOTAL = 38;

/** Local tests of branches the plan defines but does not number. */
const T_LOCAL_TOTAL = 49;

/**
 * The explicit registration list. One line per .test.gs file, in load order.
 *
 * It is a function rather than a top-level array on purpose: a top-level const
 * holding references to functions declared in other files would work today
 * (declarations hoist across the shared scope) and is exactly the shape plan
 * §1.1a warns about. Building the list at call time removes the question.
 */
function t_registerAll_() {
  T_TESTS.length = 0;
  t_suite('10_Values',   t_values_tests);
  t_suite('30_DiffCell', t_diffCell_tests);
  t_suite('20_Align',    t_align_tests);
  t_suite('21_Relocate', t_relocate_tests);
  t_suite('31_DiffTab',  t_diffTab_tests);
  t_suite('50_Csv',      t_csv_tests);
  t_suite('40_Pair',     t_pair_tests);
  t_suite('41_Names',    t_names_tests);
  t_suite('70_Compare',  t_compare_tests);
  t_suite('90_Main',     t_main_tests);
}

/**
 * Runs every registered test and logs PASS / FAIL per test, with
 * expected-vs-actual on failure, then asserts both declared totals.
 *
 * Needs no spreadsheet and raises no authorisation prompt. If one appears, a
 * Google-service call has been added outside 90_Main.gs.
 */
function runTests() {
  t_registerAll_();

  const lines = [];
  let pass = 0, fail = 0;

  for (let i = 0; i < T_TESTS.length; i++) {
    const t = T_TESTS[i];
    T_STATE = { failures: [] };
    let thrown = null;
    try {
      t.fn();
    } catch (e) {
      thrown = (e && e.stack) ? e.stack : String(e);
    }
    if (thrown) T_STATE.failures.push('THREW ' + thrown);

    if (T_STATE.failures.length === 0) {
      pass++;
      lines.push('PASS  ' + t_pad('#' + t.n, 5) + ' ' + t.name);
    } else {
      fail++;
      lines.push('FAIL  ' + t_pad('#' + t.n, 5) + ' ' + t.name);
      for (let k = 0; k < T_STATE.failures.length; k++) {
        lines.push('        ' + T_STATE.failures[k]);
      }
    }
  }
  T_STATE = null;

  for (let i = 0; i < T_PENDING.length; i++) {
    lines.push('PEND  ' + t_pad('#' + T_PENDING[i].n, 5) + ' ' +
               T_PENDING[i].name + '   (needs step ' + T_PENDING[i].step + ')');
  }

  // ---- the coverage assertions ------------------------------------------
  const planIds = [], localIds = [];
  for (let i = 0; i < T_TESTS.length; i++) {
    if (typeof T_TESTS[i].n === 'number') planIds.push(T_TESTS[i].n);
    else localIds.push(T_TESTS[i].n);
  }
  for (let i = 0; i < T_PENDING.length; i++) {
    if (typeof T_PENDING[i].n === 'number') planIds.push(T_PENDING[i].n);
  }

  const seen = {};
  const missing = [], duplicated = [], outOfRange = [];
  for (let i = 0; i < planIds.length; i++) {
    const n = planIds[i];
    if (n < 1 || n > T_PLAN_TOTAL) outOfRange.push(n);
    if (seen[n]) duplicated.push(n); else seen[n] = true;
  }
  for (let n = 1; n <= T_PLAN_TOTAL; n++) if (!seen[n]) missing.push(n);

  const problems = [];
  if (missing.length) {
    problems.push('plan acceptance tests: missing ' + missing.join(', '));
  }
  if (duplicated.length) {
    problems.push('plan acceptance tests: duplicated ' + duplicated.join(', '));
  }
  if (outOfRange.length) {
    problems.push('plan acceptance tests: id outside 1..' + T_PLAN_TOTAL + ': ' +
                  outOfRange.join(', '));
  }
  if (localIds.length !== T_LOCAL_TOTAL) {
    problems.push('local tests: expected ' + T_LOCAL_TOTAL + ', found ' +
                  localIds.length +
                  (localIds.length < T_LOCAL_TOTAL
                    ? ' — a suite is probably unregistered in t_registerAll_'
                    : ''));
  }

  lines.push('');
  lines.push(pass + ' passed, ' + fail + ' failed, ' + T_PENDING.length +
             ' pending.');
  lines.push('Plan acceptance tests: ' + planIds.length + ' of ' +
             T_PLAN_TOTAL + ' declared.');
  lines.push('Local tests of unnumbered branches: ' + localIds.length + ' of ' +
             T_LOCAL_TOTAL + ' declared.');
  for (let i = 0; i < problems.length; i++) lines.push('FAIL — ' + problems[i]);
  if (!problems.length && !fail) {
    lines.push('OK — ' + (pass) + ' tests, both declared totals met.');
  }

  const report = lines.join('\n');
  if (typeof console !== 'undefined' && console.log) console.log(report);
  return report;
}
