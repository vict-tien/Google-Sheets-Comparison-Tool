---
title: Sheets Diff Tool — Implementation Documentation
status: implementation documentation — describes shipped code. Steps 1–10 complete against the plan's 2026-08-22 revision, its current one; **Step 11, the live run, is still not done (§1.3)**
date: 2026-08-08
revised: 2026-08-22 — **v1.1.0.** Both outstanding plan revisions are now implemented: `DERIVED_VALUE` and the two-section CSV (the plan's 2026-08-19 revision), and the multi-file layout, Script Properties config and `VERSION` stamping (2026-08-22). §11 is a conformance note rather than a gap analysis. §0, §1.1–§1.4, §2, §5.2, §5.4, §6.1–§6.4, §7, §8, §9 and §10 describe the new behaviour
target: Google Apps Script (V8), twenty-four `.gs` files in `src/` plus a checked-in manifest, no external libraries
documents: v1.1.0 — `src/00_Config.gs` … `src/99_TestRunner.gs`, `VERSION = '1.1.0'` in `src/00_Config.gs`
built_from: Google Sheets Difference Comparison Tool Implementation Plan.md, revision 2026-08-22 — **not checked in**; the plan is the specification this build was measured against and lives outside the repository
measured_against: Google Sheets Difference Comparison Tool Implementation Plan.md, revision 2026-08-22
migration: docs/migration-v1.1.0.md — Stage 0, Track B and Track A complete; only its §5, the Step 11 live run, remains
audience: whoever runs, verifies or continues the diff tool build
---

# Sheets Diff Tool — Implementation Documentation

**Reference conventions.** **§n** points within this document. **Plan §n** and
**Step n** refer to *Google Sheets Difference Comparison Tool Implementation
Plan.md*, revision 2026-08-22 — the specification, which is **not checked in**.
**Test n** is a row in that plan's acceptance-test table, which runs to 38; a
quoted id (**Test '4a'**) is local to this build and has no plan counterpart.
**Fixture doc §n** refers to [`fixture-generator.md`](fixture-generator.md).
**Migration §n** refers to [`migration-v1.1.0.md`](migration-v1.1.0.md). Types in
`CAPITALS` are the output taxonomy; **rule n** is a row in plan §0.1, which holds
fifteen.

**Paths.** Source is in `src/`, the three harness scripts in `tools/`, these
documents in `docs/`. A bare `00_Config.gs` below means `src/00_Config.gs`; the
harnesses are always written with their `tools/` prefix, because that is how they
are invoked.

---

## 0. What this is

Given two Google Spreadsheet URLs the tool compares every matching tab, writes
**the authored changes** — plus **every** reference-error cell, changed or not —
to section 1 of a CSV in Drive, writes **every recalculated cell** to section 2
of the same file, and logs a summary.

The project is twenty-four `.gs` files with numeric load-order prefixes: thirteen
production, nine test, two harness. `00_Config.gs` loads first and holds every
tunable; `90_Main.gs` loads last and is **the only file that touches a Google
service**. Everything between is pure, which is what lets all 79 tests run with
no spreadsheet and no authorisation prompt.

| Entry point | Does | Needs a spreadsheet? |
|---|---|---|
| `verifyReferenceForms([url [, tab]])` | Plan §1.2 against a real file. **Run first** (§4.9). Falls back to the `URL_A` Script Property | Yes, read-only |
| `run()` | The tool. Reads `URL_A`/`URL_B` from Script Properties and calls `runWith` | Yes, read-only + one Drive write |
| `runWith(urlA, urlB, opts)` | The same, with config passed in and no ambient state | Yes, read-only + one Drive write |
| `runTests()` | 79 tests on in-memory fixtures | No |

These four are the whole dropdown. Everything else is either pure and called by
them, or a `t_`-prefixed harness global.

`run()` logs — this is real output, generated from the fixture builders in
`98_TestLib.gs` rather than written by hand:

```
sheets-diff v1.1.0
A: 2026 Cost Model v3    (6 tabs)
B: 2026 Cost Model v4    (6 tabs)

TAB                   STATUS        REF   VAL   FORM   UNVER   VOL   HARD   FMLZD   ±ROW   ±COL  │   DERIV
─────────────────────────────────────────────────────────────────────────────────────────────────┼────────
Assumptions           modified        0     0      0       0     0      0       0     +1      0  │       6
HVAC Capex            modified        1     0      0       1     1      0       0      0      0  │       0
Rates                 modified        0     0      0       0     0      0       0     +1      0  │       0
Escalation            SKIPPED         0     —      —       —     —      —       —      —      —  │       —
Cover → C o v e r     renamed         0     0      0       0     0      0       0      0      0  │       0
Scratch               deleted         —     —      —       —     —      —       —      —      —  │       —
Ledger                added           1     —      —       —     —      —       —      —      —  │       —
─────────────────────────────────────────────────────────────────────────────────────────────────┼────────
5 changed, 0 unchanged, 1 skipped.  1 added in B.  0 values, 0 formulas, 0 hardcodes, 1 volatile.
DERIVED: 6 cells recalculated with unchanged formulas (section 2).
REFERENCE ERRORS: 2 total — 0 new, 0 fixed, 2 pre-existing.  2 root, 0 inherited.
→ changes-20260822-1432-v1.1.0.csv (10 rows in section 1, 6 in section 2, 41s)

⚠ 2 pre-existing reference errors were already present in both files (REF_ERROR).
  These are not changes — they are flagged because the scan reports state, not deltas.
⚠ Escalation skipped: edit distance 45% — structure differs.
  It was still scanned and holds no reference errors; its cells were not compared.
⚠ 1 formula holds unverifiable references into: Escalation (1).
  A large count means a referenced tab was skipped or unpaired.
⚠ 1 INDIRECT/OFFSET formula changed value with identical text (VOLATILE_VALUE).
  1 volatile formula exists in total — any whose value happened not to change are NOT detected.
ℹ Derived values: 6 cells changed value with identical formulas — SECTION 2 of the CSV.
  A downstream tab may show no rows in section 1 even where its numbers moved; the cause
  is reported at its root, which in a reference chain can sit several tabs away.
ℹ The CSV holds two tables. A plain import reads the blank line, the # marker and the
  repeated header as three data rows — split the file at the marker before importing.
ℹ References relocated: +1 row in Assumptions, +1 row in Rates, 1 formula realigned.
```

and writes:

```
tab,change,a_ref,b_ref,column,old,new
Ledger,REF_ERROR,,B4,B,,'=Old!#REF!
HVAC Capex,REF_ERROR,C14,C14,C,'=Rates!#REF!,'=Rates!#REF!
Cover,TAB_RENAMED,,,,Cover,C o v e r
Scratch,TAB_DELETED,,,,Scratch,
Ledger,TAB_ADDED,,,,,Ledger
Assumptions,ROW_ADDED,,A15,,,Inserted|999|
HVAC Capex,FORMULA_UNVERIFIED,C10,C10,C,'=Escalation!$B$4,'=Escalation!$B$5
HVAC Capex,VOLATILE_VALUE,C12,C12,C,55,77
Rates,ROW_ADDED,,A3,,,Inserted|999
Escalation,TAB_SKIPPED,,,,,edit distance 45% — structure differs

# SECTION 2 — DERIVED VALUES: cells whose formula is identical in both files and whose value changed
tab,change,a_ref,b_ref,column,old,new
Assumptions,DERIVED_VALUE,C3,C3,C,100,200
Assumptions,DERIVED_VALUE,C4,C4,C,101,201
Assumptions,DERIVED_VALUE,C5,C5,C,102,202
Assumptions,DERIVED_VALUE,C6,C6,C,103,203
Assumptions,DERIVED_VALUE,C7,C7,C,104,204
Assumptions,DERIVED_VALUE,C8,C8,C,105,205
```

**Read that output in order.** `HVAC Capex` holds `=Rates!$B$4` and a row was
inserted in `Rates`; the reference is now `=Rates!$B$5` in B and **produces no
row at all**, because relocation resolved it. That absence is the tool. The one
`FORMULA_UNVERIFIED` is the same shape pointing at `Escalation`, which was
skipped, so nothing knows where its rows went — and the notes name `Escalation`
rather than `HVAC Capex`, because `Escalation` is the tab a reader has to go and
look at.

### Which plan revision this describes

**The plan's latest, 2026-08-22, in full.** This document describes shipped code
and the shipped code is current against the specification; §11 is a conformance
note rather than a gap analysis.

| Plan revision | Adds | In |
|---|---|---|
| 2026-08-07 | The tool as originally specified — 33 acceptance tests, twelve rules, one CSV table | v1.0.0 |
| 2026-08-19 | `DERIVED_VALUE` and a **second CSV section**; `sectionOf`; `derivedSection`/`derivedCap`; rules 13–15; tests 34–38 | **v1.1.0** |
| 2026-08-22 | **Multi-file layout**, per-module test files, checked-in `appsscript.json`, Script Properties config, `VERSION` stamping | **v1.1.0** |

The single most consequential change for a reader who knew v1.0.0: **recalculated
cells are no longer suppressed.** They are emitted, as `DERIVED_VALUE`, into a
second table below the first. A downstream tab whose numbers moved used to
produce nothing but a count in the summary; it now produces rows you can read.
§5.2 is the mechanism, §7.3 the layout, §7.5 what the summary says about it.

### Scope boundary

**Read-only with respect to both source spreadsheets** — by scope as well as by
construction. `appsscript.json` requests `spreadsheets.readonly`, so the platform
refuses a write to either file rather than this code merely declining to attempt
one. The only write anywhere is the single `DriveApp.createFile` in `runWith()`.

Six functions do I/O — `readTab`, `readSheets_`, `sheetNames_`, `run`, `runWith`,
`stamp_` and `verifyReferenceForms` — and **all of them are in `90_Main.gs`**,
which is the last file to load. Everything in the other twelve production files is
pure, which is what lets all 79 tests run with no spreadsheet and no
authorisation prompt, and which is now checkable in one grep (§2) rather than by
reading a banner comment.

Not built, deliberately: everything in the plan's Non-goals table — no dependency
graph, no `INDIRECT` resolution, no column alignment, no merge or patch-back, no
UI.

**Not done: Step 11**, the end-to-end run against two real successive versions.
§1.3 is the procedure, §1.4 is what was verified in its place, §6.4 is what to
check when it is run. **Not done: plan §1.2**, the observation of what
`getFormulasR1C1()` really returns — `verifyReferenceForms()` performs it in one
call, but nobody has run it. §4.9 is why 79 green tests prove nothing there, and
it is the reason Step 11 is described as the blocking gap rather than as a
formality.

---

## 1. Setup and use

### 1.1 In Apps Script

1. Create the script project — script.google.com → **New project**, standalone,
   **not** container-bound. Then either push with `clasp`, or paste all
   twenty-four `.gs` files in `src/` in by hand. Runtime must be V8 — the code uses
   `const`, `let`, `Map`, `Set`, `Int32Array`.

   For `clasp`, write a `.clasp.json` at the repository root. It is **not**
   checked in, because it holds a script id:

   ```json
   {
     "scriptId": "<your script id>",
     "rootDir": "src"
   }
   ```

   `rootDir` is the load-bearing line. Everything Apps Script sees lives in
   `src/`; `tools/` and `docs/` must not be pushed, and without `rootDir` they
   would be. Copy `.clasp.json.example` and fill the id in.
2. **Check `appsscript.json` went with them.** It is checked in, at
   `src/appsscript.json`, and it is what
   makes the read-only guarantee a platform constraint rather than a promise
   this code makes about itself:

   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/spreadsheets.readonly",
     "https://www.googleapis.com/auth/drive.file"
   ]
   ```

   `spreadsheets.**readonly**` means the platform refuses a write to either
   source file. `drive.file` grants access to files this script itself created
   and nothing else — the narrowest scope that still writes the CSV.
   `script.external_request` is **deliberately absent**: nothing here makes an
   external request, and adding it "just in case" would put a network capability
   behind the same consent screen as the read.
3. Run `runTests()`. **No authorisation prompt appears.** If one does, a
   Google-service call has been added outside `90_Main.gs` — see §9.
4. **Project Settings → Script Properties → add `URL_A` and `URL_B`.** They are
   not in source, so nothing to edit and no spreadsheet id in version control.
5. Run `verifyReferenceForms()`. Authorise Sheets. **Read §4.9 before deciding
   the output looks fine.**
6. Run `run()`. Authorise Drive.

The load order is the numeric prefix, and it matters in exactly one way:
top-level `const` initialisation runs in file order, while **function
declarations hoist across every file in the shared scope**. So `31_DiffTab.gs`
calling `sectionOf` from `50_Csv.gs` is safe, and a constant in `00_Config.gs`
computed from another global would not be. The rule that keeps this true is plan
§1.1a's: **every top-level statement is a declaration.**

The config block, verbatim from `00_Config.gs`:

```js
const VERSION = '1.1.0';

