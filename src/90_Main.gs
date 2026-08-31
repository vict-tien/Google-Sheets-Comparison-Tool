/**
 * ============================================================================
 * 90_Main.gs — THE ONLY IMPURE FILE
 * ============================================================================
 *
 * Everything that touches SpreadsheetApp, DriveApp, PropertiesService,
 * Utilities, Session or MimeType lives here and nowhere else. That is now
 * enforceable by one grep over the file tree rather than by a banner comment
 * and a convention:
 *
 *     grep -l 'SpreadsheetApp\|DriveApp\|PropertiesService\|Utilities\|Session\|MimeType' src/*.gs
 *
 * must name this file and no other. The property it protects is that
 * runTests() raises NO AUTHORISATION PROMPT — which is what lets 79 tests run
 * on in-memory fixtures. No test can catch a violation, because the suite never
 * runs inside Apps Script; the grep is the whole defence.
 *
 * NOTHING HERE WRITES TO EITHER SOURCE SPREADSHEET. The only write anywhere in
 * the tool is the single DriveApp.createFile in runWith(). Read-only by
 * construction is what makes the tool safe to point at a live model, and
 * appsscript.json requests spreadsheets.readonly so the platform enforces it
 * rather than the code merely promising it.
 *
 * THE MANIFEST CANNOT CARRY COMMENTS, so the scope decisions live here.
 * appsscript.json requests exactly two:
 *
 *   spreadsheets.readonly   openByUrl, getSheets, getDataRange and the three
 *                           grid getters. READONLY is the point: the platform
 *                           refuses a write to a source file rather than this
 *                           code merely declining to attempt one.
 *   drive.file              the one DriveApp.createFile. drive.file grants
 *                           access to files this script itself created and
 *                           nothing else, which is the narrowest scope that
 *                           still writes the CSV.
 *
 * script.external_request is DELIBERATELY ABSENT, not overlooked: nothing in
 * this build makes an external request, and adding the scope "just in case"
 * would put a network capability behind the same consent screen as the read.
 * PropertiesService, Utilities and Session need no scope at all.
 *
 * ENTRY POINTS IN THE DROPDOWN, AND ONLY THESE:
 *   verifyReferenceForms(url [, tab])   plan §1.2 — RUN THIS FIRST
 *   run()                               config from Script Properties
 *   runWith(urlA, urlB, opts)           the tool, no ambient state
 *   runTests()                          the suite; needs no spreadsheet
 */

/**
 * Plan Step 8. The ONLY Sheets I/O in the tool: three grids and the two offsets
 * of one tab, trimmed.
 *
 * getDataRange() DOES NOT NECESSARILY START AT A1. If the first populated cell
 * is C5 then rowOffset is 5 and colOffset is 3, and ignoring them corrupts every
 * emitted reference AND every absolute-row lookup in relocate() — the second with
 * no visible symptom, because a formula relocated through a map keyed on the
 * wrong rows still comes out looking like a formula.
 *
 * All three arrays have identical dimensions and non-formula cells return '' from
 * both formula methods. getValues() returns error tokens as plain strings, which
 * is what makes errorState (§4h) free.
 *
 * Takes anything with getDataRange() — a Sheet, or a stub. That is deliberate:
 * it is the one I/O function whose contract can be tested without a spreadsheet.
 */
function readTab(sheet) {
  const range = sheet.getDataRange();
  return trimGrid({
    values:    range.getValues(),
    fR1C1:     range.getFormulasR1C1(),
    fA1:       range.getFormulas(),
    rowOffset: range.getRow(),
    colOffset: range.getColumn()
  });
}

/**
 * Reads the tabs named in `wanted` into the { tabs, names } shape
 * compareWorkbooks consumes.
 *
 * `names` carries EVERY tab in the file even though `tabs` holds only the wanted
 * ones. That is not an inconsistency: pairTabs must see the full name list to
 * pair correctly, while a tab deleted in B needs no grid read — TAB_DELETED
 * carries no cell rows. Reading it would cost 3 API calls to produce nothing.

/**
 * Reads the tabs named in `wanted` into the { tabs, names } shape
 * compareWorkbooks consumes.
 *
 * `names` carries EVERY tab in the file even though `tabs` holds only the wanted
 * ones. That is not an inconsistency: pairTabs must see the full name list to
 * pair correctly, while a tab deleted in B needs no grid read — TAB_DELETED
 * carries no cell rows. Reading it would cost 3 API calls to produce nothing.
 */
function readSheets_(sheets, names, wanted) {
  const tabs = {};
  const pace = sheets.length > READ_PACE_TABS;
  for (let i = 0; i < sheets.length; i++) {
    if (wanted && !wanted[names[i]]) continue;
    tabs[names[i]] = readTab(sheets[i]);
    if (pace && i < sheets.length - 1) Utilities.sleep(READ_PACE_MS);
  }
  return { tabs: tabs, names: names };
}

function sheetNames_(sheets) {
  return sheets.map(function (s) { return s.getName(); });
}

