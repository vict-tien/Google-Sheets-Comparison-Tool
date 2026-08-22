---
title: Sheets Diff Tool — Implementation Documentation
status: implementation documentation — describes shipped code. Steps 1–10 complete against the plan's 2026-08-07 revision; **two later plan revisions are unimplemented (§11)**
date: 2026-08-08
revised: 2026-08-22 — re-anchored to the plan's 2026-08-19 (two-section CSV) and 2026-08-22 (multi-file layout, Script Properties) revisions. The shipped code implements neither. §11 is the conformance gap; the work to close it is a separate document
target: Google Apps Script (V8), single `.gs` file, no external libraries
documents: SheetsDiff.gs — v1.0.0 by this document's reckoning; **the source carries no VERSION constant** (§11.2)
built_from: Google Sheets Difference Comparison Tool Implementation Plan.md, revision 2026-08-07
measured_against: Google Sheets Difference Comparison Tool Implementation Plan.md, revision 2026-08-22
migration: Sheets Diff Tool - v1.1.0 Migration Plan.md
audience: whoever runs, verifies or continues the diff tool build
---

# Sheets Diff Tool — Implementation Documentation

**Reference conventions.** **§n** points within this document. **Plan §n** and
**Step n** refer to *Google Sheets Difference Comparison Tool Implementation
Plan.md* — **its 2026-08-22 revision**, which is the current one; where the
distinction matters, **plan-v1 §n** names the 2026-08-07 revision this code was
built from. **Test n** is a row in the current plan's acceptance-test table,
which now runs to 38; a quoted id (**Test '4a'**) is local to this build and has
no plan counterpart. **Fixture doc §n** refers to *Test Fixture Generator -
Implementation Documentation.md*, which **has** been realigned to the current
plan. **Migration §n** refers to *Sheets Diff Tool - v1.1.0 Migration Plan.md*.
Types in `CAPITALS` are the output taxonomy.

---

## 0. What this is

`SheetsDiff.gs` is the whole tool in one file. Given two Google Spreadsheet URLs
it compares every matching tab, writes **only the changes** — plus **every**
reference-error cell, changed or not — to a CSV in Drive, and logs a summary.

| Entry point | Does | Needs a spreadsheet? |
|---|---|---|
| `verifyReferenceForms(url [, tab])` | Plan §1.2 against a real file. **Run first** (§4.9) | Yes, read-only |
| `run(urlA, urlB [, opts])` | The tool. One CSV in Drive, one summary in the log | Yes, read-only + one Drive write |
| `runTests()` | 74 tests on in-memory fixtures | No |

`run()` logs:

```
A: 2026 Cost Model v3    (6 tabs)
B: 2026 Cost Model v4    (6 tabs)

TAB                   STATUS        REF   VAL   FORM   UNVER   VOL   HARD   FMLZD   ±ROW   ±COL
───────────────────────────────────────────────────────────────────────────────────────────────
Assumptions           modified        0     0      0       0     0      0       0     +1      0
HVAC Capex            modified        1     0      0       1     1      0       0      0      0
Rates                 modified        0     0      0       0     0      0       0     +1      0
Escalation            SKIPPED         0     —      —       —     —      —       —      —      —
Cover → C o v e r     renamed         0     0      0       0     0      0       0      0      0
Scratch               deleted         —     —      —       —     —      —       —      —      —
Ledger                added           1     —      —       —     —      —       —      —      —
───────────────────────────────────────────────────────────────────────────────────────────────
5 changed, 0 unchanged, 1 skipped.  1 added in B.  0 values, 0 formulas, 0 hardcodes, 1 volatile.
REFERENCE ERRORS: 2 total — 0 new, 0 fixed, 2 pre-existing.  2 root, 0 inherited.
→ changes-20260807-1432.csv (12 rows, 41s)
```

### Which plan revision this describes

**This document describes shipped code, and the shipped code is one plan revision
behind — in two respects.** Everything below §11 is a true account of what
`SheetsDiff.gs` does today; it is not an account of what the plan now asks for.

| Plan revision | Adds | Implemented |
|---|---|---|
| 2026-08-07 | The tool as originally specified — 33 acceptance tests, twelve rules, one CSV table | **Yes**, Steps 1–10 |
| 2026-08-19 | `DERIVED_VALUE` and a **second CSV section**; `sectionOf`; `derivedSection`/`derivedCap`; rules 13–15; tests 34–38 | **No** — §11.1 |
| 2026-08-22 | **Twelve-file layout**, per-module test files, checked-in `appsscript.json`, Script Properties config, `VERSION` stamping | **No** — §11.2 |

The single most consequential difference for a reader: **the plan now requires
recalculated cells to be emitted into section 2 of the CSV; this build suppresses
them and prints a count.** Everything §5.2, §6.4 and §7.5 say about derived-value
suppression is accurate about the code and **is now a deviation from the plan**.
§11 is the complete matrix. Do not read §1–§10 as a specification.

### Scope boundary

**Read-only with respect to both source spreadsheets.** The only write anywhere
is the single `DriveApp.createFile` in `run()`. Four functions do I/O —
`readTab`, `readSheets_`, `run`, `verifyReferenceForms` — and all sit below the
`I/O BOUNDARY` banner near the bottom of the file. **Everything above that banner
is pure**, which is what lets all 74 tests run with no spreadsheet and no
authorisation prompt.

Not built, deliberately: everything in the plan's Non-goals table — no dependency
graph, no `INDIRECT` resolution, no column alignment, no merge or patch-back, no
UI.

**Not done: Step 11**, the end-to-end run against two real successive versions.
§1.3 is the procedure, §1.4 is what was verified in its place, §6.4 is what to
check when it is run. **Not done: plan §1.2**, the observation of what
`getFormulasR1C1()` really returns — `verifyReferenceForms()` now performs it in
one call, but nobody has run it. §4.9 is why 74 green tests prove nothing there.
**Not done: the plan's 2026-08-19 and 2026-08-22 revisions** — §11.

---

## 1. Setup and use

### 1.1 In Apps Script

1. script.google.com → **New project** (standalone, not container-bound). Paste
   the file in. Runtime must be V8 — the file uses `const`, `let`, `Map`,
   `Int32Array`.
2. Run `runTests()`. **No authorisation prompt appears.** If one does, something
   touching a Google service has been added above the I/O boundary.
3. Set `URL_A` / `URL_B`, or pass them to `run()`.
4. Run `verifyReferenceForms(URL_A)`. Authorise Sheets. **Read §4.9 before
   deciding the output looks fine.**
5. Run `run()`. Authorise Drive.

The config block, verbatim from the source:

```js
const URL_A = 'https://docs.google.com/spreadsheets/d/.../edit';
const URL_B = 'https://docs.google.com/spreadsheets/d/.../edit';

const OPTS = {
  includeDerived:  false,  // also emit VALUE rows where formulas are identical
  expandRows:      false,  // added/deleted rows -> one row per cell, not a preview
  epsilon:         1e-9,   // relative tolerance for numeric comparison
  similarity:      0.5,    // gap-matching threshold in alignment pass 2
  editDistanceCap: 0.30,   // skip a tab if more than this fraction of rows differ
  noiseWarn:       0.30    // warn if more than this fraction of compared cells changed
};

const REF_ERROR_TOKENS = ['#REF!', '#NAME?'];   // NOT #DIV/0!, #VALUE!, #N/A, #NUM!
const ALIGN_WINDOW_MAX = 2000;                  // per-side DP window ceiling
const HASH_CELL_SEP = '\u0000';                 // no cell can contain these
const HASH_FORMULA  = '\u0001';
```

Three further constants live beside the code that reads them, not in the block:
`CSV_HEADER` (`'tab,change,a_ref,b_ref,column,old,new'`, line 1150),
`READ_PACE_TABS` (10) and `READ_PACE_MS` (1000) at lines 1768–1769.

All six `OPTS` keys are live. `noiseWarn` is the only one whose effect never
reaches the CSV: it sets `stats.noise`, which `buildSummary` prints as a warning
(§5.4).

**Two lines of that block are what the plan's 2026-08-19 and 2026-08-22
revisions change.** They are quoted above as they stand in the source, not as
the plan now asks for them:

| Shipped | Plan now requires | §|
|---|---|---|
| `const URL_A` / `URL_B` in source, used as `run()`'s defaults | Both read from **Script Properties**; `run()` resolves config and calls `runWith(urlA, urlB, opts)`, which holds no ambient state | 11.2 |
| `includeDerived: false` — when true, emits recalculated cells as `VALUE` rows into the one and only CSV table | `derivedSection: true` — emits them as `DERIVED_VALUE` into **section 2**; plus `derivedCap: 5000` | 11.1 |
| No `VERSION` constant; filename is `changes-<stamp>.csv` | `VERSION` in `00_Config.gs`, stamped into the filename and the summary head | 11.2 |

**`includeDerived: true` is not a partial implementation of `derivedSection`.**
It emits the wrong type (`VALUE`) into the wrong section (1) with no cap, which
is precisely the merged-table outcome plan rule 13 exists to forbid. Leave it
`false` until the migration lands.

| | |
|---|---|
| Writes to `URL_A` / `URL_B` | **None**, by construction (§0) |
| Writes elsewhere | Exactly one `DriveApp.createFile` per `run()`, into My Drive root |
| File name | `changes-yyyyMMdd-HHmm.csv`, script timezone, `MimeType.CSV` |
| Scopes | Sheets on `verifyReferenceForms` / `run`; Drive additionally on `run` |
| Re-running | Safe. Two runs in one **minute** produce two files with the same name; Drive permits duplicates, nothing is overwritten |
| Undo | Trash the CSV |
| Runtime | `runTests()` under 10 ms, deterministic. `run()` scales with tab count — §7.4 |

### 1.2 Running the suite outside Apps Script