const OPTS = {
  derivedSection:  true,   // emit recalculated cells as DERIVED_VALUE into CSV section 2
  derivedCap:      5000,   // above this, section 2 is truncated and says so
  expandRows:      false,  // added/deleted rows -> one row per cell, not a preview
  epsilon:         1e-9,   // relative tolerance for numeric comparison
  similarity:      0.5,    // gap-matching threshold in alignment pass 2
  editDistanceCap: 0.30,   // skip a tab if more than this fraction of rows differ
  noiseWarn:       0.30    // warn if more than this fraction of SECTION 1 cells changed
};

const CHANGE_TYPES = [ /* the taxonomy, written down once */ ];
const SECTION_2_TYPES = new Set(['DERIVED_VALUE']);

const REF_ERROR_TOKENS = ['#REF!', '#NAME?'];   // NOT #DIV/0!, #VALUE!, #N/A, #NUM!
const ALIGN_WINDOW_MAX = 2000;                  // per-side DP window ceiling
const HASH_CELL_SEP = String.fromCharCode(0);   // no cell can contain these
const HASH_FORMULA  = String.fromCharCode(1);
const READ_PACE_TABS = 10;
const READ_PACE_MS   = 1000;
```

`OPTS` stays in source while the URLs do not, and the split is deliberate: the
URLs are *which two files*, which changes every run and belongs to whoever is
running it; `OPTS` is *behaviour*, and behaviour belongs under review.

All seven `OPTS` keys are live. `noiseWarn` is the only one whose effect never
reaches the CSV: it sets `stats.noise`, which `buildSummary` prints as a warning
(§5.4). The two separators are written as `fromCharCode` so that no NUL byte
ever lands in the source file — an editor, a diff, a grep and `clasp push` each
handle one differently, and at least one of them silently.

**`derivedSection` has two states, not three.** On, and every recalculated cell
is a `DERIVED_VALUE` row in section 2, capped at `derivedCap`. Off, and there is
no such row anywhere and no second table — the file is byte-identical to what
this tool wrote before v1.1.0. The v1.0.0 `includeDerived` switch was **deleted
rather than aliased**: it emitted `VALUE` into section 1 with no cap, which is
the merged table rule 13 exists to forbid, so an alias would have left a config
key that quietly produces the output the revision exists to prevent.

| | |
|---|---|
| Writes to `URL_A` / `URL_B` | **None** — by scope (`spreadsheets.readonly`) as well as by construction (§0) |
| Writes elsewhere | Exactly one `DriveApp.createFile` per run, into My Drive root. Counted in the dry run (§1.4) |
| File name | `changes-yyyyMMdd-HHmm-v<VERSION>.csv`, script timezone, `MimeType.CSV` |
| Scopes | `spreadsheets.readonly` on `verifyReferenceForms` / `run`; `drive.file` additionally on `run` |
| Re-running | Safe. Two runs in one **minute** produce two files with the same name; Drive permits duplicates, nothing is overwritten |
| Undo | Trash the CSV |
| Runtime | `runTests()` well under a second, deterministic. `run()` scales with tab count — §7.4 |

### 1.2 Running the suite outside Apps Script

The suite is plain ES2015+ with no platform dependency, so any V8 will do. With
Node installed:

```bash
node tools/runner.js   out.txt
node tools/sabotage.js sabotage.txt
node tools/dryrun.js   dryrun.txt
```

The machine this was built on has no standalone Node, Bun or Deno, but VS Code
ships an Electron that will act as one — which is what the two traps below are
about:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" tools/runner.js out.txt
```

Run from the repository root either way. Each script resolves `src/` from its own
`__dirname`, so the source is found from any working directory, but the output
file is written relative to the **working directory** and the three names are
gitignored at the root.

| Script | Does | Read it for |
|---|---|---|
| `tools/runner.js` | Concatenates every `.gs` in **name order** and calls `runTests()` | The suite |
| `tools/sabotage.js` | Applies each of twenty mutations to that source in a fresh `vm` and reports which tests go red | §6.3 — **what the green means** |
| `tools/dryrun.js` | Stubs all six Google globals and drives `runWith()` end to end | §1.4 — the scope boundary, mechanically |

All three read `src/`, skip `GenerateTestWorkbooks.gs`, and concatenate in name
order, which is the order Apps Script loads in —
that is what the numeric prefixes are for. Running here does not prove the load
order is right *in Apps Script*; it proves it is self-consistent, and it catches
a duplicate global immediately, which is the failure mode the split introduces.

Two traps, both of which read as a broken test file rather than a broken
invocation:

| Trap | Symptom |
|---|---|
| `console.log` is discarded under `ELECTRON_RUN_AS_NODE` | Nothing printed, exit 0. Write the returned string to a file |
| `process.argv[1]` is the **script path**, not the first argument | The runner overwrites itself with its own output. Arguments start at `argv[2]` |

### 1.3 Step 11 — the end-to-end run, still not performed

**This is the blocking gap, and it is the only one left.** No part of this build
has met a live spreadsheet. Everything below §1.4 is verified against fixtures,
a stub, or a mutation matrix; none of that answers plan §1.2a, and §4.9 is why
that one unanswered question can invalidate every `FORMULA` row in a run without
producing an error.

| # | Do | Because |
|---|---|---|
| 1 | Generate fixtures with `generateTestWorkbooks()` from `GenerateTestWorkbooks.gs`, **or** point `URL_A`/`URL_B` at two real successive versions. Note the `FIXTURE_VERSION` in the names | The generator mutates a *copy* of A with real `insertRowBefore`/`deleteRow` calls, so Sheets itself performs the formula rewriting Step 4 exists to invert. Hand-written B-side formulas would test a guess |
| 2 | Set `URL_A` / `URL_B` in **Script Properties**. Not in source — the constants no longer exist | §1.1 |
| 3 | Run `verifyReferenceForms()`. **This gates everything** | Plan §1.2. The suite cannot detect a `REF_RE` mismatch with reality (§4.9). The generator breaks references deliberately, so part (b) must report `KEEPS` or `DROPS` — never "unverified" |
| 4 | Run `run()`. Confirm it completes inside 6 minutes, and that the filename carries `v1.1.0` | Apps Script's execution ceiling. The footer prints elapsed seconds; the version is what lets this CSV be matched to the fixture pair that produced it |
| 5 | **Read section 1 to completion before opening section 2** | The whole point of the split. Section 2 is one to three orders of magnitude larger and contains no authored change |
| 6 | Read the `REF_ERROR_NEW` rows first within it | Something broke between these two versions. They sort to the top of section 1 (§7.3) |
| 7 | Check the relocation footer | 0 formulas realigned while a referenced tab changed rows means Step 4 is silently no-opping. `buildSummary` raises this itself, but only when absolute references exist (§5.5) |
| 8 | Check the volatile line | Every `VOLATILE_VALUE` row needs manual verification, and so does the gap between detected and total — a volatile formula whose value happened not to change is not detected at all (§10) |
| 9 | Check the unverified line | It names the *referenced* tab whose row map is missing (§5.3). A large count means that tab was skipped or unpaired |
| 10 | Check the `HARDCODED` rows | What the diff half of the tool exists for |
| 11 | Sanity-check the two footer counts against each other, then read section 2 for the downstream tabs | A section 2 of zero against a model full of formulas means `derivedSection` never fired. A section 1 of zero with a large section 2 means the revision changed inputs and nothing else — which is a real and useful answer |