/**
 * The dropdown entry point. Resolves configuration and calls runWith.
 *
 * THE URLS ARE NOT IN SOURCE. They are Script Properties, so that no
 * spreadsheet id is committed and the checked-in default is not whatever was
 * last compared. OPTS stays in source, because it is behaviour and behaviour
 * belongs under review.
 *
 * Project Settings → Script Properties → URL_A, URL_B.
 */
function run() {
  const props = PropertiesService.getScriptProperties();
  const urlA = props.getProperty('URL_A');
  const urlB = props.getProperty('URL_B');
  if (!urlA || !urlB) {
    throw new Error(
      'Set URL_A and URL_B in Project Settings → Script Properties.');
  }
  return runWith(urlA, urlB, OPTS);
}

/**
 * Plan Step 9. Opens both files, compares them, writes one CSV to Drive and logs
 * the summary. Takes no ambient state and returns its counts, which is what
 * makes it callable from a scratch function with two URLs and a modified opts.
 *
 * The two-phase ordering — every tab aligned before any tab is compared — lives
 * inside compareWorkbooks and is NOT re-implemented here. That is load-bearing:
 * relocating Rates!R4C2 inside the HVAC tab needs the Rates row map, and a
 * single-pass loop that reads, aligns and compares one tab at a time cannot have
 * it. The symptom is false FORMULA rows across every referencing tab, plausible
 * enough to be believed. Tests 18, 22 and 26 hold that ordering.
 *
 * Phase 0 pairs on NAMES ONLY, before any grid is read, so that the read in
 * phase 1 can skip tabs that no comparison will ever look at.
 *
 * console.log gets the summary and NEVER the CSV — Apps Script truncates large
 * log payloads with no documented ceiling, so a logged CSV silently loses rows.
 */
function runWith(urlA, urlB, opts) {
  const t0 = Date.now();
  opts = opts || OPTS;

  // PHASE 0 — pair, on names alone.
  const ssA = SpreadsheetApp.openByUrl(urlA);
  const ssB = SpreadsheetApp.openByUrl(urlB);
  const shA = ssA.getSheets(), shB = ssB.getSheets();
  const namesA = sheetNames_(shA), namesB = sheetNames_(shB);

  // Advisory only. compareWorkbooks pairs again and that call is authoritative;
  // this one exists to decide what is worth reading. pairTabs is deterministic
  // over the same inputs, so the two cannot disagree.
  const plan = pairTabs(namesA, namesB);
  const wantA = {}, wantB = {};
  for (let i = 0; i < plan.pairs.length; i++) {
    wantA[plan.pairs[i][0]] = true;
    wantB[plan.pairs[i][1]] = true;
  }
  for (let i = 0; i < plan.added.length; i++) wantB[plan.added[i]] = true;

  // PHASES 1 and 2 — read, align every tab, then compare every tab.
  const wbA = readSheets_(shA, namesA, wantA);
  const wbB = readSheets_(shB, namesB, wantB);
  const result = compareWorkbooks(wbA, wbB, opts);

  // PHASE 3 — emit. The filename carries VERSION so a CSV found later can be
  // attributed to a build; GenerateTestWorkbooks.gs stamps FIXTURE_VERSION into
  // the workbook names for the same reason, and Step 11 needs both halves to
  // check a run against a checklist written for a specific fixture version.
  const fileName = 'changes-' + stamp_() + '-v' + VERSION + '.csv';
  const file = DriveApp.createFile(fileName, toCsv(result.changes, opts),
                                   MimeType.CSV);

  const summary = buildSummary({
    titleA: ssA.getName(), titleB: ssB.getName(),
    tabCountA: namesA.length, tabCountB: namesB.length,
    result: result, opts: opts,
    fileName: fileName, fileUrl: file.getUrl(),
    csvRows: result.changes.length,
    elapsedMs: Date.now() - t0
  });
  console.log(summary);

  return { fileId: file.getId(), fileUrl: file.getUrl(),
           rows: result.changes.length, summary: summary };
}

/** yyyyMMdd-HHmm in the script's own timezone. */
function stamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
                              'yyyyMMdd-HHmm');
}

/**
 * Plan §1.2, run against a real file instead of by hand. RUN THIS BEFORE
 * TRUSTING ANY OUTPUT OF run().
 *
 * §1.2 gates Step 4 and it is the one thing in this plan that cannot be
 * discharged from fixtures: REF_RE is written against the reference forms the
 * plan TABULATES, and the fixtures assert against those same tabulated forms, so
 * THE TEST SUITE CANNOT DETECT A MISMATCH WITH REALITY. If the real
 * getFormulasR1C1() output differs, relocation silently no-ops and every shifted
 * reference is reported as an authored change — no error, no warning.
 *
 * What it reports:
 *   (a) every formula cell's A1 and R1C1 form side by side, and — the part that
 *       matters — every R1C1 formula in which REF_RE finds NO reference. A
 *       cross-sheet or absolute-row formula in that list means the regex is
 *       broken for this workbook.
 *   (b) for each cell whose A1 form carries #REF! or #NAME?, whether the literal
 *       token SURVIVES into the R1C1 form. §4h's root-versus-inherited test is a
 *       substring match against it; if R1C1 drops or transforms the token, every
 *       broken reference is misclassified as inherited. This rendering is not
 *       documented anywhere — it has to be observed.
 *
 * Read-only. Pass a tab name to narrow it, or omit for every tab. With no url
 * it falls back to the URL_A Script Property, so it runs from the dropdown.
 *
 * The plan calls this entry point verifyR1C1(). The name here is the one kept:
 * this function does strictly more than the plan's sketch — part (b) and the
 * no-match list are both beyond it — and renaming a working gate to match a
 * sketch buys nothing.
 */
