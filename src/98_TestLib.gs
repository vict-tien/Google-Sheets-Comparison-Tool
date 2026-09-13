/**
 * ============================================================================
 * 98_TestLib.gs — fixtures, assertions, and suite registration
 * ============================================================================
 *
 * EVERY GLOBAL IN THE HARNESS IS PREFIXED `t_` (functions) OR `T_` (state).
 * That is not tidiness. In one file, a collision between a test helper and a
 * production function is a visible redeclaration error. Across twenty-three
 * files it is a SILENT last-one-wins overwrite with no error at all, and the
 * symptom is a test passing against the wrong helper. `sheet`, `fixture` and
 * `workbook` are the live hazards — all three are plausible production names.
 *
 * t_pad and padR_ (60_Summary.gs) are DIFFERENT FUNCTIONS with identical
 * bodies: one is the harness's left-aligner, one is the summary's. The prefix
 * is what makes that non-confusable. Do not merge them — the summary's column
 * layout and the harness's report layout have no reason to move together.
 *
 * The fixture builders live here rather than beside one test file because every
 * test file needs them.
 */

// --- suite registration ----------------------------------------------------
//
// A .test.gs file declares one function that calls t_test for each of its
// tests. 99_TestRunner.gs holds the EXPLICIT list of those functions and calls
// them. An unregistered suite therefore contributes nothing and says nothing —
// the failure mode a multi-file project will hit sooner or later — and the only
// defence is the declared totals the runner asserts. There is no auto-discovery
// here on purpose: auto-discovery would hide the very thing the totals check.

const T_TESTS = [];

/**
 * Acceptance tests whose implementation step is not built yet. They are listed
 * as PENDING and are NOT counted as passes. Empty: all 38 now run.
 */
const T_PENDING = [];

let T_STATE = null;
let T_SUITE = null;

/** Runs one .test.gs file's registration function with its name attached. */
function t_suite(name, body) {
  T_SUITE = name;
  body();
  T_SUITE = null;
}

/**
 * Registers one test.
 *
 * `n` is NUMERIC only for a test in the plan's acceptance table — the runner
 * counts numeric ids against T_PLAN_TOTAL and string ids ('2b', '10a') against
 * T_LOCAL_TOTAL. Using a number for a local test silently inflates plan
 * coverage, which is the exact failure the declared totals exist to catch.
 */
function t_test(n, name, fn) {
  T_TESTS.push({ n: n, name: name, fn: fn, suite: T_SUITE });
}


/**
 * A TabData fixture. Plan Step 1.
 *   t_fixture(values, fR1C1, fA1, rowOffset, colOffset)
 * fR1C1 / fA1 default to same-shaped grids of ''.
 */
function t_fixture(values, fR1C1, fA1, rowOffset, colOffset) {
  return {
    values: values,
    fR1C1: fR1C1 || t_emptyFormulas(values),
    fA1:   fA1   || t_emptyFormulas(values),
    rowOffset: rowOffset || 1,
    colOffset: colOffset || 1
  };
}

/** Same-shaped grid of ''. */
function t_emptyFormulas(values) {
  return values.map(function (row) {
    return row.map(function () { return ''; });
  });
}

/**
 * Multi-tab workbook fixture. Plan Step 1 requires this now rather than as a
 * Step 9 retrofit — tests 18 and 21-33 need at least three tabs each.
 *
 *   t_workbook({ Rates: t_fixture(...), Fleet: t_fixture(...) })
 *
 * Returns { tabs: {name: TabData}, names: [...] } with insertion order kept,
 * which is what pairTabs (Step 7) will consume.
 */
function t_workbook(tabs) {
  const names = Object.keys(tabs);
  for (let i = 0; i < names.length; i++) {
    const t = tabs[names[i]];
    if (!t || !t.values || !t.fR1C1 || !t.fA1) {
      throw new Error('t_workbook(): tab "' + names[i] + '" is not a TabData fixture');
    }
  }
  return { tabs: tabs, names: names };
}

/**
 * Builds a TabData from a compact spec: a grid where any string starting with
 * '=' becomes a formula. `r1c1` supplies the R1C1 forms positionally; where it
 * is omitted the A1 text is reused, which is fine for tests that never compare
 * across a row shift.
 *
 *   t_sheet([['Label', 10], ['Total', '=SUM(B1:B1)']])
 */
function t_sheet(grid, r1c1, rowOffset, colOffset) {
  const values = [], fA1 = [], fR = [];
  for (let r = 0; r < grid.length; r++) {
    const vr = [], ar = [], rr = [];
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (typeof cell === 'string' && cell.charAt(0) === '=') {
        vr.push('');           // tests that care about the value set it explicitly
        ar.push(cell);
        rr.push((r1c1 && r1c1[r] && r1c1[r][c] !== undefined) ? r1c1[r][c] : cell);
      } else {
        vr.push(cell === undefined || cell === null ? '' : cell);
        ar.push('');
        rr.push('');
      }
    }
    values.push(vr); fA1.push(ar); fR.push(rr);
  }
  return t_fixture(values, fR, fA1, rowOffset, colOffset);
}

/**
 * One tab against one tab, through the WHOLE pipeline — pairing, alignment,
 * relocation, masking, comparison. The shape most single-tab tests want.
 *
 * This replaced the walkAligned_ scaffolding that stood in for Step 5 while it
 * did not exist. Every test written against the scaffolding now runs against
 * the real diffTab, which is the point: the scaffolding never relocated, never
 * masked, never checked headers and never scanned unaligned tabs, so a test
 * that passed under it proved less than it looked like it did.
 */
