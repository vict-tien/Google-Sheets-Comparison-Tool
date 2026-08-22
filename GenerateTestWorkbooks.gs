/**
 * ============================================================================
 * Google Sheets Diff Tool — TEST FIXTURE GENERATOR
 * ============================================================================
 *
 * Built from : "Google Sheets Difference Comparison Tool Implementation Plan.md"
 * Documented in: "Test Fixture Generator - Implementation Documentation.md"
 *   — expected output per tab, diagnostics for a failed run, and the reasoning
 *     behind the ordering constraints and row padding below.
 *
 * Creates TWO real Google Spreadsheets in a designated Drive folder:
 *
 *     <prefix> A   — the "old" revision
 *     <prefix> B   — the "new" revision
 *
 * Between them they exercise all 38 acceptance tests in the plan's
 * "Verification — acceptance tests" table, plus the COL_ADDED / TAB_ADDED /
 * TAB_DELETED / TAB_RENAMED paths.
 *
 * Tests 36 and 37 are OPTS variations rather than fixture content: they are
 * exercised by re-running the diff tool over the SAME pair of files with
 * derivedSection:false and with a lowered derivedCap. See §6.5 of the
 * documentation.
 *
 * ---------------------------------------------------------------------------
 * THE CENTRAL DESIGN DECISION
 * ---------------------------------------------------------------------------
 * B is not written cell-by-cell. B is a *copy* of A which is then MUTATED with
 * real structural operations — sheet.insertRowBefore(), sheet.deleteRow(),
 * sheet.setName(), sheet.deleteColumn() — and Google Sheets itself performs the
 * formula rewriting.
 *
 * This matters. Hand-writing "=Rates!$B$5" into B would be the generator's
 * *guess* at what Sheets does when a row is inserted in Rates. The whole point
 * of Step 4 (relocation) is to invert Sheets' real behaviour. A fixture built
 * from a guess tests the guess, not the tool. Letting Sheets do the rewrite
 * means the fixtures are authentic by construction — including the #REF!
 * tokens, which are produced by genuinely deleting the referenced rows rather
 * than by typing "#REF!" (which Sheets will not accept as formula input).
 *
 * Consequently the build order is load-bearing:
 *   1. Build every tab of A.
 *   2. Break the references that must be broken IN BOTH files (delete rows in
 *      'Ref Src A'). Pre-existing errors must exist before the copy is taken.
 *   3. Copy A -> B.
 *   4. Mutate B. Errors created here are B-only (REF_ERROR_NEW).
 *
 * ---------------------------------------------------------------------------
 * TAB SIZING — why every tab has ~16-20 rows for a 1-cell edit
 * ---------------------------------------------------------------------------
 * Step 3.3 skips a tab when
 *     editDistance = (unmatchedA + unmatchedB) / (lenA + lenB) > editDistanceCap
 * With editDistanceCap = 0.30, a 4-row tab with one edited label scores
 * 2/8 = 0.25 (passes) but a 3-row tab scores 2/6 = 0.33 (skips). Fixtures are
 * therefore padded so that no intentional edit accidentally trips the guard and
 * turns an expected VALUE row into a TAB_SKIPPED. See §5.1 of
 * "Test Fixture Generator - Implementation Documentation.md" — the
 * denominator has to be the FULL row counts, not the post-trim middle window,
 * or every isolated edit skips its own tab.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   1. script.google.com -> New project -> paste this file.
 *   2. Set CONFIG.FOLDER_ID (or leave '' to create a folder in My Drive root).
 *   3. Run generateTestWorkbooks(). Authorise Sheets + Drive on first run.
 *   4. Copy the two URLs from the execution log into the diff tool's
 *      Project Settings -> Script Properties, as URL_A and URL_B. They are
 *      NOT source constants any more (plan §1.1f).
 *
 * Runtime ~60-90s. Read-only with respect to everything except the two files
 * it creates.
 */

// ===========================================================================
// CONFIG
// ===========================================================================

// Bumped by hand whenever the fixture set changes. Stamped into both file
// names for the same reason the diff tool stamps VERSION into its CSV
// (plan §1.1e): when a six-week-old CSV disagrees with today's, the first
// question is whether the fixtures moved underneath it.
const FIXTURE_VERSION = '1.1.0';

const CONFIG = {
  // Drive folder to write into. Leave '' to create/reuse FOLDER_NAME in the
  // root of My Drive. Accepts a bare folder ID or a full folder URL.
  FOLDER_ID: '',
  FOLDER_NAME: 'Sheets Diff Tool - Test Fixtures',

  // File names. Suffixes ' A' and ' B' are appended.
  NAME_PREFIX: 'Diff Fixture',

  // Append a -YYYYMMDD-HHMM stamp so repeat runs do not collide.
  TIMESTAMP_NAMES: true
};

// Guard for trashGeneratedWorkbooks(). Must be set to true in the editor
// before that function will delete anything.
const CONFIRM_TRASH = false;

// ===========================================================================
// ENTRY POINT
// ===========================================================================

/**
 * Builds both fixture workbooks. This is the function to run.
 */
function generateTestWorkbooks() {
  const folder = resolveFolder_();
  const stamp = ' v' + FIXTURE_VERSION +
                (CONFIG.TIMESTAMP_NAMES ? ' ' + timestamp_() : '');
  const nameA = CONFIG.NAME_PREFIX + ' A' + stamp;
  const nameB = CONFIG.NAME_PREFIX + ' B' + stamp;

  // --- 1. Build A -------------------------------------------------------
  const ssA = SpreadsheetApp.create(nameA);
  DriveApp.getFileById(ssA.getId()).moveTo(folder);
  buildWorkbookA_(ssA);

  // --- 2. Pre-existing breakage (must exist in BOTH files) --------------
  breakReferencesInA_(ssA);
  SpreadsheetApp.flush();

  // --- 3. Copy A -> B ---------------------------------------------------
  const fileB = DriveApp.getFileById(ssA.getId()).makeCopy(nameB, folder);
  const ssB = SpreadsheetApp.openById(fileB.getId());

  // --- 4. Mutate B ------------------------------------------------------
  mutateWorkbookB_(ssB);
  SpreadsheetApp.flush();

  logResult_(folder, ssA, ssB);
  return { a: ssA.getUrl(), b: ssB.getUrl(), folder: folder.getUrl() };
}

// ===========================================================================
// WORKBOOK A — tab construction
// ===========================================================================

function buildWorkbookA_(ss) {
  const specs = tabSpecs_();
  specs.forEach(function (spec) {
    writeTab_(ss, spec);
  });
  // SpreadsheetApp.create() leaves a default sheet behind.
  const first = ss.getSheetByName('Sheet1');
  if (first) ss.deleteSheet(first);
}

