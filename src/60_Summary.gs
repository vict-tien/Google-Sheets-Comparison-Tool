/**
 * ============================================================================
 * 60_Summary.gs — Step 10, the log summary
 * ============================================================================
 *
 * Pure. It reads the bundle compareWorkbooks returned and formats text; nothing
 * here touches a Google service, so the summary is testable on fixtures like
 * everything else.
 *
 * Four blocks: Head (VERSION, then the A:/B: titles with tab counts), Table
 * (one row per tab), Totals, Notes.
 *
 * TWO LINES ARE MANDATORY whenever their counts are non-zero: what broke in
 * this revision, and the statement that pre-existing errors are a STATE REPORT
 * rather than a change. Without the second, a reader filters them out along
 * with the diff noise — exactly what this tool exists to prevent. Test '10b'
 * asserts both by their text, which is the point: asserting only the count lets
 * a rewording silently drop the sentence that gave the number meaning.
 *
 * A DASH IS NOT A ZERO. `0` under VAL asserts "no value changes here". For a
 * SKIPPED, added or deleted tab that is false and unfalsifiable — nothing
 * looked. Tests '10c' and '10g'.
 */

/**
 * Numeric columns, in the plan's order. REF IS FIRST AND STAYS FIRST: a broken
 * reference outranks any value change in a model review (plan Step 10).
 *
 * DERIV SITS PAST A RULE, after ±COL. It counts section-2 rows, which run one
 * to three orders of magnitude larger than every column left of it, and a wide
 * number in the middle of the table drags the eye off the ones that need
 * reading. The rule is a real column here (`rule: true`) so the header, every
 * row and the horizontal rule stay aligned by construction rather than by three
 * separate string literals agreeing.
 */
const SUMMARY_COLS = [
  { key: 'REF',    w: 6 },
  { key: 'VAL',    w: 6 },
  { key: 'FORM',   w: 7 },
  { key: 'UNVER',  w: 8 },
  { key: 'VOL',    w: 6 },
  { key: 'HARD',   w: 7 },
  { key: 'FMLZD',  w: 8 },
  { key: '±ROW', w: 7 },
  { key: '±COL', w: 7 },
  { key: '│',    w: 3, rule: true },
  { key: 'DERIV',  w: 8 }
];

/**
 * Change type -> summary column. A type absent from this map is treated as
 * STRUCTURAL: it appears in the CSV and counts toward nothing in this table.
 * That is the intended default for TAB_*, ROW_* and COL_* — and a trap for a
 * new cell type, which will silently tally nowhere until it is added here.
 */
const SUMMARY_TYPE_COL = {
  REF_ERROR: 'REF', REF_ERROR_NEW: 'REF', REF_ERROR_FIXED: 'REF',
  VALUE: 'VAL', FORMULA: 'FORM', FORMULA_UNVERIFIED: 'UNVER',
  VOLATILE_VALUE: 'VOL', HARDCODED: 'HARD', FORMULARIZED: 'FMLZD',
  DERIVED_VALUE: 'DERIV'
};

/**
 * Plan Step 10. Fixed-width, no colour, no dependencies.
 *
 * Signature note: the plan's module map says buildSummary(results), but a
 * summary needs the pairing (added / deleted / renamed tabs and the
 * ambiguous-name warnings), the change rows themselves (the per-type tallies and
 * the root-versus-inherited split live there, not in stats) and the run's own
 * facts (file names, row count, elapsed). So it takes the whole report:
 *
 *   { titleA, titleB, tabCountA, tabCountB, result, fileName, fileUrl,
 *     csvRows, elapsedMs }
 *
 * `result` is compareWorkbooks' return value. Everything else is optional and
 * degrades to a placeholder, which is what lets the tests call it on a bare
 * comparison with no Drive file behind it.
 *
 * BOTH ERROR LINES ARE MANDATORY when their counts are non-zero (plan Step 10):
 * one for what broke in this revision, one making explicit that pre-existing
 * errors are a STATE REPORT rather than a change. Without the second, a reader
 * filters them out as diff noise — which is precisely the requirement this tool
/**
 * Plan Step 10. Fixed-width, no colour, no dependencies.
 *
 * Signature note: the plan's module map says buildSummary(results), but a
 * summary needs the pairing (added / deleted / renamed tabs and the
 * ambiguous-name warnings), the change rows themselves (the per-type tallies and
 * the root-versus-inherited split live there, not in stats) and the run's own
 * facts (file names, row count, elapsed). So it takes the whole report:
 *
 *   { titleA, titleB, tabCountA, tabCountB, result, fileName, fileUrl,
 *     csvRows, elapsedMs }
 *
 * `result` is compareWorkbooks' return value. Everything else is optional and
 * degrades to a placeholder, which is what lets the tests call it on a bare
 * comparison with no Drive file behind it.
 *
 * BOTH ERROR LINES ARE MANDATORY when their counts are non-zero (plan Step 10):
 * one for what broke in this revision, one making explicit that pre-existing
 * errors are a STATE REPORT rather than a change. Without the second, a reader
 * filters them out as diff noise — which is precisely the requirement this tool
 * exists to serve.
 */