Check the result against fixture doc §6: **41 rows in section 1, 45 in section
2**, the eight reference-error rows, and the tabs that must emit nothing. Then
the two variant runs, fixture doc §6.5 — `derivedSection: false` and
`derivedCap: 3`, both via `runWith(urlA, urlB, opts)`.

**Three results are failures that look like successes**, and each has a cause
already located:

| Looks like | Is |
|---|---|
| Section 2 empty, section 1 at 41 | `derivedSection` never fired — `diffCell` rule 5 still returning `null` |
| `Volatile!B2` / `B3` in section 2 as `DERIVED_VALUE` | Rule 14 inverted. Nothing is dropped and no count is wrong; the rows are mislabelled and buried (§6.3) |
| A noise warning on `Cascade` | The noise ratio is counting section 2 — rule 15, test 38 (§5.4) |

### 1.4 What was verified in place of Step 11

| Verified | How | Covers |
|---|---|---|
| All **38** plan acceptance tests + 41 local tests | `tools/runner.js` in a V8 `vm` | Steps 1–7 and 10 in full, `readTab`'s contract, 9's pure half |
| **What those 79 passes are worth** | `tools/sabotage.js` — twenty mutations, each in a fresh `vm` | §6.3. Twenty caught, none decorative, eight still caught by a single test each |
| `runWith()`'s full call path, `readTab`, `toCsv`, `buildSummary` | `tools/dryrun.js`: all six Google globals stubbed; fixture `TabData` served through fake `getDataRange()` objects | Method names, call order, the Drive write, the filename, the summary text |
| **Nothing writes to a source spreadsheet** | Stub sheets are `Proxy` objects that **throw on any method but** `getName` and `getDataRange`. The dry run completes, 13 checks green | The §0 scope boundary, mechanically |
| Exactly one Drive write per run | Counted in the stub: 1 | §1.1 |
| `run()` refuses rather than opening `undefined` when the Script Properties are unset | `tools/dryrun.js` runs it with no properties first and asserts the throw | §1.1 step 4 |
| The CSV reaches Drive and **never** the log | `tools/dryrun.js` asserts the logged text holds no data rows | §7.4 |
| Purity, no duplicate global, no computed top-level constant | Three greps over the file tree | §2, §9 |

| **Not** verified | Consequence |
|---|---|
| What `getFormulasR1C1()` really returns | §4.9. The whole of Step 4 rests on it |
| Whether `#REF!` survives into R1C1 | Diagnostic only — `errorState` reads the A1 form |
| Apps Script's own parser and quota behaviour | Six globals were stubbed, and the suite runs in Electron's V8 rather than Apps Script's. Running `runTests()` once in the editor closes the parser half |
| Real runtime against a large workbook | The 6-minute ceiling is untested |
| `Utilities.sleep` pacing above 10 tabs | Dry-run fixtures have 4 tabs; the branch never fired |
| That `clasp push --rootDir src` uploads all twenty-five files in the right load order | The prefixes are what Apps Script sorts on, but nobody has pushed this layout |

---

## 2. Architecture

Files load in name order. **Purity runs the other way**: `90_Main.gs` loads
last and is the only file allowed a Google service, so the question "does this
project touch Sheets outside the one place it should?" is one `grep -l` over the
tree rather than a reading of a banner comment.

```
appsscript.json           spreadsheets.readonly + drive.file. THE READ-ONLY
                          GUARANTEE, enforced by the platform (§1.1)

00_Config.gs   VERSION, OPTS, CHANGE_TYPES, SECTION_2_TYPES, REF_ERROR_TOKENS,
               ALIGN_WINDOW_MAX, HASH_*, READ_PACE_*    ← literal declarations only
01_Types.gs    the @typedefs.  No code
10_Values.gs   valuesEqual, normaliseValue, displayValue, errorState
11_Refs.gs     columnLetter, a1, headerText_
20_Align.gs    trimGrid, hashRow, isAnchorable, hashGrid,
               alignRows → lcsMatch_ / resolveGap_ → rowSimilarity_
21_Relocate.gs REF_RE, ABS_ROW_RE, rewriteRefs_  ← THE SHARED ENGINE
               ├─ protectStrings_ / restoreStrings_
               ├─ isRefBoundary_ / formatRef_
               └─ relocate, maskUnresolvable, unresolvableTargets, isVolatile
30_DiffCell.gs diffCell — AND NOTHING ELSE.  Two of its seven rules are
               ORDERING facts (§4.3, rule 14), so the file is its own unit
31_DiffTab.gs  diffTab, scanErrorsUnaligned, headerMismatch_, gridWidth_, preview_
40_Pair.gs     pairTabs
50_Csv.gs      CSV_HEADER, CSV_SECTION_2_MARKER, sectionOf, csvField, toCsv,
               csvSortSection1_, changeIsRoot_, sideIsRoot_
60_Summary.gs  SUMMARY_COLS, SUMMARY_TYPE_COL, buildSummary, summaryCell_,
               summaryNotes_, summaryRule_, padR_ / padL_ / repeat_ / signed_
70_Compare.gs  compareWorkbooks — PURE, and the one deviation from the plan's
               file table (§11)
90_Main.gs     ═══ THE ONLY IMPURE FILE ═══
               run()  → PropertiesService → runWith(urlA, urlB, OPTS)
               runWith(urlA, urlB, opts)
               ├─ SpreadsheetApp.openByUrl ×2
               ├─ PHASE 0  sheetNames_ ×2 → pairTabs   ← names only, nothing read
               ├─ readSheets_(sheets, names, wanted) ×2
               │   └─ readTab(sheet) → trimGrid(...)
               ├─ compareWorkbooks(...)                ← phases 1 and 2, pure
               ├─ PHASE 3  DriveApp.createFile(name, toCsv(changes, opts), CSV)
               └─ console.log(buildSummary({...}))
               verifyReferenceForms([url [, tab]])     ← PLAN §1.2, executable
               ├─ rewriteRefs_ per formula     → did REF_RE match anything?
               └─ REF_ERROR_TOKENS per formula → does the token survive into R1C1?
               stamp_()

98_TestLib.gs  t_suite / t_test, T_TESTS, T_STATE, the t_assert* family, and
               every fixture builder (t_fixture, t_sheet, t_workbook, t_filler,
               t_plantG, t_plant, t_inserted, t_unalignable, t_stubSheet,
               t_opts, t_diffFixture, t_cmp)
99_TestRunner.gs  runTests, t_registerAll_, T_PLAN_TOTAL, T_LOCAL_TOTAL
<module>.test.gs  one per module — §6.2
```

**`compareWorkbooks` is in its own file, and that is a deliberate deviation from
plan §1.1**, which puts phases 0–2 inside the impure entry point. It is pure
here so that tests 18, 22, 26 and 32 can check the two-phase ordering without a
spreadsheet. Folding it into `90_Main.gs` to match the plan's table would move
the ordering guarantee those four tests exist for into the one file the suite
cannot reach — the exact inversion §3.2 was built to prevent. It costs one row
in a table; the alternative costs four tests their subject.

`T_STATE` is the only module-level mutable binding; it exists so assertions can
report into the running test and is nulled after the loop. `T_TESTS` is emptied
and rebuilt by `t_registerAll_` on each run, so `runTests()` is re-entrant.

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
Stats       = { tab, renamedTo, compared, emitted, derived, relocated,
                volatileCells, volatileEmitted, unverified, unverifiedTargets,
                absRefs, noise, rowsAdded, rowsDeleted, colsAdded, colsDeleted,
                skipped, reason }
Report      = { titleA, titleB, tabCountA, tabCountB, result, opts,
                fileName, fileUrl, csvRows, elapsedMs }   // buildSummary's input
```

Five properties are load-bearing:

- **`Change` carries no `section` field, and must not gain one.** Membership is
  computed by `sectionOf(change)` from the change type alone (plan §0.5). A
  stored field is a second source of truth that no test can enforce: the row
  would say one thing and the type another, and only the type is checkable.
- **`Stats` is the summary's only channel out of `diffTab`.** Every field exists
  because `buildSummary` prints something unrecoverable from the Change rows:
  `unverifiedTargets` names tabs no Change row mentions (§5.3), `absRefs` gates a
  warning about a silent failure (§5.5).
- **`emitted` counts section 1 only; `derived` counts section 2.** That split is
  rule 15 and it is the whole of §5.4. `derived` replaced v1.0.0's
  `derivedSuppressed`, which counted rows deliberately *not* written; it now
  counts rows that exist.
- **Per-type counts are *not* on `Stats`.** `buildSummary` tallies them from the
  Change rows, because `emitted` knows how many section-1 cells were emitted but
  not how they were classified, and the root/inherited split exists only on the
  rows.
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
everything `runWith()` does apart from opening spreadsheets and writing Drive
files. It was built ahead of Step 8 rather than left as harness scaffolding, and
in v1.1.0 it has a file to itself (`70_Compare.gs`) for the same reason.

The alternative was to let tests drive `alignRows` and `diffTab` in whatever order
each found convenient. Tests 18, 22 and 26 exist to check that **every tab is
aligned before any tab is compared**; if that ordering lives in the test file,
those tests verify a copy of the logic and `runWith()` is free to get it wrong.
Test 18 lists `HVAC` *before* `Rates` in both workbooks for exactly this reason —
a single-pass implementation reaches the referencing tab first, has no `Rates`
row map, cannot relocate, and reports a false `FORMULA`. The mutation
"single-pass" now fails **47 of the 79 tests**: it is the single most destructive
row in §6.3, which is the right shape for a property this central.

The cost is that Step 8 and `runWith()` must adapt to `compareWorkbooks`'s
signature rather than the reverse. That is the right direction: the signature
takes plain data, which is what makes the suite possible without a
spreadsheet.

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

Sabotaging it fails **Tests 19, 29, 30, 31, 33, 35, '2c', '2d', '10a', '10b'**
and nothing else; the other 69 stay green. Test 35 joined that set for a reason
worth noting: a `#REF!` present in both files has identical formulas *and*
identical values, which is exactly the shape rule 5 now routes to **section 2**.
Below rule 5 the error is not merely suppressed — it is relabelled
`DERIVED_VALUE` and filed in the wrong table.

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

