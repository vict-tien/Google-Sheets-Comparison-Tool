/**
 * ============================================================================
 * 41_Names.gs — defined names, and the one change nothing else can see
 * ============================================================================
 *
 * A defined name is the only edit in this tool's world that changes what a
 * model computes while leaving EVERY formula byte-identical in both files.
 * Repoint `BaseRate` from Rates!$B$4 to Rates!$B$9 and every `=BaseRate*2`
 * still reads `=BaseRate*2`. Values move, the diff is silent, and no other pass
 * in this build can see it — cell comparison has nothing to compare, and the
 * reference engine never resolves the name because a name is not a coordinate.
 *
 * SCOPE, DELIBERATELY: REDEFINITION ONLY. Names added in B and names deleted
 * from A are NOT reported, and that is a decision rather than an omission. A
 * deleted name that is still used breaks its formulas, and those surface as
 * #NAME? through the error scan (§4h) — reporting the name too would double-
 * count one event. A name added and not yet used changes nothing. The
 * invisible case is the one that needs a row.
 *
 * THIS PASS MUST RUN AFTER ALIGNMENT, and 70_Compare.gs is where that ordering
 * is enforced. A definition has to be RELOCATED before it is compared: insert a
 * row above Rates!4 and B's copy of every name below it legitimately reads one
 * row lower. Compare the two raw and each of them reports as redefined — the
 * exact false-positive class Step 4 exists to suppress, walking back in through
 * a new door. Test '9b' is that guard, and it is the reason this file exists
 * rather than a dozen lines inside compareWorkbooks.
 *
 * WHERE THE MAP IS MISSING THE PAIR IS REPORTED, NOT SUPPRESSED. Same direction
 * as doc §4.4's rule for an absent mask: over-reporting is visible and a reader
 * can dismiss it; under-reporting is silent and nobody ever learns.
 */

/**
 * Names are keyed on scope AND name, because the same name can exist once at
 * workbook scope and once per sheet. Chosen for the same reason as
 * HASH_CELL_SEP: no scope or name can contain it.
 */
const NAME_KEY_SEP = String.fromCharCode(2);

function nameKey_(scope, name) {
  return String(scope || '') + NAME_KEY_SEP + String(name);
}

/**
 * A DefinedName's target as A1 text, for the CSV's `old` / `new`.
 *
 * A single cell renders as `Rates!B4`, a block as `Rates!B2:C4`. The sheet
 * prefix goes through sheetPrefix_ (11_Refs.gs) rather than being quoted here,
 * so this and formatRef_ cannot disagree about when a name needs quotes.
 */
function nameTargetA1_(d) {
  if (!d || !d.sheet) return '';
  const rows = (d.numRows === undefined) ? 1 : d.numRows;
  const cols = (d.numCols === undefined) ? 1 : d.numCols;
  const ref = (rows === 1 && cols === 1)
    ? a1(d.row, d.col)
    : a1(d.row, d.col) + ':' + a1(d.row + rows - 1, d.col + cols - 1);
  return sheetPrefix_(d.sheet) + ref;
}

/**
 * Rewrites A's definition into the coordinates it WOULD have if B's edits had
 * been made to A. The same rule relocate() applies to a formula, on a target
 * that happens to be structured rather than textual:
 *
 *   sheet -> tables.tabMap[sheet]                 (rule 5: renamed tabs)
 *   row   -> tables.rowMaps[sheet].get(row)       (rule 3: moved rows)
 *
 * `rowMaps` is keyed on A's tab names and valued in SHEET rows, which is what a
 * definition's row already is — no index conversion, and none wanted.
 *
 * Where the map is absent, or has no entry for this row, the row is left ALONE
 * rather than guessed. See this file's header for why that direction is right.
 */
function relocateName_(d, tabMap, rowMaps) {
  const sheet = (tabMap[d.sheet] !== undefined) ? tabMap[d.sheet] : d.sheet;
  let row = d.row;
  const map = rowMaps[d.sheet];
  if (map) {
    const mapped = map.get(d.row);
    if (mapped !== undefined) row = mapped;
  }
  return { sheet: sheet, row: row, col: d.col,
           numRows: d.numRows, numCols: d.numCols };
}

/** Target equality, with the two extents defaulting to a single cell. */
function sameTarget_(x, y) {
  const n = function (v) { return (v === undefined) ? 1 : v; };
  return x.sheet === y.sheet && x.row === y.row && x.col === y.col &&
         n(x.numRows) === n(y.numRows) && n(x.numCols) === n(y.numCols);
}

/**
 * Compares two workbooks' defined names and returns NAME_REDEFINED rows.
 *
 * The row uses the seven columns that already exist, with no eighth:
 *   tab    the scope — B's tab name for a sheet-scoped name, '' for workbook
 *   column THE NAME ITSELF
 *   old    what A's definition says, unrelocated — a reader wants what is in
 *          the file they have, not what this pass computed about it
 *   new    what B's definition says
 */
function diffNames(namesA, namesB, tables) {
  namesA = namesA || [];
  namesB = namesB || [];
  tables = tables || {};
  const tabMap  = tables.tabMap  || {};
  const rowMaps = tables.rowMaps || {};
  const out = [];

  const bIndex = {};
  for (let i = 0; i < namesB.length; i++) {
    bIndex[nameKey_(namesB[i].scope, namesB[i].name)] = namesB[i];
  }

  for (let i = 0; i < namesA.length; i++) {
    const a = namesA[i];
    const scopeA = a.scope || '';
    // A sheet-scoped name travels with its tab. Key on A's scope and a renamed
    // tab makes every one of its names an unmatched pair, silently.
    const scopeB = (scopeA === '')
      ? ''
      : (tabMap[scopeA] !== undefined ? tabMap[scopeA] : scopeA);

    const b = bIndex[nameKey_(scopeB, a.name)];
    if (!b) continue;                       // added / deleted — see the header

    if (sameTarget_(relocateName_(a, tabMap, rowMaps), b)) continue;

    out.push({ tab: scopeB, change: 'NAME_REDEFINED', aRef: '', bRef: '',
               column: a.name,
               old: nameTargetA1_(a), new: nameTargetA1_(b) });
  }

  return out;
}
