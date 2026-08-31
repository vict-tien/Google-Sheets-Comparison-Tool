/**
 * ============================================================================
 * 50_Csv.gs — the emission layer, and the section boundary
 * ============================================================================
 *
 * The CSV holds TWO TABLES, not one (plan §6.1, rule 13):
 *
 *     tab,change,a_ref,b_ref,column,old,new        <- header
 *     ...authored changes, errors first...          <- section 1
 *                                                   <- blank line
 *     # SECTION 2 ...                               <- marker
 *     tab,change,a_ref,b_ref,column,old,new        <- header, repeated
 *     ...recalculated cells, workbook order...      <- section 2
 *
 * Section 1 is what someone reviewing a model revision reads. Section 2 is the
 * recalculation shadow — real information, and one to three orders of magnitude
 * larger. Merged into one table it buries the review; dropped entirely, a
 * downstream tab showing no rows is indistinguishable from a tool bug.
 *
 * MEMBERSHIP IS COMPUTED, NEVER STORED. sectionOf() reads the change type; a
 * `section` field on a Change would be a second source of truth that no test
 * can enforce (plan §0.5).
 *
 * Three things here are easy to get almost right, and "almost" fails:
 *
 *   - The section 2 block is emitted ONLY when it has rows. A marker over an
 *     empty table reads as a tool bug rather than as an absence of derived
 *     changes.
 *   - With derivedSection off there is no marker, no blank line and no second
 *     header — the file must be byte-identical to the pre-revision output.
 *     Test 36 asserts exactly that, and "almost identical" is meant to fail it.
 *   - The marker is NOT passed through csvField. csvField neutralises a leading
 *     =, +, - or @, not #, and quoting the marker line breaks the layout.
 */

const CSV_HEADER = 'tab,change,a_ref,b_ref,column,old,new';

/**
 * The section 2 separator. One line, written raw. Anything that reads this file
 * as a single flat table will see this line, the blank line above it and the
 * repeated header below it as three data rows — which is why buildSummary says
 * so out loud in the notes block rather than leaving it to be discovered.
 */
const CSV_SECTION_2_MARKER =
  '# SECTION 2 — DERIVED VALUES: cells whose formula is identical in both ' +
  'files and whose value changed';

/**
 * Plan §0.5. 1 or 2, from the change type and nothing else.
 *
 * Callers pass either a Change or diffCell's raw return; both carry `change`.
 */
function sectionOf(change) {
  return SECTION_2_TYPES.has(change.change) ? 2 : 1;
}

/**
 * Plan Step 6. RFC 4180, with a formula-injection guard in front of it.
 *
 * The order matters: prefixing must happen BEFORE quoting, or the apostrophe
 * lands inside the quotes and neutralises nothing, producing '"=A1,B1" — which
 * Sheets re-imports as a formula. Cells hold literal newlines via Alt+Enter,
 * and formulas hold commas as a matter of course, so both branches fire on real
 * data constantly.
 */
function csvField(v) {
  let s = (v === null || v === undefined) ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;                            // 1. neutralise
  if (/["\r\n,]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';  // 2. RFC 4180
  return s;
}

/**
 * Plan Step 6 and §6.1. Partition by sectionOf, sort each block independently,
 * join.
 *
 * SECTION 1 keeps the error-first sort: reference errors as a block at the top,
 * roots before inherited, and within each NEW then FIXED then pre-existing.
 * Errors are the class a reader wants to see as a SET, and a broken reference
 * outranks any value change in a model review. Everything else keeps workbook
 * order.
 *
 * SECTION 2 IS WORKBOOK ORDER ONLY. No error class exists there — an error is
 * never derived — and no severity ranking over recalculated cells is
 * meaningful. Imposing one would only make the block harder to scan against the
 * workbook it came from.
 *
 * Root-versus-inherited comes from errorState (§4h) via the internal `_root`
 * field, which is NOT a CSV column: the plan is explicit that the type plus
 * old/new must carry the distinction to a reader, and they do — a root row's
 * `new` reads "=Rates!#REF!", an inherited row's reads "#REF!". Rows assembled
 * by hand, without `_root`, fall back to reading exactly that.
 *
 * @param {Array<Change>} changes
 * @param {Object=} opts  OPTS; derivedSection and derivedCap are read here
 */
function toCsv(changes, opts) {
  opts = opts || OPTS;

  const section1 = [], section2 = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (sectionOf(c) === 2) section2.push(c); else section1.push(c);
  }

  const lines = [CSV_HEADER];
  const emit = function (c) {
    lines.push([c.tab, c.change, c.aRef, c.bRef, c.column, c.old, c.new]
               .map(csvField).join(','));
  };

  csvSortSection1_(section1).forEach(emit);

  // derivedSection off means the pre-revision file, exactly: one header, one
  // block, nothing appended. diffCell emits no DERIVED_VALUE in that mode, so
  // section2 is already empty — the explicit guard is here so that a hand-built
  // row array cannot smuggle a second table into a run that asked for one.
  if (!opts.derivedSection || section2.length === 0) return lines.join('\n');

  // TRUNCATE AFTER SORTING, NEVER BEFORE. Both orders satisfy a count check;
  // only this one makes the file deterministic and a re-run byte-identical,
  // which is what test 37 asserts.
  const cap = (opts.derivedCap === undefined) ? section2.length : opts.derivedCap;
  const kept = section2.slice(0, cap);
  const dropped = section2.length - kept.length;

  lines.push('');
  lines.push(CSV_SECTION_2_MARKER);   // raw: see this file's header
  lines.push(CSV_HEADER);
  kept.forEach(emit);
  if (dropped > 0) {
    emit({ tab: '', change: 'DERIVED_TRUNCATED', aRef: '', bRef: '', column: '',
           old: '',
           new: dropped + ' further derived rows suppressed — ' +
                'raise OPTS.derivedCap' });
  }

  return lines.join('\n');
}

/**
 * Section 1's sort. Split out so the two blocks cannot accidentally share one:
 * applying this ranking to section 2 would be a no-op today and a silent
 * reordering the day any section-2 type is added.
 */
function csvSortSection1_(changes) {
  const rank = { REF_ERROR_NEW: 0, REF_ERROR_FIXED: 1, REF_ERROR: 2 };

  const keyed = changes.map(function (c, i) {
    const isErr = Object.prototype.hasOwnProperty.call(rank, c.change);
    return {
      c: c, i: i,
      k0: isErr ? 0 : 1,
      k1: isErr ? (changeIsRoot_(c) ? 0 : 1) : 0,
      k2: isErr ? rank[c.change] : 0
    };
  });

  keyed.sort(function (x, y) {
    return (x.k0 - y.k0) || (x.k1 - y.k1) || (x.k2 - y.k2) || (x.i - y.i);
  });

  return keyed.map(function (k) { return k.c; });
}

function changeIsRoot_(c) {
  if (c._root !== undefined) return c._root;
  return sideIsRoot_(c.new) || sideIsRoot_(c.old);
}

function sideIsRoot_(s) {
  s = String(s === null || s === undefined ? '' : s);
  if (s.charAt(0) !== '=') return false;
  for (let i = 0; i < REF_ERROR_TOKENS.length; i++) {
    if (s.indexOf(REF_ERROR_TOKENS[i]) !== -1) return true;
  }
  return false;
}