`runWith()` calls `pairTabs` on the two name lists, then reads only tabs appearing in
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
| `stats.derived` / `unverifiedTargets` / `absRefs` | §5.2, §5.3, §5.5 |
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

### 5.2 The derived count comes from the row, not from re-testing why there is none

v1.0.0 suppressed recalculated cells and printed a count. `diffCell` returned
`null` without saying why, so `diffTab` re-tested rule 5's condition on the
`null` branch to recover the number — a duplicated condition, documented at the
time as an acceptable compromise because the alternative was to thread a mutable
out-parameter into the pure heart of the taxonomy.

**That whole mechanism is gone.** The cell is emitted now, so the counter reads
the row:

```js
if (sectionOf(result) === 2) stats.derived++;
else                         stats.emitted++;
```

The duplicated condition disappeared with the suppression it counted, and
`diffCell` still has no side effect — which matters, because three tests call it
directly.

**The summary line it fed did not disappear, and must not.** A downstream tab
whose numbers moved still shows nothing in section 1, and a reader who does not
know that will read the silence as either "unchanged" or "the tool is broken".
The `ℹ Derived values` note and the `DERIV` column are what close that gap, and
Test '10d' asserts the note **by its text** — asserting only the count would let
a rewording drop the sentence that gives the number meaning.

**One subtlety in the counter.** With `derivedSection: false`, `diffCell` emits
nothing and `stats.derived` is 0 — the DERIV column reads `0`, not the number of
cells that *would* have been emitted. That is the honest reading: the count is
of rows in the file, and there are none. Anyone who wants the number turns the
section on.

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

### 5.4 The noise ratio is recorded, never emitted — and counts section 1 only

`stats.noise` is set when `emitted / compared > opts.noiseWarn`. It produces no
Change row: a warning about the diff is not part of the diff, and a
`NOISE_WARNING` row would be filtered out with the noise it warns about.

**`stats.derived` is deliberately absent from that ratio, and this is rule 15.**
A recalculation shadow is a function of how *connected* the model is, not of how
badly the tab aligned. One changed input in a well-built model recalculates most
of a tab, so an implementation that counts section 2 raises the warning on every
downstream tab of a **correct** run — and a warning that fires on correct runs is
not read on the run where it matters. Test 38 is the guard: 18 of 40 compared
cells recalculate, which would put a section-2-counting implementation at 47.5%
against a 30% threshold, and the assertion is that **no warning appears**.

The same reasoning protects the edit-distance cap upstream, and it holds for a
different reason: `hashRow` contributes literal cells only, so recalculation
cannot move a row's identity hash at all. That is why "improving" `hashRow` to
include formula-cell values is the documented way rule 15 fails upstream of the
noise ratio — the mutation now fails Test '3c' **and** 35, 37 and 38 (§6.3).

Reaching the warning legitimately needs a specific shape. Changing *k* whole rows
of *n* moves both the noise ratio and the edit distance to *k/n*, so the tab
skips before the noise check runs. A **mass formula rewrite** is the reachable
case: row hashes ignore formula cells, so alignment stays perfect at edit
distance 0 while a third of the compared cells change. Test '5e' uses 20
rewritten formulas over 60 compared cells. `stats.relocated`, `volatileCells` and
`unverified` work the same way.

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

### 5.6 `runWith()` pairs twice rather than passing the pairing down

`runWith()` calls `pairTabs` to decide what to read; `compareWorkbooks` calls it again
to decide what to compare. Pairing once and passing the result in was rejected:
`compareWorkbooks` owns the two-phase ordering that Tests 18, 22, 26 and 32 exist
to check (§3.2), and accepting a pairing from its caller adds a parameter whose
only purpose is to let the I/O layer influence phase 0. The failure mode is nasty
— an inconsistent pairing makes `wbA.tabs[aName]` `undefined` inside phase 1,
surfacing as a thrown error deep in `hashGrid` rather than as a pairing problem.