The suite is plain ES2015+ with no platform dependency. This machine has no
standalone Node, Bun or Deno, but VS Code ships an Electron that will act as one:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" runner.js out.txt
```

```js
// runner.js — Electron-as-node has no attached stdout, so write to a file
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('SheetsDiff.gs', 'utf8');
global.console = { log: function () {} };
fs.writeFileSync(process.argv[2], vm.runInThisContext(src + '\n;runTests();'));
```

Two traps, both of which read as a broken test file rather than a broken
invocation:

| Trap | Symptom |
|---|---|
| `console.log` is discarded under `ELECTRON_RUN_AS_NODE` | Nothing printed, exit 0. Write the returned string to a file |
| `process.argv[1]` is the **script path**, not the first argument | The runner overwrites itself with its own output. Arguments start at `argv[2]` |

### 1.3 Step 11 — the end-to-end run, not yet performed

| # | Do | Because |
|---|---|---|
| 1 | Generate fixtures with `generateTestWorkbooks()` from `GenerateTestWorkbooks.gs`, **or** point `URL_A`/`URL_B` at two real successive versions | The generator mutates a *copy* of A with real `insertRowBefore`/`deleteRow` calls, so Sheets itself performs the formula rewriting Step 4 exists to invert. Hand-written B-side formulas would test a guess |
| 2 | Run `verifyReferenceForms(URL_A)`. **This gates everything** | Plan §1.2. The suite cannot detect a `REF_RE` mismatch with reality (§4.9) |
| 3 | Run `run()`. Confirm it completes inside 6 minutes | Apps Script's execution ceiling. The footer prints elapsed seconds |
| 4 | Read the `REF_ERROR_NEW` rows first | Something broke between these two versions. They sort to the top of the CSV (§7.3) |
| 5 | Check the relocation footer | 0 formulas realigned while a referenced tab changed rows means Step 4 is silently no-opping. `buildSummary` raises this itself, but only when absolute references exist (§5.5) |
| 6 | Check the volatile line | Every `VOLATILE_VALUE` row needs manual verification, and so does the gap between detected and total — a volatile formula whose value happened not to change is not detected at all (§10) |
| 7 | Check the unverified line | It names the *referenced* tab whose row map is missing (§5.3). A large count means that tab was skipped or unpaired |
| 8 | Check the `HARDCODED` rows | What the diff half of the tool exists for |
| 9 | If a downstream tab looks wrong but shows no rows, trace upstream before assuming a bug | Derived values are suppressed by design; the suppression line gives the count (§5.2) |

**The plan's Step 11 now has ten steps, not nine.** Its 8–10 — read section 1 to
completion before opening section 2, sanity-check the two row counts against each
other, and check section 2 before assuming a downstream tab is wrong — all
presuppose a section 2 that this build does not write. They are not omissions
from the table above; they are unreachable until §11.1 is closed. The generated
fixture pair is already built for them (fixture doc §6.2, §6.5), so the Step 11
run should be deferred until after the migration rather than performed twice.

### 1.4 What was verified in place of Step 11

| Verified | How | Covers |
|---|---|---|
| 33 of the plan's **38** acceptance tests, + 41 local tests | `runTests()` in a V8 `vm` | Steps 1–7 and 10 in full, `readTab`'s contract, 9's pure half. Tests 34–38 do not exist (§11.1) |
| `run()`'s full call path, `readTab`, `toCsv`, `buildSummary` | Apps Script globals stubbed in a `vm`; fixture `TabData` served through fake `getDataRange()` objects | Method names, call order, the Drive write, the summary text |
| **Nothing writes to a source spreadsheet** | Stub sheets are `Proxy` objects that **throw on any method but** `getName` and `getDataRange`. The dry run completes | The §0 scope boundary, mechanically |
| Exactly one Drive write per run | Counted in the stub: 1 | §1.1 |

| **Not** verified | Consequence |
|---|---|
| What `getFormulasR1C1()` really returns | §4.9. The whole of Step 4 rests on it |
| Whether `#REF!` survives into R1C1 | Diagnostic only — `errorState` reads the A1 form |
| Apps Script's parser and quota behaviour | `Utilities`, `Session`, `SpreadsheetApp`, `DriveApp`, `MimeType` were all stubbed |
| Real runtime against a large workbook | The 6-minute ceiling is untested |
| `Utilities.sleep` pacing above 10 tabs | Dry-run fixtures have 4 tabs; the branch never fired |

---

## 2. Architecture

```
run(urlA, urlB, opts)          ← THE TOOL.  Sheets + Drive.  Step 9's shell
├─ SpreadsheetApp.openByUrl ×2
├─ PHASE 0  sheetNames_ ×2 → pairTabs        ← names only, nothing read yet
├─ readSheets_(sheets, names, wanted) ×2     ← Step 8
│   └─ readTab(sheet) → trimGrid(...)
├─ compareWorkbooks(wbA, wbB, opts)          ← phases 1 and 2 live in here
├─ PHASE 3  DriveApp.createFile(name, toCsv(changes), MimeType.CSV)
└─ console.log(buildSummary({...}))          ← Step 10

verifyReferenceForms(url [, tab])            ← PLAN §1.2, executable
├─ rewriteRefs_ per formula     → did REF_RE match anything?
└─ REF_ERROR_TOKENS per formula → does the token survive into R1C1?
════════════ I/O BOUNDARY — everything below is pure ════════════════════════
STEP 10  buildSummary(report) → summaryCell_, summaryNotes_, changeIsRoot_,
                                padR_ / padL_ / repeat_ / signed_
STEP 9   compareWorkbooks(wbA, wbB, opts) → { changes, tables, results, pairing }
         ├─ PHASE 0  pairTabs(namesA, namesB)
         ├─ PHASE 1  per pair: hashGrid ×2 → alignRows → rowMaps[aName]
         │           per TAB_ADDED: scanErrorsUnaligned
         └─ PHASE 2  per pair: diffTab(...)
STEP 7   pairTabs(namesA, namesB)
STEP 6   toCsv(changes) → changeIsRoot_ / sideIsRoot_ / csvField
STEP 5   diffTab(...) → headerMismatch_, gridWidth_, headerText_, preview_,
                        scanErrorsUnaligned
STEP 4   relocate / maskUnresolvable / unresolvableTargets / isVolatile
         └─ rewriteRefs_  ← the shared engine
             ├─ protectStrings_ / restoreStrings_
             ├─ REF_RE + isRefBoundary_
             └─ formatRef_(sheetName, rowPart, colPart)
STEP 3   trimGrid, normaliseValue, hashRow, isAnchorable, hashGrid,
         alignRows → lcsMatch_ / resolveGap_ → rowSimilarity_
STEP 2   valuesEqual, errorState, diffCell, displayValue
HELPERS  columnLetter(n), a1(row, col)
STEP 1   fixture, sheet, workbook, filler_, plantG_, plant_, inserted_,
         unalignable_, stubSheet_, assertEqual/Count/None/Total
```

**The physical ordering is inverted on purpose.** The I/O functions sit at the
*bottom*, below every pure function, so "does this file touch a Google service?"
is answered by reading one banner rather than by grepping. Declarations hoist, so
the order costs nothing.

`TEST_STATE` is the only module-level mutable binding; it exists so assertions
can report into the running test and is nulled after the loop.

### 2.1 Data structures

```js
TabData     = { values, fR1C1, fA1, rowOffset, colOffset }   // plan §2
Alignment   = { pairs:   [aIdx, bIdx][],       // ARRAY indices
                added:   bIdx[],               // ARRAY indices
                deleted: aIdx[],               // ARRAY indices
                rowMap:  Map<sheetRowA, sheetRowB> | null,   // SHEET rows
                skipped: boolean, reason: string }
Tables      = { rowMaps: { [aTabName]: Map }, tabMap: { [aTabName]: bTabName } }
Change      = { tab, change, aRef, bRef, column, old, new, _root? }
Workbook    = { tabs: { [name]: TabData }, names: [name] }
Stats       = { tab, renamedTo, compared, emitted, relocated, volatileCells,
                volatileEmitted, unverified, unverifiedTargets, derivedSuppressed,
                absRefs, noise, rowsAdded, rowsDeleted, colsAdded, colsDeleted,
                skipped, reason }
Report      = { titleA, titleB, tabCountA, tabCountB, result,
                fileName, fileUrl, csvRows, elapsedMs }   // buildSummary's input
```

Four properties are load-bearing:

- **`Stats` is the summary's only channel out of `diffTab`.** Every field exists
  because `buildSummary` prints something unrecoverable from the Change rows:
  `derivedSuppressed` counts rows deliberately *not* emitted (§5.2),
  `unverifiedTargets` names tabs no Change row mentions (§5.3), `absRefs` gates a
  warning about a silent failure (§5.5).
- **Per-type counts are *not* on `Stats`.** `buildSummary` tallies them from the
  Change rows, because `stats.emitted` knows how many cells were emitted but not
  how they were classified, and the root/inherited split exists only on the rows.
- **`pairs`/`added`/`deleted` are array indices; `rowMap` is sheet rows.** Two
  coordinate spaces in one object, on purpose — `pairs` indexes the grids,
  `rowMap` answers R1C1 lookups. Mixing them is §4.1.
- **`rowMaps` is keyed on A's tab names, and a skipped, added, deleted or
  unpaired tab has no entry at all.** The absence is the only signal
  `maskUnresolvable` has (§4.5).

`_root` is not a CSV column — it is `errorState`'s classification riding along so
`toCsv` can sort roots above inherited errors. `toCsv` writes seven named fields
and never enumerates the object, so it cannot leak.

---

## 3. The central design decision

### 3.1 One regex engine, per-match target resolution

**Every reference in a formula is resolved and rewritten independently, by a
callback on a global regex, with its target tab computed per match.**

```js
function rewriteRefs_(f, transform) { ... }   // protect strings, replace, restore
relocate         = rewriteRefs_ + "map the sheet name and the absolute row"
maskUnresolvable = rewriteRefs_ + "blank the row where the target has no map"
```

The obvious alternative — find the formula's sheet name, look up that tab's row
map, rewrite the formula — is the plan's named trap, and it is *correct on
single-reference formulas*, which is every formula in the first six tests. It
fails on `=Rates!$B$4 * Escalation!$C$7`, where two references need two different
maps in one pass, and on `=Rates!$B$4 * $D$7`, where one reference is cross-tab
and the other resolves to the current tab. The mutation "one row map per formula"
fails **ten tests** (§6.3) — loud now, and silent had those fixtures carried one
reference each.

Two consequences:

- **Relocation is single-hop, so chain depth is irrelevant.** A reference points
  at a *location*; the immediate target's own map is the final answer however
  many tabs the chain crosses. No dependency graph, no topological sort, no cycle
  detection. Test 26 says so out loud.
- **Relocation is applied to A's formulas only.** Relocating both sides
  double-shifts. `diffTab` calls `relocate(rawA, ...)` and passes `tabB.fR1C1`
  straight through.

### 3.2 The phase split is a function, not a comment

`compareWorkbooks` is Step 9's two-phase orchestration over in-memory workbooks —
everything `run()` does apart from opening spreadsheets and writing Drive files.
It was built ahead of Step 8 rather than left as harness scaffolding.

The alternative was to let tests drive `alignRows` and `diffTab` in whatever order
each found convenient. Tests 18, 22 and 26 exist to check that **every tab is
aligned before any tab is compared**; if that ordering lives in the test file,
those tests verify a copy of the logic and `run()` is free to get it wrong. Test
18 lists `HVAC` *before* `Rates` in both workbooks for exactly this reason — a
single-pass implementation reaches the referencing tab first, has no `Rates` row
map, cannot relocate, and reports a false `FORMULA`. The mutation "single-pass"
fails **Tests 18, 23, 24, 25, 26 and '5e'**.

The cost is that Step 8 and `run()` must adapt to `compareWorkbooks`'s signature
rather than the reverse. That is the right direction: the signature takes plain
data, which is what makes the suite possible without a spreadsheet.

---

## 4. Constraints that fail silently

### 4.1 `rowMap` is keyed on sheet rows — and its test needs unequal offsets

`alignRows` pass 3 builds `rowMap.set(aIdx + rowOffsetA, bIdx + rowOffsetB)`.
R1C1 absolute references are sheet-row numbers, so a map built in array-index
space returns wrong rows to `relocate` with no error anywhere.

**The trap is in the test, not the code.** Test '3d' originally used
`rowOffset: 5` on both sides and **passed against a deliberately sabotaged
index-space implementation** — with equal offsets a near-identity map agrees with
itself on most probes by coincidence. It now uses **A at sheet row 5, B at sheet
row 9** and probes four ways: `get(5)`→`9`, `get(12)`→`17`, `get(1)`→`undefined`,
`get(0)`→`undefined`. Under an index-space bug all four fail.