function buildSummary(report) {
  report = report || {};
  const result  = report.result;
  const changes = result.changes;
  const pairing = result.pairing;
  const L = [];

  // ---- tally the change rows per tab -------------------------------------
  // Per-type counts come from the rows, not from stats: stats knows how many
  // cells were emitted but not what they were called, and the error split is
  // only visible on the rows.
  const byTab = {};
  const bucket = function (name) {
    if (!byTab[name]) {
      byTab[name] = { REF: 0, VAL: 0, FORM: 0, UNVER: 0, VOL: 0, HARD: 0,
                      FMLZD: 0, DERIV: 0, cells: 0 };
    }
    return byTab[name];
  };

  let refNew = 0, refFixed = 0, refPre = 0, refRoot = 0, refInherited = 0;
  // The two section counts. They describe very different review jobs, so the
  // footer reports them apart rather than as one total.
  let sec1 = 0, sec2 = 0;
  // Workbook-level, so it belongs to no tab and lands in no column of the table
  // below. It gets its own line instead — silence would make the one change
  // that leaves every formula identical the one change nobody sees.
  let namesRedefined = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (c.change === 'NAME_REDEFINED') namesRedefined++;
    if (sectionOf(c) === 2) sec2++; else sec1++;
    const col = SUMMARY_TYPE_COL[c.change];
    if (col) { const b = bucket(c.tab); b[col]++; b.cells++; }
    if (c.change === 'REF_ERROR_NEW')        refNew++;
    else if (c.change === 'REF_ERROR_FIXED') refFixed++;
    else if (c.change === 'REF_ERROR')       refPre++;
    if (col === 'REF') {
      if (changeIsRoot_(c)) refRoot++; else refInherited++;
    }
  }
  const refTotal = refNew + refFixed + refPre;

  // ---- one table row per tab --------------------------------------------
  // Paired tabs in A's order (exact matches first, then renames — pairTabs
  // builds `pairs` that way), then deleted, then added.
  const rows = [];
  let nChanged = 0, nUnchanged = 0, nSkipped = 0;

  for (let i = 0; i < result.results.length; i++) {
    const s = result.results[i];
    const b = bucket(s.tab);
    const structural = s.rowsAdded + s.rowsDeleted + s.colsAdded + s.colsDeleted;
    let status;
    if (s.skipped) {
      status = 'SKIPPED'; nSkipped++;
    } else if (b.cells > 0 || structural > 0) {
      // A renamed tab whose cells also changed must not read as merely
      // "renamed" — that would hide every row in it.
      status = s.renamedTo ? 'ren+mod' : 'modified'; nChanged++;
    } else if (s.renamedTo) {
      status = 'renamed'; nChanged++;
    } else {
      status = 'unchanged'; nUnchanged++;
    }
    rows.push({
      label: s.renamedTo ? (s.tab + ' → ' + s.renamedTo) : s.tab,
      status: status,
      tally: b,
      stats: s,
      // A skipped tab's cells were never compared, so every column but REF is a
      // dash. Printing 0 there would assert "no value changes", which is a lie.
      numeric: !s.skipped
    });
  }

  for (let i = 0; i < pairing.deleted.length; i++) {
    rows.push({ label: pairing.deleted[i], status: 'deleted', tally: null,
                stats: null, numeric: false, refDash: true });
    nChanged++;
  }
  for (let i = 0; i < pairing.added.length; i++) {
    // Added tabs are error-scanned and nothing else (plan Step 9, phase 1), so
    // REF is real and the rest are dashes.
    rows.push({ label: pairing.added[i], status: 'added',
                tally: bucket(pairing.added[i]), stats: null, numeric: false });
  }

  // ---- render -----------------------------------------------------------
  let tabW = 20;
  for (let i = 0; i < rows.length; i++) tabW = Math.max(tabW, rows[i].label.length);
  const statusW = 11;

  let header = padR_('TAB', tabW + 2) + padR_('STATUS', statusW);
  for (let i = 0; i < SUMMARY_COLS.length; i++) {
    header += padL_(SUMMARY_COLS[i].key, SUMMARY_COLS[i].w);
  }
  // The horizontal rule is derived from the header rather than written beside
  // it, so the vertical rule before DERIV lands on a crossing and cannot drift
  // out of position when a column width changes.
  const rule = summaryRule_(header);

  // The VERSION stamp goes first, on its own line. An old CSV and the summary
  // that described it are attributable to a build only if both carry it; the
  // filename carries the other half.
  L.push('sheets-diff v' + VERSION);
  L.push('A: ' + padR_(String(report.titleA || '(A)'), tabW + 2) +
         '(' + (report.tabCountA !== undefined ? report.tabCountA : '?') + ' tabs)');
  L.push('B: ' + padR_(String(report.titleB || '(B)'), tabW + 2) +
         '(' + (report.tabCountB !== undefined ? report.tabCountB : '?') + ' tabs)');
  L.push('');
  L.push(header);
  L.push(rule);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let line = padR_(r.label, tabW + 2) + padR_(r.status, statusW);
    for (let k = 0; k < SUMMARY_COLS.length; k++) {
      const col = SUMMARY_COLS[k];
      line += padL_(col.rule ? col.key : summaryCell_(r, col.key), col.w);
    }
    L.push(line);
  }
  L.push(rule);

  // ---- totals -----------------------------------------------------------
  let totals = nChanged + ' changed, ' + nUnchanged + ' unchanged, ' +
               nSkipped + ' skipped.';
  if (pairing.added.length) totals += '  ' + pairing.added.length + ' added in B.';
  const sum = function (key) {
    let n = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i].tally) n += rows[i].tally[key];
    return n;
  };
  totals += '  ' + sum('VAL') + ' values, ' + sum('FORM') + ' formulas, ' +
            sum('HARD') + ' hardcodes, ' + sum('VOL') + ' volatile.';
  L.push(totals);

  // Suppressed at zero, like every other optional line: a run with nothing
  // derived should not spend a line saying so. The reference-error tally is the
  // one exception, because silence there reads as "not checked".
  const derivedTotal = sum('DERIV');
  if (derivedTotal > 0) {
    L.push('DERIVED: ' + derivedTotal + ' cell' + (derivedTotal === 1 ? '' : 's') +
           ' recalculated with unchanged formulas (section 2).');
  }

  if (namesRedefined > 0) {
    L.push('NAMES: ' + namesRedefined + ' defined name' +
           (namesRedefined === 1 ? ' was' : 's were') + ' repointed. Every ' +
           'formula using ' + (namesRedefined === 1 ? 'it' : 'them') +
           ' is unchanged in text.');
  }

  if (refTotal === 0) {
    L.push('REFERENCE ERRORS: none in either file.');
  } else {
    L.push('REFERENCE ERRORS: ' + refTotal + ' total — ' + refNew + ' new, ' +
           refFixed + ' fixed, ' + refPre + ' pre-existing.  ' +
           refRoot + ' root, ' + refInherited + ' inherited.');
  }

  // Two counts when there are two tables, one when there is one. The split
  // form is not printed over an empty section 2 for the same reason the CSV
  // does not emit the block: a "0 in section 2" reads as a tool state rather
  // than as an absence of derived changes.
  let footer = '→ ' + (report.fileName || '(no file written)') + ' (';
  if (sec2 > 0) {
    footer += sec1 + ' rows in section 1, ' + sec2 + ' in section 2';
  } else {
    footer += (report.csvRows !== undefined ? report.csvRows : changes.length) +
              ' rows';
  }
  if (report.elapsedMs !== undefined) {
    footer += ', ' + Math.round(report.elapsedMs / 1000) + 's';
  }
  L.push(footer + ')');
  if (report.fileUrl) L.push('  ' + report.fileUrl);

  // ---- the warning block ------------------------------------------------
  L.push('');
  const notes = summaryNotes_(result, {
    refNew: refNew, refPre: refPre, refTotal: refTotal, rows: rows,
    sec2: sec2, opts: report.opts || OPTS
  });
  for (let i = 0; i < notes.length; i++) L.push(notes[i]);

  return L.join('\n');
}