function t_diffFixture(tabA, tabB, opts) {
  return t_cmp(t_workbook({ T: tabA }), t_workbook({ T: tabB }), opts).changes;
}

/**
 * OPTS with overrides.
 *
 * Tests must NOT hand-roll an opts literal. One that omits a key takes
 * `undefined` for it, and `undefined` reads as OFF for derivedSection and as NO
 * CAP for derivedCap — two different behaviours, neither of them the default
 * the test meant. Three tests carried a six-key literal each before this
 * existed, and every key added to OPTS since would have had to be added to all
 * three by hand.
 */
function t_opts(over) {
  const o = {};
  Object.keys(OPTS).forEach(function (k) { o[k] = OPTS[k]; });
  Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
  return o;
}

/** Multi-tab: the full two-phase compare over two workbook fixtures. */
function t_cmp(wbA, wbB, opts) {
  return compareWorkbooks(wbA, wbB, opts || OPTS);
}

/**
 * Builds a padded filler grid: `n` rows of [label i, i*10]. Tabs need ~16 rows
 * before an isolated one-cell edit stops tripping the edit-distance cap
 * (2 / (2n) <= 0.30 needs n >= 4, and several spread edits need many more).
 */
function t_filler(n, startAt) {
  const g = [];
  for (let i = 0; i < n; i++) {
    const k = (startAt || 1) + i;
    g.push(['Row ' + k, k * 10]);
  }
  return g;
}

/**
 * Plants formulas into a grid and returns the TabData.
 *
 *   t_plantG(grid, [[rowIdx, colIdx, a1Formula, r1c1Formula, value], ...])
 *
 * The R1C1 form is given explicitly because that is what Step 4 operates on and
 * what the tests are actually about — a fixture that let A1 stand in for R1C1
 * would be testing nothing. `value` is the formula cell's displayed result.
 * Rows are padded to a common width so the grid stays rectangular.
 */
function t_plantG(grid, cells, rowOffset, colOffset) {
  const r1c1 = [];
  for (let i = 0; i < cells.length; i++) {
    const r = cells[i][0], c = cells[i][1];
    while (grid[r].length <= c) grid[r].push('');
    grid[r][c] = cells[i][2];
    if (!r1c1[r]) r1c1[r] = [];
    r1c1[r][c] = cells[i][3];
  }
  let w = 0;
  for (let i = 0; i < grid.length; i++) w = Math.max(w, grid[i].length);
  for (let i = 0; i < grid.length; i++) while (grid[i].length < w) grid[i].push('');

  const t = t_sheet(grid, r1c1, rowOffset, colOffset);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i][4] !== undefined) t.values[cells[i][0]][cells[i][1]] = cells[i][4];
  }
  return t;
}

/** t_plantG over a fresh `n`-row filler grid. */
function t_plant(n, cells) {
  return t_plantG(t_filler(n), cells);
}

/** An `n`-row filler tab with one row inserted at array index `idx`. */
function t_inserted(n, idx, cells) {
  const g = t_filler(n);
  g.splice(idx, 0, ['Inserted', 999]);
  return t_plantG(g, cells || []);
}

/**
 * A stand-in for a Sheet, for the two Step 8 tests.
 *
 * readTab is the one I/O function whose contract is testable without a
 * spreadsheet: it calls five methods on getDataRange() and hands the results to
 * trimGrid. What the tests check is that the two OFFSETS survive that hand-off —
 * dropping them corrupts every absolute-row lookup in relocate() with no visible
 * symptom, which is the failure plan Step 8 calls out.
 *
 * It does not and cannot verify what the real API returns. That is plan §1.2 and
 * Step 11, both manual.
 */
function t_stubSheet(spec) {
  return {
    getDataRange: function () {
      return {
        getValues:        function () { return spec.values; },
        getFormulasR1C1:  function () { return spec.fR1C1; },
        getFormulas:      function () { return spec.fA1; },
        getRow:           function () { return spec.row; },
        getColumn:        function () { return spec.col; }
      };
    }
  };
}

/** A 20-row tab rewritten past the edit-distance cap — always skipped. */
function t_unalignable() {
  const g = t_filler(20);
  for (let i = 0; i < 9; i++) g[i * 2] = ['Wholly different ' + i, 5000 + i];
  return t_sheet(g);
}

// --- assertions ------------------------------------------------------------
//
// t_assertCount AND t_assertTotal, always both. A count alone permits extra
// rows to appear unnoticed, which is how a regression that ADDS output stays
// green — and adding output is exactly what turning section 2 on does.

function t_assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) t_fail(label + ': expected ' + e + ', got ' + a);
}

function t_assertCount(changes, type, n) {
  const got = changes.filter(function (c) { return c.change === type; });
  if (got.length !== n) {
    t_fail('expected ' + n + ' ' + type + ', got ' + got.length +
          ' [' + got.map(t_describe).join('; ') + ']');
  }
}

function t_assertNone(changes, type) {
  t_assertCount(changes, type, 0);
}

function t_assertTotal(changes, n) {
  if (changes.length !== n) {
    t_fail('expected ' + n + ' change(s) in total, got ' + changes.length +
          ' [' + changes.map(t_describe).join('; ') + ']');
  }
}

function t_fail(msg) {
  T_STATE.failures.push(msg);
}

function t_describe(c) {
  return c.change + '@' + (c.aRef || '-') + '/' + (c.bRef || '-') +
         ' "' + c.old + '"->"' + c.new + '"';
}

function t_pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}