/**
 * Writes one tab. Cells listed in spec.text are formatted as plain text BEFORE
 * the values land, so that strings like '=1+1' and '#DIV/0!' are stored as
 * literal text rather than parsed as a formula. Format must precede value —
 * reformatting afterwards will not convert a parsed formula back to text.
 */
function writeTab_(ss, spec) {
  const sheet = ss.insertSheet(spec.name, ss.getSheets().length);
  const grid = padGrid_(spec.grid);

  (spec.text || []).forEach(function (a1) {
    sheet.getRange(a1).setNumberFormat('@');
  });

  sheet.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  sheet.getRange(1, 1, 1, grid[0].length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ===========================================================================
// PRE-EXISTING BREAKAGE — runs on A, before the copy
// ===========================================================================

/**
 * Deletes the rows of 'Ref Src A' that other tabs point at, which makes Sheets
 * rewrite those references to ='Ref Src A'!#REF!. Because this happens before
 * the copy, the resulting errors are present in BOTH files and must surface as
 * REF_ERROR (the changes-only exception, test 30) rather than REF_ERROR_NEW.
 *
 * Rows are deleted high-to-low so the earlier deletions do not shift the later
 * targets out from under us.
 *
 * Targets:
 *   row 7 -> 'Chain Root'!C7      (test 33 root)
 *   row 5 -> 'Ref Errors'!B3      (test 31, fixed later in B)
 *   row 3 -> 'Ref Errors'!B2      (test 30, left broken in both)
 *            'Header Guard'!D3    (test 32, error inside a skipped tab)
 *            'Edit Distance'!E3   (error inside an edit-distance-skipped tab)
 */
function breakReferencesInA_(ss) {
  const src = ss.getSheetByName('Ref Src A');
  [7, 5, 3].forEach(function (r) { src.deleteRow(r); });
}

// ===========================================================================
// WORKBOOK B — mutations
// ===========================================================================

/**
 * Every intentional difference between A and B. Ordering constraints are noted
 * inline; where a mutation depends on Sheets having already rewritten a
 * formula, the existing formula is READ BACK and amended rather than retyped,
 * so the generator never has to predict the rewrite.
 */
function mutateWorkbookB_(ss) {

  // -- Tab-level structure (test 10, 21) ---------------------------------

  // TAB_RENAMED. Sheets rewrites 'Renamed Ref'!B2 to point at the new name;
  // the tool must undo that via tabMap and emit ZERO formula rows (test 21).
  ss.getSheetByName('Lookup Table').setName('Lookup Table v2');

  // TAB_DELETED.
  ss.deleteSheet(ss.getSheetByName('Scratch'));

  // TAB_ADDED — and it is added already broken. The reference is written now
  // and 'Ref Src B' row 3 is deleted further down, so by the end of this
  // function the cell reads ='Ref Src B'!#REF!. scanErrorsUnaligned() must
  // find it even though the tab has no A-side counterpart to align against.
  const added = ss.insertSheet('New Tab', ss.getSheets().length);
  added.getRange(1, 1, 3, 3).setValues([
    ['Key', 'Value', 'Note'],
    ['brand new row', 1, 'this tab exists only in B'],
    ['inherited break', "='Ref Src B'!$B$3", 'breaks when Ref Src B row 3 goes']
  ]);

  // -- Structural row operations in REFERENCED tabs -----------------------
  // These must happen before any formula read-back below.

  // Rates: one row inserted above the referenced row 4.
  // Drives tests 18, 23, 24, 25, 26, 27, 28.
  // Old B4 (55) moves to B5; the new B4 holds 77, so every INDIRECT/OFFSET
  // that resolves positionally now reads a DIFFERENT VALUE with IDENTICAL
  // FORMULA TEXT — which is the entire point of VOLATILE_VALUE.
  insertRowWith_(ss.getSheetByName('Rates'), 4,
    ['Inserted rate', 77, 'USD', 'added in B above the referenced row']);

  // Escalation: unrelated row inserted. Test 23 needs a formula whose two
  // references target two DIFFERENT tabs that BOTH shifted.
  insertRowWith_(ss.getSheetByName('Escalation'), 3,
    [2027.5, 'interpolated', 1.085, 'added in B']);

  // Assumptions: the middle of the reference chain shifts too (test 26).
  insertRowWith_(ss.getSheetByName('Assumptions'), 4,
    ['inserted.key', 'added in B', 0, 0]);

  // Self Ref: same-tab absolute reference =$B$4 (test 17).
  insertRowWith_(ss.getSheetByName('Self Ref'), 4,
    ['Inserted', 999, 'shifts the same-tab absolute target']);

  // -- Row insert / delete tabs (tests 7, 13, 14, 15) ---------------------

  insertRowWith_(ss.getSheetByName('Row Insert Top'), 2,
    ['New top row', 5, 2, '=B2*C2', 'inserted directly under the header']);

  insertRowWith_(ss.getSheetByName('Row Insert Mid'), 8,
    ['Inserted mid', 42, 2.5, '', 'literals only']);

  ss.getSheetByName('Row Delete Mid').deleteRow(8);

  const rie = ss.getSheetByName('Row Insert Edit');
  insertRowWith_(rie, 6, ['Inserted at 6', 7, 1.25, '', 'insert']);
  rie.getRange('C11').setValue(88.88);   // was C10 in A; edit sits BELOW the insert

  // Row Relabel: identity label edited. Must come back as 1 VALUE, not as a
  // ROW_DELETED + ROW_ADDED pair — that is what alignment pass 2 exists for.
  ss.getSheetByName('Row Relabel').getRange('A7').setValue('Bracket (renamed)');

  // -- Edit Distance tab (tests 20, 22) -----------------------------------
  // Deliberately mangled past editDistanceCap so the tool SKIPS it. A row is
  // also inserted, which shifts C4/C7 — the targets of 'Unverified'. Because
  // the tab is skipped it gets no row map, so those references are
  // unresolvable and must come back FORMULA_UNVERIFIED rather than FORMULA.
  const ed = ss.getSheetByName('Edit Distance');
  insertRowWith_(ed, 2, ['inserted', 0, 0, 'shifts every reference below', '']);
  // Rows are now 1-off from A. Rewrite 6 of the 12 data rows wholesale.
  [3, 5, 7, 9, 11, 13].forEach(function (r, i) {
    ed.getRange(r, 1, 1, 4).setValues([
      ['completely different ' + i, 900 + i, 9.99 + i, 'restructured']
    ]);
  });

  // -- Cell-level edits: Basics (tests 2, 3, 4, 5, 6, 9, 11) --------------

  const basics = ss.getSheetByName('Basics');
  basics.getRange('B2').setValue(12);                   // input changed (test 4)
  basics.getRange('E2').setValue('island-alpha-EDITED'); // literal island (test 6)
  basics.getRange('D7').setValue(21);                   // literal over formula (test 5)
  basics.getRange('D10').setFormula('=C10*B10');        // rewritten, same result (test 3)
  basics.getRange('B18').setValue('note-one-EDITED');   // formula-free row (test 2)
  // FORMULARIZED — diffCell rule 1, the mirror of HARDCODED. No numbered test
  // covers it, but it is a branch of the taxonomy and needs a fixture. The
  // value is unchanged on purpose: rule 1 fires on the '' -> formula transition
  // alone, so an implementation that reaches for the value first fails here.
  basics.getRange('G13').setFormula('="ok"');
  // A number becomes a computation error. #DIV/0! is NOT a reference error and
  // must fall through to VALUE. Written as plain text because there is no way
  // to place a bare error token in a cell without a formula.
  basics.getRange('B17').setNumberFormat('@');
  basics.getRange('B17').setValue('#DIV/0!');
  // Column F (dates) is deliberately untouched — test 9 fails if the tool
  // compares Date objects by identity instead of .getTime().

  // -- CSV hostile content (test 8) ---------------------------------------

  const csv = ss.getSheetByName('CSV Nasty');
  csv.getRange('B2').setValue('a,b and "quoted"\nsecond line');
  csv.getRange('B3').setNumberFormat('@');
  csv.getRange('B3').setValue('=1+1');       // must be neutralised, not executed
  csv.getRange('B4').setValue('-leading minus');
  csv.getRange('B5').setValue('@at-sign start');

  // -- Unverified tab (tests 22, 24) --------------------------------------
  // Read-back-and-amend: B5's formula has ALREADY been rewritten by Sheets for
  // the Rates and Edit Distance inserts. Appending '*2' adds a genuine authored
  // edit on top of that. Half the formula is verifiable (Rates has a row map)
  // and half is not (Edit Distance is skipped) — masking must preserve the
  // verifiable half or the real edit is lost as FORMULA_UNVERIFIED. Test 24.
  const unv = ss.getSheetByName('Unverified');
  const b5 = unv.getRange('B5');
  b5.setFormula(b5.getFormula() + '*2');

  // -- Ref Errors (tests 29, 31) ------------------------------------------

  const refs = ss.getSheetByName('Ref Errors');
  // Broken in A, repaired here -> REF_ERROR_FIXED (test 31).
  refs.getRange('B3').setFormula("='Ref Src A'!$B$2");

  // Deleting this row breaks 'Ref Errors'!B4 and 'New Tab'!B3. B4 is aligned
  // against a clean A-side cell -> REF_ERROR_NEW, root (tests 29, 19). B3 sits
  // in a tab with no A-side counterpart, so the unaligned scan reports it as a
  // plain REF_ERROR with aRef empty (plan 5.2) — same fault, different row type.
  ss.getSheetByName('Ref Src B').deleteRow(3);

  // -- Header Guard (tests 12, 32) ----------------------------------------
  // Header changed at column C -> TAB_SKIPPED. The #REF! at D3 (inherited from
  // A) must STILL be reported, with bRef set and aRef empty.
  ss.getSheetByName('Header Guard').getRange('C1').setValue('Rate (USD)');

  // -- Cascade (test 38) --------------------------------------------------
  // One literal. Every formula cell on the tab derives from it, so this single
  // edit produces 1 section-1 row and 40 section-2 rows. The tab must NOT trip
  // the noise warning and must NOT come back TAB_SKIPPED — both guards count
  // section 1 only (rule 15).
  ss.getSheetByName('Cascade').getRange('B2').setValue(25);

  // -- Col Change ---------------------------------------------------------
  const col = ss.getSheetByName('Col Change');
  col.getRange('E1').setValue('Extra column');
  col.getRange(2, 5, 8, 1).setValues([['e1'], ['e2'], ['e3'], ['e4'], ['e5'], ['e6'], ['e7'], ['e8']]);

  // 'Untouched', 'Rates Ref', 'HVAC', 'Chain Root', 'Chain Leaf', 'Volatile',
  // 'Ref Src A' and '_Manifest' receive NO direct mutation. Their expected
  // output is produced entirely by relocation and error propagation.
}

/** Inserts a row above rowIndex and fills it. */
function insertRowWith_(sheet, rowIndex, values) {
  sheet.insertRowBefore(rowIndex);
  sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
}

// ===========================================================================
// TAB SPECIFICATIONS
// ===========================================================================

/**
 * ORDER MATTERS. A formula written against a sheet that does not exist yet
 * resolves to "Unresolved sheet name" and Sheets does not necessarily repair it
 * when the sheet appears later — which would seed reference errors the fixture
 * never asked for, in tabs whose expected output is zero rows.
 *
 * So every tab that is REFERENCED is created before the tabs that reference it.
 * This is a write-ordering constraint on the generator only; it says nothing
 * about the diff tool, whose relocation is single-hop and order-free (plan §0.2).
 */
function tabSpecs_() {
  return [
    // Self-contained tabs — no cross-sheet references at all.
    manifestTab_(),
    untouchedTab_(),
    basicsTab_(),
    csvNastyTab_(),
    rowInsertTopTab_(),
    rowInsertMidTab_(),
    rowDeleteMidTab_(),
    rowInsertEditTab_(),
    rowRelabelTab_(),
    selfRefTab_(),
    colChangeTab_(),
    cascadeTab_(),
    scratchTab_(),

    // Reference TARGETS — must exist before anything points at them.
    refSrcATab_(),
    refSrcBTab_(),
    ratesTab_(),
    escalationTab_(),
    lookupTableTab_(),
    editDistanceTab_(),   // targets Unverified; also references Ref Src A
    assumptionsTab_(),    // references Rates + Escalation; targeted by HVAC
    chainRootTab_(),      // references Ref Src A; targeted by Chain Leaf

    // Referrers.
    hvacTab_(),
    ratesRefTab_(),
    unverifiedTab_(),
    volatileTab_(),
    refErrorsTab_(),
    chainLeafTab_(),
    headerGuardTab_(),
    renamedRefTab_()
  ];
}

// --- _Manifest --------------------------------------------------------------
// Identical in both files, so it contributes zero rows to the diff. It exists
// so that whoever opens the fixtures can see what each tab is for without
// going back to the plan.

function manifestTab_() {
  const grid = [['Test', 'Tab', 'What differs in B', 'Expected output']];
  TEST_INDEX.forEach(function (t) { grid.push(t); });
  return { name: '_Manifest', grid: grid };
}

const TEST_INDEX = [
  ['1', 'Untouched', 'nothing', '0 changes'],
  ['2', 'Basics B18', 'literal edited in a formula-free row', '1 VALUE'],
  ['3', 'Basics D10', '=B10*C10 rewritten as =C10*B10', '1 FORMULA, 0 VALUE'],
  ['4', 'Basics B2', 'input changed; downstream formulas identical', '1 VALUE in section 1; D2/B19/D19 as DERIVED_VALUE in section 2'],
  ['5', 'Basics D7', 'literal 21 typed over a formula', '1 HARDCODED; old=formula new=21'],
  ['6', 'Basics E2', 'literal island inside the calculated zone', '1 VALUE (pivot-scan impls fail)'],
  ['7', 'Row Insert Top', 'row inserted directly under the header', '1 ROW_ADDED, ZERO FORMULA rows'],
  ['8', 'CSV Nasty B2:B5', 'comma+quote+newline, =1+1, -lead, @lead', 'reimports intact; formulas neutralised'],
  ['9', 'Basics col F', 'dates untouched', '0 rows (fails without .getTime())'],
  ['10', 'Lookup Table / Scratch / New Tab', 'renamed / deleted / added', '1 TAB_RENAMED, 1 TAB_DELETED, 1 TAB_ADDED'],
  ['11', 'Basics B17', 'number replaced by #DIV/0!', '1 VALUE, NOT a REF_ERROR'],
  ['12', 'Header Guard C1', 'header text differs at column C', 'TAB_SKIPPED, no cell rows -- but see 32'],
  ['13', 'Row Insert Mid', 'row inserted at row 8, nothing else', 'exactly 1 ROW_ADDED, 0 VALUE, 0 FORMULA'],
  ['14', 'Row Delete Mid', 'row 8 deleted, nothing else', 'exactly 1 ROW_DELETED'],
  ['15', 'Row Insert Edit', 'row inserted at 6 plus one value edited below', '1 ROW_ADDED + 1 VALUE, refs offset'],
  ['16', 'Row Relabel A7', 'row identity label edited', '1 VALUE, not DELETED+ADDED'],
  ['17', 'Self Ref', 'row inserted above the =$B$4 target, same tab', '0 FORMULA rows'],
  ['18', 'Rates Ref', 'row inserted in Rates; this tab holds =Rates!$B$4', '0 FORMULA rows here; 1 ROW_ADDED in Rates'],
  ['19', 'Ref Errors B4 / Ref Src B', 'referenced row deleted in Ref Src B', '1 ROW_DELETED + 1 REF_ERROR_NEW (root)'],
  ['20', 'Edit Distance', '6 of 12 rows rewritten wholesale', 'TAB_SKIPPED on the edit-distance cap'],
  ['21', 'Renamed Ref', "Lookup Table renamed; formula untouched", '1 TAB_RENAMED, 0 FORMULA rows'],
  ['22', 'Unverified B6', 'points into the skipped Edit Distance tab', 'FORMULA_UNVERIFIED, not FORMULA'],
  ['23', 'Assumptions C11', '=Rates!$B$4*Escalation!$C$7, rows added in BOTH', '0 FORMULA rows (one-map-per-formula fails)'],
  ['24', 'Unverified B5', 'half-verifiable formula genuinely edited (*2)', 'FORMULA, not FORMULA_UNVERIFIED'],
  ['25', 'Assumptions C12', '=Rates!$B$4*$D$7 cross-tab + same-tab absolute', '0 FORMULA rows'],
  ['26', 'Assumptions C8 -> HVAC F10', 'chain; rows inserted in Rates AND Assumptions', '2 ROW_ADDED, 0 FORMULA in either referencer'],
  ['27', 'Volatile B2', '=INDIRECT("Rates!B"&A2), text identical, value moved', '1 VOLATILE_VALUE in SECTION 1, 0 FORMULA, 0 DERIVED_VALUE'],
  ['28', 'Volatile B3', '=OFFSET(Rates!$A$1,3,1), anchor relocates cleanly', '1 VOLATILE_VALUE in SECTION 1 -- NOT DERIVED_VALUE (rule 14)'],
  ['29', 'Ref Errors B4', 'clean in A, broken in B', '1 REF_ERROR_NEW; new shows the broken formula'],
  ['30', 'Ref Errors B2', '#REF! in BOTH, formulas identical', '1 REF_ERROR -- the changes-only exception'],
  ['31', 'Ref Errors B3', 'broken in A, repaired in B', '1 REF_ERROR_FIXED'],
  ['32', 'Header Guard D3', 'reference error inside a header-skipped tab', '1 TAB_SKIPPED AND 1 REF_ERROR (bRef set, aRef empty)'],
  ['33', 'Chain Root C7 + Chain Leaf F10', 'root #REF! and its inherited symptom', '2 rows, BOTH in section 1; root sorts first; new=formula vs new=#REF!'],
  ['34', 'Basics D2 / B19 / D19', 'identical formulas, values moved, non-volatile', '3 DERIVED_VALUE; sectionOf returns 2; old/new are values not formulas'],
  ['35', 'whole run', 'both sections populated', 'blank line + # marker + repeated header; ZERO DERIVED_VALUE above it'],
  ['36', 'whole run, derivedSection:false', 're-run the tool over these same two files', 'section 2 absent entirely; section 1 byte-identical to the default run'],
  ['37', 'whole run, derivedCap:3', 're-run the tool over these same two files', 'first 3 derived rows in workbook order + 1 DERIVED_TRUNCATED reading 42'],
  ['38', 'Cascade', 'one input recalculates all 40 formula cells', '1 VALUE + 40 DERIVED_VALUE, NO noise warning, NOT skipped'],
  ['+', 'Basics G13', 'literal "ok" replaced by the formula ="ok"', 'FORMULARIZED (rule 1), value unchanged'],
  ['+', 'Col Change', 'column E added in B', 'COL_ADDED'],
  ['+', 'Edit Distance E3', 'ref error inside an edit-distance-skipped tab', 'REF_ERROR still scanned (rule 9)'],
  ['+', 'New Tab B3', 'added tab containing a broken reference', 'REF_ERROR from scanErrorsUnaligned']
];

// --- Untouched (test 1) -----------------------------------------------------

function untouchedTab_() {
  const grid = [['Item', 'Qty', 'Price', 'Total', 'Note']];
  return { name: 'Untouched', grid: grid.concat(filler_(15, 2, 'Untouched item')) };
}

// --- Basics (tests 2, 3, 4, 5, 6, 9, 11 + FORMULARIZED) ---------------------
// The taxonomy tab: one fixture per branch of diffCell.
// Rows whose HASH changes in B are 2, 7, 13, 17 and 18 — spread out on purpose.
// Five changed rows across 24 scores 10/48 = 0.21, under editDistanceCap.
// Bunching them, or trimming the tab, would put it over the cap and every
// expected row would be replaced by a single TAB_SKIPPED.
// (Row 10 also changes, but only its formula, so its hash is unaffected.)

function basicsTab_() {
  const d = function (m, day) { return new Date(2026, m, day); };
  const grid = [
    ['Item', 'Qty', 'Price', 'Total', 'Note', 'Date', 'Flag'],
    ['Widget',    10, 2.50,  '=B2*C2',   'island-alpha',  d(0, 15), 'ok'],
    ['Gadget',     4, 7.00,  '=B3*C3',   'island-beta',   d(1, 20), 'ok'],
    ['Doohickey',  6, 3.00,  '=B4*C4',   'island-gamma',  d(2,  5), 'ok'],
    ['Sprocket',   8, 4.25,  '=B5*C5',   'island-delta',  d(2, 18), 'ok'],
    ['Flange',     3, 9.10,  '=B6*C6',   'island-eps',    d(3,  2), 'ok'],
    ['Bracket',   12, 1.75,  '=B7*C7',   'island-zeta',   d(3, 27), 'ok'],
    ['Coupling',   5, 6.40,  '=B8*C8',   'island-eta',    d(4, 11), 'ok'],
    ['Bearing',    9, 3.30,  '=B9*C9',   'island-theta',  d(5,  1), 'ok'],
    ['Seal',       7, 2.20,  '=B10*C10', 'island-iota',   d(5, 19), 'ok'],
    ['Gasket',    11, 0.95,  '=B11*C11', 'island-kappa',  d(6,  8), 'ok'],
    ['Shim',       2, 15.00, '=B12*C12', 'island-lambda', d(6, 30), 'ok'],
    ['Pin',       20, 0.40,  '=B13*C13', 'island-mu',     d(7, 14), 'ok'],
    ['Clip',      14, 0.80,  '=B14*C14', 'island-nu',     d(8,  3), 'ok'],
    ['Washer',    30, 0.15,  '=B15*C15', 'island-xi',     d(8, 22), 'ok'],
    // A genuine, permanent #DIV/0! present in BOTH files. Identical formula and
    // identical value, so it must produce NO row at all. If a REF_ERROR turns
    // up here, REF_ERROR_TOKENS has been widened past #REF! and #NAME?.
    ['Div check', '=1/0', '', '', 'real error, identical in both', '', ''],
    // B replaces this number with the plain-text token '#DIV/0!'.
    ['Error text cell', 42, '', '', 'becomes #DIV/0! in B', '', ''],
    // No formula anywhere on this row — test 2 requires that.
    ['Note row', 'note-one', 'note-two', '', 'formula-free row', '', ''],
    ['Subtotal', '=SUM(B2:B15)', '', '=SUM(D2:D15)', '', '', ''],
    ['Tail', 1, 1.00, '=B20*C20', 'island-omega', d(11, 31), 'ok'],
    // Headroom. Five changed rows over 24 scores 10/48 = 0.21; over the 20-row
    // version it was 0.25, which is uncomfortably close to the 0.30 cap for a
    // tab whose whole purpose is to emit rows rather than be skipped.
    ['Pad 1', 2, 1.10, '=B21*C21', 'island-pi',    d(9,  4), 'ok'],
    ['Pad 2', 3, 1.20, '=B22*C22', 'island-rho',   d(9, 17), 'ok'],
    ['Pad 3', 4, 1.30, '=B23*C23', 'island-sigma', d(10, 6), 'ok'],
    ['Pad 4', 5, 1.40, '=B24*C24', 'island-tau',   d(10, 25), 'ok']
  ];
  return { name: 'Basics', grid: grid };
}

// --- CSV Nasty (test 8) -----------------------------------------------------

function csvNastyTab_() {
  const grid = [
    ['Field', 'Value', 'Note'],
    ['comma + quote + newline', 'plain-1', 'B gets a,b "quoted" and a line break'],
    ['formula injection', 'plain-2', 'B gets the literal text =1+1'],
    ['leading minus', 'plain-3', 'B gets -leading minus'],
    ['leading at-sign', 'plain-4', 'B gets @at-sign start']
  ];
  return { name: 'CSV Nasty', grid: grid.concat(filler_(14, 6, 'csv filler')) };
}

// --- Row operations (tests 7, 13, 14, 15, 16) -------------------------------

function rowInsertTopTab_() {
  // No aggregate ranges here on purpose. Inserting a row at the TOP of a range
  // (=SUM(B2:B16) with the insert at row 2) is a boundary case Sheets resolves
  // by keeping the start at row 2, which no row map can reproduce. Out of scope
  // for the plan, so the fixture does not create it.
  const grid = [['Item', 'Qty', 'Price', 'Total', 'Note']];
  return { name: 'Row Insert Top', grid: grid.concat(filler_(16, 2, 'top item')) };
}

function rowInsertMidTab_() {
  // This one DOES carry an aggregate, and it is meant to. The insert lands at
  // row 8, strictly inside =SUM(B2:B17), so Sheets extends the end of the range
  // and the row map relocates that endpoint exactly. It must not produce a
  // FORMULA row. Test 13 says zero.
  const grid = [['Item', 'Qty', 'Price', 'Total', 'Note']];
  const rows = filler_(16, 2, 'mid item');
  rows.push(['Total', '=SUM(B2:B17)', '', '=SUM(D2:D17)', 'range end relocates']);
  return { name: 'Row Insert Mid', grid: grid.concat(rows) };
}

function rowDeleteMidTab_() {
  const grid = [['Item', 'Qty', 'Price', 'Total', 'Note']];
  return { name: 'Row Delete Mid', grid: grid.concat(filler_(16, 2, 'del item')) };
}

function rowInsertEditTab_() {
  const grid = [['Item', 'Qty', 'Price', 'Total', 'Note']];
  return { name: 'Row Insert Edit', grid: grid.concat(filler_(16, 2, 'edit item')) };
}

function rowRelabelTab_() {
  const grid = [['Item', 'Qty', 'Price', 'Total', 'Note']];
  const rows = filler_(16, 2, 'relabel item');
  // Sheet row 7. B renames it. The row's other three literal cells are
  // untouched, so alignment pass 2 scores it 3/4 = 0.75 — above opts.similarity,
  // which is what makes it re-pair as an edit instead of splitting into a
  // ROW_DELETED + ROW_ADDED pair.
  rows[5][0] = 'Bracket';
  rows[5][4] = 'stable note';
  return { name: 'Row Relabel', grid: grid.concat(rows) };
}

// --- Edit Distance (tests 20, 22) -------------------------------------------

function editDistanceTab_() {
  const grid = [['Key', 'Alpha', 'Beta', 'Comment', 'Broken']];
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const r = i + 2;
    rows.push(['key-' + i, 100 + i, 1.5 + i, 'original row ' + i, '']);
    // C4 and C7 are the targets of 'Unverified'. Values only, no formulas.
    if (r === 4) rows[i][2] = 44.4;
    if (r === 7) rows[i][2] = 77.7;
    // A reference error inside a tab the tool will SKIP. Rule 9 says the error
    // scan runs independently of alignment, so this must still be reported.
    if (r === 3) rows[i][4] = "='Ref Src A'!$B$3";
  }
  return { name: 'Edit Distance', grid: grid.concat(rows) };
}

// --- Referenced tabs --------------------------------------------------------

function ratesTab_() {
  const grid = [
    ['Rate', 'Value', 'Unit', 'Note'],
    ['Base',       100,  'USD',    ''],
    ['Escalator',  1.03, 'x',      ''],
    // B4 is THE referenced cell. B inserts a row above it, so B4 becomes B5 and
    // a new value lands at B4 — which is what makes the volatile cases detectable.
    ['Labor',      55,   'USD/hr', 'referenced as Rates!$B$4'],
    ['Material',   32,   'USD/unit', ''],
    ['Overhead',   0.18, 'pct',    ''],
    ['Freight',    12.5, 'USD',    ''],
    ['Insurance',  4.75, 'pct',    ''],
    ['Permits',    850,  'USD',    ''],
    ['Bond',       1.25, 'pct',    ''],
    ['Contingency',0.07, 'pct',    ''],
    ['Fee',        0.05, 'pct',    ''],
    ['Tax',        0.0825, 'pct',  ''],
    ['Discount',   0.02, 'pct',    ''],
    ['Rounding',   0.5,  'USD',    ''],
    ['Misc',       9.99, 'USD',    '']
  ];
  return { name: 'Rates', grid: grid };
}

function escalationTab_() {
  // Column C must be the NUMERIC factor, not the basis text — Assumptions
  // multiplies by Escalation!$C$7 and a string there would make the fixture
  // itself error out, masking whatever the tool was supposed to report.
  const grid = [['Year', 'Basis', 'Factor', 'Note']];
  for (let y = 0; y < 15; y++) {
    grid.push([2026 + y, 'CPI', +(1 + y * 0.03).toFixed(4),
               y === 5 ? 'referenced as Escalation!$C$7' : '']);
  }
  return { name: 'Escalation', grid: grid };
}

function assumptionsTab_() {
  // C7 is the middle link of the chain HVAC -> Assumptions -> Rates.
  // D7 is the same-tab absolute target for test 25.
  const grid = [
    ['Key', 'Description', 'Value', 'Alt'],
    ['base.cost',   'literal',                 1200,             10],
    ['area',        'literal',                 4500,             20],
    ['duration',    'literal',                 18,               30],
    ['index',       'literal',                 1.12,             40],
    ['adjustment',  'literal',                 0.94,             50],
    ['labor.rate',  'chain middle',            '=Rates!$B$4',    12.5],
    ['spare.1',     'literal',                 7,                60],
    ['spare.2',     'literal',                 8,                70],
    ['combined',    'two tabs, both shifted',  '=Rates!$B$4 * Escalation!$C$7', 0],
    ['mixed.abs',   'cross-tab + same-tab',    '=Rates!$B$4 * $D$7',            0],
    ['spare.3',     'literal',                 9,                80],
    ['spare.4',     'literal',                 10,               90],
    ['spare.5',     'literal',                 11,               100],
    ['spare.6',     'literal',                 12,               110],
    ['spare.7',     'literal',                 13,               120]
  ];
  return { name: 'Assumptions', grid: grid };
}

function hvacTab_() {
  // F10 closes the chain. Both Rates and Assumptions gain a row in B, and this
  // formula must still come back clean — single-hop relocation, no graph.
  const grid = [['Zone', 'Area', 'Load', 'Unit cost', 'Subtotal', 'Rate from chain']];
  for (let i = 0; i < 14; i++) {
    const r = i + 2;
    grid.push(['Zone ' + (i + 1), 500 + i * 25, 12 + i, 3.5 + i * 0.1,
               '=B' + r + '*D' + r,
               r === 10 ? "=Assumptions!$C$7" : '']);
  }
  return { name: 'HVAC', grid: grid };
}

function ratesRefTab_() {
  // The clean isolated version of test 18: nothing about this tab changes, so
  // any FORMULA row here is pure relocation failure with no other explanation.
  const grid = [['Key', 'Value', 'Note']];
  for (let i = 0; i < 15; i++) {
    const r = i + 2;
    grid.push(['ref-' + i, r === 2 ? '=Rates!$B$4' : 100 + i,
               r === 2 ? 'the only cross-tab reference on this tab' : '']);
  }
  return { name: 'Rates Ref', grid: grid };
}

function selfRefTab_() {
  const grid = [['Key', 'Value', 'Note']];
  for (let i = 0; i < 15; i++) {
    const r = i + 2;
    grid.push(['row-' + i, r === 4 ? 42 : 5 + i, '']);
  }
  grid[3][2] = 'referenced as $B$4';   // sheet row 4
  grid[5][2] = '=$B$4';                // sheet row 6 — same-tab absolute (test 17)
  return { name: 'Self Ref', grid: grid };
}

function unverifiedTab_() {
  const grid = [['Key', 'Formula', 'Note']];
  for (let i = 0; i < 15; i++) grid.push(['unv-' + i, 10 + i, '']);
  // grid[0] is the header, so grid[n] is sheet row n+1.
  // Row 5: half verifiable (Rates has a row map), half not (Edit Distance is
  // skipped). B appends '*2'. The masked forms must still differ -> FORMULA.
  grid[4][0] = 'mixed.verifiability';
  grid[4][1] = "=Rates!$B$4 * 'Edit Distance'!$C$7";
  grid[4][2] = 'test 24 - a real edit hiding behind an unverifiable reference';
  // Row 6: wholly unverifiable -> FORMULA_UNVERIFIED.
  grid[5][0] = 'wholly.unverifiable';
  grid[5][1] = "='Edit Distance'!$C$4";
  grid[5][2] = 'test 22 - target tab has no row map';
  return { name: 'Unverified', grid: grid };
}

function volatileTab_() {
  const grid = [['Key', 'Value', 'Note']];
  for (let i = 0; i < 15; i++) grid.push(['vol-' + i, 1 + i, '']);
  // A2 holds the row number the INDIRECT string is assembled from. Sheets does
  // not rewrite it when Rates gains a row — the "4" is data, not a reference —
  // so the formula text is byte-identical in both files while the value moves.
  grid[1][0] = 4;
  grid[1][1] = '=INDIRECT("Rates!B" & A2)';
  grid[1][2] = 'test 27 - identical text, different value';
  grid[2][1] = '=OFFSET(Rates!$A$1, 3, 1)';
  grid[2][2] = 'test 28 - anchor relocates, numeric offset does not';
  return { name: 'Volatile', grid: grid };
}

// --- Reference errors (tests 29, 30, 31) ------------------------------------

function refErrorsTab_() {
  const grid = [['Case', 'Formula', 'Expected']];
  for (let i = 0; i < 15; i++) grid.push(['case-' + i, 100 + i, '']);
  grid[1][0] = 'pre-existing';
  grid[1][1] = "='Ref Src A'!$B$3";
  grid[1][2] = 'test 30 - broken in A and B -> REF_ERROR';
  grid[2][0] = 'fixed in B';
  grid[2][1] = "='Ref Src A'!$B$5";
  grid[2][2] = 'test 31 - broken in A, repaired in B -> REF_ERROR_FIXED';
  grid[3][0] = 'new in B';
  grid[3][1] = "='Ref Src B'!$B$3";
  grid[3][2] = 'test 29 - clean in A, broken in B -> REF_ERROR_NEW';
  return { name: 'Ref Errors', grid: grid };
}

function chainRootTab_() {
  // C7 becomes ='Ref Src A'!#REF! once row 7 of Ref Src A is deleted, in A.
  // Root cause: the broken pointer is in THIS cell's own formula text.
  const grid = [['Key', 'Description', 'Value']];
  for (let i = 0; i < 15; i++) grid.push(['root-' + i, 'literal', 10 + i]);
  grid[6][1] = 'broken pointer lives here';   // grid[6] === sheet row 7
  grid[6][2] = "='Ref Src A'!$B$7";
  return { name: 'Chain Root', grid: grid };
}

function chainLeafTab_() {
  // F10's own formula is clean. Only its VALUE reads #REF!, inherited from
  // Chain Root. Same underlying fault, opposite classification: root vs
  // inherited, and the root must sort first in the CSV.
  const grid = [['Zone', 'A', 'B', 'C', 'D', 'Inherited']];
  for (let i = 0; i < 14; i++) {
    grid.push(['leaf-' + i, i, i * 2, i * 3, i * 4,
               (i + 2) === 10 ? "='Chain Root'!$C$7" : '']);
  }
  return { name: 'Chain Leaf', grid: grid };
}

// --- Header Guard (tests 12, 32) --------------------------------------------

function headerGuardTab_() {
  const grid = [['Item', 'Qty', 'Rate', 'Notes']];
  for (let i = 0; i < 15; i++) grid.push(['hdr-' + i, 10 + i, 2 + i, '']);
  // D3 breaks when Ref Src A row 3 is deleted, in A. It sits inside a tab the
  // header guard will refuse to compare — which is the whole point of test 32.
  grid[2][3] = "='Ref Src A'!$B$3";
  return { name: 'Header Guard', grid: grid };
}

// --- Rename / add / delete (tests 10, 21) -----------------------------------

function lookupTableTab_() {
  const grid = [['Key', 'Value', 'Note']];
  for (let i = 0; i < 15; i++) {
    const r = i + 2;
    grid.push(['lookup-' + i, r === 4 ? 3.14159 : 20 + i,
               r === 4 ? 'referenced as $B$4' : '']);
  }
  return { name: 'Lookup Table', grid: grid };
}

function renamedRefTab_() {
  const grid = [['Key', 'Value', 'Note']];
  for (let i = 0; i < 15; i++) {
    const r = i + 2;
    grid.push(['rn-' + i, r === 2 ? "='Lookup Table'!$B$4" : 50 + i,
               r === 2 ? 'sheet name must be relocated via tabMap' : '']);
  }
  return { name: 'Renamed Ref', grid: grid };
}

function scratchTab_() {
  const grid = [['Scratch', 'Value', 'Note']];
  for (let i = 0; i < 10; i++) grid.push(['scratch-' + i, i, 'deleted in B']);
  return { name: 'Scratch', grid: grid };
}

// --- Cascade (test 38) ------------------------------------------------------
// One literal drives every formula cell on the tab. Changing B2 in B
// recalculates all 40 of them with IDENTICAL formula text, which is the
// definition of DERIVED_VALUE.
//
// The proportions are the fixture. 22 rows x 4 columns = 88 compared cells:
//   section 1 :  1 / 88 = 0.011  -> no noise warning, which is the pass
//   section 2 : 40 / 88 = 0.455  -> if the ratio counted section 2 it would be
//                                   41/88 = 0.47 and the warning WOULD fire
// So the tab distinguishes a correct implementation from one that counts
// derived rows in the noise ratio. A tab with fewer derived cells would pass
// under both readings and prove nothing (rule 15, test 38).
//
// It also guards hashRow. Only the literal columns A and B contribute to a
// row's identity hash; C and D are formulas and hash to the formula sentinel.
// So exactly one row's hash changes and editDistance is 2/44 = 0.045. One that
// "improves" hashRow by folding in formula-cell values moves 21 of the 22 (the
// all-literal header row is the exception), scores 42/44 = 0.95, and returns
// this tab as TAB_SKIPPED — loudly (plan Step 5, rule 15's second half).
function cascadeTab_() {
  const grid = [['Key', 'Input', 'Scaled', 'Doubled']];
  // B2 is the only literal that changes in B. Its row still aligns: three of
  // its four literal cells are untouched, scoring 3/4 = 0.75 in alignment
  // pass 2, above opts.similarity.
  grid.push(['driver', 10, '', 'the only edit on this tab']);
  for (let i = 0; i < 20; i++) {
    const r = i + 3;
    grid.push(['step-' + i, 1 + i, '=$B$2*B' + r, '=C' + r + '*2']);
  }
  return { name: 'Cascade', grid: grid };
}

function colChangeTab_() {
  const grid = [['Item', 'Qty', 'Price', 'Total']];
  for (let i = 0; i < 8; i++) {
    const r = i + 2;
    grid.push(['col-' + i, 10 + i, 1.5 + i, '=B' + r + '*C' + r]);
  }
  return { name: 'Col Change', grid: grid };
}

// --- Break sources ----------------------------------------------------------

function refSrcATab_() {
  // Rows 3, 5 and 7 are deleted in A, before the copy. Everything pointing at
  // them ends up broken in BOTH files.
  const grid = [['Key', 'Value', 'Fate']];
  for (let i = 0; i < 15; i++) {
    const r = i + 2;
    const doomed = (r === 3 || r === 5 || r === 7);
    grid.push(['srcA-' + i, 200 + i, doomed ? 'DELETED IN A - breaks its referrers in both files' : '']);
  }
  return { name: 'Ref Src A', grid: grid };
}

function refSrcBTab_() {
  // Row 3 is deleted in B only. Anything pointing at it is clean in A and
  // broken in B -> REF_ERROR_NEW.
  const grid = [['Key', 'Value', 'Fate']];
  for (let i = 0; i < 15; i++) {
    const r = i + 2;
    grid.push(['srcB-' + i, 300 + i, r === 3 ? 'DELETED IN B ONLY' : '']);
  }
  return { name: 'Ref Src B', grid: grid };
}

// ===========================================================================
// HELPERS
// ===========================================================================

/** Standard 5-column data rows whose Total column is a relative formula. */
function filler_(count, startRow, label) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const r = startRow + i;
    out.push([label + ' ' + (i + 1), 10 + i, +(1.5 + i * 0.25).toFixed(2),
              '=B' + r + '*C' + r, 'note ' + (i + 1)]);
  }
  return out;
}

