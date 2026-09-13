// ============================================================================
// dryrun.js — runWith()'s call path, with every Google service stubbed
// ============================================================================
//
// The suite cannot reach 90_Main.gs: readTab is the only function in it whose
// contract is testable from a duck-typed object, and run/runWith/stamp_/
// verifyReferenceForms all need SpreadsheetApp, DriveApp, PropertiesService,
// Utilities, Session and MimeType. This stubs all six and drives runWith()
// end to end over in-memory fixtures.
//
// WHAT IT ACTUALLY PROVES, and the reason it is worth running at all:
//
//   1. The §0 scope boundary, MECHANICALLY. Every stub sheet is a Proxy that
//      THROWS on any method but getName and getDataRange. If any code path
//      reaches for a setter on a source spreadsheet, the run dies here rather
//      than in someone's live model.
//   2. Exactly one Drive write per run, counted.
//   3. That run() refuses to proceed with no Script Properties set, rather than
//      opening `undefined`.
//   4. Method names and call ORDER — the half of Step 9 the pure tests cannot
//      see, because compareWorkbooks receives workbooks already in memory.
//
// WHAT IT DOES NOT PROVE: anything about the real API. What getFormulasR1C1()
// returns is plan §1.2 and is answered only by verifyReferenceForms against a
// real file. Six globals stubbed here is six assumptions, not six facts.
//
// Run it the same way as runner.js:
//   $env:ELECTRON_RUN_AS_NODE = "1"
//   & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" tools/dryrun.js dryrun.txt
//
// The source lives in src/ and this file in tools/, so the directory is
// resolved from __dirname rather than from the working directory.
const fs = require('fs'), vm = require('vm'), path = require('path');

const dir = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(dir)
  .filter(function (f) { return /\.gs$/.test(f); })
  .sort();
let src = '';
for (const f of files) src += fs.readFileSync(path.join(dir, f), 'utf8') + '\n';

const log = [];
const state = { driveWrites: 0, sleeps: 0, forbidden: [], opened: [] };

// --- the stubs --------------------------------------------------------------
function stubRange(tab) {
  return {
    getValues:       function () { return tab.values; },
    getFormulasR1C1: function () { return tab.fR1C1; },
    getFormulas:     function () { return tab.fA1; },
    getRow:          function () { return tab.rowOffset; },
    getColumn:       function () { return tab.colOffset; }
  };
}

// A sheet that throws on ANY method but the two readTab is allowed to use.
function stubSheet(name, tab) {
  const allowed = {
    getName:      function () { return name; },
    getDataRange: function () { return stubRange(tab); }
  };
  return new Proxy(allowed, {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      state.forbidden.push(String(prop));
      throw new Error('FORBIDDEN call on a source sheet: ' + String(prop));
    }
  });
}

/**
 * A NamedRange, plus the one that throws.
 *
 * `sheetName === null` is a name left pointing at a deleted sheet, and
 * getRange() throws for it on the real API. readNames_ must SKIP it rather than
 * let it kill the run — a broken name is not a redefinition, and the formulas
 * using it already surface as #NAME?. That branch has no other coverage: the
 * suite cannot reach 90_Main.gs at all.
 */
function stubNamedRange(name, sheetName, row, col, numRows, numCols) {
  return {
    getName:  function () { return name; },
    getRange: function () {
      if (sheetName === null) throw new Error('range no longer resolves');
      return {
        getSheet:      function () {
          return { getName: function () { return sheetName; } };
        },
        getRow:        function () { return row; },
        getColumn:     function () { return col; },
        getNumRows:    function () { return numRows; },
        getNumColumns: function () { return numCols; }
      };
    }
  };
}

function stubSpreadsheet(title, wb, named) {
  return {
    getName:   function () { return title; },
    getSheets: function () {
      return wb.names.map(function (n) { return stubSheet(n, wb.tabs[n]); });
    },
    // A read, so it belongs here rather than behind the forbidding Proxy —
    // that Proxy exists to catch WRITES to a source spreadsheet.
    getNamedRanges: function () { return named || []; }
  };
}

const ctx = { console: { log: function (m) { log.push(String(m)); } } };
vm.createContext(ctx);
vm.runInContext(src, ctx);

// Build the fixture pair inside the vm, where the t_ builders live.
ctx.__mkPair = new Function('return null;');
const pair = vm.runInContext(`
(function () {
  const A = t_workbook({
    Assumptions: t_plantG(t_filler(18), [[4, 2, '=B5*2', '=RC[-1]*2', 100]]),
    'Fleet Capex': t_plant(16, [[9, 2, '=Rates!$B$4', '=Rates!R4C2', 40]]),
    Rates: t_sheet(t_filler(16)),
    Scratch: t_sheet(t_filler(16))
  });
  const B = t_workbook({
    Assumptions: t_plantG(t_filler(18), [[4, 2, '=B5*2', '=RC[-1]*2', 200]]),
    'Fleet Capex': t_plant(16, [[9, 2, '=Rates!$B$5', '=Rates!R5C2', 40]]),
    Rates: t_inserted(16, 2),
    Ledger: t_plant(16, [[3, 1, '=Old!#REF!', '=Old!#REF!', '#REF!']])
  });
  return { A: A, B: B };
})()`, ctx);