`pairTabs` is pure and deterministic over the same two name lists, so the calls
cannot disagree, and it is O(tabs) on strings — unmeasurable next to one
`getValues()`. The comment in `runWith()` labels its own call **advisory** so the
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
79 passed, 0 failed, 0 pending.
Plan acceptance tests: 38 of 38 declared.
Local tests of unnumbered branches: 41 of 41 declared.
OK — 79 tests, both declared totals met.
```

38 + 41 = 79. The tallies print separately because a single combined figure "of
38" overstates plan coverage.

**Both totals are DECLARED, and the run fails when they are not met.**

```js
const T_PLAN_TOTAL  = 38;   // the plan's acceptance-test table
const T_LOCAL_TOTAL = 41;   // local tests of unnumbered branches
```

`runTests()` checks that the numeric ids present cover `1..38` **exactly** — no
gaps, no duplicates, nothing out of range — and that the string ids number 41. A
shortfall is reported by number:

```
FAIL — plan acceptance tests: missing 34, 35, 36, 37, 38
```

not as a count, because "5 missing" sends someone hunting and that line does not.

**This is not bookkeeping; it is the only defence against two real failure
modes.** v1.0.0's runner computed its total from the tests it happened to hold
and printed `33 total`, and stayed green for the entire period in which the
plan's table ran to 38 and five acceptance tests were simply absent. A suite that
grades itself measures nothing. And a multi-file test layout adds a second, worse
version of the same problem: **a `.test.gs` file whose suite is never registered
in `t_registerAll_` contributes nothing, fails nothing, and says nothing.** To
confirm the defence still works, comment out one line of `t_registerAll_` and
check that the run goes red — it reports both the missing plan ids and a local
count short of 41.

**The plan lists no acceptance test against Steps 8, 10 or Step 9's I/O half**,
specifying the Step 11 live run as their verification instead. Thirteen local
tests cover them anyway ('4z', '8a'–'8b', '10a'–'10i'), because Step 11 has still
not been run and shipping three unexercised steps on the strength of a procedure
nobody has followed is not a verification. `tools/dryrun.js` (§1.4) covers the rest of
`90_Main.gs` outside the suite.

### 6.2 Coverage by module

One `.test.gs` per module, registered explicitly in `t_registerAll_`. A test
lives with the module it is about, not with the step that introduced it.

| Test file | Acceptance tests | Local tests | n |
|---|---|---|---|
| `10_Values.test.gs` | 9, 11 | '2f' | 3 |
| `20_Align.test.gs` | 13, 14, 15, 16, 20 | '3a'–'3g' | 12 |
| `21_Relocate.test.gs` | 17, 19, 23, 24, 25, 27, 28, 29, 31 | '4a'–'4e', '4z' | 15 |
| `30_DiffCell.test.gs` | 1, 2, 3, 4, 5, 6, 30, **34** | '2b'–'2e', '2g'–'2i' | 15 |
| `31_DiffTab.test.gs` | 7, 12, 32, **38** | '5a'–'5f' | 10 |
| `40_Pair.test.gs` | 10, 21 | '7a', '7b' | 4 |
| `50_Csv.test.gs` | 8, 33, **35**, **36**, **37** | '6a' | 6 |
| `70_Compare.test.gs` | 18, 22, 26 | — | 3 |
| `90_Main.test.gs` | none in the plan | '8a', '8b', '10a'–'10i' | 11 |
| | **38** | **41** | **79** |

`60_Summary.gs` has no test file of its own: its tests are '10a'–'10i' and they
live in `90_Main.test.gs`, because what they actually assert is the *rendered
output of a whole run*, which is `90_Main.gs`'s subject.

**Tests 4, 27, 28 and '2h' are one test in four parts, and they are why
`30_DiffCell.gs` is a file of its own.** All four put identical observable state
in front of rule 5 — the same formula text on both sides, a changed value — and
differ only in `ctx.volatile` and `opts.derivedSection`:

| | `ctx.volatile` | `derivedSection` | Answer |
|---|---|---|---|
| 27, 28 | true | either | `VOLATILE_VALUE`, section 1 |
| 4, '2h' | false | on | `DERIVED_VALUE`, section 2 |
| 4 (second half), '2g' | false | off | nothing at all |

That is the whole of rule 14, and it is why 27 and 28 assert **zero
`DERIVED_VALUE`** rather than counting rows. Inverting rule 5's two branches
*mislabels* rather than drops: the totals stay right, the rows are simply in the
wrong table.

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
| 34 | Identical formulas, values 20 vs 24, non-volatile | 1 `DERIVED_VALUE`, total 1; `sectionOf` returns 2; `old`/`new` are `'20'`/`'24'` — the **values**, never the formula |
| 35 | 40 recalculated cells + 1 `FORMULA` + 1 `REF_ERROR_NEW` | Marker at CSV line index 4; blank line above it, repeated header below; section 1 holds exactly 2 rows, error first; **zero `DERIVED_VALUE` above the marker**, all 40 below it, and nothing else in the file |
| 36 | Test 34's fixture, `derivedSection: false` | 0 rows, and the CSV is **exactly** `CSV_HEADER` — no marker, no blank line, no second header |
| 37 | 25 recalculated cells + 1 `VALUE`, `derivedCap: 10` | Section 1 untouched; first 10 in **workbook order** (`C1`…`C10`) then one `DERIVED_TRUNCATED` reading 15; a re-run is byte-identical |
| 38 | One input change recalculating 18 of 20 rows | `compared` 40, `emitted` 1, `derived` 18, `noise` **false**, and no warning in the summary |
| '10a' | Summary rendering | `REF` precedes `VAL`, `±COL` precedes the rule and the rule precedes `DERIV`; the row reads exactly `1 1 0 0 0 1 0 +1 0 │ 0`; line 0 carries the `VERSION` stamp |
| '10b' | Both error lines | `REFERENCE ERRORS: 2 total — 1 new, 0 fixed, 1 pre-existing`, plus the literal phrase `reports state, not deltas` |
| '10d' | The derived note | `DERIVED: 1 cell recalculated…`, the `ℹ Derived values` line, the chain caveat, and the two-table import warning — all **by text**; plus `stats.derived === 1` and `stats.emitted === 0` |
| '10i' | Zero state | `REFERENCE ERRORS: none in either file.`; footer `→ changes-x.csv (0 rows, 4s)` — the **single**-count form, because section 2 is empty |

**Tests '2h' and '2i' call `diffCell` directly.** Both branches were implemented
and wholly unexercised through fixtures until a documentation pass; `diffTab` now
reaches `FORMULA_UNVERIFIED` via Test 22 and `VOLATILE_VALUE` via Tests 27–28, but
the direct tests stay because they pin the `undefined`-mask default no fixture can
produce (§4.4).

### 6.3 The sabotage matrix

Each row is a mutation applied to the concatenated source in a fresh `vm`
context. **A green suite proves nothing on its own; this table is what the green
means.** It is `tools/sabotage.js` (§1.2), so it is re-runnable, and the numbers below
are what it printed — not what anyone expected it to print.

**Re-run it at the end of any refactor, not just the suite.** A green suite after
a 3,500-line move proves that the tests still run; the matrix proves they still
bite.

| Mutation | Fails | Count |
|---|---|---|
| Edit-distance denominator → the post-trim middle | 2, 4, 5, 6, 7, 11, 12, 13, 14, 16, 17, 18, 19, 23, 24, 25, 26, 27, 35, 37, 38, '2b', '2e', '3d', '3g', '5c', '5d', '5e', '5f', '10a', '10f', '10h' | 31 |
| Single-pass: compare each tab as soon as it is aligned | 47 tests, essentially the whole suite | 47 |
| `relocate()` no-ops (a broken plan §4b regex) | 17, 18, 21, 22, 23, 25, 26, '4a'–'4d', '4z', '10e' | 13 |
| Rule 3 moved below the identical-formula suppression | 19, 29, 30, 31, 33, 35, '2c', '2d', '10a', '10b' | 10 |
| Compare formulas in A1 instead of R1C1 | 7, 17, 18, 21, 22, 23, 25, 26, '10e' | 9 |
| **`sectionOf` returns 2 for everything** | 4, 8, 33, 34, 35, 37, 38, '5e', '6a' | 9 |
| **`sectionOf` returns 1 for everything** | 4, 34, 35, 37, 38, '10d' | 6 |
| `hashRow` hashes formula-cell values too | 35, 37, 38, '3c' | 4 |
| **Rule 5's branches swapped — `derivedSection` before `ctx.volatile`** | 27, 28, '2h' | 3 |
| One row map per formula (first reference's tab wins) | 23, '4a' | 2 |
| `maskUnresolvable` masks every absolute row | 24, '4d' | 2 |
| Scan removed from the skipped-alignment return | '5a', '10c' | 2 |
| `errorState` checks the value only, never the formula | 33 | 1 |
| Header guard compares B row 0 positionally | 7 | 1 |
| `hashGrid` ignores the width cap | '5d' | 1 |
| `rowMap` built in array-index space | '3d' | 1 |
| Mask `undefined` guards removed | '2i' | 1 |
| `isAnchorable` → `return true` | '3c' | 1 |
| **Noise ratio counts section 2** | 38 | 1 |
| **`derivedCap` truncates before sorting** | 37 | 1 |

**Twenty mutations, twenty caught, none decorative.** A mutation that failed no
test would name a test that must be rewritten before the work is called done;
there are none.

**Eight are caught by a single test each**, across eight distinct tests: 7, 33,
'2i', '3c', '3d', '5d', 38, 37. Deleting any one of those restores a silent
failure mode. Three of those guards exist *because* the matrix showed the
mutation passing: `errorState`'s root classification, the header guard's pair
lookup (§4.10), and — new in v1.1.0 — the section-1-only noise ratio, which no
existing test could see because nothing was emitted into section 2.

Three rows deserve reading against their v1.0.0 numbers:

- **"One row map per formula" fell from 10 to 2.** The mutation as reimplemented
  here resolves the target once per formula and applies that map to every
  reference's row. Only two fixtures can tell the difference: a formula holding
  two references into two *different* tabs whose maps *disagree*. Test 25's
  `=Rates!$B$4*$B$7` looks like a third, but `Rates` and `HVAC` happen to map
  row 7 the same way, so it passes under the mutation by coincidence. **Test 23
  and '4a' are the whole guard, and that is thinner than the v1.0.0 table
  claimed.** Worth a wider fixture the next time this area is touched.
- **"`hashRow` hashes formula-cell values too" rose from 1 to 4.** Exactly as the
  plan predicted: rule 15 depends on alignment being blind to recalculation, so
  the three new section-2 tests now guard `hashRow` as a side effect of guarding
  themselves.
- **"Rule 5's branches swapped" fails 27, 28 and '2h' — and nothing else.** That
  is rule 14 behaving as documented. The inversion *mislabels* rather than drops:
  every total in every other test stays correct, and only an assertion of **zero
  `DERIVED_VALUE`** can see it.

### 6.4 Expected output of the Step 11 run

Against `GenerateTestWorkbooks.gs`'s fixture pair, each line is a falsifiable
check:

| Check | Expected |
|---|---|
| Completion | Inside 6 minutes. The footer prints elapsed seconds |
| Drive | Exactly one `changes-yyyyMMdd-HHmm-v1.1.0.csv` in My Drive root. **The version is what lets this file be matched to the `FIXTURE_VERSION` in the workbook names** |
| Source files | Unmodified. Neither file's revision history gains an entry — and with `spreadsheets.readonly` the platform would refuse the attempt |
| Section 1 | **41 rows** (fixture doc §6), of which eight are reference errors |
| Section 2 | **45 rows**, below one blank line, one `#` marker and one repeated header |
| First section-1 data rows | `REF_ERROR_NEW`, then `REF_ERROR_FIXED`, then `REF_ERROR`; roots before inherited within each (§7.3) |
| Relocation footer | **Non-zero** formulas realigned. Zero, with row movement and absolute references present, means §4.9 |
| `verifyReferenceForms` (a) | No cross-sheet or absolute-row formula in the no-match list |
| `verifyReferenceForms` (b) | The generator breaks references deliberately, so this must report `KEEPS` or `DROPS` — never "unverified" |
| The two variant runs (fixture doc §6.5) | `derivedSection: false` → 41 rows, one table, no marker. `derivedCap: 3` → 3 rows plus one `DERIVED_TRUNCATED` reading 42, and section 1 still at 41 |

**What must produce nothing** is the stronger half of the assertion:

| Must emit no rows | Why |
|---|---|
| Tabs where only a row was inserted, in every tab referencing them | Rules 1–5. Any `FORMULA` row here is a relocation failure |
| Every date cell | Rule 11. A `VALUE` row on an unchanged date means `.getTime()` normalisation broke |
| `#DIV/0!`, `#VALUE!`, `#N/A`, `#NUM!` cells | Not reference errors. They may appear as `VALUE` rows; never as `REF_ERROR*` |
| **Anything at all in section 1 for a purely downstream tab** | Its cells belong in section 2. A `VALUE` row there means rule 5 is not being reached |
| **A noise warning on `Cascade`** | 40 formula cells from one input. A warning here is rule 15 — the noise ratio counting section 2 (§5.4) |

### 6.5 What is not covered

| Not covered | Why |
|---|---|
| `getFormulasR1C1()`'s actual output | Plan §1.2a. `verifyReferenceForms` can now check it, but has not been run (§4.9) |
| Whether `#REF!` survives into R1C1 | Plan §1.2b. Diagnostic only while `errorState` reads the A1 form |
| `runWith()` against a live spreadsheet | Step 11. The call path is covered by the stubbed dry run (§1.4); the *platform* is not |
| That `clasp push --rootDir src` uploads all twenty-five files, in load order | The numeric prefixes are what Apps Script sorts on, but nobody has pushed this layout. `tools/runner.js` proves the concatenation is self-consistent, not that Apps Script produces the same one |
| `Utilities.sleep` pacing above 10 tabs | Dry-run fixtures have 4 tabs, so the branch never fired |
| `verifyReferenceForms` beyond one dry run | Deliberate — it reports what the real API returns, which is exactly what a fixture cannot supply |
| Apps Script's own parser and quota behaviour | The suite runs in V8 via Electron; five globals were stubbed |
| Array formulas, merged cells, column alignment, row moves | Non-goals in the plan |

---

## 7. Function reference

`Step` is the plan's build step; `File` is where it lives. **Everything with a
file other than `90_Main.gs` is pure**, and that is checkable in one grep rather
than by trusting this column (§2).