**Any future test of `rowMap` must use two different, non-1 offsets.**

### 4.2 The edit-distance denominator is the full row counts

```js
const denom = lenA + lenB;                    // NOT midA + midB
const editDistance = (unmatchedA + unmatchedB) / denom;
```

Pass 0 trims matching rows from both ends, so for an isolated one-cell edit the
post-trim middle is one row per side and the ratio is 2/2 = 1.0 — every isolated
edit would skip its own tab. Sabotaging this line fails **25 tests** (§6.3), which
is loud; the production failure would be whole tabs returning `TAB_SKIPPED`,
which reads as a workbook problem rather than a tool problem.

The plan does not state the denominator. This reading comes from fixture doc §5.1,
which establishes it independently.

### 4.3 `diffCell` rule 3 must precede rule 5

The error-state block sits at position 3, above the identical-formula suppression
at position 5. A `#REF!` present in both files has identical formulas *and*
identical values; moved below rule 5 it is suppressed as "not a change" and never
appears. That is the plan's changes-only exception, and the plan names it the
failure an implementation is most likely to ship while looking correct.

Sabotaging it fails **Tests 30, 19, 29, 31, 33, '2c', '2d'** — and nothing else.
The other 67 tests stay green.

### 4.4 An absent mask means `FORMULA`, never `FORMULA_UNVERIFIED`

```js
const masked = (ctx.maskA !== undefined && ctx.maskB !== undefined &&
                ctx.maskA === ctx.maskB);
```

Drop the two `undefined` guards and `undefined === undefined` is true, so every
formula difference from a caller that did not compute masks reports as
`FORMULA_UNVERIFIED` — real edits filed as unverifiable and lost.

The default direction is deliberate: an unmasked genuine edit surfaces as
`FORMULA` (over-reporting, visible) rather than `FORMULA_UNVERIFIED`
(under-reporting, silent). `diffTab` always computes masks when both formulas are
present and differ, so only Test '2i', which calls `diffCell` directly, catches
this. **Test 3 stopped guarding this line the moment `diffTab` became the
caller** — exactly the drift a sabotage matrix is re-run to find.

### 4.5 A skipped alignment must return no `rowMap`

`alignRows` returns `rowMap: null` on both skip paths, and `compareWorkbooks`
writes `rowMaps[aName]` **only** when `!alignment.skipped`. Plan §4e keys on the
tab's absence from `rowMaps`; a `null` entry would satisfy `rowMaps[target]` as
falsy in `maskUnresolvable` but throw on `map.get(n)` in `relocate`. Test '3e'
pins the null, Test 22 pins the absence end to end.

### 4.6 `maskUnresolvable` masks only what has no map

Where the target tab has a row map the reference is left exactly as it is; only
targets absent from `rowMaps` get their absolute row replaced by `#`. Masking
every absolute row instead collapses a genuine repointing — `Rates!R4C2`
relocated to `R5C2` versus B's hand-edited `R9C2` — into two identical
`Rates!R#C2` strings, and the edit is filed `FORMULA_UNVERIFIED` and lost.

**Test 24's fixture must edit the row of the mapped reference specifically.** An
edit elsewhere in the formula (a trailing `+1`) survives masking and lets a
mask-everything implementation pass. The fixture originally did exactly that and
the mutation went undetected until the matrix was re-run.

A reference whose tab *has* a map but whose specific row is missing is **not**
masked. That is a dangling reference into a deleted row; Sheets will have
rewritten B's copy to `#REF!`, so it surfaces as `REF_ERROR_NEW` (Test 19).

### 4.7 The error scan has three call sites, each needing its own test

`diffTab` returns early twice — on `alignment.skipped` and on a header mismatch —
and **both** returns concatenate `scanErrorsUnaligned(tabB, tabName)`. A third
call sits in `compareWorkbooks` phase 1, for tabs added in B.

| Deleted call site | Fails |
|---|---|
| Skipped-alignment return | Test '5a' only |
| Header-mismatch return | Test 32 only |
| Phase 1, added tabs | Test '5b' only |

Three separate one-test guards; that is why all three exist.

### 4.8 `REF_RE` needs a word-boundary check the plan does not give it

The plan's regex makes both row and column parts optional, so its shortest match
is the two characters `RC`. Without a boundary test it fires inside ordinary
identifiers — `=Total_RC+1` would have its `RC` rewritten. `isRefBoundary_`
rejects a match whose adjacent character continues a word (`[A-Za-z0-9_.]`).

This cuts the other way too: if a real reference form ever appears flush against
a word character, the boundary check skips it silently. Test '4c' pins both
directions.

### 4.9 The plan §4b regex is unvalidated against reality, and the tests cannot tell

**This is the most dangerous thing in the file.** `REF_RE` matches the forms the
plan tabulates — `R4C2`, `R[-1]C[2]`, `RC[-1]`, `Rates!R4C2`, `'Q1 Rates'!R4C2`
— and every fixture writes its R1C1 forms by hand in exactly that syntax. **The
suite therefore proves the regex is self-consistent, not that it matches what
`getFormulasR1C1()` returns.** If the real output differs, relocation no-ops and
every shifted reference is reported as an authored `FORMULA` change — no error,
no warning, a plausible-looking CSV.

Two defences exist, and neither replaces running plan §1.2.

**`verifyReferenceForms(url [, tab])`** reads a real file and per formula cell
logs the A1 and R1C1 forms side by side, reporting whether `REF_RE` matched. Its
actionable output is the **no-match list**, which three populations reach:

| In the no-match list | Meaning |
|---|---|
| Carries `#REF!` or `#NAME?` | Expected — a broken reference has no `R`/`C` form left. Counted separately, not listed |
| A reference-free formula, `=TODAY()` | Expected. Listed; unavoidable noise |
| **A cross-sheet or absolute-row reference** | **`REF_RE` is wrong for this workbook and Step 4 is silently no-opping** |

Part (b) reports, per cell whose formula carries an error token, whether the token
`KEEPS` or `DROPS` through into R1C1. If no cell carries one it says §1.2b is
**unverified** rather than passing silently — an absent observation and a
successful one must not look alike.

**`buildSummary`** carries the same check as a field diagnostic (plan Step 11.4):
0 formulas realigned, while rows moved, while `stats.absRefs > 0` (§5.5).

### 4.10 The header guard reads the aligned pair, not B's row 0

The plan says to compare "trimmed row 0 of A vs B, positionally".
`headerMismatch_` instead finds the B row that alignment paired with A's row 0.

Positionally contradicts Test 7: a row inserted at the top of a tab puts a
stranger in B's position 0, the guard fires, and the tab comes back `TAB_SKIPPED`
instead of one `ROW_ADDED`. Reading the pair keeps the guard doing its real job —
catching a tab whose *columns* no longer line up, Test 12 — without firing on a
row insertion alignment has already explained. The mutation fails Test 7 alone.

If A's row 0 is unpaired (deleted) the guard is skipped entirely; guessing would
skip the tab on a deletion. Columns where either side holds a formula are skipped,
because comparing derived values here would skip tabs over ordinary recalculation.

### 4.11 Hashes are computed on the overlapping width

`hashGrid(tabData, width)` truncates each row to `width`, and both
`compareWorkbooks` and `alignRows` pass `min(widthA, widthB)`.

Without the cap, one added column appends a field to every hash on one side,
nothing matches anything, edit distance comes out at exactly 100%, and the tab is
skipped wholesale — which makes `COL_ADDED` and `COL_DELETED` unreachable code,
since a column delta is the only thing that produces them. The mutation fails
Test '5d' alone. This is an extension of the plan, which does not mention width.

### 4.12 `readTab` must carry both offsets, and dropping `rowOffset` is invisible

`getDataRange()` does not necessarily start at A1. If the first populated cell is
`C5`, `rowOffset` is 5 and `colOffset` is 3.

| Dropped | Symptom |
|---|---|
| `colOffset` | Every emitted `aRef`/`bRef` names the wrong column. **Loud** — a reader checks one reference and sees it |
| `rowOffset` | Every ref names the wrong row **and** every absolute-row lookup in `relocate` consults a map keyed on the wrong rows. The relocated formula still *looks* like a formula, so this produces plausible `FORMULA` rows with no error. **Silent** |

`readTab` passes `range.getRow()` and `range.getColumn()` straight into
`trimGrid`, which never touches them — it trims only *trailing* rows and columns,
so the position of `[0][0]` is fixed by the offsets alone. Tests '8a' and '8b'.

**A blank sheet is the edge case that reaches furthest.** `getDataRange()` on an
empty tab returns `A1:A1` holding `''`. Untrimmed that is a one-row tab, which
pairs with a real tab and compares against its first row. `trimGrid` reduces it to
zero rows — Test '8b'.

### 4.13 Phase 0 pairs on names before anything is read

`run()` calls `pairTabs` on the two name lists, then reads only tabs appearing in
`pairs` or `added`. A tab deleted in B is never read: `TAB_DELETED` carries no
cell rows, so reading it costs API calls to produce nothing.

The constraint this creates: **`readSheets_` returns every tab's name but only
the wanted tabs' grids.** `{ tabs, names }` is deliberately asymmetric, because
`compareWorkbooks` must pair against the *full* name list to pair correctly while
only indexing `tabs` by a name pairing selected. Narrowing `names` to the tabs
read would silently change the pairing — a tab absent from the list cannot be
reported deleted, and cannot block an unrelated normalised match.

`compareWorkbooks` then calls `pairTabs` again, and **that call is the
authoritative one** (§5.6).

---

## 5. Design rules and compromises

### 5.1 Additions to the plan's signatures

| Addition | Why it was unavoidable |
|---|---|
| `ctx.fA1A` / `ctx.fA1B` | `diffCell` rules 1–3 display formulas in **A1** while comparing in **R1C1** (rule 2 of the fifteen). It receives only R1C1 forms, so display forms must arrive some other way |
| `isAnchorable` as its own function | Plan §3.2 says to "mark these `anchorable: false`" but `hashRow` returns a string. Splitting the predicate keeps `hashRow` to its stated signature |
| `hashGrid(tabData, width)` | §4.11 |
| `diffTab(..., stats)` — 7th parameter | The noise ratio produces "a warning", which is a Step 10 concern, not a CSV row (§5.4) |
| `diffCell` returns `root`; `Change._root` | §2.1 |
| `compareWorkbooks(wbA, wbB, opts)` | §3.2 |
| `buildSummary(report)`, not `(results)` | The summary prints file name, elapsed time, both titles, added/deleted/renamed tabs and ambiguous-name warnings — none of which is on a `Stats`. Every field but `result` is optional and degrades to a placeholder, which lets tests call it with no Drive file behind it |
| `unresolvableTargets(f, tables, curTab)` | §5.3 |
| `stats.derivedSuppressed` / `unverifiedTargets` / `absRefs` | §5.2, §5.3, §5.5 |
| `verifyReferenceForms(url [, tab])` | Plan §1.2 is specified as a manual observation; once Step 8 existed, leaving the gate manual was a choice rather than a constraint (§4.9) |
| `readSheets_` / `sheetNames_` / `stamp_` | Step 8 is `readTab` alone; a workbook needs a loop, and §4.13 is why that loop takes a `wanted` set |

