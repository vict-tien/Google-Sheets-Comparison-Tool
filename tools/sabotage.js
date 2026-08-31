// ============================================================================
// sabotage.js — the acceptance gate
// ============================================================================
//
// A GREEN SUITE PROVES NOTHING ON ITS OWN. This is what the green means: each
// row below is a mutation applied to the concatenated source in a fresh vm
// context, and the report is the set of tests that go red.
//
// Two ways to read it, and the second matters more:
//
//   - A mutation that fails NO test means the corresponding test is decorative
//     and must be rewritten before the work is called done.
//   - A mutation caught by exactly ONE test means deleting that one test
//     restores a silent failure mode. Eight of the fifteen original rows are
//     like this. That is the number to watch after any refactor.
//
// Run it the same way as runner.js:
//   $env:ELECTRON_RUN_AS_NODE = "1"
//   & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" tools/sabotage.js sabotage.txt
//
// The source lives in src/ and this file in tools/, so the directory is
// resolved from __dirname rather than from the working directory.
const fs = require('fs'), vm = require('vm'), path = require('path');

const dir = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(dir)
  .filter(function (f) { return /\.gs$/.test(f); })
  .sort();

let BASE = '';
for (const f of files) BASE += fs.readFileSync(path.join(dir, f), 'utf8') + '\n';