| Function | Step | File | Returns | Note |
|---|---|---|---|---|
| `valuesEqual(a, b, opts)` | 2 | `10_Values` | boolean | Date → `getTime()`; strings trimmed; relative epsilon |
| `errorState(value, formula)` | 4h | `10_Values` | `'none'`\|`'root'`\|`'inherited'` | Formula checked first (§5.7) |
| `diffCell(vA, vB, fA, fB, ctx, opts)` | 2 | `30_DiffCell` | `{change, old, new, root?}` \| `null` | 7 ordered rules; `fA` arrives relocated |
| `displayValue(v)` | 2 | `10_Values` | string | Reader-facing; Date → ISO (§5.1) |
| `trimGrid(tabData)` | 3 | `20_Align` | TabData | Trailing rows then columns; offsets untouched |
| `normaliseValue(v)` | 3 | `10_Values` | string | Identity only (§5.1) |
| `hashRow(values, formulas)` | 3 | `20_Align` | string | Literal cells only |
| `isAnchorable(values, formulas)` | 3 | `20_Align` | boolean | §5.1 |
| `hashGrid(tabData, width)` | 3 | `20_Align` | `{hashes, anchorable}` | `width` caps the columns (§4.11) |
| `alignRows(hA, hB, tabA, tabB, opts)` | 3 | `20_Align` | Alignment | Four passes (§7.1) |
| `lcsMatch_` / `resolveGap_` / `rowSimilarity_` | 3 | `20_Align` | pairs / void / 0..1 | `Int32Array` DP; `rowSimilarity_`'s denominator is positions where **either** side is literal |
| `relocate(f, tables, currentTab)` | 4 | `21_Relocate` | string | A's formulas only (§3.1, §7.2) |
| `maskUnresolvable(f, tables, curTab)` | 4e | `21_Relocate` | string | Masks only unmapped targets (§4.6) |
| `unresolvableTargets(f, tables, curTab)` | 4 | `21_Relocate` | string[] | Names what `maskUnresolvable` masked (§5.3) |
| `rewriteRefs_(f, transform)` | 4 | `21_Relocate` | string | Protect → replace → restore; the shared engine |
| `protectStrings_` / `restoreStrings_` | 4a/4f | `21_Relocate` | `{text, literals}` / string | Placeholder is `<n>` |
| `isRefBoundary_(whole, offset, len)` | 4 | `21_Relocate` | boolean | §4.8 |
| `formatRef_(sheetName, rowPart, colPart)` | 4d | `21_Relocate` | string | Re-quotes only when the name needs it |
| `isVolatile(f)` | 4g | `21_Relocate` | boolean | `/\b(INDIRECT\|OFFSET)\s*\(/i` on the raw formula |
| `diffTab(tabA, tabB, alignment, tables, tabName, opts, stats)` | 5 | `31_DiffTab` | Change[] | §7.2 |
| `scanErrorsUnaligned(tabB, tabName)` | 5.2 | `31_DiffTab` | Change[] | One file, one cell at a time; `aRef` always `''` |
| `headerMismatch_(tabA, tabB, alignment)` | 5 | `31_DiffTab` | column letter \| null | §4.10 |
| `gridWidth_` / `preview_` | 5 | `31_DiffTab` | number / string | `preview_` truncates at 200 chars |
| `sectionOf(change)` | 6 | `50_Csv` | 1 \| 2 | From the type alone. **Never a field on a `Change`** (§2.1) |
| `toCsv(changes, opts)` | 6 | `50_Csv` | string | Two blocks; §7.3 |
| `csvSortSection1_(changes)` | 6 | `50_Csv` | Change[] | Error-first. Split out so section 2 cannot inherit it (§7.3) |
| `csvField(v)` | 6 | `50_Csv` | string | Neutralise `^[=+\-@]`, **then** RFC 4180 quote |
| `changeIsRoot_` / `sideIsRoot_` | 6 | `50_Csv` | boolean | `_root` first, text as fallback (§5.7) |
| `pairTabs(namesA, namesB)` | 7 | `40_Pair` | `{tabMap, pairs, added, deleted, changes, warnings}` | §7.3 |
| `compareWorkbooks(wbA, wbB, opts)` | 9 | `70_Compare` | `{changes, tables, results, pairing}` | §3.2 |
| `buildSummary(report)` | 10 | `60_Summary` | string | §7.5. Pure; every field but `result` optional |
| `summaryCell_` / `summaryNotes_` / `summaryRule_` | 10 | `60_Summary` | string / string[] | A number or `—` (§5.7); the warning block in plan order |
| `padR_` / `padL_` / `repeat_` / `signed_` | 10 | `60_Summary` | string | Fixed-width rendering. **`t_pad` in the harness is a different function** with the same body — see §7.6 |
| `columnLetter(n)` / `a1(row, col)` | 5 | `11_Refs` | string | Bijective base-26 |
| `headerText_(tabA, c)` | 5 | `11_Refs` | string | A's row 0, or `''` where that cell is a formula |
| **`readTab(sheet)`** | **8** | `90_Main` | TabData | **I/O.** Six API calls; takes anything with `getDataRange()` |
| **`readSheets_(sheets, names, wanted)`** | **8** | `90_Main` | Workbook | **I/O.** `names` is every tab, `tabs` only the wanted (§4.13) |
| **`sheetNames_(sheets)`** | **8** | `90_Main` | string[] | **I/O** |
| **`run()`** | **9** | `90_Main` | as `runWith` | **I/O.** Resolves `URL_A`/`URL_B` from Script Properties, then delegates. Throws if either is unset |
| **`runWith(urlA, urlB, opts)`** | **9** | `90_Main` | `{fileId, fileUrl, rows, summary}` | **I/O.** No ambient state. §7.4 |
| **`stamp_()`** | **9** | `90_Main` | string | **I/O** (`Session`). `yyyyMMdd-HHmm`, script timezone |
| **`verifyReferenceForms([url [, tab]])`** | **1.2** | `90_Main` | string | **I/O.** The gate (§4.9) |
| `t_fixture` / `t_sheet` / `t_workbook` / `t_plantG` / `t_plant` / `t_inserted` / `t_unalignable` / `t_filler` / `t_stubSheet` | 1 | `98_TestLib` | fixtures | §7.6 |
| `t_opts(over)` | 1 | `98_TestLib` | opts | `OPTS` plus overrides. **Tests must not hand-roll an opts literal** — §7.6 |
| `t_diffFixture(tabA, tabB, opts)` / `t_cmp(wbA, wbB, opts)` | 1 | `98_TestLib` | Change[] / result | Whole-pipeline entry points for tests |
| `t_suite` / `t_test` / `t_assert*` / `t_fail` / `t_describe` / `t_pad` | 1 | `98_TestLib` | — | Registration and assertions |
| `runTests()` / `t_registerAll_()` | 1 | `99_TestRunner` | string | Asserts both declared totals — §6.1 |

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

### 7.3 `toCsv`'s two blocks, and `pairTabs`'s three passes

```
tab,change,a_ref,b_ref,column,old,new        <- header
...section 1, error-first...
                                             <- blank line
# SECTION 2 — DERIVED VALUES: ...            <- marker, written RAW
tab,change,a_ref,b_ref,column,old,new        <- header, repeated
...section 2, workbook order...
```

`toCsv(changes, opts)` partitions by `sectionOf`, sorts each block
**independently**, and joins.

**Section 1** keeps the error-first sort — reference errors as a block at the
top, roots before inherited, `NEW` then `FIXED` then pre-existing within each,
everything else in workbook order:

| Sort key | Value |
|---|---|
| `k0` | 0 for the three `REF_ERROR*` types, 1 for everything else |
| `k1` | 0 root, 1 inherited (errors only) — from `_root` (§5.7) |
| `k2` | `REF_ERROR_NEW` 0, `REF_ERROR_FIXED` 1, `REF_ERROR` 2 |
| tiebreak | original index, so non-error rows keep workbook order |

**Section 2 is workbook order only.** An error is never derived, so no error
class exists there, and no severity ranking over recalculated cells is
meaningful; imposing one would only make the block harder to scan against the
workbook it came from. The section-1 comparator is a separate function
(`csvSortSection1_`) rather than a branch, so section 2 cannot inherit it by
accident the day a second section-2 type is added.

Four things about the layout are easy to get almost right, and "almost" is
exactly what fails:

| | Why |
|---|---|
| The second block is emitted **only when it has rows** | A marker over an empty table reads as a tool bug rather than as an absence of derived changes |
| `derivedSection: false` → no marker, **no blank line**, no second header | The file must be byte-identical to the pre-revision output. Test 36 asserts the whole string, and "almost identical" is meant to fail it |
| The `#` marker does **not** go through `csvField` | `csvField` neutralises a leading `=`, `+`, `-` or `@` — not `#`. Quoting the marker would break the layout |
| Truncation happens **after** the sort | Both orders satisfy a count check. Only this one makes the file deterministic and a re-run byte-identical — test 37 asserts the re-run, which is what catches the other order |

Above `opts.derivedCap`, the first `derivedCap` rows are kept **in sorted
order**, the rest dropped, and one row appended:

```
,DERIVED_TRUNCATED,,,,,15 further derived rows suppressed — raise OPTS.derivedCap
```

`DERIVED_TRUNCATED` never exists as a `Change`; it is written at emission time,
so it never reaches `buildSummary`'s tallies. The summary reports the loss its
own way, with a `⚠ Section 2 truncated` note above both `ℹ` lines — a note about
where rows *are* must not sit above a note that some are **gone**.

`csvField` neutralises a leading `=`, `+`, `-` or `@` **before** quoting. The
other order puts the apostrophe inside the quotes where it does nothing,
producing `'"=A1,B1"`, which Sheets re-imports as a formula.

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

`run()` adds one `PropertiesService.getScriptProperties()` and two
`getProperty` calls ahead of all of that, and none of them counts against the
Sheets quota.

`readTab` makes six calls per tab: `getDataRange`, the three grid getters, `getRow`
and `getColumn`. That is the plan's `6T + 4`, with `getName` per sheet added by
phase 0 and tabs deleted in B subtracted by §4.13. `readSheets_` inserts
`Utilities.sleep(1000)` between reads when a file has more than 10 sheets — **that
branch is untested**.