function verifyReferenceForms(url, tabName) {
  const target = url ||
    PropertiesService.getScriptProperties().getProperty('URL_A');
  if (!target) {
    throw new Error('Pass a URL, or set URL_A in Project Settings → ' +
                    'Script Properties.');
  }
  const ss = SpreadsheetApp.openByUrl(target);
  const sheets = tabName ? [ss.getSheetByName(tabName)] : ss.getSheets();
  if (!sheets[0]) throw new Error('no such tab: ' + tabName);

  const L = ['STEP 1.2 — reference forms observed in "' + ss.getName() + '"', ''];
  const unmatched = [], errCells = [];
  let formulaCells = 0, withRefs = 0, brokenNoMatch = 0;

  for (let s = 0; s < sheets.length; s++) {
    const name = sheets[s].getName();
    const tab = readTab(sheets[s]);
    const width = gridWidth_(tab);

    for (let r = 0; r < tab.fA1.length; r++) {
      for (let c = 0; c < width; c++) {
        const a1f = tab.fA1[r][c], rcf = tab.fR1C1[r][c];
        if (a1f === '' && rcf === '') continue;
        formulaCells++;
        const ref = a1(r + tab.rowOffset, c + tab.colOffset);
        // padR_, the production left-aligner in 60_Summary.gs. The harness
        // has its own t_pad; the two are deliberately not merged, and
        // production code must not reach into the test files at all.
        L.push(padR_(name + '!' + ref, 28) + padR_(a1f, 44) + rcf);

        // (b) does the error token survive into R1C1? Computed first because (a)
        //     needs to know whether an unmatched formula is merely broken.
        const tok = REF_ERROR_TOKENS.filter(function (t) {
          return a1f.indexOf(t) !== -1 || rcf.indexOf(t) !== -1;
        })[0];

        // (a) does REF_RE see anything at all in this R1C1 form?
        const found = [];
        rewriteRefs_(rcf, function (m) {
          found.push(formatRef_(m.sheet, m.rowPart, m.colPart));
          return '';
        });
        if (found.length) withRefs++;
        // A formula whose reference is already #REF! has no R/C form left to
        // match, and one like =TODAY() never had one. Neither says anything about
        // REF_RE, so they are counted apart to keep the actionable list short.
        else if (tok) brokenNoMatch++;
        else unmatched.push(name + '!' + ref + '  ' + rcf);

        if (tok) {
          errCells.push(name + '!' + ref + '  A1 has ' + tok + ', R1C1 ' +
                        (rcf.indexOf(tok) !== -1 ? 'KEEPS it  ' + rcf
                                                 : 'DROPS it  ' + rcf));
        }
      }
    }
  }

  L.push('');
  L.push('(a) ' + formulaCells + ' formula cells, ' + withRefs +
         ' in which REF_RE matched at least one reference.');
  if (brokenNoMatch) {
    L.push('    ' + brokenNoMatch + (brokenNoMatch === 1 ? ' more holds' : ' more hold') +
           ' a reference error and so have no R/C form left to match — expected.');
  }
  if (unmatched.length) {
    L.push('    ' + unmatched.length + ' with NO match and no error token. A ' +
           'reference-free formula such as');
    L.push('    =TODAY() belongs here; a cross-sheet or absolute-row reference ' +
           'does NOT — that means');
    L.push('    REF_RE is wrong for this workbook and Step 4 is silently ' +
           'no-opping. Read each one:');
    for (let i = 0; i < Math.min(unmatched.length, 20); i++) {
      L.push('      ' + unmatched[i]);
    }
    if (unmatched.length > 20) {
      L.push('      ... and ' + (unmatched.length - 20) + ' more');
    }
  }

  L.push('');
  if (!errCells.length) {
    L.push('(b) No cell in this file carries #REF! or #NAME? in its A1 formula, ' +
           'so §1.2b is');
    L.push('    UNVERIFIED. Break one reference deliberately and re-run. Note ' +
           'that errorState()');
    L.push('    reads the A1 form, which §4h names as the preferred surface, so ' +
           'this is a');
    L.push('    diagnostic rather than a blocker.');
  } else {
    for (let i = 0; i < errCells.length; i++) L.push('(b) ' + errCells[i]);
  }

  const report = L.join('\n');
  console.log(report);
  return report;
}