// Each mutation is [label, find, replace]. `find` must appear exactly once —
// a mutation that silently fails to apply reports "caught by nothing", which
// is indistinguishable from a decorative test.
const MUTATIONS = [
  ['Edit-distance denominator -> the post-trim middle',
   'const denom = lenA + lenB;',
   'const denom = midA + midB;'],

  ['One row map per formula (first reference\'s tab wins)',
   `  return rewriteRefs_(f, function (ref) {
    const target = (ref.sheet === null) ? currentTab : ref.sheet;

    // Only re-emit a sheet prefix if the reference carried one.`,
   `  let firstTarget_ = null;
  return rewriteRefs_(f, function (ref) {
    if (firstTarget_ === null) {
      firstTarget_ = (ref.sheet === null) ? currentTab : ref.sheet;
    }
    const target = firstTarget_;

    // Only re-emit a sheet prefix if the reference carried one.`],

  ['relocate() no-ops (a broken plan §4b regex)',
   'R(\\d+|\\[-?\\d+\\])?C(\\d+|\\[-?\\d+\\])?/g;',
   'Z(\\d+|\\[-?\\d+\\])?Q(\\d+|\\[-?\\d+\\])?/g;'],

  ['Compare formulas in A1 instead of R1C1',
   `      const rawA = tabA.fR1C1[aIdx][c];
      const fB   = tabB.fR1C1[bIdx][c];`,
   `      const rawA = tabA.fA1[aIdx][c];
      const fB   = tabB.fA1[bIdx][c];`],

  ['Rule 3 moved below the identical-formula suppression',
   'RULE3_MARKER', 'RULE3_MARKER'],   // handled specially below

  ['Single-pass: compare each tab as soon as it is aligned',
   `    if (!alignment.skipped) rowMaps[aName] = alignment.rowMap;
    prepared.push({ aName: aName, bName: bName, tabA: tabA, tabB: tabB,
                    alignment: alignment });`,
   `    if (!alignment.skipped) rowMaps[aName] = alignment.rowMap;
    const st_ = {};
    changes.push.apply(changes, diffTab(tabA, tabB, alignment,
      { rowMaps: rowMaps, tabMap: pairing.tabMap }, aName, opts, st_));
    prepared.push({ aName: aName, bName: bName, tabA: tabA, tabB: tabB,
                    alignment: alignment, done_: true });`],

  ['maskUnresolvable masks every absolute row',
   "if (rowPart !== undefined && /^\\d+$/.test(rowPart) && !rowMaps[target]) {\n      rowPart = '#';",
   "if (rowPart !== undefined && /^\\d+$/.test(rowPart)) {\n      rowPart = '#';"],

  ['errorState checks the value only, never the formula',
   `  if (formula !== '' && formula !== null && formula !== undefined) {
    const f = String(formula);
    for (let i = 0; i < REF_ERROR_TOKENS.length; i++) {
      if (f.indexOf(REF_ERROR_TOKENS[i]) !== -1) return 'root';
    }
  }`,
   '  // sabotaged: formula not consulted'],

  ['Header guard compares B row 0 positionally',
   `  let bHeader = -1;
  for (let p = 0; p < alignment.pairs.length; p++) {
    if (alignment.pairs[p][0] === 0) { bHeader = alignment.pairs[p][1]; break; }
  }`,
   '  let bHeader = 0;'],

  ['hashGrid ignores the width cap',
   'return (width === undefined || row.length <= width) ? row : row.slice(0, width);',
   'return row;'],

  ['Scan removed from the skipped-alignment return',
   `    out.push(row('TAB_SKIPPED', '', '', '', '', alignment.reason));
    return out.concat(scanErrorsUnaligned(tabB, tabName));`,
   `    out.push(row('TAB_SKIPPED', '', '', '', '', alignment.reason));
    return out;`],

  ['hashRow hashes formula-cell values too',
   "parts.push(f === '' ? normaliseValue(values ? values[c] : '') : HASH_FORMULA);",
   "parts.push(normaliseValue(values ? values[c] : ''));"],

  ['rowMap built in array-index space',
   'rowMap.set(pairs[i][0] + offA, pairs[i][1] + offB);',
   'rowMap.set(pairs[i][0], pairs[i][1]);'],

  ['Mask undefined guards removed',
   `    const masked = (ctx.maskA !== undefined && ctx.maskB !== undefined &&
                    ctx.maskA === ctx.maskB);`,
   '    const masked = (ctx.maskA === ctx.maskB);'],

  ['isAnchorable -> return true',
   `function isAnchorable(values, formulas) {
  const width`,
   `function isAnchorable(values, formulas) {
  if (true) return true;
  const width`],

  // ---- the five Track A rows -------------------------------------------
  ['sectionOf returns 1 for everything',
   'return SECTION_2_TYPES.has(change.change) ? 2 : 1;',
   'return 1;'],

  ['sectionOf returns 2 for everything',
   'return SECTION_2_TYPES.has(change.change) ? 2 : 1;',
   'return 2;'],

  ['Rule 5\'s branches swapped: derivedSection tested before ctx.volatile',
   `      if (ctx.volatile) {
        return { change: 'VOLATILE_VALUE', old: displayValue(vA), new: displayValue(vB) };
      }`,
   `      if (opts.derivedSection) {
        return { change: 'DERIVED_VALUE',
                 old: displayValue(vA), new: displayValue(vB) };
      }
      if (ctx.volatile) {
        return { change: 'VOLATILE_VALUE', old: displayValue(vA), new: displayValue(vB) };
      }`],

  ['Noise ratio counts section 2',
   `  stats.noise = stats.compared > 0 &&
                (stats.emitted / stats.compared) > opts.noiseWarn;`,
   `  stats.noise = stats.compared > 0 &&
                ((stats.emitted + stats.derived) / stats.compared) > opts.noiseWarn;`],

  ['derivedCap truncates BEFORE sorting',
   `  const cap = (opts.derivedCap === undefined) ? section2.length : opts.derivedCap;
  const kept = section2.slice(0, cap);`,
   `  const cap = (opts.derivedCap === undefined) ? section2.length : opts.derivedCap;
  const kept = section2.slice().reverse().slice(0, cap);`],

  // --- v1.2.0: whole-row and whole-column references --------------------------

  ['REF_RE reverted to a mandatory R and a mandatory C',
   "  /(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!)?(?:R(\\d+|\\[-?\\d+\\])?C(\\d+|\\[-?\\d+\\])?|R(\\d+|\\[-?\\d+\\])|C(\\d+|\\[-?\\d+\\]))/g;",
   "  /(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!)?R(\\d+|\\[-?\\d+\\])?C(\\d+|\\[-?\\d+\\])?/g;"],

  ['formatRef_ ignores `form` and always emits both halves',
   `  if (form === 'R') return prefix + r;
  if (form === 'C') return prefix + c;
  return prefix + r + c;`,
   `  return prefix + r + c;`],

  ['The R-only branch is ordered ahead of R…C, so R1C1 splits into two refs',
   "(?:R(\\d+|\\[-?\\d+\\])?C(\\d+|\\[-?\\d+\\])?|R(\\d+|\\[-?\\d+\\])|C(\\d+|\\[-?\\d+\\]))",
   "(?:R(\\d+|\\[-?\\d+\\])|C(\\d+|\\[-?\\d+\\])|R(\\d+|\\[-?\\d+\\])?C(\\d+|\\[-?\\d+\\])?)"],

  ['The single-part branches no longer require an operand, so a bare R matches',
   "|R(\\d+|\\[-?\\d+\\])|C(\\d+|\\[-?\\d+\\]))",
   "|R(\\d+|\\[-?\\d+\\])?|C(\\d+|\\[-?\\d+\\])?)"]
];