**Blank rows are non-anchorable too** — an extension, not an implementation, of
plan §3.2, which names only fully formula-driven rows. `isAnchorable` returns true
only for a row holding at least one literal cell with a non-empty value. A blank
row carries as little identity and collides as widely; anchoring on one mis-pairs
two unrelated padding rows and drags every row between them out of alignment.
Fixtures are padded to 16–20 rows, so blank-row collisions are not hypothetical.
Sabotaging `isAnchorable` to `return true` fails Test '3c'.

**`displayValue` and `normaliseValue` are deliberately different.**
`normaliseValue` (used by `hashRow`, `rowSimilarity_`, `headerMismatch_`,
`headerText_`) renders a `Date` as `'D' + getTime()`; `displayValue` (used for
`old`/`new`, `preview_`, `toCsv`) renders it as `toISOString()`. Collapsing them
puts a `D`-prefixed epoch integer in the CSV, or a locale-formatted date into a
row hash — where a timezone shift changes row identity and desynchronises
alignment.

**Fixtures must supply explicit R1C1 forms.** `sheet(grid)` marks any string
starting with `=` as a formula and, absent an explicit R1C1 grid, **stores the A1
text in `fR1C1` too** — harmless for Steps 2–3, unusable for Step 4. `plantG_`
exists so no Step 4–7 test can make that mistake: every planted cell is
`[r, c, a1, r1c1, value]` and the R1C1 form is mandatory. The mutation "compare in
A1 instead of R1C1" fails eight tests only because the fixtures make the two
differ wherever it matters.

### 5.2 The suppressed-derived count re-tests `diffCell`'s condition

`diffCell` returns `null` for a suppressed derived value and does not say why.
`buildSummary` must print the count anyway — it is the only place a reader learns
that cells changed and were deliberately withheld, and without it a downstream tab
showing no rows is indistinguishable from a bug. So `diffTab` re-tests the
condition on the `null` branch:

```js
} else if (fA !== '' && fA === fB &&
           !valuesEqual(tabA.values[aIdx][c], tabB.values[bIdx][c], opts)) {
  stats.derivedSuppressed++;
}
```

**Suppression itself is now a deviation.** Plan rule 13 requires these cells to
be *emitted*, as `DERIVED_VALUE`, into section 2 — see §11.1. What follows
describes the shipped counting mechanism, which the migration replaces with a
real emission; `stats.derivedSuppressed` becomes `stats.derived` and keeps its
purpose, since the summary's `DERIV` column needs the same number.

**This is a duplicated condition and therefore a compromise.** It is acceptable
because the alternative is worse: threading a mutable out-parameter into
`diffCell` gives the pure heart of the taxonomy a side effect, and `diffCell` is
called directly by Tests '2g', '2h' and '2i'. The duplication is safe because it
is *narrower* than rule 5 — every other way rule 5 is reached (`volatile`,
`includeDerived`) returns a row, and rules 1–4 all return a row, so the only
`null` this can catch is rule 5's suppression. Test '10d' pins the count at 1.

### 5.3 Unverifiable references are attributed to the referenced tab

The plan's Step 10 mock-up reads `⚠ 6 formulas hold unverifiable references:
Rates (4), Escalation (2)` — and in that same mock-up `Rates` is `SKIPPED`, so it
cannot be the tab *holding* those formulas. The count is attributed to the tab
**referenced**, and plan Step 11.6 confirms it.

`maskUnresolvable` knows which target failed and throws the name away.
`unresolvableTargets` therefore re-runs `rewriteRefs_` with the same per-match
resolution and collects the names. Running the same rule is the point — a second,
independently written predicate could drift and name a tab that was not masked.
Cost is bounded: it runs only for cells already classified `FORMULA_UNVERIFIED`.
Test '10e' asserts the attribution names `Rates`, the skipped tab, not `HVAC`,
which holds the formula.

### 5.4 The noise ratio is recorded, never emitted

`stats.noise` is set when `emitted / compared > opts.noiseWarn`. It produces no
Change row: a warning about the diff is not part of the diff, and a
`NOISE_WARNING` row would be filtered out with the noise it warns about.

Reaching it needs a specific shape. Changing *k* whole rows of *n* moves both the
noise ratio and the edit distance to *k/n*, so the tab skips before the noise
check runs. A **mass formula rewrite** is the reachable case: row hashes ignore
formula cells, so alignment stays perfect at edit distance 0 while a third of the
compared cells change. Test '5e' uses 20 rewritten formulas over 60 compared
cells. `stats.relocated`, `volatileCells` and `unverified` work the same way.

### 5.5 The `absRefs` gate on the relocation warning

Plan Step 11.4's field check — 0 formulas realigned while a referenced tab changed
rows — is automated in `summaryNotes_` with a third condition the plan omits:
`stats.absRefs > 0`.

Without it the warning fires on any workbook with row movement and no absolute
references at all — a workbook where there is nothing to realign and nothing
wrong. A warning that fires on correct runs trains the reader to skip it, and this
is the one warning that must never be skipped (§4.9).

`ABS_ROW_RE` (`/(?:^|[^A-Za-z0-9_.])R\d+C/`) is tested against each raw A-side
formula. It is deliberately looser than `REF_RE` — no string protection, no
right-hand boundary — because a false positive only makes a warning *available*
and never changes a classification. Test '10f' asserts both directions.

### 5.6 `run()` pairs twice rather than passing the pairing down

`run()` calls `pairTabs` to decide what to read; `compareWorkbooks` calls it again
to decide what to compare. Pairing once and passing the result in was rejected:
`compareWorkbooks` owns the two-phase ordering that Tests 18, 22, 26 and 32 exist
to check (§3.2), and accepting a pairing from its caller adds a parameter whose
only purpose is to let the I/O layer influence phase 0. The failure mode is nasty
— an inconsistent pairing makes `wbA.tabs[aName]` `undefined` inside phase 1,
surfacing as a thrown error deep in `hashGrid` rather than as a pairing problem.

`pairTabs` is pure and deterministic over the same two name lists, so the calls
cannot disagree, and it is O(tabs) on strings — unmeasurable next to one
`getValues()`. The comment in `run()` labels its own call **advisory** so the
second is not later "optimised" away.

### 5.7 Smaller rules

| Rule | Reason |
|---|---|
| A row added already broken is `REF_ERROR_NEW`, not `REF_ERROR` | The cell did not exist in A, so its A-side state is `'none'` by construction, and `'none'` → error is what rule 3 calls `REF_ERROR_NEW`. `aRef` stays empty. Test '5c'. Deleted rows are not scanned — B is the authority on what is broken now |
| Root vs inherited travels on `Change._root`, not in the text | `toCsv` could tell them apart by reading the row, but that is a poor thing for a sort to depend on. Before this field, the mutation "`errorState` checks the value only" failed **no test at all**; it now fails Test 33 |
| `errorState` is delivered ahead of its step (plan §4h) | `diffCell` rule 3 consumes it and the plan lists Test 30 as a Step 2 test. It reads the **A1** formula, which §4h names as the preferred surface, so it does not depend on the unresolved §1.2b observation |
| Test 21 renames `Q1 Rates`→`Q1_Rates`, not `Rates`→`Rates v2` | **The plan's fixture cannot pass under the plan's own pairing rule** — normalisation lowercases and strips punctuation only, so `rates` and `ratesv2` differ. Widening normalisation was rejected; the substitute tests the same rule (rule 5, sheet name through `tabMap`) and exercises both quoting paths. Test '7b' pins the original behaviour as a recorded decision |
| A dash is not a zero in the summary table | `0` under `VAL` asserts "no value changes here". For a `SKIPPED`, `added` or `deleted` tab that is false and unfalsifiable — nothing looked. `SKIPPED`/`added` show a real `REF` (the scan needs no alignment, §4.7) and dashes elsewhere; `deleted` dashes everything, since the tab is never read (§4.13). Tests '10c', '10g'. Likewise a renamed tab whose cells changed reads `ren+mod`, not `renamed`, which would hide every row in it (Test '10h') |

---

## 6. Expected behaviour

### 6.1 The suite

```
74 passed, 0 failed, 0 pending.
Plan acceptance tests: 33 implemented, 0 pending on unbuilt steps, 33 total.
Local tests of unnumbered branches: 41.
```

33 + 41 = 74. The tallies print separately because a single combined figure "of
33" overstates plan coverage; the runner reported exactly that until a
documentation pass caught it. `PENDING` is empty — every plan acceptance test
*that exists in this file* runs.

**That third number is now wrong, and wrong in the direction the plan warns
about.** `runTests()` computes its "total" as `planRun + PENDING.length` — the
count of numeric ids it happens to hold, not a figure it was told to expect. So
the line reads `33 total` and stays green while the plan's table has run to 38
since 2026-08-19. Plan Step 1 requires the opposite: **the runner must assert an
expected total and fail when it is not met**, precisely so that five acceptance
tests cannot go missing without a red run. Migration §3 closes this first,
because until it is closed every later step reports success against its own
bookkeeping. §11.1 lists the five.

**The plan lists no acceptance test against Steps 8, 10 or Step 9's I/O half**,
specifying the Step 11 live run as their verification instead. Twelve local tests
cover them anyway ('4z', '8a'–'8b', '10a'–'10i'), because Step 11 has not been run
and shipping three unexercised steps on the strength of a procedure nobody has
followed is not a verification.

### 6.2 Coverage by step

| Step | Acceptance tests | Local tests |
|---|---|---|
| 2 — `diffCell`, `valuesEqual` | 1, 2, 3, 4, 5, 6, 9, 11, 30 | '2b'–'2i' (8) |
| 3 — `trimGrid`, `alignRows` | 13, 14, 15, 16, 20 | '3a'–'3g' (7) |
| 4 — `relocate`, masking | 17, 19, 23, 24, 25, 27, 28, 29, 31 | '4a'–'4e' (5), '4z' |
| 5 — `diffTab` | 7, 12, 32 | '5a'–'5f' (6) |
| 6 — `toCsv` | 8, 33 | '6a' |
| 7 — `pairTabs` | 10, 21 | '7a', '7b' |
| 8 — `readTab` | none in the plan | '8a', '8b' |
| 9 — `compareWorkbooks` | 18, 22, 26 | — |
| 10 — `buildSummary` | none in the plan | '10a'–'10i' (9) |

Assertions that carry the most weight, as exact counts (coordinates are **sheet**
references, so they are what appears in `aRef`/`bRef`):

| Test | Fixture | Asserted |
|---|---|---|
| 7 | `=RC[-1]*2` in column C of 16 rows; row inserted at the **top** of B | 1 `ROW_ADDED`; **0 `FORMULA`, 0 `VALUE`**, total 1 |
| 12 | Header `ID,Name,Cost` vs `ID,Name,Price`, 15 identical data rows | 1 `TAB_SKIPPED`, `column` `C`, total 1 |
| 18 | `HVAC!C10` = `=Rates!$B$4`; row inserted in `Rates` above row 4. **`HVAC` listed first** | 1 `ROW_ADDED`; **0 `FORMULA`**, total 1 |
| 19 | `Rates` row 4 deleted; `Assumptions!C10` becomes `=Rates!#REF!` | 1 `ROW_DELETED` + 1 `REF_ERROR_NEW`, total 2; the error's `tab` is `Assumptions` |
| 20 | 20 rows, 9 even-indexed rows rewritten | 1 `TAB_SKIPPED`, reason `edit distance 45% — structure differs` |
| 22 | `Rates` unalignable; `HVAC!C10` shifts `R4C2`→`R5C2` | 1 `FORMULA_UNVERIFIED`, 0 `FORMULA`, 1 `TAB_SKIPPED`, total 2 |
| 23 | `=Rates!$B$4*Escalation!$C$7`; rows inserted in **both** targets | 2 `ROW_ADDED`; **0 `FORMULA`, 0 `FORMULA_UNVERIFIED`**, total 2 |
| 24 | Same formula; `Rates` maps 4→5 but B points at row 9; `Escalation` unalignable | 1 `FORMULA`, **0 `FORMULA_UNVERIFIED`**, 1 `TAB_SKIPPED`, 1 `ROW_ADDED`, total 3 |
| 26 | `HVAC!C10`→`Assumptions!C7`→`Rates!B4`; rows inserted in both targets | 2 `ROW_ADDED`; **0 `FORMULA`, 0 `FORMULA_UNVERIFIED`**, total 2 |
| 32 | Test 12's header mismatch plus `#REF!` at `C6` in B | 1 `TAB_SKIPPED` **and** 1 `REF_ERROR` with `aRef` `''`, `bRef` `C6`, total 2 |
| 33 | Root error in `Assumptions`, inherited in `HVAC`, identical in both files, **`HVAC` listed first** | 2 `REF_ERROR`; first CSV data line is `Assumptions`, second `HVAC` |
| '10a' | Summary rendering | `REF` precedes `VAL`; the row reads exactly `1 1 0 0 0 1 0 +1 0` |
| '10b' | Both error lines | `REFERENCE ERRORS: 2 total — 1 new, 0 fixed, 1 pre-existing`, plus the literal phrase `reports state, not deltas` |
| '10i' | Zero state | `REFERENCE ERRORS: none in either file.`; footer `→ changes-x.csv (0 rows, 4s)` |

