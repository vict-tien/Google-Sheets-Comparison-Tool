// ============================================================================
// runner.js — runs the suite outside Apps Script
// ============================================================================
//
// The suite is plain ES2015+ with no platform dependency, so any V8 will do.
// This machine has no standalone Node, Bun or Deno; VS Code ships an Electron
// that will act as one:
//
//   $env:ELECTRON_RUN_AS_NODE = "1"
//   & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" runner.js out.txt
//
// Two traps, both of which read as a broken test file rather than a broken
// invocation:
//
//   - console.log is DISCARDED under ELECTRON_RUN_AS_NODE. Nothing is printed
//     and the exit code is 0. Hence the write to a file.
//   - process.argv[1] is the SCRIPT PATH, not the first argument. Arguments
//     start at argv[2]; reading argv[1] makes the runner overwrite itself with
//     its own output.
//
// Files are concatenated in NAME ORDER, which is the same order Apps Script
// loads them in — that is what the numeric prefixes are for. Running here does
// not prove the load order is right in Apps Script, but it does prove it is
// self-consistent.
const fs = require('fs'), vm = require('vm'), path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(function (f) { return /\.gs$/.test(f); })
  .filter(function (f) { return f !== 'GenerateTestWorkbooks.gs'; })
  .sort();

let src = '';
for (const f of files) src += fs.readFileSync(path.join(dir, f), 'utf8') + '\n';

global.console = { log: function () {} };

let out;
try {
  out = vm.runInThisContext(src + '\n;runTests();');
} catch (e) {
  out = 'THREW LOADING OR RUNNING:\n' + (e && e.stack ? e.stack : String(e));
}
fs.writeFileSync(process.argv[2] || 'out.txt',
                 'files: ' + files.join(', ') + '\n\n' + out);
