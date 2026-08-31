/**
 * ============================================================================
 * 01_Types.gs — the shapes that travel between modules
 * ============================================================================
 *
 * Declarations only; this file emits no code. It exists so the four
 * load-bearing properties of these shapes are written down once, next to the
 * shapes, rather than rediscovered from a call site.
 */

/**
 * One tab, read and trimmed. Plan §2.
 *
 * rowOffset / colOffset are SHEET coordinates of [0][0]. getDataRange() does
 * not necessarily start at A1; if the first populated cell is C5 they are 5 and
 * 3. trimGrid removes only TRAILING rows and columns, so the offsets alone fix
 * where the grid sits. Dropping colOffset misnames every emitted reference —
 * loud. Dropping rowOffset ALSO misnames every absolute-row lookup in
 * relocate(), and a formula relocated through a map keyed on the wrong rows
 * still looks like a formula — silent.
 *
 * @typedef {{ values:   Array<Array<*>>,
 *             fR1C1:    Array<Array<string>>,
 *             fA1:      Array<Array<string>>,
 *             rowOffset: number,
 *             colOffset: number }} TabData
 */

/**
 * What alignRows returns.
 *
 * TWO COORDINATE SPACES IN ONE OBJECT, on purpose. `pairs`, `added` and
 * `deleted` are ARRAY indices into the grids. `rowMap` is keyed and valued in
 * SHEET rows, because R1C1 absolute references are sheet-row numbers. Building
 * the map in index space returns wrong rows to relocate() with no error
 * anywhere — see 20_Align.test.gs '3d', which needs two DIFFERENT non-1 offsets
 * to detect it.
 *
 * A skipped alignment carries rowMap: null, and 70_Compare.gs then writes NO
 * entry for that tab. The ABSENCE is what maskUnresolvable keys on; a null
 * entry would read falsy there but throw on map.get() in relocate.
 *
 * @typedef {{ pairs:   Array<Array<number>>,
 *             added:   Array<number>,
 *             deleted: Array<number>,
 *             rowMap:  Map<number, number>|null,
 *             skipped: boolean,
 *             reason:  string }} Alignment
 */

/**
 * The two lookups Step 4 resolves per match.
 *
 * `rowMaps` is keyed on A's tab names. A skipped, added, deleted or unpaired
 * tab has no entry at all.
 *
 * @typedef {{ rowMaps: Object<string, Map<number, number>>,
 *             tabMap:  Object<string, string> }} Tables
 */

/**
 * One CSV row.
 *
 * THERE IS NO `section` FIELD, and there must not be one (plan §0.5). Section
 * membership is computed by sectionOf() in 50_Csv.gs from `change` alone. A
 * stored field is a second source of truth that no test can enforce.
 *
 * `_root` is not a CSV column either — it is errorState's root/inherited
 * classification riding along so toCsv's sort can order roots above inherited
 * errors. toCsv writes seven named fields and never enumerates the object, so
 * it cannot leak into the output.
 *
 * @typedef {{ tab: string, change: string, aRef: string, bRef: string,
 *             column: string, old: string, new: string,
 *             _root: (boolean|undefined) }} Change
 */

/**
 * One defined name, resolved to coordinates rather than left as text.
 *
 * STRUCTURED, NOT A STRING, and that is what lets 41_Names.gs relocate a
 * definition with no A1 parser and no R1C1 translator: the row is already a
 * SHEET row, which is exactly what rowMaps is keyed and valued in.
 *
 * `scope` is '' for a workbook-scoped name and the owning tab's name for a
 * sheet-scoped one. The Apps Script host reports every name as workbook-scoped
 * because the platform exposes no scope accessor on a named range — see
 * readNames_. (Spelled without the global's name on purpose: the purity grep in
 * CONTRIBUTING.md must keep naming one file, and a comment should not join it.)
 *
 * @typedef {{ name: string, scope: string, sheet: string,
 *             row: number, col: number,
 *             numRows: number, numCols: number }} DefinedName
 */

/**
 * `names` is the TAB name list; `definedNames` is the defined-name list. The
 * collision is why the second is not called `names` — they are different things
 * and one of them was here first.
 *
 * `definedNames` is optional: a workbook built without it compares exactly as
 * before and emits no NAME_REDEFINED rows.
 *
 * @typedef {{ tabs: Object<string, TabData>, names: Array<string>,
 *             definedNames: (Array<DefinedName>|undefined) }} Workbook
 */

/**
 * diffTab's only channel out to the summary. Every field exists because
 * buildSummary prints something that cannot be recovered from the Change rows:
 * `derived` counts section-2 rows for the DERIV column, `unverifiedTargets`
 * names tabs no Change row mentions, `absRefs` gates a warning about a silent
 * failure.
 *
 * PER-TYPE COUNTS ARE DELIBERATELY ABSENT. `emitted` knows how many section-1
 * cells were emitted but not how they were classified, and the root/inherited
 * split exists only on the rows. buildSummary tallies types from the rows.
 *
 * `emitted` counts SECTION 1 ONLY (rule 15). The noise ratio is emitted /
 * compared, and counting recalculated cells in it makes the warning fire on
 * every well-behaved connected model.
 *
 * @typedef {{ tab: string, renamedTo: string,
 *             compared: number, emitted: number, derived: number,
 *             relocated: number, volatileCells: number, volatileEmitted: number,
 *             unverified: number, unverifiedTargets: Object<string, number>,
 *             absRefs: number, noise: boolean,
 *             rowsAdded: number, rowsDeleted: number,
 *             colsAdded: number, colsDeleted: number,
 *             skipped: boolean, reason: string }} Stats
 */

/**
 * buildSummary's input. Every field but `result` is optional and degrades to a
 * placeholder, which is what lets the tests call it with no Drive file behind
 * it.
 *
 * @typedef {{ titleA: (string|undefined), titleB: (string|undefined),
 *             tabCountA: (number|undefined), tabCountB: (number|undefined),
 *             result: {changes: Array<Change>, tables: Tables,
 *                      results: Array<Stats>, pairing: Object},
 *             fileName: (string|undefined), fileUrl: (string|undefined),
 *             csvRows: (number|undefined),
 *             elapsedMs: (number|undefined) }} Report
 */