`runWith()` does **not** re-implement phase ordering: it reads both workbooks
fully, then hands them to `compareWorkbooks`. A single-pass loop in the I/O layer
would produce false `FORMULA` rows across every referencing tab — plausible
enough to be believed, and invisible to Tests 18, 22 and 26, which only exercise
`compareWorkbooks` (§3.2).

The summary goes to `console.log`; **the CSV never does.** Apps Script truncates
large log payloads with no documented ceiling, so a logged CSV silently loses rows.

### 7.5 `buildSummary` — layout and the mandatory lines

Four blocks: **Head** (the `VERSION` stamp, then the `A:`/`B:` titles with tab
counts), **Table** (one row per tab — paired in A's order, then deleted, then
added; `REF` first, `DERIV` last), **Totals** (changed/unchanged/skipped over A's
tabs, additions in B reported apart; then values, formulas, hardcodes, volatile;
then the `DERIVED:` line where non-zero; then the error tally; then the file
footer), **Notes**.

`TAB` is `max(20, longest label)` wide, `STATUS` is 11, and the numeric columns
are right-aligned at 6/6/7/8/6/7/8/7/7, then a 3-wide rule, then `DERIV` at 8.
`signed_` gives `±ROW` and `±COL` an explicit `+`. Statuses: `modified`,
`unchanged`, `SKIPPED` (upper-case — it means *nothing was compared*), `renamed`,
`ren+mod`, `deleted`, `added`.

**`DERIV` sits past a rule, and the rule is a real column.** It counts section-2
rows, which run one to three orders of magnitude larger than everything left of
it; a wide number in the middle of the table drags the eye off the ones that need
reading. The horizontal rule is *derived from the header string* by
`summaryRule_` rather than written beside it, so the crossing lands on the
vertical rule by construction and cannot drift when a column width changes.

**The footer reports one count or two.** With an empty section 2 it reads
`(12 rows, 41s)`; with a non-empty one, `(10 rows in section 1, 6 in section 2,
41s)`. The split form is not printed over an empty section 2 for the same reason
the CSV does not emit the block: a "0 in section 2" reads as a tool state rather
than as an absence of derived changes. Test '10i' pins the single-count form.

**The `DERIV` dash logic is `summaryCell_`'s, unchanged.** A `SKIPPED`, `added`
or `deleted` tab shows `—`, not `0` — `0` there would assert "nothing
recalculated here" about cells no pass ever looked at (Test '10c').

The notes block, each line suppressed when its count is zero:

| Note | Fires when |
|---|---|
| `⚠ N references broke in this revision` | `REF_ERROR_NEW > 0` |
| `⚠ N pre-existing … reports state, not deltas` | `REF_ERROR > 0` |
| `⚠ <tab> skipped: <reason>` + errors-still-scanned | per skipped tab |
| `⚠ N formulas hold unverifiable references into: …` | `unverified > 0` (§5.3) |
| `⚠ N INDIRECT/OFFSET formulas changed value…` + the total-versus-detected gap | `volatileEmitted > 0` / `volatileCells > 0` |
| `⚠ Section 2 truncated at N rows…` | section 2 exceeded `derivedCap`. **Above** both `ℹ` lines below, because it reports loss |
| `ℹ Derived values: N cells… — SECTION 2 of the CSV` | `derived > 0` (§5.2), plus the chain caveat |
| `ℹ The CSV holds two tables…` | the same condition. A plain import reads the blank line, the marker and the repeated header as three data rows, and someone will do that |
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

**Every harness global is prefixed `t_` (functions) or `T_` (state), and the
prefix is load-bearing.** In one file a collision between a test helper and a
production function is a visible redeclaration error. Across twenty-four files
it is a **silent last-one-wins overwrite with no error at all**, and the symptom
is a test passing against the wrong helper. `sheet`, `fixture` and `workbook`
were the live hazards — all three are plausible production names.

For the same reason **`t_pad` and `padR_` are two functions with identical
bodies and must stay that way.** One is the harness's left-aligner, one is the
summary's; the summary's column layout and the harness's report layout have no
reason to move together. `verifyReferenceForms` used the harness's `pad_` in
v1.0.0 — harmless in one file, and impossible after the split, since production
code must not reach into a test file. It uses `padR_` now, which is the same
rendering.

| Builder | Produces | Use when |
|---|---|---|
| `t_fixture(values, fR1C1, fA1, rowOffset, colOffset)` | TabData verbatim | Exact control, or an offset |
| `t_sheet(grid, r1c1, rowOffset, colOffset)` | TabData from a compact grid | Literal-only tabs — `=` prefix means formula |
| `t_plantG(grid, cells, rowOffset, colOffset)` | TabData with formulas planted | **Any test involving Step 4.** `cells` are `[r, c, a1, r1c1, value]`; rows padded rectangular |
| `t_plant(n, cells)` | `t_plantG` over `t_filler(n)` | The common case |
| `t_inserted(n, idx, cells)` | `t_filler(n)` with `['Inserted', 999]` spliced at `idx`, then planted | The B side of an insertion test |
| `t_unalignable()` | 20 rows, 9 rewritten | The B side of a "this tab must skip" test |
| `t_workbook({name: TabData})` | `{tabs, names}`, insertion order kept | Multi-tab tests. Throws on a non-TabData |
| `t_filler(n, startAt)` | `n` rows of `['Row k', k*10]` | Padding past the edit-distance cap |
| `t_stubSheet({values, fR1C1, fA1, row, col})` | An object exposing the five methods `readTab` calls | Testing `readTab`'s contract without a spreadsheet |
| `t_opts(over)` | `OPTS` with overrides | **Any test that varies config** |

`t_filler` exists because of the edit-distance cap: 2 / (2n) ≤ 0.30 needs n ≥ 4
for a single isolated edit, and several spread-out edits need considerably more.
Every fixture here uses 16–25 rows.

**Insertion indices matter.** `t_inserted(16, 2, ...)` splices at array index 2,
which is sheet row 3, which is *above* row 4 — so the row map sends 4 → 5. Off by
one and the fixture tests nothing, because the map becomes an identity and
`relocate` looks correct while doing nothing.

**`t_opts` exists because a hand-rolled opts literal is a live trap.** Three
tests carried a six-key literal each in v1.0.0, and a literal that omits a key
takes `undefined` for it — which reads as *off* for `derivedSection` and as *no
cap* for `derivedCap`, two different behaviours and neither of them the default
the test meant. Every key added to `OPTS` since would have had to be added to all
three by hand, silently, or the tests would have drifted from the shipped
defaults without failing.

---

## 8. Diagnosing a failure

**In the suite:**

| Symptom | Likely cause |
|---|---|
| Apps Script asks for authorisation on `runTests()` | A Google-service call has been added outside `90_Main.gs`. `grep -l 'SpreadsheetApp\|DriveApp\|PropertiesService\|Utilities\|Session\|MimeType' src/*.gs` names the file |
| `FAIL — plan acceptance tests: missing …` with every listed test also absent from the output | A `.test.gs` suite is not registered in `t_registerAll_`. The local count will be short too (§6.1) |
| A test fails against a helper that looks correct | A harness global lost its `t_` prefix and is now shadowed by, or shadowing, a production function. Across files this is silent — check for a duplicate declaration (§9) |
| The local runner prints nothing, exit 0 | `console.log` is discarded under `ELECTRON_RUN_AS_NODE` (§1.2) |
| The runner file is replaced by test output | `process.argv[1]` is the script path; arguments start at `argv[2]` (§1.2) |
| 31 unrelated tests fail together | Edit-distance denominator changed to the post-trim middle (§4.2) |
| Almost the whole suite fails at once | Phase 1 no longer completes before phase 2 (§3.2) — the mutation costs 47 tests |
| Only 19, 29, 30, 31, 33, 35, '2c', '2d', '10a', '10b' fail | `diffCell` rule 3 moved below rule 5 (§4.3) |
| Only 27, 28 and '2h' fail | **Rule 14 inverted** — `derivedSection` tested before `ctx.volatile`. Nothing is dropped and no total is wrong; every `VOLATILE_VALUE` is relabelled `DERIVED_VALUE` and buried in section 2 (§6.3) |
| Only 38 fails | The noise ratio is counting section 2 (§5.4) |
| Only 37 fails | `derivedCap` is truncating before the sort (§7.3) |
| 4, 34, 35, 37, 38 and '10d' fail together | `sectionOf` is returning 1 for everything — the second table is gone |
| Those plus 8, 33, '5e' and '6a' | `sectionOf` is returning 2 for everything — section 1 is gone |
| Only 24 and '4d' fail | `maskUnresolvable` is masking references whose tab **has** a map (§4.6) |
| Only 7 fails | The header guard is reading B's row 0 positionally (§4.10) |
| Only '5d' fails | `hashGrid`'s width cap dropped — a column delta now skips the tab (§4.11) |
| Only '5a', only 32, or only '5b' fails | One of the three `scanErrorsUnaligned` call sites was removed (§4.7) |
| Only 33 fails | `errorState` no longer distinguishes root from inherited (§5.7) |
| Only '3d' fails | `rowMap` built in array-index space (§4.1) |
| Only '3c' fails | `hashRow` counting formula-cell values, or `isAnchorable` widened (§5.1) |
| Only '2i' fails | Mask `undefined` guards removed (§4.4) |
| 18/22/26 fail while 17 and 23 pass | Phase 1 no longer completes before phase 2 (§3.2) |
| `TAB_SKIPPED` where a cell change was expected | Fixture too short for the edit-distance cap — pad with `t_filler` (§7.6) |
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
| A downstream tab shows no rows in **section 1** but its numbers moved | Working as designed. Its cells are in section 2; read the `ℹ Derived values` line and the `DERIV` column, then trace upstream (§5.2) |
| Section 2 is empty against a model full of formulas | `derivedSection` is off, or `diffCell` rule 5 is still returning `null` |
| Section 2 is enormous and section 1 is nearly empty | Also working as designed: the revision changed inputs and nothing else. That is a real and useful answer |
| A spreadsheet tool reads three junk rows in the middle of the CSV | The blank line, the `#` marker and the repeated header. Split the file at the marker before importing — the summary says so (§7.5) |
| `run()` throws "Set URL_A and URL_B…" | Project Settings → Script Properties. The constants are not in source (§1.1) |
| `REF_ERROR` rows for `#DIV/0!` or `#N/A` | A token was added to `REF_ERROR_TOKENS`. Test 11 catches `#DIV/0!` only |
| Execution exceeds 6 minutes | Tab count times grid size. The pacing above 10 tabs adds a second per tab — untested (§6.5) |
| Two CSVs with the same name | Two runs inside one minute. `stamp_` is minute-resolution; nothing was overwritten (§1.1) |
| `verifyReferenceForms` reports §1.2b "unverified" | No cell in the file carries `#REF!`/`#NAME?`. Break one deliberately and re-run (§4.9) |

