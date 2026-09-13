# Sheets Diff Tool

A structural diff for Google Sheets. Point it at two spreadsheet URLs — typically
two successive versions of the same model — and it reports **what someone
changed**, separated from what merely **recalculated as a result**.

Written in Google Apps Script (V8), no external libraries, no build step.
Read-only with respect to both source files, enforced by OAuth scope rather than
by convention.

> **Status: v1.1.0.** All 79 tests pass
> against in-memory fixtures and a stubbed Google API, but the end-to-end run
> against two real files has not been performed, and one assumption about the
> Sheets API (`getFormulasR1C1()`'s exact output) is unverified. See
> [Known gaps](#known-gaps) before trusting a result.

---

## Why this exists

`diff` on two spreadsheet exports tells you that four hundred cells changed. It
does not tell you that **one** of them was typed by a person and the other three
hundred and ninety-nine are that edit propagating through the formulas.

This tool makes that distinction the organising principle of its output:

- **Section 1 of the CSV — authored changes.** Edited literals, rewritten
  formulas, a formula replaced by a hardcoded number, inserted and deleted rows,
  renamed tabs. Plus **every** reference-error cell, changed or not.
- **Section 2 — derived values.** Cells whose formula is byte-identical in both
  files and whose value moved. Real information, one to three orders of magnitude
  more numerous, and kept out of section 1 so it cannot bury the diff.

It also tries hard to produce *no row at all* where nothing meaningful happened.
If a row was inserted in `Rates` and a formula in `Fleet Capex` consequently reads
`=Rates!$B$5` where it used to read `=Rates!$B$4`, that formula is **not** a
change — the tool relocates references through the row alignment and stays quiet.
That silence is the feature. Where it *can't* resolve a reference (because the
referenced tab was skipped or unpaired) it says so explicitly, as
`FORMULA_UNVERIFIED`, and names the tab you have to go and look at.

## What the output looks like

A run logs a summary:

```
sheets-diff v1.1.0
A: 2026 Cost Model v3    (6 tabs)
B: 2026 Cost Model v4    (6 tabs)

TAB                   STATUS        REF   VAL   FORM   UNVER   VOL   HARD   FMLZD   ±ROW   ±COL  │   DERIV
─────────────────────────────────────────────────────────────────────────────────────────────────┼────────
Assumptions           modified        0     0      0       0     0      0       0     +1      0  │       6
Fleet Capex           modified        1     0      0       1     1      0       0      0      0  │       0
Escalation            SKIPPED         0     —      —       —     —      —       —      —      —  │       —
Cover → C o v e r     renamed         0     0      0       0     0      0       0      0      0  │       0
Ledger                added           1     —      —       —     —      —       —      —      —  │       —
─────────────────────────────────────────────────────────────────────────────────────────────────┼────────
5 changed, 0 unchanged, 1 skipped.  1 added in B.  0 values, 0 formulas, 0 hardcodes, 1 volatile.
DERIVED: 6 cells recalculated with unchanged formulas (section 2).
REFERENCE ERRORS: 2 total — 0 new, 0 fixed, 2 pre-existing.  2 root, 0 inherited.
→ changes-20260822-1432-v1.1.0.csv (10 rows in section 1, 6 in section 2, 41s)
```

and writes a two-section CSV to Drive:

```
tab,change,a_ref,b_ref,column,old,new
Fleet Capex,REF_ERROR,C14,C14,C,'=Rates!#REF!,'=Rates!#REF!
Cover,TAB_RENAMED,,,,Cover,C o v e r
Assumptions,ROW_ADDED,,A15,,,Inserted|999|
Fleet Capex,FORMULA_UNVERIFIED,C10,C10,C,'=Escalation!$B$4,'=Escalation!$B$5
Escalation,TAB_SKIPPED,,,,,edit distance 45% — structure differs

# SECTION 2 — DERIVED VALUES: cells whose formula is identical in both files and whose value changed
tab,change,a_ref,b_ref,column,old,new
Assumptions,DERIVED_VALUE,C3,C3,C,100,200
```

The CSV holds **two tables in one file**. A plain import reads the blank line, the
`#` marker and the repeated header as three data rows — split the file at the
marker first.

## Safety

**Neither source spreadsheet is ever written to.** The manifest requests
`spreadsheets.readonly`, so the platform refuses a write rather than this code
merely declining to attempt one. The only write anywhere is a single
`DriveApp.createFile` for the CSV, under `drive.file` — a scope that grants access
to files this script itself created and nothing else. `script.external_request` is
deliberately absent.

Every call to a Google service lives in [`src/90_Main.gs`](src/90_Main.gs) and
nowhere else, which makes the boundary checkable in one command:

```bash
grep -l 'SpreadsheetApp\|DriveApp\|PropertiesService\|Utilities\|Session\|MimeType' src/*.gs
# must name src/90_Main.gs and nothing else
```

That purity is also what lets the whole test suite run with no spreadsheet and no
authorisation prompt.

## Install

1. Create a standalone Apps Script project at
   [script.google.com](https://script.google.com) — **not** container-bound.
   Runtime must be V8.
2. Push the contents of `src/`, either with [`clasp`](https://github.com/google/clasp)
   or by pasting the files in. For `clasp`, copy `.clasp.json.example` to
   `.clasp.json` and fill in your script id:

   ```json
   { "scriptId": "<your script id>", "rootDir": "src" }
   ```

   `rootDir` matters. `clasp` pushes an entire directory, and only `src/` belongs
   in this project.
3. Confirm `appsscript.json` arrived with the rest — it carries the read-only
   scope, and that is the whole safety guarantee.
4. Run `runTests()`. **No authorisation prompt should appear.** If one does, a
   Google-service call has been added outside `90_Main.gs`.
5. **Project Settings → Script Properties**, add `URL_A` and `URL_B`. Spreadsheet
   URLs are configuration, not source — nothing to edit and no document id in
   version control.
6. Run `verifyReferenceForms()` and read its output against
   [docs/implementation.md](docs/implementation.md) §4.9 **before** deciding it
   looks fine.
7. Run `run()`.

## Entry points

These four are the whole menu; everything else is pure and called by them.

| Function | Does | Needs a spreadsheet? |
|---|---|---|
| `verifyReferenceForms([url [, tab]])` | Checks what the Sheets API really returns for formulas. **Run this first** | Yes, read-only |
| `run()` | The tool. Reads `URL_A` / `URL_B` from Script Properties | Yes, read-only + one Drive write |
| `runWith(urlA, urlB, opts)` | The same, config passed in, no ambient state | Yes, read-only + one Drive write |
| `runTests()` | 79 tests on in-memory fixtures | **No** |

## Configuration

Behaviour lives in [`src/00_Config.gs`](src/00_Config.gs) and stays under review.
The two URLs live in Script Properties, because *which two files* changes every
run and belongs to whoever is running it.

```js
const OPTS = {
  derivedSection:  true,   // emit recalculated cells as DERIVED_VALUE into CSV section 2
  derivedCap:      5000,   // above this, section 2 is truncated and says so
  expandRows:      false,  // added/deleted rows -> one row per cell, not a preview
  epsilon:         1e-9,   // relative tolerance for numeric comparison
  similarity:      0.5,    // gap-matching threshold in alignment pass 2
  editDistanceCap: 0.30,   // skip a tab if more than this fraction of rows differ
  noiseWarn:       0.30    // warn if more than this fraction of section 1 cells changed
};
```

## Tests

The suite is plain ES2015+ with no platform dependency, so it runs anywhere a V8
does — including inside Apps Script via `runTests()`. Outside it:

```bash
node tools/runner.js   out.txt        # 79 tests
node tools/sabotage.js sabotage.txt   # what the 79 passes are worth
node tools/dryrun.js   dryrun.txt     # runWith() with all six Google globals stubbed
```

Run these from the repository root. Output goes to the file named in the argument
because `console.log` is discarded under some hosts; all three output names are
gitignored.

**`sabotage.js` is the one to read.** A green suite proves nothing on its own, so
it applies twenty mutations to the source — each in a fresh `vm` — and reports
which tests go red. Currently: twenty caught, **none decorative**, and eight
caught by a single test each. That last number is what to watch after a refactor,
because deleting any one of those eight tests silently restores a failure mode.

`dryrun.js` stubs `SpreadsheetApp`, `DriveApp`, `PropertiesService`, `Utilities`,
`Session` and `MimeType`, then drives `runWith()` end to end. Every stub sheet is
a `Proxy` that **throws on any method except `getName` and `getDataRange`** — so
if a code path ever reaches for a setter on a source spreadsheet, it dies in the
harness rather than in someone's live model.

## Layout

```
src/          the diff tool — 24 .gs files + appsscript.json (readonly scopes)
              numeric prefixes ARE the Apps Script load order; do not rename
fixtures/     GenerateTestWorkbooks.gs + appsscript.json (read-WRITE scopes)
              a SEPARATE script project — see below
tools/        runner.js, sabotage.js, dryrun.js — run the suite outside Apps Script
docs/         implementation notes, fixture generator notes, migration record
```

The numeric prefixes are load-bearing. Apps Script sorts files by name, and while
function declarations hoist across the whole shared scope, **top-level `const`
initialisation runs in file order**. `00_Config.gs` therefore loads first and
contains nothing but literal declarations; `90_Main.gs` loads last and is the only
impure file.

**`fixtures/` is a second Apps Script project, deliberately.** The generator
*creates* spreadsheets, so its manifest requests read-write scopes — the exact
opposite of the tool's. Pushing them as one project would hand the diff tool write
access and dissolve the guarantee the manifest exists to make. Deploy it with a
`.clasp.json` whose `rootDir` is `fixtures`.

## Documentation

| Document | For |
|---|---|
| [docs/implementation.md](docs/implementation.md) | How it works and **why it is shaped this way**. Constraints that fail silently (§4), the sabotage matrix (§6.3), diagnosing a failure (§8), extending it (§9) |
| [docs/fixture-generator.md](docs/fixture-generator.md) | The generator that builds the two test spreadsheets, and what each fixture tab is for |
| [docs/migration-v1.1.0.md](docs/migration-v1.1.0.md) | Record of the single-file → multi-file migration. History, not a reference |

The specification these were built against — *Google Sheets Difference Comparison
Tool Implementation Plan.md* — is **not checked in**. Section numbers cited as
"plan §n" refer to it.

## Known gaps

- **The end-to-end run against two real spreadsheets has not been performed.**
  Everything is verified against fixtures, a stub, or the mutation matrix.
- **`getFormulasR1C1()`'s real output is unverified.** `verifyReferenceForms()`
  answers this in one call, but nobody has run it. If the assumption is wrong it
  can invalidate every `FORMULA` row in a run *without producing an error* —
  which is why it is listed here rather than treated as a formality.
- **No `clasp push` has been performed on this layout.** The prefixes are what
  Apps Script sorts on; `tools/runner.js` proves the concatenation is
  self-consistent, not that Apps Script produces the same one.

Out of scope by design: no dependency graph, no `INDIRECT` resolution, no column
alignment, no merge or patch-back, no UI.

## License

[Apache License 2.0](LICENSE).