**Tests '2h' and '2i' call `diffCell` directly.** Both branches were implemented
and wholly unexercised through fixtures until a documentation pass; `diffTab` now
reaches `FORMULA_UNVERIFIED` via Test 22 and `VOLATILE_VALUE` via Tests 27–28, but
the direct tests stay because they pin the `undefined`-mask default no fixture can
produce (§4.4).

### 6.3 The sabotage matrix

Each row is a mutation applied to a copy of the source in a `vm` context. **A
green suite proves nothing on its own; this table is what the green means.**

| Mutation | Fails | Count |
|---|---|---|
| Edit-distance denominator → the post-trim middle | 2, 4, 5, 6, 7, 11, 12, 13, 14, 16, 17, 18, 19, 23, 24, 25, 26, 27, '2b', '2e', '3d', '3g', '5c', '5d', '5e' | 25 |
| One row map per formula (first reference's tab wins) | 18, 21, 22, 23, 25, 26, 28, '4a', '4b', '4c' | 10 |
| `relocate()` no-ops (a broken plan §4b regex) | 17, 18, 21, 23, 25, 26, '4a', '4b', '4c' | 9 |
| Compare formulas in A1 instead of R1C1 | 7, 17, 18, 21, 22, 23, 25, 26 | 8 |
| Rule 3 moved below the identical-formula suppression | 19, 29, 30, 31, 33, '2c', '2d' | 7 |
| Single-pass: compare each tab as soon as it is aligned | 18, 23, 24, 25, 26, '5e' | 6 |
| `maskUnresolvable` masks every absolute row | 24, '4d' | 2 |
| `errorState` checks the value only, never the formula | 33 | 1 |
| Header guard compares B row 0 positionally | 7 | 1 |
| `hashGrid` ignores the width cap | '5d' | 1 |
| Scan removed from the skipped-alignment return | '5a' | 1 |
| `hashRow` hashes formula-cell values too | '3c' | 1 |
| `rowMap` built in array-index space | '3d' | 1 |
| Mask `undefined` guards removed | '2i' | 1 |
| `isAnchorable` → `return true` | '3c' | 1 |

**Eight mutations are caught by a single test each, across seven distinct tests**
— '3c' is the only one guarding two. Deleting Test 33, 7, '5d', '5a', '3c', '3d'
or the '2i' mask assertions each restores a silent failure mode. Two of those
guards were created during this build precisely because the matrix showed the
mutation passing: `errorState`'s root classification and the header guard's pair
lookup (§4.10).

### 6.4 Expected output of the Step 11 run

Against `GenerateTestWorkbooks.gs`'s fixture pair, each line is a falsifiable
check:

| Check | Expected |
|---|---|
| Completion | Inside 6 minutes. The footer prints elapsed seconds |
| Drive | Exactly one `changes-yyyyMMdd-HHmm.csv` in My Drive root |
| Source files | Unmodified. Neither file's revision history gains an entry |
| First CSV data rows | `REF_ERROR_NEW`, then `REF_ERROR_FIXED`, then `REF_ERROR`; roots before inherited within each (§7.3) |
| Relocation footer | **Non-zero** formulas realigned. Zero, with row movement and absolute references present, means §4.9 |
| `verifyReferenceForms` (a) | No cross-sheet or absolute-row formula in the no-match list |
| `verifyReferenceForms` (b) | The generator breaks references deliberately, so this must report `KEEPS` or `DROPS` — never "unverified" |

**What must produce nothing** is the stronger half of the assertion:

| Must emit no rows | Why |
|---|---|
| Tabs where only a row was inserted, in every tab referencing them | Rules 1–5 of the plan's fifteen. Any `FORMULA` row here is a relocation failure |
| Downstream formula cells whose inputs moved | Derived-value suppression; the count appears on the suppression line instead (§5.2). **Under the current plan this row is inverted** — they must appear, as `DERIVED_VALUE`, in section 2 (§11.1) |
| Every date cell | Rule 11. A `VALUE` row on an unchanged date means `.getTime()` normalisation broke |
| `#DIV/0!`, `#VALUE!`, `#N/A`, `#NUM!` cells | Not reference errors. They may appear as `VALUE` rows; never as `REF_ERROR*` |

### 6.5 What is not covered

| Not covered | Why |
|---|---|
| `getFormulasR1C1()`'s actual output | Plan §1.2a. `verifyReferenceForms` can now check it, but has not been run (§4.9) |
| Whether `#REF!` survives into R1C1 | Plan §1.2b. Diagnostic only while `errorState` reads the A1 form |
| `run()` against a live spreadsheet | Step 11. The call path is covered by the stubbed dry run (§1.4); the *platform* is not |
| `Utilities.sleep` pacing above 10 tabs | Dry-run fixtures have 4 tabs, so the branch never fired |
| `verifyReferenceForms` beyond one dry run | Deliberate — it reports what the real API returns, which is exactly what a fixture cannot supply |
| Apps Script's own parser and quota behaviour | The suite runs in V8 via Electron; five globals were stubbed |
| Array formulas, merged cells, column alignment, row moves | Non-goals in the plan |

---

## 7. Function reference

| Function | Step | Returns | Note |
|---|---|---|---|
| `valuesEqual(a, b, opts)` | 2 | boolean | Date → `getTime()`; strings trimmed; relative epsilon |
| `errorState(value, formula)` | 4h | `'none'`\|`'root'`\|`'inherited'` | Formula checked first (§5.7) |
| `diffCell(vA, vB, fA, fB, ctx, opts)` | 2 | `{change, old, new, root?}` \| `null` | 7 ordered rules; `fA` arrives relocated |
| `displayValue(v)` | 2 | string | Reader-facing; Date → ISO (§5.1) |
| `trimGrid(tabData)` | 3 | TabData | Trailing rows then columns; offsets untouched |
| `normaliseValue(v)` | 3 | string | Identity only (§5.1) |
| `hashRow(values, formulas)` | 3 | string | Literal cells only |
| `isAnchorable(values, formulas)` | 3 | boolean | §5.1 |
| `hashGrid(tabData, width)` | 3 | `{hashes, anchorable}` | `width` caps the columns (§4.11) |
| `alignRows(hA, hB, tabA, tabB, opts)` | 3 | Alignment | Four passes (§7.1) |
| `lcsMatch_` / `resolveGap_` / `rowSimilarity_` | 3 | pairs / void / 0..1 | `Int32Array` DP; `rowSimilarity_`'s denominator is positions where **either** side is literal |
| `relocate(f, tables, currentTab)` | 4 | string | A's formulas only (§3.1, §7.2) |
| `maskUnresolvable(f, tables, curTab)` | 4e | string | Masks only unmapped targets (§4.6) |
| `unresolvableTargets(f, tables, curTab)` | 4 | string[] | Names what `maskUnresolvable` masked (§5.3) |
| `rewriteRefs_(f, transform)` | 4 | string | Protect → replace → restore; the shared engine |
| `protectStrings_` / `restoreStrings_` | 4a/4f | `{text, literals}` / string | Placeholder is `<n>` |
| `isRefBoundary_(whole, offset, len)` | 4 | boolean | §4.8 |
| `formatRef_(sheetName, rowPart, colPart)` | 4d | string | Re-quotes only when the name needs it |
| `isVolatile(f)` | 4g | boolean | `/\b(INDIRECT\|OFFSET)\s*\(/i` on the raw formula |
| `diffTab(tabA, tabB, alignment, tables, tabName, opts, stats)` | 5 | Change[] | §7.2 |
| `scanErrorsUnaligned(tabB, tabName)` | 5.2 | Change[] | One file, one cell at a time; `aRef` always `''` |
| `headerMismatch_(tabA, tabB, alignment)` | 5 | column letter \| null | §4.10 |
| `headerText_` / `gridWidth_` / `preview_` | 5 | string / number / string | `preview_` truncates at 200 chars |
| `toCsv(changes)` | 6 | string | §7.3 |
| `csvField(v)` | 6 | string | Neutralise `^[=+\-@]`, **then** RFC 4180 quote |
| `changeIsRoot_` / `sideIsRoot_` | 6 | boolean | `_root` first, text as fallback (§5.7) |
| `pairTabs(namesA, namesB)` | 7 | `{tabMap, pairs, added, deleted, changes, warnings}` | §7.3 |
| `compareWorkbooks(wbA, wbB, opts)` | 9 | `{changes, tables, results, pairing}` | §3.2 |
| `buildSummary(report)` | 10 | string | §7.5. Pure; every field but `result` optional |
| `summaryCell_` / `summaryNotes_` | 10 | string / string[] | A number or `—` (§5.7); the warning block in plan order |
| `padR_` / `padL_` / `repeat_` / `signed_` | 10 | string | Fixed-width rendering. `pad_` in the harness is separate and left-aligns |
| `columnLetter(n)` / `a1(row, col)` | 5 | string | Bijective base-26 |
| **`readTab(sheet)`** | **8** | TabData | **I/O.** Six API calls; takes anything with `getDataRange()` |
| **`readSheets_(sheets, names, wanted)`** | **8** | Workbook | **I/O.** `names` is every tab, `tabs` only the wanted (§4.13) |
| **`sheetNames_(sheets)`** | **8** | string[] | **I/O** |
| **`run(urlA, urlB, opts)`** | **9** | `{fileId, fileUrl, rows, summary}` | **I/O.** §7.4 |
| **`stamp_()`** | **9** | string | **I/O** (`Session`). `yyyyMMdd-HHmm`, script timezone |
| **`verifyReferenceForms(url, tab)`** | **1.2** | string | **I/O.** The gate (§4.9) |
| `fixture` / `sheet` / `workbook` / `plantG_` / `plant_` / `inserted_` / `unalignable_` / `filler_` / `stubSheet_` | 1 | fixtures | §7.6 |
| `diffFixture_(tabA, tabB, opts)` / `cmp_(wbA, wbB, opts)` | 1 | Change[] / result | Whole-pipeline entry points for tests |

### 7.1 `alignRows` — the four passes

| Pass | Does | Exits early? |
|---|---|---|
| 0 | Prefix then suffix trim on equal hashes | No. The suffix loop is bounded by `pre`, so the two cannot overlap |
| 1 | Window guard, LCS over **anchorable** middle rows only, edit-distance cap | Yes — both guards return `rowMap: null` |
| 2 | Greedy similarity matching per gap between consecutive anchors | No |
| 3 | `rowMap` in sheet rows | No |

The window guard fires when **either** middle exceeds `ALIGN_WINDOW_MAX` (2000).
At the ceiling the DP allocates `Int32Array(2001 × 2001)` ≈ **16.0 MB**. Only
anchorable rows enter the table, so the real allocation is normally far smaller.

Pass 2 scores candidates across the whole gap, sorts descending, and takes
greedily with each row used once — O(gapA × gapB) in `rowSimilarity_` calls,
acceptable only because passes 0 and 1 have reduced the gaps to a handful of rows.

### 7.2 `relocate` and `diffTab`

What `relocate` moves, and what it does not:

| Element | Treatment |
|---|---|
| Sheet name | `tables.tabMap[target]`, re-quoted by `formatRef_` if the new name needs it |
| Absolute row (`R4`) | `tables.rowMaps[target].get(4)`; unchanged if the tab or the row is absent |
| Relative row (`R[-1]`, bare `R`) | Untouched — R1C1 is already shift-invariant |
| Column part, any form | **Never** touched. Column alignment is a plan non-goal |
| Double-quoted spans | Replaced by `<n>` before matching, restored after |
| Named ranges (`TaxRate`) | Not matched. Correct — named ranges do not shift; a deleted one yields `#NAME?`, caught by `errorState` |

The target tab is `ref.sheet || currentTab`, computed **per match**. A reference
with no sheet prefix must not gain one on output, so `relocate` passes `null` to
`formatRef_` rather than the resolved current tab name.

`diffTab`'s six stages, in order:

| # | Stage | Emits |
|---|---|---|
| 1 | `alignment.skipped` → return | `TAB_SKIPPED` ++ the unaligned scan |
| 2 | Header guard (§4.10) → return | `TAB_SKIPPED` with `column` set ++ the unaligned scan |
| 3 | Column delta over the non-overlapping width | `COL_ADDED` / `COL_DELETED` |
| 4 | Aligned pairs × overlapping width → `relocate`, `errorState` ×2, `isVolatile`, masks, `diffCell` | The nine cell types |
| 5 | `alignment.added` / `deleted` | `ROW_ADDED` / `ROW_DELETED`, plus `REF_ERROR_NEW` per broken cell in an added row (§5.7) |
| 6 | Noise ratio | Nothing — `stats.noise` only (§5.4) |

Masks are computed **only** when both formulas are present and differ — the one
condition `diffCell` can use them in. `ctx.volatile` is
`rawA !== '' && (isVolatile(rawA) || isVolatile(fB))`, using the **raw** A-side
formula, because relocation only changes coordinates and the test is for a
function name.

### 7.3 `toCsv`'s sort and `pairTabs`'s three passes

| Sort key | Value |
|---|---|
| `k0` | 0 for the three `REF_ERROR*` types, 1 for everything else |
| `k1` | 0 root, 1 inherited (errors only) — from `_root` (§5.7) |
| `k2` | `REF_ERROR_NEW` 0, `REF_ERROR_FIXED` 1, `REF_ERROR` 2 |
| tiebreak | original index, so non-error rows keep workbook order |

`csvField` neutralises a leading `=`, `+`, `-` or `@` **before** quoting. The other
order puts the apostrophe inside the quotes where it does nothing, producing
`'"=A1,B1"`, which Sheets re-imports as a formula.

`pairTabs` runs exact name match, then normalised match on the remainder
(`toLowerCase()` then `replace(/[^a-z0-9]/g, '')`, emitting `TAB_RENAMED`), then
leftovers become `TAB_DELETED` and `TAB_ADDED`. If two names on either side
normalise alike, **the whole bucket is withdrawn from normalised matching** and a
warning is pushed to `pairing.warnings`; the tabs fall through. A wrong pairing
generates a full-tab phantom diff, so guessing is worse than reporting a delete
and an add. Test '7a'.

### 7.4 `run` and `readTab` — the I/O half of Step 9

For files of *T_A* and *T_B* tabs of which *P* pair and *N* are added in B:

| Phase | Does | Calls |
|---|---|---|
| 0 | `openByUrl` ×2, `getSheets` ×2, `getName` per sheet, `pairTabs` | `4 + T_A + T_B` |
| 1+2 | `readSheets_` ×2 → `readTab` per **wanted** tab, then `compareWorkbooks` | `6 × (2P + N)` |
| 3 | `toCsv`, one `DriveApp.createFile`, `getUrl`, `getId` | 3 |

`readTab` makes six calls per tab: `getDataRange`, the three grid getters, `getRow`
and `getColumn`. That is the plan's `6T + 4`, with `getName` per sheet added by
phase 0 and tabs deleted in B subtracted by §4.13. `readSheets_` inserts
`Utilities.sleep(1000)` between reads when a file has more than 10 sheets — **that
branch is untested**.

`run()` does **not** re-implement phase ordering: it reads both workbooks fully,
then hands them to `compareWorkbooks`. A single-pass loop in the I/O layer would
produce false `FORMULA` rows across every referencing tab — plausible enough to be
believed, and invisible to Tests 18, 22 and 26, which only exercise
`compareWorkbooks` (§3.2).

The summary goes to `console.log`; **the CSV never does.** Apps Script truncates
large log payloads with no documented ceiling, so a logged CSV silently loses rows.

### 7.5 `buildSummary` — layout and the mandatory lines

Four blocks: **Head** (`A:`/`B:` titles with tab counts), **Table** (one row per
tab — paired in A's order, then deleted, then added; `REF` first), **Totals**
(changed/unchanged/skipped over A's tabs, additions in B reported apart; then
values, formulas, hardcodes, volatile; then the error tally; then the file footer
with row count and elapsed seconds), **Notes**.

`TAB` is `max(20, longest label)` wide, `STATUS` is 11, and the nine numeric
columns are right-aligned at 6/6/7/8/6/7/8/7/7. `signed_` gives `±ROW` and `±COL`
an explicit `+`. Statuses: `modified`, `unchanged`, `SKIPPED` (upper-case — it
means *nothing was compared*), `renamed`, `ren+mod`, `deleted`, `added`.

The notes block, each line suppressed when its count is zero:

| Note | Fires when |
|---|---|
| `⚠ N references broke in this revision` | `REF_ERROR_NEW > 0` |
| `⚠ N pre-existing … reports state, not deltas` | `REF_ERROR > 0` |
| `⚠ <tab> skipped: <reason>` + errors-still-scanned | per skipped tab |
| `⚠ N formulas hold unverifiable references into: …` | `unverified > 0` (§5.3) |
| `⚠ N INDIRECT/OFFSET formulas changed value…` + the total-versus-detected gap | `volatileEmitted > 0` / `volatileCells > 0` |
| `ℹ Derived values suppressed: N cells…` | `derivedSuppressed > 0` (§5.2). **The plan replaces this line** with a `DERIVED:` tally, a `DERIV` table column and two `ℹ` lines about the two-table CSV (§11.1) |
| `ℹ References relocated: …, N formulas realigned` | `relocated > 0` or rows moved |
| `⚠ 0 formulas realigned while N rows moved…` | §5.5 |
| `⚠ <tab>: N of M compared cells changed` | `stats.noise` (§5.4) |
| `⚠ ambiguous tab name normalisation…` | `pairing.warnings` (§7.3) |

**Two lines are mandatory** where the plan is concerned: what broke now, and the
statement that pre-existing errors are a state report rather than a change.
Without the second, a reader filters them out along with the diff noise — exactly
what the tool exists to prevent. Test '10b' asserts both by their text.

**The zero-error case is a deviation.** Printing `⚠ 0 references broke` is noise,
so when no error exists the tally reads `REFERENCE ERRORS: none in either file.`
and both warnings are omitted. The mandate has nothing to bite on with no errors,
but **silence** would read as "not checked", so the explicit `none` stays (Test
'10i'). Relocation row movement likewise shows `+1/-1 rows in <tab>` when an
insertion and a deletion cancel, because `0 rows in <tab>` would hide both.

### 7.6 The fixture builders

| Builder | Produces | Use when |
|---|---|---|
| `fixture(values, fR1C1, fA1, rowOffset, colOffset)` | TabData verbatim | Exact control, or an offset |
| `sheet(grid, r1c1, rowOffset, colOffset)` | TabData from a compact grid | Literal-only tabs — `=` prefix means formula |
| `plantG_(grid, cells, rowOffset, colOffset)` | TabData with formulas planted | **Any test involving Step 4.** `cells` are `[r, c, a1, r1c1, value]`; rows padded rectangular |
| `plant_(n, cells)` | `plantG_` over `filler_(n)` | The common case |
| `inserted_(n, idx, cells)` | `filler_(n)` with `['Inserted', 999]` spliced at `idx`, then planted | The B side of an insertion test |
| `unalignable_()` | 20 rows, 9 rewritten | The B side of a "this tab must skip" test |
| `workbook({name: TabData})` | `{tabs, names}`, insertion order kept | Multi-tab tests. Throws on a non-TabData |
| `filler_(n, startAt)` | `n` rows of `['Row k', k*10]` | Padding past the edit-distance cap |
| `stubSheet_({values, fR1C1, fA1, row, col})` | An object exposing the five methods `readTab` calls | Testing `readTab`'s contract without a spreadsheet |

`filler_` exists because of the edit-distance cap: 2 / (2n) ≤ 0.30 needs n ≥ 4 for
a single isolated edit, and several spread-out edits need considerably more. Every
fixture here uses 16–20 rows.

**Insertion indices matter.** `inserted_(16, 2, ...)` splices at array index 2,
which is sheet row 3, which is *above* row 4 — so the row map sends 4 → 5. Off by
one and the fixture tests nothing, because the map becomes an identity and
`relocate` looks correct while doing nothing.

---

## 8. Diagnosing a failure

**In the suite:**

| Symptom | Likely cause |
|---|---|
| Apps Script asks for authorisation on `runTests()` | A Google-service call has been added above the I/O boundary (§0) |
| The local runner prints nothing, exit 0 | `console.log` is discarded under `ELECTRON_RUN_AS_NODE` (§1.2) |
| The runner file is replaced by test output | `process.argv[1]` is the script path; arguments start at `argv[2]` (§1.2) |
| 25 unrelated tests fail together | Edit-distance denominator changed to the post-trim middle (§4.2) |
| Only 19, 29, 30, 31, 33, '2c', '2d' fail | `diffCell` rule 3 moved below rule 5 (§4.3) |
| Only 24 and '4d' fail | `maskUnresolvable` is masking references whose tab **has** a map (§4.6) |
| Only 7 fails | The header guard is reading B's row 0 positionally (§4.10) |
| Only '5d' fails | `hashGrid`'s width cap dropped — a column delta now skips the tab (§4.11) |
| Only '5a', only 32, or only '5b' fails | One of the three `scanErrorsUnaligned` call sites was removed (§4.7) |
| Only 33 fails | `errorState` no longer distinguishes root from inherited (§5.7) |
| Only '3d' fails | `rowMap` built in array-index space (§4.1) |
| Only '3c' fails | `hashRow` counting formula-cell values, or `isAnchorable` widened (§5.1) |
| Only '2i' fails | Mask `undefined` guards removed (§4.4) |
| 18/22/26 fail while 17 and 23 pass | Phase 1 no longer completes before phase 2 (§3.2) |
| `TAB_SKIPPED` where a cell change was expected | Fixture too short for the edit-distance cap — pad with `filler_` (§7.6) |
| A relocation test passes but proves nothing | The insertion index is at or below the referenced row, so the map is an identity (§7.6) |

**On a real run:**

| Symptom | Likely cause |
|---|---|
| `⚠ 0 formulas realigned while N rows moved` | Plan §1.2a was never done and `REF_RE` matches nothing (§4.9). **This is the failure with no error message** — run `verifyReferenceForms` |
| `FORMULA` rows across every tab referencing one changed tab | The same thing, or phase 1 not completing before phase 2 (§3.2). Check the relocation footer first — it distinguishes them |
| Every emitted `aRef` names the wrong column | `colOffset` lost between `getDataRange()` and `TabData` (§4.12) |
| References look right but `FORMULA` rows appear on untouched formulas | `rowOffset` lost — the row map is keyed on the wrong rows. Silent, and the loud half of §4.12 will not show it |
| A tab that looks unchanged reads `modified` with every count 0 | A `COL_ADDED`/`COL_DELETED` row, or non-zero `±ROW`/`±COL`: structural changes set `modified` without a cell count |
| Summary shows `0` where a tab was skipped | `summaryCell_`'s dash logic broke; `0` there asserts something nothing checked (§5.7) |
| A downstream tab shows no rows but its numbers moved | Working as designed. Read the `ℹ Derived values suppressed` line, then trace upstream (§5.2) |
| `REF_ERROR` rows for `#DIV/0!` or `#N/A` | A token was added to `REF_ERROR_TOKENS`. Test 11 catches `#DIV/0!` only |
| Execution exceeds 6 minutes | Tab count times grid size. The pacing above 10 tabs adds a second per tab — untested (§6.5) |
| Two CSVs with the same name | Two runs inside one minute. `stamp_` is minute-resolution; nothing was overwritten (§1.1) |
| `verifyReferenceForms` reports §1.2b "unverified" | No cell in the file carries `#REF!`/`#NAME?`. Break one deliberately and re-run (§4.9) |

---

## 9. Extending

**To add a test:**

1. Append `{ n, name, fn }` to `TESTS`. Use a **numeric** `n` only for a plan
   acceptance test — the runner counts numeric ids against the plan's total and
   string ids as local (§6.1). **That total is now 38, and the runner does not
   assert it** (§11.2); numbers 34–38 are unclaimed and belong to the migration.
2. Build fixtures with `plant_`/`inserted_` if formulas are involved, `sheet()` if
   not, padded via `filler_` to ≥16 rows.
3. Assert with `assertCount` **and** `assertTotal`. A count alone permits extra
   rows to appear unnoticed, which is how a regression that adds output stays
   green.
4. Mutate the line the test protects and confirm the test fails. A test that
   survives its own sabotage is decorative (§6.3).

**To add a change type:**

1. Add the rule to `diffCell` in taxonomy order, and re-read §4.3 before choosing
   where — rule 3's position ahead of the suppression rule is a correctness point.
2. Add it to `SUMMARY_TYPE_COL` and, if it deserves a column, to `SUMMARY_COLS`. A
   type absent from the map is treated as structural: it appears in the CSV and
   counts toward nothing in the summary table.
3. If it is an error type, add it to `toCsv`'s `rank` map (§7.3) **and** to the
   error tally in `buildSummary`. Missing the second leaves a row in the CSV that
   the `REFERENCE ERRORS:` line does not count, so the two disagree silently.

**To add a summary line:**

1. Add the counter to `diffTab`'s `stats` initialiser — every field must be
   initialised there, or a tab that never reaches the incrementing branch leaves
   it `undefined` and the summary prints `NaN`.
2. Push the line in `summaryNotes_`, in the plan's order, guarded on a non-zero
   count. A line that fires on a correct run trains the reader to skip the block
   (§5.5).
3. Assert the line **by its text**, as Tests '10b' and '10d' do. Asserting only
   the count lets a rewording silently drop the sentence that gave the number
   meaning.

**To touch the I/O layer:**

1. Everything added must go below the `I/O BOUNDARY` banner. Anything above it
   that calls a Google service breaks `runTests()`'s no-authorisation property
   (§0), and no test will catch it — the suite never runs in Apps Script.
2. Nothing may call a setter on either source spreadsheet. The dry-run harness
   (§1.4) enforces this with throwing proxies; re-run it after any change here.
3. `readTab` must keep taking a duck-typed object rather than a `Sheet`, or Tests
   '8a' and '8b' cannot construct an input.

**Seven traps, all quiet:**

- A fixture built with `sheet(grid)` alone gives Step 4 A1 text where it expects
  R1C1, and the relocation regex silently matches nothing (§5.1).
- A test of `rowMap` with equal `rowOffset` values passes against an index-space
  bug (§4.1).
- An insertion index at or below the referenced row makes the row map an identity,
  and the relocation test passes without relocating (§7.6).
- Adding a token to `REF_ERROR_TOKENS` turns the targeted scan into a general
  error report. Test 11 catches `#DIV/0!` specifically; `#VALUE!`, `#N/A` and
  `#NUM!` have no test and would slip through.
- A fixture whose reference names a row **outside** the target tab's data range
  produces a `FORMULA` row that looks like a relocation bug and is not: with
  `rowOffset` 5, `Rates!R4C2` has no map entry, so plan §4d leaves it alone by design.
  This cost real time during the dry run.
- Narrowing `readSheets_`'s returned `names` to the tabs actually read changes the
  pairing without changing any test (§4.13).
- Passing `run()`'s advisory pairing into `compareWorkbooks` to "avoid pairing
  twice" makes an inconsistency surface as a thrown error inside `hashGrid` rather
  than as a pairing problem (§5.6).

---

## 10. Known limitations

| Limitation | Whose | Status |
|---|---|---|
| **The plan's 2026-08-19 revision is unimplemented.** No `DERIVED_VALUE`, no `sectionOf`, no second CSV section, no `derivedCap`; recalculated cells are suppressed and counted | This build, against the current plan | The largest gap. §11.1; rules 13–15 and tests 34–38 |
| **The plan's 2026-08-22 revision is unimplemented.** One file rather than twelve, no `appsscript.json`, URLs in source rather than Script Properties, no `VERSION`, test globals unprefixed, `runTests()` asserts no total | This build, against the current plan | §11.2. Independent of the above and closable separately |
| **`runTests()` reports its own count as the plan total** | This build | Reads `33 total` while the plan's table holds 38, and stays green. §6.1, §11.2 |
| **Step 11 not run.** No part of this has met a live spreadsheet | This build | The blocking gap. §1.3 procedure, §1.4 what was verified instead, §6.4 what to check |
| **Plan §1.2 not run.** `REF_RE` is validated only against the forms the plan tabulates | Inherited from the plan | `verifyReferenceForms` performs it in one call, but nobody has. **The suite cannot detect the mismatch** (§4.9) |
| `Utilities.sleep` pacing above 10 tabs never executed | This build | Dry-run fixtures have 4 tabs (§6.5) |
| `verifyReferenceForms` has no unit test | This build | Deliberate: it reports what the real API returns, which a fixture cannot supply |
| Per-tab tallies recomputed from Change rows rather than read from `Stats` | This build | Intended (§2.1). `Stats` knows counts, not classifications |
| `derivedSuppressed` duplicates `diffCell` rule 5's condition | This build | Documented compromise; the alternative gives `diffCell` a side effect (§5.2) |
| `run()` pairs tabs twice | This build | Deliberate (§5.6). Cost is O(tabs) on strings |
| Two runs in one minute produce two identically named CSVs | This build | Drive permits duplicate names, so nothing is lost. Minute resolution matches the plan's filename format |
| Test 21 does not use the plan's fixture | This build | The plan's own pairing rule cannot pair `Rates` with `Rates v2` (§5.7) |
| Header guard reads the aligned pair, not B row 0 | Deviation from the plan | Required by Test 7; the plan's literal wording fails it (§4.10) |
| Hashes capped to the overlapping width | Extension beyond the plan | Without it `COL_ADDED`/`COL_DELETED` are unreachable (§4.11) |
| `REF_RE` carries a word-boundary check | Extension beyond the plan | The plan's regex matches the bare string `RC` inside identifiers (§4.8) |
| Blank rows treated as non-anchorable | Extension beyond the plan | Deliberate (§5.1); the plan names only formula-driven rows |
| Added rows' errors typed `REF_ERROR_NEW` | This build | The plan requires the flag but names no type (§5.7) |
| A column delta reaches `COL_ADDED` but cells beyond the overlap are never compared | Inherited from the plan | Column alignment and absolute-column relocation are explicit non-goals |
| Edit-distance denominator not specified by the plan | Inherited from the plan | Resolved via fixture doc §5.1 (§4.2) |
| `INDIRECT`/`OFFSET` cannot be resolved; `VOLATILE_VALUE` is silent when the value happens not to change | Inherited from the plan | Plan §0.3 names it a known limit and forbids fixing it |
| `alignRows` calls `hashGrid` internally, recomputing hashes its caller already built | This build | ~2× redundant hashing; negligible at these sizes, worth folding into the signature if a large workbook shows up in a profile |
| Suite validated in V8 via VS Code's Electron, not in Apps Script | This build | The file uses no platform API, so the risk is confined to Apps Script's own parser; running `runTests()` once in the editor closes it |
| Array formulas, merged cells, row moves, charts, formatting | Non-goals in the plan | Not defects — see the plan's Non-goals table |

---

## 11. Conformance with the revised plan

The plan was revised twice after this code shipped. Neither revision has been
implemented. The two are **independent** — §11.1 changes what the tool outputs,
§11.2 changes how the source is arranged and configured — and either can be
closed without the other.

This section is the falsifiable half of the frontmatter's claim. Every "shipped"
cell cites a line or a name in `SheetsDiff.gs`; every "presents as" cell says
what an unaware reader would see, because that is what decides which gaps are
urgent.

### 11.1 The 2026-08-19 revision — derived values into a second section

**What changed in the plan.** A cell whose formula is identical in both files but
whose value differs is no longer discarded. It is emitted as `DERIVED_VALUE` into
**section 2** of the CSV — a second table below a blank line, a `#` marker and a
repeated header — and section membership is computed from the change type by a
pure `sectionOf`, never stored on a `Change`.

| Plan item | Shipped | Presents as |
|---|---|---|
| `DERIVED_VALUE` change type | Absent. `diffCell` rule 5 returns `null`, or `VALUE` when `includeDerived` is on (line 226) | **Silent.** Recalculated cells produce no row and the reader is told only a count |
| `SECTION_2_TYPES`, `sectionOf(change)` → 1 or 2 | Absent — no notion of a section anywhere | n/a until a type needs routing |
| Two-block CSV: blank line, `#` marker, repeated header | `toCsv(changes)` (line 1181) writes one header and one block | n/a |
| `toCsv(changes, `**`opts`**`)` | One parameter. Truncation and the section switch both need `opts` | A signature change with no compiler to catch it |
| `OPTS.derivedSection: true` | `OPTS.includeDerived: false` (line 75) — different name, inverted default, **different semantics**: emits `VALUE` into section 1 | **Dangerous.** Reads like the same switch. Turning it on produces the merged table rule 13 exists to forbid |
| `OPTS.derivedCap: 5000` + `DERIVED_TRUNCATED` row | Absent. Nothing bounds the emitted row count | n/a while nothing is emitted |
| Section 2 sorted in workbook order only | `toCsv`'s sort has one section and an error-first rank (§7.3) | n/a |
| Rule 15 — noise ratio and edit-distance cap count **section 1 only** | `stats.noise = stats.emitted / stats.compared` (lines 1055–1056), where `emitted` counts every emitted cell change | **Latent, and the nastiest item here.** Compliant today only because nothing derived is emitted. The moment `DERIVED_VALUE` lands, one input change trips the warning on every connected tab — test 38 |
| `hashRow` must keep excluding formula-cell values | Already excludes them (§5.1, Test '3c') | Compliant, and must stay so — the plan names "improving" it as the way rule 15 fails upstream |
| Rule 14 — `ctx.volatile` tested **before** the derived branch | **Already correct.** `diffCell` rule 5 tests `ctx.volatile` at line 222, `includeDerived` at line 226 | Compliant. The plan's single scariest new rule is satisfied structurally; the migration must not reorder these two lines |
| Summary `DERIV` column | `SUMMARY_COLS` holds nine columns, none of them `DERIV` (lines 1390–1400); `SUMMARY_TYPE_COL` maps nine types, not `DERIVED_VALUE` (lines 1403–1407) | Column absent |
| Summary `DERIVED: N cells recalculated` line, two `ℹ` lines on the two-table CSV, truncation warning | One `ℹ Derived values suppressed: N` line instead (line 1671) | Wrong claim once emission lands |
| Footer split — `(88 rows in section 1, 818 in section 2)` | `(N rows, Ms)` from `report.csvRows` (lines 1562–1563) | Understates the review job |
| Acceptance tests 34–38 | Absent. `TESTS` holds numeric ids **1–33** and 41 string ids; `PENDING` is empty (line 3524) | **Silent** — §6.1 |
| Tests 4, 27, 28, 33 restated against sections | Present but weaker: 4 asserts suppression; 27–28 assert `VOLATILE_VALUE` without asserting **zero** `DERIVED_VALUE`; 33 asserts sort order without asserting section 1 | Each passes for the wrong reason once section 2 exists |

**The five missing tests, and what each is the only guard for:**

| Test | Guards |
|---|---|
| 34 | `sectionOf` returns 2 for `DERIVED_VALUE`, and `old`/`new` carry the two **values**, not the formula |
| 35 | The section boundary itself — both blocks present, error first in section 1, **zero `DERIVED_VALUE` above the marker** |
| 36 | `derivedSection: false` is byte-identical to today's output — no marker, no blank line, no second header |
| 37 | `derivedCap` truncates **after** sorting, so the file is deterministic and re-runnable; section 1 untouched |
| 38 | Rule 15 — a tab that recalculates 90% of itself raises **no** noise warning |

Tests 34, 36 and 37 fail loudly if the feature is missing. **35 and 38 do not**:
35 is satisfied by any output holding the right rows in the wrong place, and 38
by any run that happens not to cross the threshold.

### 11.2 The 2026-08-22 revision — layout, config, versioning

**What changed in the plan.** The project became twelve `.gs` files with numeric
load-order prefixes, one `.test.gs` per module, a checked-in `appsscript.json`
with explicit scopes, spreadsheet URLs in Script Properties rather than source,
and a hand-bumped `VERSION` stamped into every output.

| Plan item | Shipped | Presents as |
|---|---|---|
| Twelve files, `00_Config.gs` … `90_Main.gs` | One file, `SheetsDiff.gs`, 3,524 lines | Cosmetic until someone edits it |
| Purity enforced by the file tree, checkable in one grep | Enforced by the `I/O BOUNDARY` banner at line 1755, and by convention | **Functionally equivalent today**, weaker under edit: a `SpreadsheetApp` call added above the banner is invisible to a file listing and to `runTests()`, which never runs in Apps Script (§9) |
| One `.test.gs` per module, `98_TestLib.gs`, `99_TestRunner.gs` | 74 tests in one `TESTS` array literal, in the same file as the code | The suite ships, which is what plan Step 1.4 actually asks for |
| `runTests()` **asserts** its own expected total | Computes the total from what it holds (§6.1) and reports `33 total` | **Silent, and already failing** — five acceptance tests are missing and the run is green |
| Every test global prefixed `t_` | `fixture`, `sheet`, `workbook`, `filler_`, `assertEqual`, `plantG_` … unprefixed | Harmless in one file; a last-one-wins overwrite with **no error** the moment the files split. Rename before the split, not after |
| `appsscript.json` checked in, `oauthScopes` explicit, `spreadsheets.readonly` | No manifest in the project directory | **The read-only guarantee is promised by the code rather than enforced by the platform** (§0). The cheapest real safety gain available |
| `URL_A` / `URL_B` from Script Properties | `const URL_A` / `URL_B` at lines 71–72, used as `run()`'s defaults (line 1845) | Spreadsheet ids in version control, and the checked-in default is whatever was last compared |
| `run()` / `runWith(urlA, urlB, opts)` split | `run(urlA, urlB, opts)` (line 1840) — already argument-driven, but falls back to the source constants and never reads `PropertiesService` | **Half done.** The orchestration is already free of ambient state; only config resolution needs lifting out |
| `VERSION` in `00_Config.gs`, stamped into filename and summary head | No `VERSION` constant. Filename is `changes-<yyyyMMdd-HHmm>.csv` (line 1866) | An old CSV cannot be attributed to a build. The fixture generator already stamps `FIXTURE_VERSION`, so a fixture pair and the CSV that diffed it cannot be matched up |
| Entry point named `verifyR1C1()` | `verifyReferenceForms(url, tab)` | Naming only. The shipped function does strictly more (§4.9) — keep the behaviour and settle the name in both documents |
| `clasp` clone into a git repo | The project directory is not a git repository | No history. Two runs that behaved differently cannot be told apart |
| Non-goals gain: bundler / TypeScript / npm, mocking `SpreadsheetApp`, a shared `utils.gs` | Not listed in §6.5 or §10 | Documentation only — this build already obeys all three |

### 11.3 Where the shipped code has no place in the plan's layout

The plan's §1.1 file table was written against its own module map, which lists
nineteen functions. This build ships those plus the additions in §5.1. Most have
an obvious home; **one does not**, and it is the function four tests depend on.

| Function or constant | Plan file | Note |
|---|---|---|
| `displayValue` | `10_Values.gs` | Beside `normaliseValue`, from which it must stay distinct (§5.1) |
| `isAnchorable`, `hashGrid` | `20_Align.gs` | §4.11, §5.1 |
| `unresolvableTargets`, `rewriteRefs_`, `protectStrings_`, `restoreStrings_`, `isRefBoundary_`, `formatRef_`, `REF_RE`, `ABS_ROW_RE` | `21_Relocate.gs` | The regex engine and its callers (§3.1) |
| `headerMismatch_`, `gridWidth_`, `preview_` | `31_DiffTab.gs` | |
| `changeIsRoot_`, `sideIsRoot_`, `CSV_HEADER` | `50_Csv.gs` | |
| `summaryCell_`, `summaryNotes_`, `padR_`, `padL_`, `repeat_`, `signed_`, `SUMMARY_COLS`, `SUMMARY_TYPE_COL` | `60_Summary.gs` | |
| `readSheets_`, `sheetNames_`, `stamp_`, `verifyReferenceForms` | `90_Main.gs` | I/O, correctly (§4.13, §7.4) |
| **`compareWorkbooks`** | **None** | See below |
| `ALIGN_WINDOW_MAX`, `HASH_CELL_SEP`, `HASH_FORMULA`, `READ_PACE_TABS`, `READ_PACE_MS` | `00_Config.gs` | All literal declarations, so plan §1.1a's load-order hazard does not bite. **Keep them literal** |

**`compareWorkbooks` is pure, and the plan puts its work inside `runWith`, which
is not.** The plan's Step 9 describes phases 0–2 as part of the impure entry
point; this build extracted them so Tests 18, 22, 26 and 32 can check the
two-phase ordering without a spreadsheet (§3.2). Folding it back into
`90_Main.gs` to match the twelve-file table would move the ordering guarantee
those four tests exist for into the one file the suite cannot reach — the exact
inversion §3.2 was built to prevent.

**Resolution: a thirteenth file, `70_Compare.gs`, pure.** A deliberate deviation
from plan §1.1, recorded here rather than silently taken. It costs one row in a
table; the alternative costs four tests their subject.

### 11.4 Already compliant — do not rebuild

Worth stating explicitly, because a migration that re-derives these will
reintroduce failure modes the sabotage matrix already protects (§6.3):

| Plan item | Evidence |
|---|---|
| Rule 14 — volatile tested before derived | `diffCell` lines 222–228; Tests 27, 28, '2h' |
| Rule 8 — error state before the identical-formula rule | `diffCell` rule 3; §4.3; Test 30 |
| Rule 9 — the error scan is independent of alignment | Three call sites, §4.7; Tests 32, '5a', '5b' |
| Rule 4 — per-match target resolution | `rewriteRefs_`, §3.1; Tests 23, 25 |
| Rule 6 — mask only what has no map | §4.6; Test 24 |
| Rule 10 — every tab aligned before any tab compared | `compareWorkbooks`, §3.2; Tests 18, 26 |
| `hashRow` excludes formula-cell values | §5.1; Test '3c' — rule 15 depends on this staying true |
| `Change` carries no `section` field | It carries none, and `sectionOf` must not add one |
| RFC 4180 escaping, injection prefix before quoting | `csvField`, §7.3; Test 8 |
| `REF_ERROR_TOKENS` is two tokens | Line 86; Test 11 |
| Nothing writes to a source spreadsheet | §0, §1.4 — throwing proxies |