// diffCell rule 3 is a block move rather than a substitution, so it gets its
// own transform: lift the error block out and reinsert it after rule 5.
function moveRule3(src) {
  const start = src.indexOf('  // 3. ERROR STATE');
  const end = src.indexOf('  // 4. both hold formulas');
  if (start < 0 || end < 0) return null;
  const block = src.slice(start, end);
  const after = src.indexOf('  // 6. neither holds a formula');
  if (after < 0) return null;
  const without = src.slice(0, start) + src.slice(end);
  const at = without.indexOf('  // 6. neither holds a formula');
  return without.slice(0, at) + block + without.slice(at);
}

function failedTests(src) {
  let report;
  try {
    const ctx = { console: { log: function () {} } };
    vm.createContext(ctx);
    report = vm.runInContext(src + '\n;runTests();', ctx, { timeout: 60000 });
  } catch (e) {
    return { error: (e && e.message) ? e.message : String(e), ids: [] };
  }
  const ids = [];
  const lines = String(report).split('\n');
  for (const l of lines) {
    const m = /^FAIL  #(\S+)/.exec(l);
    if (m) ids.push(m[1]);
  }
  const totals = lines.filter(function (l) { return /^FAIL — /.test(l); });
  return { ids: ids, totals: totals };
}

const out = [];
const base = failedTests(BASE);
out.push('BASELINE: ' + (base.ids.length === 0 && base.totals.length === 0
  ? 'clean — 87 pass, both declared totals met'
  : 'NOT CLEAN: ' + base.ids.join(', ') + ' ' + base.totals.join(' ')));
if (base.error) out.push('  ' + base.error);
out.push('');
out.push('| Mutation | Fails | Count |');
out.push('|---|---|---|');

let singles = 0, decorative = 0;
for (const [label, find, repl] of MUTATIONS) {
  let src;
  if (find === 'RULE3_MARKER') {
    src = moveRule3(BASE);
    if (src === null) { out.push('| ' + label + ' | **DID NOT APPLY** | — |'); continue; }
  } else {
    const n = BASE.split(find).length - 1;
    if (n !== 1) {
      out.push('| ' + label + ' | **DID NOT APPLY (' + n + ' matches)** | — |');
      continue;
    }
    src = BASE.replace(find, repl);
  }
  const r = failedTests(src);
  if (r.error) {
    out.push('| ' + label + ' | THREW: ' + r.error + ' | — |');
    continue;
  }
  const extra = r.totals.length ? ' + ' + r.totals.join('; ') : '';
  if (r.ids.length === 0 && !r.totals.length) decorative++;
  if (r.ids.length === 1) singles++;
  out.push('| ' + label + ' | ' + (r.ids.join(', ') || '**NOTHING**') + extra +
           ' | ' + r.ids.length + ' |');
}

out.push('');
out.push(singles + ' mutations are caught by a single test each.');
out.push(decorative + ' mutations are caught by nothing — each names a ' +
         'decorative test that must be rewritten.');

fs.writeFileSync(process.argv[2] || 'sabotage.txt', out.join('\n') + '\n');