---

## 9. Extending

**To add a test:**

1. Call `t_test(n, name, fn)` inside the registration function of the
   `.test.gs` file for the module the test is *about*. Use a **numeric** `n`
   only for a plan acceptance test; the runner checks numeric ids against
   `T_PLAN_TOTAL` and string ids against `T_LOCAL_TOTAL` (§6.1).
2. **Bump the matching total in `99_TestRunner.gs`.** The run goes red until you
   do, which is the intent: a suite whose totals follow its contents measures
   nothing.
3. A **new test file** also needs a line in `t_registerAll_`. Without it the file
   loads, declares its function, and is never called — no error, no output. The
   declared totals are the only thing that notices.
4. Build fixtures with `t_plant`/`t_inserted` if formulas are involved,
   `t_sheet()` if not, padded via `t_filler` to ≥16 rows, and `t_opts({...})` for
   any config variation — never a hand-rolled opts literal (§7.6).
5. Assert with `t_assertCount` **and** `t_assertTotal`. A count alone permits
   extra rows to appear unnoticed, which is how a regression that *adds* output
   stays green — and turning section 2 on is exactly such a change.
6. Add the line the test protects to `tools/sabotage.js` and confirm the test fails. A
   test that survives its own sabotage is decorative (§6.3).

**To add a change type:**

1. Add it to `CHANGE_TYPES` in `00_Config.gs`. That list is the taxonomy written
   down once; nothing reads it at runtime, and that is the point — it is the
   checklist for the rest of these steps.
2. Add the rule to `diffCell` in taxonomy order, and re-read §4.3 and rule 14
   before choosing where. **Two of rule 5's neighbours are ordering facts, and
   both fail silently.**
3. Add it to `SUMMARY_TYPE_COL` and, if it deserves a column, to `SUMMARY_COLS`
   — and to the `bucket()` initialiser in `buildSummary`, or every tally reads
   `undefined`. A type absent from the map is treated as structural: it appears
   in the CSV and counts toward nothing in the summary table.
4. Decide its **section**, and if it is section 2, add it to `SECTION_2_TYPES`.
   Do not add a field to `Change` (§2.1).
5. If it is an error type, add it to `csvSortSection1_`'s `rank` map (§7.3)
   **and** to the error tally in `buildSummary`. Missing the second leaves a row
   in the CSV that the `REFERENCE ERRORS:` line does not count, so the two
   disagree silently.
6. Decide whether it belongs in the **noise ratio**. `stats.emitted` is section 1
   only, and that is rule 15 (§5.4) — a type that is a function of model
   connectivity rather than of authorship must not enter it.

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

1. Everything added must go in **`90_Main.gs`**. Anything elsewhere that calls a
   Google service breaks `runTests()`'s no-authorisation property (§0), and no
   test will catch it — the suite never runs in Apps Script. The grep in §2 is
   the whole defence; run it.
2. Nothing may call a setter on either source spreadsheet. `tools/dryrun.js` (§1.4)
   enforces this with throwing proxies; re-run it after any change here.
3. A new scope means editing `appsscript.json`, which is the one place a reviewer
   can see the tool's reach. Widening `spreadsheets.readonly` to `spreadsheets`
   removes the platform's guarantee that this tool cannot write to a live model,
   and no test can restore it.
4. `readTab` must keep taking a duck-typed object rather than a `Sheet`, or Tests
   '8a' and '8b' cannot construct an input.

**Ten traps, all quiet:**

- A fixture built with `t_sheet(grid)` alone gives Step 4 A1 text where it expects
  R1C1, and the relocation regex silently matches nothing (§5.1).
- A test of `rowMap` with equal `rowOffset` values passes against an index-space
  bug (§4.1).
- An insertion index at or below the referenced row makes the row map an identity,
  and the relocation test passes without relocating (§7.6).
- A `.test.gs` file added without a line in `t_registerAll_` runs nothing and
  reports nothing (§6.1).
- A harness global added without its `t_` prefix silently overwrites, or is
  overwritten by, a production function of the same name — across files there is
  no redeclaration error (§7.6).
- A top-level `const` in `00_Config.gs` whose value is computed from another
  global reads `undefined` on some load orders, with nothing to say so (§1.1).
- Adding a token to `REF_ERROR_TOKENS` turns the targeted scan into a general
  error report. Test 11 catches `#DIV/0!` specifically; `#VALUE!`, `#N/A` and
  `#NUM!` have no test and would slip through.
- A fixture whose reference names a row **outside** the target tab's data range
  produces a `FORMULA` row that looks like a relocation bug and is not: with
  `rowOffset` 5, `Rates!R4C2` has no map entry, so plan §4d leaves it alone by design.
  This cost real time during the dry run.
- Narrowing `readSheets_`'s returned `names` to the tabs actually read changes the
  pairing without changing any test (§4.13).
- Passing `runWith()`'s advisory pairing into `compareWorkbooks` to "avoid pairing
  twice" makes an inconsistency surface as a thrown error inside `hashGrid` rather
  than as a pairing problem (§5.6).

---

## 10. Known limitations

| Limitation | Whose | Status |
|---|---|---|
| **Step 11 not run.** No part of this has met a live spreadsheet | This build | **The blocking gap, and now the only one.** §1.3 procedure, §1.4 what was verified instead, §6.4 what to check |
| **"One row map per formula" is guarded by two tests, not ten** | This build | §6.3. Only a formula holding two references into two tabs whose maps *disagree* can see the mutation; test 25 looks like a third guard and passes it by coincidence. Widen a fixture next time this area is touched |
| **Plan §1.2 not run.** `REF_RE` is validated only against the forms the plan tabulates | Inherited from the plan | `verifyReferenceForms` performs it in one call, but nobody has. **The suite cannot detect the mismatch** (§4.9) |
| `Utilities.sleep` pacing above 10 tabs never executed | This build | Dry-run fixtures have 4 tabs (§6.5) |
| `verifyReferenceForms` has no unit test | This build | Deliberate: it reports what the real API returns, which a fixture cannot supply |
| Per-tab tallies recomputed from Change rows rather than read from `Stats` | This build | Intended (§2.1). `Stats` knows counts, not classifications |
| `runWith()` pairs tabs twice | This build | Deliberate (§5.6). Cost is O(tabs) on strings |
| Two runs in one minute produce two identically named CSVs | This build | Drive permits duplicate names, so nothing is lost. Minute resolution matches the plan's filename format, and `VERSION` now distinguishes builds but not runs |
| Section 2 above `derivedCap` is **discarded**, not paged | Plan §6.3 | The `DERIVED_TRUNCATED` row and the summary's `⚠ Section 2 truncated` note both say so, and both name the remedy. Raising the cap is a re-run |
| `CHANGE_TYPES` is never read at runtime | This build | Deliberate: it is the taxonomy written down once, and the checklist §9 works from. Nothing enforces that it stays complete |
| The summary's `DERIV` column reads `0`, not the would-be count, when `derivedSection` is off | This build | The honest reading — it counts rows in the file, and there are none (§5.2) |
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
| Suite validated in V8 via VS Code's Electron, not in Apps Script | This build | The code uses no platform API outside `90_Main.gs`, so the risk is confined to Apps Script's own parser and to its file load order; running `runTests()` once in the editor closes both |
| Nobody has run `clasp push` on this layout | This build | The numeric prefixes are what Apps Script sorts on, and `tools/runner.js` proves the concatenation is self-consistent — not that Apps Script produces the same one |
| Array formulas, merged cells, row moves, charts, formatting | Non-goals in the plan | Not defects — see the plan's Non-goals table |

---

## 11. Conformance

**Current.** The code implements the plan's 2026-08-22 revision — its latest —
in full: all fifteen rules, all 38 acceptance tests, the two-section CSV, the
multi-file layout, Script Properties config and `VERSION` stamping. The gap
analysis that stood here through v1.0.0 is deleted rather than carried forward as
history; git holds it, at the commit before the migration.

Two deliberate deviations from the plan's own text are recorded rather than
silently taken, and both are load-bearing:

| Deviation | Why |
|---|---|
| **A thirteenth production file, `70_Compare.gs`.** Plan §1.1 lists twelve and puts phases 0–2 inside the impure entry point | `compareWorkbooks` is pure, and tests 18, 22, 26 and 32 exist to check the two-phase ordering. Folding it into `90_Main.gs` moves that guarantee into the one file the suite cannot reach (§2) |
| **The entry point is `verifyReferenceForms`, not the plan's `verifyR1C1`** | The shipped function does strictly more — part (b) and the no-match list are both beyond the plan's sketch. Renaming a working gate to match a sketch buys nothing (§4.9) |

Three earlier extensions beyond the plan remain, and are documented where they
bite rather than here: the word-boundary check in `REF_RE` (§4.8), the
overlapping-width cap on hashing (§4.11), and blank rows treated as
non-anchorable (§5.1). Each has a test and a sabotage row.

**What is not conformant is Step 11**, which is not a code gap: it is a run
nobody has performed. §1.3 is the procedure and §6.4 is the checklist.