/** Rectangularises a ragged grid — setValues() rejects anything else. */
function padGrid_(grid) {
  let width = 0;
  grid.forEach(function (row) { width = Math.max(width, row.length); });
  return grid.map(function (row) {
    const copy = row.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}

function resolveFolder_() {
  if (CONFIG.FOLDER_ID) {
    const m = String(CONFIG.FOLDER_ID).match(/[-\w]{25,}/);
    return DriveApp.getFolderById(m ? m[0] : CONFIG.FOLDER_ID);
  }
  const existing = DriveApp.getFoldersByName(CONFIG.FOLDER_NAME);
  return existing.hasNext() ? existing.next() : DriveApp.createFolder(CONFIG.FOLDER_NAME);
}

function timestamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
}

function logResult_(folder, ssA, ssB) {
  const lines = [
    '',
    'Fixtures generated.',
    '',
    'Folder : ' + folder.getName() + '  ' + folder.getUrl(),
    'A      : ' + ssA.getName() + '  (' + ssA.getSheets().length + ' tabs)',
    '         ' + ssA.getUrl(),
    'B      : ' + ssB.getName() + '  (' + ssB.getSheets().length + ' tabs)',
    '         ' + ssB.getUrl(),
    '',
    'Set these in the DIFF TOOL project, Project Settings -> Script Properties',
    '(not in source -- plan 1.1f):',
    '  URL_A = ' + ssA.getUrl(),
    '  URL_B = ' + ssB.getUrl(),
    '',
    'Coverage: 38 acceptance tests + COL_ADDED, TAB_ADDED/DELETED/RENAMED.',
    'The _Manifest tab (identical in both files, so it produces no rows) maps',
    'each test to its tab and its expected output.',
    '',
    '--- SECTION 1 of the CSV: 41 rows -----------------------------------',
    '  TAB_SKIPPED    x2   Header Guard (header mismatch), Edit Distance (edit distance)',
    '  TAB_RENAMED    x1   Lookup Table -> Lookup Table v2',
    '  TAB_ADDED      x1   New Tab        TAB_DELETED x1  Scratch',
    '  REF_ERROR_NEW  x1   Ref Errors!B4',
    '  REF_ERROR_FIXED x1  Ref Errors!B3',
    '  REF_ERROR      x6   Ref Errors!B2, Chain Root!C7 (root),',
    '                      Chain Leaf!F10 (inherited), and from the unaligned',
    '                      scan (bRef only, aRef empty): Header Guard!D3,',
    '                      Edit Distance!E4, New Tab!B3',
    '                      -- the scan emits REF_ERROR for everything it finds,',
    '                      including cells that are new in B (plan 5.2)',
    '  VOLATILE_VALUE x2   Volatile!B2, Volatile!B3',
    '                      -- section 1, NOT section 2. Rule 14, tests 27/28.',
    '  HARDCODED      x1   Basics!D7        FORMULARIZED x1  Basics!G13',
    '  FORMULA        x2   Basics!D10 (rewritten, same result - test 3)',
    '                      Unverified!B5 (NOT unverified - see test 24)',
    '  FORMULA_UNVERIFIED x1  Unverified!B6',
    '  VALUE          x11  Basics x4, CSV Nasty x4, Row Insert Edit,',
    '                      Row Relabel, Cascade!B2',
    '  ROW_ADDED      x7   ROW_DELETED x2   COL_ADDED x1',
    '',
    '--- SECTION 2 of the CSV: 45 rows -----------------------------------',
    '  In workbook order, which is the order section 2 must be sorted in:',
    '  DERIVED_VALUE  x3   Basics!D2, Basics!B19, Basics!D19',
    '  DERIVED_VALUE  x1   Row Insert Mid!B18 -> B19  (SUM gains the inserted 42)',
    '  DERIVED_VALUE  x1   Row Insert Edit!D10 -> D11 (C was edited to 88.88)',
    '  DERIVED_VALUE  x40  Cascade!C3:D22   -- one input, whole tab recalculates',
    '  Section 2 sits BELOW a blank line, a # marker and a repeated header.',
    '  ZERO DERIVED_VALUE rows may appear above that marker (rule 13, test 35).',
    '',
    '--- Must produce NOTHING --------------------------------------------',
    '  ZERO formula rows in: Rates Ref, Assumptions, HVAC, Self Ref,',
    '                        Renamed Ref, Row Insert Top, Row Insert Mid',
    '  ZERO rows of any kind: Untouched, Ref Src A, _Manifest',
    '  NO noise warning on Cascade. NO TAB_SKIPPED on Cascade.',
    '',
    'If any tab in the formula group emits a FORMULA row, Step 4 relocation is',
    'silently no-opping and every other result is suspect.',
    '',
    'Two further runs over these same two files complete the suite:',
    '  derivedSection:false -> tests 36. Section 2 absent; section 1 must be',
    '                          byte-identical to the default run.',
    '  derivedCap:3         -> test 37. 3 derived rows + DERIVED_TRUNCATED',
    '                          reading 42. Section 1 untouched.',
    ''
  ];
  console.log(lines.join('\n'));
}

// ===========================================================================
// CLEANUP (guarded)
// ===========================================================================

/**
 * Trashes every file in the target folder whose name starts with NAME_PREFIX.
 * Set CONFIRM_TRASH = true first. Files go to Drive's trash, not oblivion.
 */
function trashGeneratedWorkbooks() {
  if (!CONFIRM_TRASH) {
    console.log('Refused: set CONFIRM_TRASH = true at the top of the file first.');
    return;
  }
  const folder = resolveFolder_();
  const files = folder.getFiles();
  let n = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (f.getName().indexOf(CONFIG.NAME_PREFIX) === 0) {
      console.log('trashing: ' + f.getName());
      f.setTrashed(true);
      n++;
    }
  }
  console.log(n + ' file(s) trashed.');
}