// 41_Names.gs, exercised end to end. Rates has a row inserted at sheet
// row 3, so its row map sends 4 -> 5 and 10 -> 11.
//
//   BaseRate  B4 -> B5   explained by the map      -> MUST emit nothing
//   Fee       B10 -> B2  not explained by anything -> MUST emit NAME_REDEFINED
//   Broken    getRange() throws                    -> MUST be skipped, not fatal
const namesA = [
  stubNamedRange('BaseRate', 'Rates', 4, 2, 1, 1),
  stubNamedRange('Fee', 'Rates', 10, 2, 1, 1),
  stubNamedRange('Broken', null, 0, 0, 0, 0)
];
const namesB = [
  stubNamedRange('BaseRate', 'Rates', 5, 2, 1, 1),
  stubNamedRange('Fee', 'Rates', 2, 2, 1, 1)
];

const ssA = stubSpreadsheet('2026 Cost Model v3', pair.A, namesA);
const ssB = stubSpreadsheet('2026 Cost Model v4', pair.B, namesB);

ctx.SpreadsheetApp = {
  openByUrl: function (url) {
    state.opened.push(url);
    if (url === 'urlA') return ssA;
    if (url === 'urlB') return ssB;
    throw new Error('openByUrl on an unexpected url: ' + url);
  }
};
ctx.DriveApp = {
  createFile: function (name, content, mime) {
    state.driveWrites++;
    state.file = { name: name, content: content, mime: mime };
    return { getUrl: function () { return 'https://drive/' + name; },
             getId:  function () { return 'file-id'; } };
  }
};
ctx.MimeType = { CSV: 'text/csv' };
ctx.Utilities = {
  sleep: function () { state.sleeps++; },
  formatDate: function () { return '20260822-1432'; }
};
ctx.Session = { getScriptTimeZone: function () { return 'Australia/Sydney'; } };
let props = {};
ctx.PropertiesService = {
  getScriptProperties: function () {
    return { getProperty: function (k) { return props[k] || null; } };
  }
};

// --- drive it ---------------------------------------------------------------
const out = [];
function check(label, ok, detail) {
  out.push((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '   ' + detail : ''));
  return ok;
}

// 1. run() with no Script Properties must refuse, not open `undefined`.
let refused = '';
try { vm.runInContext('run()', ctx); } catch (e) { refused = e.message; }
check('run() with no Script Properties throws instead of opening undefined',
      /Script Properties/.test(refused), refused || '(did not throw)');
check('  and opened nothing', state.opened.length === 0,
      state.opened.join(', '));

// 2. run() resolves both properties and delegates to runWith.
props = { URL_A: 'urlA', URL_B: 'urlB' };
let result;
let threw = null;
try { result = vm.runInContext('run()', ctx); } catch (e) { threw = e.stack; }
check('run() completes through the full I/O path', threw === null, threw || '');

if (threw === null) {
  check('  opened exactly two spreadsheets, A then B',
        state.opened.join(',') === 'urlA,urlB', state.opened.join(','));
  check('  no forbidden method reached a source sheet',
        state.forbidden.length === 0, state.forbidden.join(', '));
  check('  exactly one Drive write', state.driveWrites === 1,
        String(state.driveWrites));
  check('  written as MimeType.CSV', state.file.mime === 'text/csv',
        state.file.mime);
  check('  filename carries the stamp and VERSION',
        state.file.name === 'changes-20260822-1432-v1.2.0.csv', state.file.name);
  check('  Utilities.sleep not called below the pacing threshold',
        state.sleeps === 0, String(state.sleeps));

  // The CSV goes to Drive and NEVER to the log: Apps Script truncates large
  // log payloads with no documented ceiling.
  const logged = log.join('\n');
  check('  the summary was logged', /^sheets-diff v/m.test(logged));
  check('  the CSV was NOT logged', logged.indexOf('DERIVED_VALUE,') === -1);
  check('  both tables reached the file',
        state.file.content.indexOf('# SECTION 2') > 0);

  // A4. The whole point of the pass is that ONE of these two names reports and
  // the other does not. Asserting only that a row exists would pass just as
  // happily if every name reported.
  const nameRows = state.file.content.split('\n')
    // NOT `indexOf(...) > 0`: a workbook-scoped name has tab '', so the row
    // STARTS with the comma and indexOf returns 0.
    .filter(function (l) { return l.indexOf('NAME_REDEFINED') !== -1; });
  check('  the repointed name reports, and only it',
        nameRows.length === 1 && nameRows[0].indexOf('Fee') > 0,
        nameRows.join(' | ') || '(none)');
  check('  the name explained by the row map stays silent',
        nameRows.join('').indexOf('BaseRate') === -1);
  check('  a name whose range no longer resolves is skipped, not fatal',
        nameRows.join('').indexOf('Broken') === -1);
  check('  and the summary says so on its own line',
        /^NAMES: 1 defined name was repointed/m.test(log.join('\n')));
  check('  return value carries fileId, fileUrl, rows and summary',
        result && result.fileId === 'file-id' && typeof result.rows === 'number' &&
        typeof result.summary === 'string');

  out.push('');
  out.push('--- summary as logged ---');
  out.push(logged);
  out.push('');
  out.push('--- CSV as written ---');
  out.push(state.file.content);
}

const report = out.join('\n');
fs.writeFileSync(process.argv[2] || 'dryrun.txt', report + '\n');