/** One table cell: a right-aligned number, or a dash where nothing was measured. */
function summaryCell_(r, key) {
  const DASH = '—';
  if (key === 'REF') {
    return r.refDash ? DASH : String(r.tally ? r.tally.REF : 0);
  }
  // DERIV takes the dash logic unchanged: a tab nothing compared shows —, not
  // 0, because 0 would assert "nothing recalculated here" about cells no pass
  // ever looked at.
  if (!r.numeric) return DASH;
  if (key === '±ROW') return signed_(r.stats.rowsAdded - r.stats.rowsDeleted);
  if (key === '±COL') return signed_(r.stats.colsAdded - r.stats.colsDeleted);
  return String(r.tally[key]);
}

/**
 * The header's own horizontal rule. Built by mapping the header, so the column
 * separator gets a crossing wherever the vertical rule sits and everything else
 * gets a dash — no position arithmetic to keep in sync.
 */
function summaryRule_(header) {
  let out = '';
  for (let i = 0; i < header.length; i++) {
    out += (header.charAt(i) === '│') ? '┼' : '─';
  }
  return out;
}

/**
 * Plan Step 10's warning block, in the plan's order. Each note is suppressed
 * when its count is zero, EXCEPT the two error lines, which are mandatory
 * whenever any error exists — see buildSummary's header comment.
 */
