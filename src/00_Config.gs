/**
 * ============================================================================
 * 00_Config.gs — every tunable, and nothing else
 * ============================================================================
 *
 * Plan §1.1. This file loads FIRST, and every statement in it is a literal
 * declaration. That is not a style rule: top-level `const` initialisation is
 * the one thing in a multi-file Apps Script project that IS order-sensitive
 * (function declarations hoist across the whole shared scope; const
 * initialisers do not). A constant here whose value is computed from another
 * global would read `undefined` on some load orders and no error would say so.
 *
 * Spreadsheet URLs are deliberately NOT here. They live in Script Properties
 * and are resolved by run() in 90_Main.gs, so that no spreadsheet id is ever
 * committed and the checked-in default is not "whatever was last compared".
 * OPTS stays in source: it is behaviour, and behaviour belongs under review.
 */

/**
 * Bumped by hand, at the commit that changes behaviour. Stamped into the CSV
 * filename and the summary head, so an output file can be attributed to a
 * build. GenerateTestWorkbooks.gs stamps FIXTURE_VERSION into both workbook
 * names for the same reason — without both, a CSV and the fixture pair that
 * produced it cannot be matched up, which is exactly what Step 11 needs.
 */
const VERSION = '1.2.0';

const OPTS = {
  derivedSection:  true,   // emit recalculated cells as DERIVED_VALUE into CSV section 2
  derivedCap:      5000,   // above this, section 2 is truncated and says so
  expandRows:      false,  // added/deleted rows -> one row per cell, not a preview
  epsilon:         1e-9,   // relative tolerance for numeric comparison
  similarity:      0.5,    // gap-matching threshold in alignment pass 2
  editDistanceCap: 0.30,   // skip a tab if more than this fraction of rows differ
  noiseWarn:       0.30    // warn if more than this fraction of SECTION 1 cells changed
};

/**
 * The complete output taxonomy — the single written-down list. Adding a change
 * type means adding it here, to SUMMARY_TYPE_COL (60_Summary.gs), and, if it is
 * an error type, to toCsv's rank map and buildSummary's error tally.
 */
const CHANGE_TYPES = [
  // cell-level
  'VALUE', 'FORMULA', 'FORMULA_UNVERIFIED', 'VOLATILE_VALUE', 'DERIVED_VALUE',
  'HARDCODED', 'FORMULARIZED',
  'REF_ERROR', 'REF_ERROR_NEW', 'REF_ERROR_FIXED',
  // structural
  'ROW_ADDED', 'ROW_DELETED', 'COL_ADDED', 'COL_DELETED',
  'TAB_ADDED', 'TAB_DELETED', 'TAB_RENAMED', 'TAB_SKIPPED',
  // workbook-level. The only change that leaves every formula byte-identical
  // in both files while the numbers move — see 41_Names.gs.
  'NAME_REDEFINED',
  // emitted by toCsv only, never present on a Change
  'DERIVED_TRUNCATED'
];

/**
 * Plan §0.5 / rule 13. Section membership is computed from the change type by
 * sectionOf() in 50_Csv.gs and is NEVER stored on a Change — a `section` field
 * would be a second source of truth that nothing enforces.
 *
 * Section 2 exists because a recalculated cell is real information and is also
 * one to three orders of magnitude more numerous than authored edits. Merged
 * into one table it buries the diff; dropped entirely it makes a downstream tab
 * showing no rows indistinguishable from a tool bug.
 */
const SECTION_2_TYPES = new Set(['DERIVED_VALUE']);

/**
 * Reference errors only. NOT #DIV/0!, #VALUE!, #N/A, #NUM! — those are
 * computation errors, and including them floods any model containing lookups
 * (plan §4h, test 11).
 */
const REF_ERROR_TOKENS = ['#REF!', '#NAME?'];

/** Alignment pass 1 refuses to run a DP table larger than this on either side. */
const ALIGN_WINDOW_MAX = 2000;

/**
 * hashRow field/cell separators. Chosen because no spreadsheet cell can
 * contain them.
 *
 * Written as fromCharCode rather than as an escaped literal, so that no NUL
 * byte ever reaches the file itself: an editor, a diff, a grep and `clasp
 * push` each handle one differently, and at least one of them silently. The
 * call reads no other global, so it is safe on any load order (see this file's
 * header).
 */
const HASH_CELL_SEP = String.fromCharCode(0);
const HASH_FORMULA  = String.fromCharCode(1);

/**
 * Plan Step 8: quota is 6T + 4 calls for T paired tabs. Above ~10 tabs per file,
 * pace the reads.
 */
const READ_PACE_TABS = 10;
const READ_PACE_MS   = 1000;