function summaryNotes_(result, t) {
  const out = [];
  const results = result.results;

  if (t.refNew > 0) {
    out.push('⚠ ' + t.refNew + ' reference' + (t.refNew === 1 ? '' : 's') +
             ' broke in this revision (REF_ERROR_NEW). Read these first.');
  }
  if (t.refPre > 0) {
    out.push('⚠ ' + t.refPre + ' pre-existing reference error' +
             (t.refPre === 1 ? ' was' : 's were') +
             ' already present in both files (REF_ERROR).');
    out.push('  These are not changes — they are flagged because the scan ' +
             'reports state, not deltas.');
  }

  // Skipped tabs, each with the errors that were still scanned inside it.
  for (let i = 0; i < results.length; i++) {
    const s = results[i];
    if (!s.skipped) continue;
    let refs = 0;
    for (let k = 0; k < t.rows.length; k++) {
      if (t.rows[k].stats === s) { refs = t.rows[k].tally.REF; break; }
    }
    out.push('⚠ ' + s.tab + ' skipped: ' + s.reason + '.');
    out.push(refs === 0
      ? '  It was still scanned and holds no reference errors; its cells were ' +
        'not compared.'
      : '  Its ' + refs + ' reference error' + (refs === 1 ? ' was' : 's were') +
        ' still scanned; its cells were not compared.');
  }

  // Unverifiable references, attributed to the tab whose row map is missing —
  // which is the tab a reader has to go and look at (plan Step 11.6).
  let unverified = 0;
  const targets = {};
  for (let i = 0; i < results.length; i++) {
    unverified += results[i].unverified;
    const ut = results[i].unverifiedTargets || {};
    Object.keys(ut).forEach(function (k) {
      targets[k] = (targets[k] || 0) + ut[k];
    });
  }
  if (unverified > 0) {
    const parts = Object.keys(targets).map(function (k) {
      return k + ' (' + targets[k] + ')';
    });
    out.push('⚠ ' + unverified + (unverified === 1 ? ' formula holds'
                                                   : ' formulas hold') +
             ' unverifiable references' +
             (parts.length ? ' into: ' + parts.join(', ') : '') + '.');
    out.push('  A large count means a referenced tab was skipped or unpaired.');
  }

  // Volatile. The gap between emitted and total is the point: a volatile
  // formula whose value happened not to change is NOT detected (plan §0.3).
  let volEmitted = 0, volCells = 0;
  for (let i = 0; i < results.length; i++) {
    volEmitted += results[i].volatileEmitted;
    volCells   += results[i].volatileCells;
  }
  if (volEmitted > 0) {
    out.push('⚠ ' + volEmitted + ' INDIRECT/OFFSET formula' +
             (volEmitted === 1 ? '' : 's') +
             ' changed value with identical text (VOLATILE_VALUE).');
  }
  if (volCells > 0) {
    out.push('  ' + volCells + (volCells === 1 ? ' volatile formula exists'
                                              : ' volatile formulas exist') +
             ' in total — any whose value happened not to change are ' +
             'NOT detected.');
  }

  // Derived values: the truncation warning first, because it reports LOSS, and
  // a note about where rows are must not sit above a note that some are gone.
  let derived = 0;
  for (let i = 0; i < results.length; i++) derived += results[i].derived;
  if (derived > 0) {
    const cap = (t.opts && t.opts.derivedCap !== undefined)
      ? t.opts.derivedCap : OPTS.derivedCap;
    if (t.sec2 > cap) {
      const lost = t.sec2 - cap;
      out.push('⚠ Section 2 truncated at ' + cap + ' rows — ' + lost +
               ' further derived row' + (lost === 1 ? ' is' : 's are') +
               ' NOT in the CSV.');
      out.push('  Raise OPTS.derivedCap and re-run if the recalculation shadow ' +
               'is what you came to read.');
    }
    out.push('ℹ Derived values: ' + derived + ' cell' +
             (derived === 1 ? '' : 's') +
             ' changed value with identical formulas — SECTION 2 of the CSV.');
    out.push('  A downstream tab may show no rows in section 1 even where its ' +
             'numbers moved; the cause');
    out.push('  is reported at its root, which in a reference chain can sit ' +
             'several tabs away.');
    out.push('ℹ The CSV holds two tables. A plain import reads the blank ' +
             'line, the # marker and the');
    out.push('  repeated header as three data rows — split the file at the ' +
             'marker before importing.');
  }

  // Relocation footer. Plan Step 11.4 reads this as the field check for §1.2a.
  let relocated = 0, moved = 0;
  const movedTabs = [];
  for (let i = 0; i < results.length; i++) {
    const s = results[i];
    relocated += s.relocated;
    if (s.rowsAdded || s.rowsDeleted) {
      moved += s.rowsAdded + s.rowsDeleted;
      // A net delta of zero still moved rows. Reporting "0 rows in X" hides an
      // insertion and a deletion that cancelled, so both counts are shown.
      const d = s.rowsAdded - s.rowsDeleted;
      movedTabs.push((s.rowsAdded && s.rowsDeleted)
        ? ('+' + s.rowsAdded + '/-' + s.rowsDeleted + ' rows in ' + s.tab)
        : (signed_(d) + ' row' + (Math.abs(d) === 1 ? '' : 's') + ' in ' + s.tab));
    }
  }
  if (relocated > 0 || moved > 0) {
    out.push('ℹ References relocated: ' +
             (movedTabs.length ? movedTabs.join(', ') + ', ' : '') +
             relocated + ' formula' + (relocated === 1 ? '' : 's') + ' realigned.');
  }

  // Plan Step 11.4, automated. 0 realigned while rows moved AND absolute
  // references exist is the signature of REF_RE matching nothing — the one
  // failure mode of Step 4 that is otherwise completely silent, and the reason
  // plan §1.2a gates the whole build. The absRefs gate keeps it from firing on a
  // workbook that simply has nothing to realign.
  let absRefs = 0;
  for (let i = 0; i < results.length; i++) absRefs += results[i].absRefs;
  if (relocated === 0 && moved > 0 && absRefs > 0) {
    out.push('⚠ 0 formulas realigned while ' + moved + ' row' +
             (moved === 1 ? '' : 's') + ' moved, yet ' + absRefs +
             ' formula' + (absRefs === 1 ? ' holds' : 's hold') +
             ' absolute row');
    out.push('  references. Step 4 may be matching nothing: verify the R1C1 ' +
             'reference forms against');
    out.push('  plan §1.2a before trusting the FORMULA rows in this run.');
  }

  for (let i = 0; i < results.length; i++) {
    if (!results[i].noise) continue;
    out.push('⚠ ' + results[i].tab + ': ' + results[i].emitted + ' of ' +
             results[i].compared + ' compared cells changed — above the ' +
             'noise threshold. Check the alignment.');
  }

  const warnings = result.pairing.warnings || [];
  for (let i = 0; i < warnings.length; i++) out.push('⚠ ' + warnings[i]);

  return out;
}

function padR_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function padL_(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}

function repeat_(ch, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ch;
  return s;
}

function signed_(n) {
  return n > 0 ? ('+' + n) : String(n);
}
