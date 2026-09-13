---
title: Test Fixture Generator — Implementation Documentation
status: implementation documentation — describes shipped code
date: 2026-08-07
revised: 2026-08-22 — realigned to the plan's 2026-08-19 (two-section CSV) and 2026-08-22 (multi-file, Script Properties) revisions; adds the `Cascade` tab for test 38
target: Google Apps Script (V8), single `.gs` file, no external libraries
documents: src/GenerateTestWorkbooks.gs
built_from: Google Sheets Difference Comparison Tool Implementation Plan.md — **not checked in**
audience: whoever runs, reads or extends the fixture generator
---

# Test Fixture Generator — Implementation Documentation

Documentation for **`src/GenerateTestWorkbooks.gs`**, the Apps Script that builds
the two spreadsheets used to validate the Google Sheets diff tool end to end. It
is a **separate script project** from the diff tool — it writes spreadsheets,
which the diff tool must never be able to do (see
[`implementation.md`](implementation.md) §0). The two are versioned together in
one repository and deployed apart.

**Reference conventions.** **§n** points within this document. **Plan §n** and
**Step n** refer to *Google Sheets Difference Comparison Tool Implementation
Plan.md* — its numbered sections and its build steps respectively; the plan is
the specification and is **not checked in**. **Test n** is
a row in that plan's "Verification — acceptance tests" table, and **rule n** a
row in its §0.1 table of fifteen rules. Change types in `CAPITALS` are the diff
tool's output taxonomy.

## 0. What this is

`GenerateTestWorkbooks.gs` builds the two Google Spreadsheets that the diff tool
is validated against:

```
<folder>/
  Diff Fixture A v1.2.0 <stamp>     the "old" revision   — 30 tabs
  Diff Fixture B v1.2.0 <stamp>     the "new" revision   — 30 tabs (one deleted, one added)
```

Between them they exercise all 38 acceptance tests from the implementation
plan, plus the five taxonomy branches the plan defines but does not number
(`FORMULARIZED`, `COL_ADDED`, `TAB_ADDED`, `TAB_DELETED`, `TAB_RENAMED`).

Two of the 38 are not fixture content at all. Tests 36 and 37 vary `OPTS` rather
than the workbooks, so they are covered by re-running the diff tool over the
*same* pair of files — see §6.5.

The plan's own tests run on in-memory fixtures and need no spreadsheet — that is
deliberate, and this generator does not replace them. It covers what those
cannot: whether the tool's model of *Google Sheets' actual behaviour* is right.
Steps 1–7 of the plan can be fully green against hand-written fixtures while
Step 4's regex matches nothing against real `getFormulasR1C1()` output, which is
the failure mode plan §1.2 warns about. These workbooks are the Step 11 end-to-end
run, made repeatable.

**Scope boundary.** The generator writes two files and nothing else. It does not
run the diff tool, does not assert on its output, and shares no code with it.
The expected results in §6 are a checklist for a human, not an automated
comparison. It also has no way to set the diff tool's `OPTS` — §6.5 is a manual
procedure, not something the generator drives.

---

## 1. Setup and use

1. script.google.com → **New project** (standalone, not container-bound) — a
   **second** project, separate from the diff tool's, for the scope reason in
   §1.1. Paste `fixtures/GenerateTestWorkbooks.gs` in, or push it with a
   `.clasp.json` whose `rootDir` is `fixtures`. Runtime must be V8.
2. Set `CONFIG.FOLDER_ID` to the destination folder — a bare ID or a full folder
   URL, both work. Leave it `''` to create (or reuse) `CONFIG.FOLDER_NAME` in the
   root of My Drive.
3. Run `generateTestWorkbooks()`. First run prompts for Sheets and Drive
   authorisation.
4. Copy the two URLs from the execution log into the **diff tool's** Project
   Settings → Script Properties, as `URL_A` and `URL_B`. **They are not source
   constants** — plan §1.1f moved them out of source, and the log prints them in
   property form for that reason.

```js
const FIXTURE_VERSION = '1.2.0';                        // stamped into both file names

const CONFIG = {
  FOLDER_ID:       '',                                  // '' → create in My Drive root
  FOLDER_NAME:     'Sheets Diff Tool - Test Fixtures',
  NAME_PREFIX:     'Diff Fixture',
  TIMESTAMP_NAMES: true                                 // -YYYYMMDD-HHMM suffix
};
```

`FIXTURE_VERSION` exists for the reason plan §1.1e gives for the diff tool's own
`VERSION`: when someone brings back an old CSV and asks why it disagrees with
today's, the first question is whether the fixtures moved underneath it. It is
bumped by hand and appears in both file names, so a CSV can always be traced to
the fixture revision that produced it. **Bump it whenever §6's expected counts
change** — a stale version number is worse than none, because it certifies
something false.

Runtime is 60–90 seconds — roughly 190 Sheets and Drive operations, dominated by
the 29 tab writes, comfortably inside the 6-minute ceiling. Re-running is safe —
with `TIMESTAMP_NAMES` on, each run produces a new pair rather than overwriting.

`trashGeneratedWorkbooks()` moves every file in the target folder whose name
starts with `NAME_PREFIX` to Drive's trash. It refuses to run until
`CONFIRM_TRASH` is set to `true` at the top of the file.

### 1.1 Project hygiene

The plan's 2026-08-22 revision put the diff tool into twelve files under `clasp`
and a checked-in manifest. Two of those three apply here; one deliberately does
not.

| Plan requirement | Applies to the generator? |
|---|---|
| `clasp` clone into the same git repo (plan §1.1d) | **Yes.** A sibling script project, in `fixtures/`. The fixture set is now versioned, and §6's counts are only checkable if you can see what changed between two runs that behaved differently |
| Explicit `oauthScopes` in `appsscript.json` (plan §1.1c) | **Yes**, and they are the opposite of the tool's. See below |
| Twelve-file layout with numeric prefixes (plan §1.1) | **No.** See §10 |

**`fixtures/` is a directory rather than a file beside the tool**, and the
separation is load-bearing rather than tidiness. `clasp` pushes a whole
`rootDir`: with the generator sitting in `src/` alongside the tool, one
`clasp push` would upload a script full of `SpreadsheetApp` **writes** into the
project whose manifest promises `spreadsheets.readonly`, and the platform would
then have to grant the union of both scope sets. The two directories are two
`rootDir` values and therefore two projects, which is what keeps the promise
enforceable.

`fixtures/appsscript.json` is checked in and holds exactly this — verbatim, and
deliberately the opposite of `src/appsscript.json`:

```json
{
  "timeZone": "Australia/Sydney",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
  ]
}
```

**These are read-write, and that is the point of writing them down.** The diff
tool declares `spreadsheets.readonly` so the platform enforces its promise never
to write. The generator cannot make that promise — it exists to create files —
so the two projects must stay separate script projects. Merging them to "save a
project" would hand the diff tool write scope and dissolve the guarantee plan
§1.1c is buying.

---

## 2. Architecture

```
generateTestWorkbooks()                   ← orchestration
├─ resolveFolder_()                       ← Drive I/O
├─ SpreadsheetApp.create + moveTo
├─ buildWorkbookA_(ssA)
│   └─ writeTab_(ss, spec)  ×29           ← Sheets I/O
├─ breakReferencesInA_(ssA)               ← manufactures the both-files errors
├─ DriveApp .makeCopy → ssB
├─ mutateWorkbookB_(ssB)                  ← every intentional A/B difference
│   └─ insertRowWith_(sheet, row, values)
└─ logResult_(folder, ssA, ssB)
──────────────────────────────────────────────────────────────────────────────
tabSpecs_()          → [{ name, grid, text? }]     ← pure, ordered (see §4.2)
<tabName>Tab_()      → one spec each               ← pure
TEST_INDEX           → the _Manifest tab's rows    ← pure data
filler_(n, startRow, label)                        ← pure
padGrid_(grid)                                     ← pure
```

A tab spec is `{ name, grid, text? }`. `grid` is a ragged 2-D array —
`padGrid_()` rectangularises it, since `setValues()` rejects anything else. Any
string beginning with `=` becomes a formula.

`text` lists A1 addresses to format as plain text *before* the values land, which
is the only way to store a literal `=1+1` or `#DIV/0!` rather than have Sheets
parse it. **No spec currently populates it.** Both plain-text cells in the fixture
set — `Basics!B17` and `CSV Nasty!B3` — exist only in B, so they are formatted at
mutation time instead (`setNumberFormat('@')` then `setValue`, in that order).
`text` is a working escape hatch for a future A-side case, not dead code, but do
not go looking for the two cells it would explain.

---

## 3. The central design decision

**B is not written cell by cell. B is a copy of A that is then mutated with real
structural operations** — `insertRowBefore`, `deleteRow`, `setName`,
`insertSheet` — and Google Sheets performs the formula rewriting itself.

Step 4 of the plan (relocation) exists to *invert* what Sheets does when a row is
inserted in a referenced tab. If the generator hand-wrote `=Rates!$B$5` into B,
the fixture would encode the generator's guess about that behaviour, and the tool
would be validated against the guess rather than against Sheets. The two agree
right up until they don't, and the failure is silent: a wrong guess produces a
fixture the tool passes and a real workbook it fails.

The same applies to reference errors. `#REF!` is produced by genuinely deleting
the rows other tabs point at — partly because it is authentic, partly because
Sheets will not accept `#REF!` as formula input at all, so there is no
alternative.

It applies a third time, and newly, to **derived values**. Since the plan's
2026-08-19 revision every recalculated cell is emitted to section 2 of the CSV,
so the fixture set now has to produce recalculations whose new values are real.
Letting Sheets compute them is the only way to know that `Basics!D19` really is
five higher and not merely expected to be.

One consequence worth stating plainly: **this generator cannot tell you what
`getFormulasR1C1()` returns.** Plan §1.2 is still a manual 15-minute step
and still gates everything. What the generator gives you is a workbook where the
right answer is known, so that once the regex is written you can tell whether it
worked.

---

## 4. Ordering constraints

Three separate orderings matter, for three different reasons. All are enforced
in code and commented at their site.

### 4.1 Build order — pre-existing vs. new errors

```
1. buildWorkbookA_()      every tab of A
2. breakReferencesInA_()  delete rows 7, 5, 3 of 'Ref Src A'
3. makeCopy → B
4. mutateWorkbookB_()     everything B-only
```

Step 2 must precede step 3. Those errors have to be present in **both** files to
be `REF_ERROR` — the changes-only exception the plan calls test 30, and the one
an implementation is most likely to fail while looking correct. Errors created in
step 4 are B-only and surface as `REF_ERROR_NEW`.

Rows are deleted **descending** (7, then 5, then 3) so earlier deletions do not
shift the later targets out from under the deletion.

### 4.2 Tab creation order — unresolved sheet names

A formula written against a sheet that does not exist yet resolves to
"Unresolved sheet name", and Sheets does not reliably repair it once the sheet
appears. That would seed reference errors into tabs whose expected output is
zero rows — and those tabs are exactly the ones proving relocation works, so the
noise would land where it does most damage.

`tabSpecs_()` is therefore ordered in three blocks: self-contained tabs,
reference targets, then referrers. The dependency edges are:

| Target | Referrers |
|---|---|
| `Ref Src A` | `Ref Errors`, `Chain Root`, `Header Guard`, `Edit Distance` |
| `Ref Src B` | `Ref Errors`, `New Tab` (created in B) |
| `Rates` | `Assumptions`, `Rates Ref`, `Unverified`, `Volatile` |
| `Escalation` | `Assumptions` |
| `Edit Distance` | `Unverified` |
| `Assumptions` | `Fleet` |
| `Chain Root` | `Chain Leaf` |
| `Lookup Table` | `Renamed Ref` |

`Cascade` appears in the first block: its only absolute reference, `$B$2`, is
same-tab, so it depends on nothing.

This constrains the generator only. It says nothing about the diff tool, whose
relocation is single-hop and whose tab processing order is free within each
phase (plan §0.2).

### 4.3 Mutation order — read back, don't predict

Inside `mutateWorkbookB_()`, structural row operations come before any
cell-level edit that depends on them. Where a mutation needs to build on a
rewrite Sheets has already performed, the code **reads the formula back and
amends it**:

```js
const b5 = unv.getRange('B5');
b5.setFormula(b5.getFormula() + '*2');
```

`Unverified!B5` is the case. By the time this runs, Sheets has already rewritten
the formula twice — once for the `Rates` insert, once for the `Edit Distance`
insert. Retyping it would mean predicting both. Appending `*2` adds a genuine
authored edit on top of whatever Sheets actually produced.

---

## 5. Fixture design rules

### 5.1 Tab length versus the edit-distance guard

Plan §3.3 skips a tab when

```
editDistance = (unmatchedA + unmatchedB) / (lenA + lenB) > opts.editDistanceCap   // 0.30
```

A single one-cell edit contributes 2 to the numerator, so a tab needs at least 4
data rows before an isolated edit stops tripping the guard, and several
spread-out edits need considerably more. **Every fixture tab is padded to
roughly 16–24 rows for this reason.** `Basics` carries five hash-changing rows,
spread across rows 2, 7, 13, 17 and 18 of 24 — 10/48 = 0.21. Bunching them, or
trimming the padding, replaces every expected row on that tab with a single
`TAB_SKIPPED`, and the run looks like a tool bug rather than a fixture bug.

This also settles an ambiguity in the plan. **The denominator has to be the full
row counts, not the post-trim middle window.** Pass 0 trims matching rows from
both ends, so for an isolated edit the middle window is one row on each side and
the ratio is 2/2 = 1.0 — every isolated edit would skip its own tab, and the
plan's own tests 2, 15 and 16 could not pass. `Edit Distance` exceeds the cap
under either reading (0.48 full-length), so test 20 is unaffected by the choice.

### 5.2 Section-2 proportions are themselves a fixture

Since the plan's 2026-08-19 revision, two guards are specified to count
**section 1 only** — the noise ratio (plan §5.1 step 6) and, upstream, the
edit-distance cap (rule 15). A fixture proves that only if counting section 2
*would* have tripped them. `Cascade` is sized backwards from that requirement:

| Quantity | Value | Consequence |
|---|---|---|
| Compared cells | 22 rows × 4 cols = 88 | the denominator |
| Section-1 rows | 1 | 1/88 = 0.011 — no warning, the pass |
| Section-2 rows | 40 | counting them gives 41/88 = 0.47 — the warning fires |
| Hash-changing rows | 1 of 22 | editDistance 2/44 = 0.045 — not skipped |

A tab with three derived cells satisfies the letter of test 38 and proves
nothing, because it passes under both readings. Do not shrink this tab.

The same shape guards `hashRow`. Only columns A and B are literal and therefore
contribute to a row's identity hash; C and D are formulas and hash to the
sentinel. An implementation that "improves" `hashRow` by folding in formula-cell
values — which the plan explicitly forbids — moves 21 of the 22 hashes (the
all-literal header row is the exception), scores 42/44 = 0.95 and returns
`Cascade` as `TAB_SKIPPED`. That failure is loud, which is the best available
outcome for a change nobody should be making.

### 5.3 Aggregate ranges and the range-start boundary

`=SUM(B2:B17)` with a row inserted at row 8 is fine: Sheets extends the end of
the range, and the row map relocates that endpoint exactly. `Row Insert Mid`
carries such a formula deliberately — test 13 demands zero `FORMULA` rows and
this is a real way to fail it.

Note what test 13 does *not* demand. The inserted row carries `42` in column B,
so `=SUM(B2:B18)` genuinely totals 42 more than `=SUM(B2:B17)` did. Identical
relocated formula, differing value — that is a `DERIVED_VALUE`, and it belongs in
section 2. Test 13 says zero `VALUE` and zero `FORMULA`; it says nothing about
section 2, and a run that suppresses that row is failing rule 13 rather than
passing test 13. Column D of the same row is empty on purpose, so `=SUM(D2:D18)`
is unchanged and the tab yields exactly one derived row rather than two.

Inserting at row 2 when the range *starts* at row 2 is different. Sheets keeps
the start at row 2 while the row map says row 2 → row 3, so relocation produces
`R3C2:R17C2` against an actual `R2C2:R17C2` and emits a false `FORMULA`. That
boundary case is outside the plan's scope, so `Row Insert Top` carries no
aggregate and the fixtures never create it.

**This is a real limitation of the tool, not of the fixtures.** A production
workbook with a total row above its data will produce false positives here. It is
recorded rather than fixed because fixing it means deciding whether a range whose
start did not move is a change, and the plan does not take a position.

### 5.4 Manufacturing each error state

| Needed | How |
|---|---|
| `REF_ERROR` (both files) | Delete the target row in A, **before** the copy |
| `REF_ERROR_NEW` | Delete the target row in B only |
| `REF_ERROR_FIXED` | Break in A, then overwrite the cell in B with a valid formula |
| Inherited (value-only) | Point a clean formula at a cell that is already a root |
| `#DIV/0!` that must **not** be flagged | A real `=1/0`, identical in both files |
| `#DIV/0!` as a changed *value* | Plain-text `'#DIV/0!'` in B — see below |

The last row is the one compromise in the fixture set. Test 11 wants a cell whose
value reads `#DIV/0!` with **no formula on either side**, so it falls through to
`VALUE`. There is no way to put a bare error token in a formula-free cell, so B
holds the literal text `#DIV/0!` in a plain-text-formatted cell. To the tool this
is indistinguishable from the real thing — `getValues()` returns the string
`'#DIV/0!'` and `getFormulas()` returns `''` either way — so the test is valid,
but the cell is synthetic and worth knowing about. `Basics!B16` carries a genuine
`=1/0` alongside it, identical in both files, which must produce no row at all —
and note that it sits at row 16, outside `=SUM(B2:B15)`, or the subtotal would be
an error rather than the derived row §6.4 expects.

### 5.5 Quoted and unquoted sheet names

Tab names deliberately mix the two forms so both branches of the plan §4b sheet-name
regex are exercised: `'Ref Src A'`, `'Edit Distance'`, `'Lookup Table'` require
quoting; `Rates`, `Escalation`, `Assumptions` do not. A regex that handles only
the unquoted branch passes a surprising number of tests before failing.

---

## 6. Expected output of a correct run

Row counts assume the default `OPTS` in plan §1.1f — in particular
`derivedSection: true` and `derivedCap: 5000`. §6.5 covers the two variant runs.

**Section membership is not a judgement call.** Plan §0.5 derives it from the
change type via `sectionOf()`, so every row below is in exactly one section and
the assignment is checkable without reading the tool's code.

| | Rows |
|---|---|
| **Section 1 — changes and breakage** | **41** |
| **Section 2 — derived values** | **45** |

**Both totals are unchanged at `FIXTURE_VERSION` 1.2.0, and that is the point of
the tab added there.** `Whole Range` holds the two reference forms `REF_RE` could
not match before v1.2.0 — `=SUM(Rates!$4:$4)` in `B2` and
`=SUM('Lookup Table'!$B:$B)` in `B3` — each pointed at the mutation that exposes
it: `Rates` gains a row above row 4, and `Lookup Table` is renamed.

**Both cells must emit nothing, in either section.** The row's contents move
unchanged so no value moves, and the sheet name relocates through `tabMap` so no
text differs. A regression therefore does not change a number here — **it adds a
row that this table does not have**, which is the only kind of fixture failure
that cannot be mistaken for a fixture edit.

### 6.1 Section 1, by change type

| Type | Count | Where |
|---|---|---|
| `VALUE` | 11 | `Basics` ×4, `CSV Nasty` ×4, `Row Insert Edit`, `Row Relabel`, `Cascade!B2` |
| `FORMULA` | 2 | `Basics!D10` (rewritten, same result — test 3), `Unverified!B5` (**not** unverified — test 24) |
| `FORMULA_UNVERIFIED` | 1 | `Unverified!B6` |
| `HARDCODED` | 1 | `Basics!D7` |
| `FORMULARIZED` | 1 | `Basics!G13` |
| `VOLATILE_VALUE` | 2 | `Volatile!B2` (INDIRECT), `Volatile!B3` (OFFSET) — **section 1, not 2** |
| `REF_ERROR_NEW` | 1 | `Ref Errors!B4` |
| `REF_ERROR_FIXED` | 1 | `Ref Errors!B3` |
| `REF_ERROR` | 6 | see §6.3 |
| `ROW_ADDED` | 7 | `Row Insert Top`, `Row Insert Mid`, `Row Insert Edit`, `Rates`, `Escalation`, `Assumptions`, `Self Ref` |
| `ROW_DELETED` | 2 | `Row Delete Mid`, `Ref Src B` |
| `COL_ADDED` | 1 | `Col Change` |
| `TAB_SKIPPED` | 2 | `Header Guard` (header mismatch), `Edit Distance` (edit distance) |
| `TAB_RENAMED` | 1 | `Lookup Table` → `Lookup Table v2` |
| `TAB_ADDED` / `TAB_DELETED` | 1 each | `New Tab` / `Scratch` |
| | **41** | |

`VOLATILE_VALUE` is the row to check first, because rule 14 made its failure
quiet. Both `Volatile` cells have identical formula text and differing values —
observably indistinguishable from a `DERIVED_VALUE` — and only the
`INDIRECT`/`OFFSET` test separates them. An implementation that routes on
"formulas equal, values differ" before consulting `ctx.volatile` puts them in
section 2, where nothing looks wrong and nobody reads them.

### 6.2 Section 2, in emission order

Plan §6.2 sorts section 2 in workbook order only — tab, then row, then column —
so this order is itself an assertion.

| # | Cell (A → B) | Why it moved |
|---|---|---|
| 1 | `Basics!D2` | `=B2*C2`; `B2` went 10 → 12 |
| 2 | `Basics!B19` | `=SUM(B2:B15)`, +2 |
| 3 | `Basics!D19` | `=SUM(D2:D15)`, +5 via `D2` |
| 4 | `Row Insert Mid!B18` → `B19` | `=SUM(B2:B17)` → `=SUM(B2:B18)`; the inserted row carries 42 (§5.3) |
| 5 | `Row Insert Edit!D10` → `D11` | `=B*C`; `C` was edited to 88.88 |
| 6–45 | `Cascade!C3:D22` | 40 cells, all driven by `B2` 10 → 25 (§5.2) |
| | **45** | |

`Basics!D7` is deliberately *not* here. The literal `21` typed over `=B7*C7`
evaluates to the same 21, so `D19` moves only by `D2`'s five. If `D19` moves by
ten, the fixture has drifted, not the tool.

### 6.3 The eight reference-error rows

| Cell | Type | Surface | Why |
|---|---|---|---|
| `Ref Errors!B4` | `REF_ERROR_NEW` | root | Clean in A, broken in B |
| `Ref Errors!B3` | `REF_ERROR_FIXED` | root | Broken in A, repaired in B |
| `Edit Distance!E4` | `REF_ERROR` | root | Tab skipped on edit distance — unaligned scan, `aRef` empty |
| `Chain Root!C7` | `REF_ERROR` | root | Broken in A, unchanged in B |
| `Ref Errors!B2` | `REF_ERROR` | root | Broken in A, unchanged in B |
| `Header Guard!D3` | `REF_ERROR` | root | Tab skipped by the header guard — unaligned scan, `aRef` empty |
| `New Tab!B3` | `REF_ERROR` | root | Tab has no A-side counterpart — unaligned scan, `aRef` empty |
| `Chain Leaf!F10` | `REF_ERROR` | inherited | Own formula is clean; only its value reads `#REF!` |

Seven roots, one inherited. All eight are **section 1** — an error is never
derived, however unchanged the cell (test 33).

Three carry `aRef` empty. That is correct, not a defect: plan §5.2
emits `REF_ERROR` with `bRef` only for anything the unaligned scan finds,
including cells that are new in B. `New Tab!B3` therefore reports as `REF_ERROR`
rather than `REF_ERROR_NEW` even though it did break in this revision — the scan
has no A-side to compare against and does not pretend otherwise.

**Sort order** follows plan §6.2: every reference error before anything else,
roots before inherited, and within the roots `REF_ERROR_NEW`, then
`REF_ERROR_FIXED`, then `REF_ERROR` in workbook order. The table above is that
order. The load-bearing assertion is the last line — `Chain Root!C7` must appear
above `Chain Leaf!F10`. Their `new` fields are what distinguishes them without an
extra column — `='Ref Src A'!#REF!` for the root, bare `#REF!` for the inherited
symptom.

### 6.4 The tabs that must emit nothing

`Rates Ref`, `Assumptions`, `Fleet`, `Self Ref`, `Renamed Ref`, `Row Insert Top`,
`Row Insert Mid` must produce **zero `FORMULA` rows**. `Untouched`, `Ref Src A`
and `_Manifest` must produce **zero rows of any kind, in either section**.

If any tab in the first group emits a `FORMULA` row, Step 4 relocation is
silently no-opping and every other result in the run is suspect. This is the
single most informative check in the whole set, because it is the failure the
plan describes as "plausible enough to be believed".

The second group is now a stronger assertion than it was. Before the two-section
revision, a tab could produce nothing because the tool had discarded its output;
now `Untouched` producing nothing means the derived branch also correctly
declined to fire. **A completely empty section 2 is a failure**, not a clean bill
— it means `derivedSection` never fired at all, which plan Step 11.9 calls out as
the check to run against the two counts.

Two further absences to confirm:

- **No noise warning for `Cascade`**, and no `TAB_SKIPPED` for it either (§5.2).
- **`Ref Src B` emits one `ROW_DELETED`.** That deletion is what breaks its
  referrers, and it is also test 19's shape — a row deleted in a referenced tab,
  producing a root error in the referencing tab. It is a side effect of how the
  errors are manufactured, not a test in its own right.

### 6.5 The two variant runs

Tests 36 and 37 change `OPTS` in the diff tool and re-run it over the *same* two
files. Neither needs a new fixture; both need the run to be repeated, and the
generator has no way to do it for you.

| Test | Set in `OPTS` | Expected |
|---|---|---|
| 36 | `derivedSection: false` | No blank line, no `#` marker, no second header, no section 2. **Section 1 must be byte-identical to the default run's section 1** — that is the whole assertion, and diffing the two files is how you check it |
| 37 | `derivedCap: 3` | Section 2 holds rows 1–3 of §6.2 — `Basics!D2`, `Basics!B19`, `Basics!D19` — then one `DERIVED_TRUNCATED` row reading **42**. Section 1 untouched at 41 rows. Re-running must yield an identical file |

`derivedCap` is lowered to 3 rather than exercised at its 5000 default because
the fixture set produces 45 derived rows and cannot reach 5000 (§10). Truncation
is a sorted-order property, so a cap of 3 tests exactly the same code path as a
cap of 5000 — provided section 2 really is sorted before it is truncated, which
is what the deterministic first-three assertion checks.

---

## 7. Tab reference

29 tabs in A. B has 29 as well — `Scratch` removed, `New Tab` added.

| Tab | Rows | Covers | Difference in B |
|---|---|---|---|
| `_Manifest` | 43 | — | none; documents the fixture set in-file |
| `Untouched` | 16 | 1 | none |
| `Basics` | 24 | 2–6, 9, 11, 34, FORMULARIZED | `B2` 10→12, `E2` label, `D7` hardcoded, `D10` formula rewritten, `G13` formularized, `B17` → text `#DIV/0!`, `B18` label |
| `CSV Nasty` | 19 | 8 | `B2:B5` gain a comma/quote/newline string, literal `=1+1`, `-lead`, `@lead` |
| `Row Insert Top` | 17 | 7 | row inserted at 2 |
| `Row Insert Mid` | 18 | 13 | row inserted at 8, inside `=SUM(B2:B17)` |
| `Row Delete Mid` | 17 | 14 | row 8 deleted |
| `Row Insert Edit` | 17 | 15 | row inserted at 6; `C11` edited below it |
| `Row Relabel` | 17 | 16 | `A7` relabelled |
| `Self Ref` | 16 | 17 | row inserted at 4, above the `=$B$4` target |
| `Col Change` | 9 | COL_ADDED | column E added |
| `Cascade` | 22 | 38 | `B2` 10→25 — one edit, 40 derived cells |
| `Scratch` | 11 | 10 | deleted |
| `Ref Src A` | 16 → 13 | — | none; rows 7/5/3 deleted **in A** to break its referrers in both files |
| `Ref Src B` | 16 | 19 | row 3 deleted, breaking its referrers in B only |
| `Rates` | 16 | 18, 23–28 | row inserted at 4, above the referenced `$B$4` |
| `Escalation` | 16 | 23 | row inserted at 3 |
| `Lookup Table` | 16 | 10, 21 | renamed to `Lookup Table v2` |
| `Edit Distance` | 13 | 20, 22 | row inserted at 2, then 6 of 12 data rows rewritten wholesale → skipped |
| `Assumptions` | 16 | 23, 25, 26 | row inserted at 4 (chain middle shifts) |
| `Chain Root` | 16 | 33 | none; `C7` is broken in both files |
| `Fleet` | 15 | 26 | none; `F10` closes the chain |
| `Rates Ref` | 16 | 18 | none; the isolated cross-tab reference |
| `Unverified` | 16 | 22, 24 | `B5` gains `*2` |
| `Volatile` | 16 | 27, 28 | none; values move because `Rates` did |
| `Ref Errors` | 16 | 29, 30, 31 | `B3` repaired |
| `Chain Leaf` | 15 | 33 | none; `F10` inherits the root's error |
| `Header Guard` | 16 | 12, 32 | `C1` header text changed |
| `Renamed Ref` | 16 | 21 | none; Sheets rewrites the sheet name for us |
| `New Tab` | — | 10, 5.2 | created in B, already holding a broken reference |

Tests 35, 36 and 37 are properties of the whole run rather than of any tab, so
they appear in no row above. Test 35 is satisfied by the run having both sections
populated at all; 36 and 37 are §6.5.

### The interesting ones

**`Rates`** is the hub. The insert at row 4 pushes the old `B4` (55) down to `B5`
and puts 77 at `B4`. That specific arrangement is what makes the volatile cases
detectable: `INDIRECT("Rates!B" & A2)` and `OFFSET(Rates!$A$1, 3, 1)` both still
resolve to `B4`, whose contents are now different — identical formula text,
changed value, which is precisely `VOLATILE_VALUE`. Everything that references
`Rates` by an *absolute* row instead — `Assumptions!C7`, `Rates Ref!B2` — is
relocated to `$B$5` and reads 55 in both files, so those tabs stay silent in
**both** sections. The contrast between the two is the fixture.

**`Assumptions` → `Fleet`** is the chain. `Assumptions!C7` holds `=Rates!$B$4`;
`Fleet!F10` holds `=Assumptions!$C$7`. A row is inserted in *both* `Rates` and
`Assumptions`, so both hops shift. Each is resolved by its own target's map in
one step. Test 26 is the one that validates the entire diff half at once.

**`Unverified`** carries the pair that distinguishes tests 22 and 24. `B6` points
only into the skipped `Edit Distance` tab and is wholly unverifiable
(`FORMULA_UNVERIFIED`). `B5` points into both `Rates` (mapped) and `Edit
Distance` (not), and gains a genuine `*2` edit. Masking only the unverifiable
half leaves the masked forms different, so it correctly reports as `FORMULA`.
An implementation that masks every absolute row reports both as
`FORMULA_UNVERIFIED` and loses a real edit.

**`Chain Root` / `Chain Leaf`** is one fault reported twice, on purpose. The root
holds the broken pointer in its own formula text; the leaf's formula is clean and
only its value reads `#REF!`. Same fault, two classifications, and the root must
sort first.

**`Cascade`** is the only tab whose *proportions* rather than whose contents are
the test. 40 of its 88 compared cells recalculate from a single edit. See §5.2
for why shrinking it silently destroys the test.

---

## 8. Diagnosing a failed run

Ranked with the quiet failures first — a symptom that produces plausible output
is worse than one that produces none.

| Symptom | Likely cause |
|---|---|
| `Volatile!B2` / `B3` appear in **section 2** as `DERIVED_VALUE` | `ctx.volatile` tested after `derivedSection` in diffCell rule 5. Nothing is dropped and no count looks wrong — the rows are merely mislabelled and buried. Rule 14, tests 27–28 |
| `FORMULA` rows in `Rates Ref` / `Assumptions` / `Fleet` / `Self Ref` | Step 4 relocation is no-opping. The plan §4b regex does not match real `getFormulasR1C1()` output — go back to plan §1.2a |
| `FORMULA` rows in `Renamed Ref` only | Sheet-name relocation (plan §4d) missing; row relocation is fine |
| `FORMULA` rows in `Assumptions` but not `Rates Ref` | One map per formula instead of one per reference (the plan §4b callback). Test 23 |
| `Unverified!B5` reports `FORMULA_UNVERIFIED` | `maskUnresolvable` is masking every absolute row, not only unmapped targets. Test 24 |
| Nothing at all from `Ref Errors!B2` | Error check placed after the identical-formula suppression rule. Test 30 — the single most likely silent failure |
| `DERIVED_VALUE` rows anywhere in section 1 | `sectionOf` not applied at write time, or a `section` field added to `Change` and set at an emission site. Rule 13, test 35 |
| Section 2 empty, section 1 at 41 | `derivedSection` never fired — diffCell rule 5 still returning `null`. Plan Step 11.9 |
| Section 2 present but the `#` marker sits over no rows | Marker emitted unconditionally instead of only when section 2 has rows. Plan §6.1 |
| Noise warning on `Cascade` | Noise ratio counts section 2. Rule 15, test 38 |
| `Cascade` comes back `TAB_SKIPPED` | `hashRow` includes formula-cell values, so all 22 hashes moved. Explicitly forbidden — plan Step 5, rule 15 |
| Fewer than 45 section-2 rows, `Cascade` intact | Check `Row Insert Mid!B18` and `Row Insert Edit!D10` — aggregate-range and below-the-insert recalculations are the two easiest to lose |
| No rows from `Header Guard` / `Edit Distance` / `New Tab` | Error scan is coupled to alignment. Test 32, rule 9 |
| `Basics!B16` (`=1/0`) reported as a reference error | `REF_ERROR_TOKENS` widened beyond `#REF!` and `#NAME?`. Test 11 |
| Every date row in `Basics` reported | `Date` not normalised with `.getTime()`. Test 9 |
| Whole tabs coming back `TAB_SKIPPED` | Edit-distance denominator computed on the post-trim window rather than full row counts — see §5.1 |
| Thousands of rows from a row-insert tab | Alignment not running, or comparing row *N* to row *N* |
| `Chain Leaf!F10` above `Chain Root!C7` | Sort is not putting roots before inherited. Test 33 |
| Section 1 differs between the default run and the `derivedSection:false` run | Section membership is being decided somewhere other than `sectionOf`. Test 36 |
| `run()` throws "Set URL_A and URL_B" | The URLs went into source instead of Script Properties. Plan §1.1f, and §1 step 4 here |
| CSV filename carries no `v<VERSION>` | Plan §1.1e not implemented; you cannot tell which build produced the file |

---

## 9. Extending the fixtures

To add a case:

1. Write a `<name>Tab_()` returning `{ name, grid }`. Pad it to ~16 rows (§5.1).
2. Register it in `tabSpecs_()` **in the right block** — after anything it
   references (§4.2).
3. Add the B-side difference to `mutateWorkbookB_()`, after the structural
   operations it depends on (§4.3).
4. **Work out which section each expected row lands in**, using plan §0.5's type
   list rather than intuition. A cell whose formula is unchanged and whose value
   moved is section 2 unless the formula is `INDIRECT`/`OFFSET`, in which case it
   is section 1.
5. Add a row to `TEST_INDEX` so the `_Manifest` tab stays truthful.
6. Update §6.1, §6.2 and the totals here, and `logResult_()` in the script.
   The log and this document duplicate the same counts and drift apart
   independently; if they disagree, one of them is wrong and you now know where
   to look.
7. Bump `FIXTURE_VERSION` (§1).

Three traps: an edit on a short tab silently becomes a `TAB_SKIPPED`; a formula
referencing a tab created later silently becomes an unresolved-name `#REF!`; and
a new formula whose value moves adds a section-2 row you may not have counted,
which shows up as an off-by-a-few against §6.2 rather than as anything obviously
wrong. None of the three raises an error. All three produce a fixture that looks
plausible and tests the wrong thing.

---

## 10. Known limitations

| Limitation | Whose | Status |
|---|---|---|
| Cannot verify plan §1.2 (R1C1 forms, broken-reference rendering) | inherent | By nature — a manual observation step, and it still gates everything |
| `#DIV/0!` for test 11 is plain text, not a real error value | platform | Unavoidable; indistinguishable to the tool (§5.4) |
| Range-start-boundary insertion produces a false `FORMULA` | the diff tool | Real tool limitation, deliberately not exercised (§5.3) |
| Section 2 tops out at 45 rows, so `derivedCap` cannot be exercised at its 5000 default | this generator | Accepted. Test 37 lowers the cap instead (§6.5); reaching 5000 would mean a fixture workbook nobody could read |
| Section-2 volume is unrepresentative | this generator | A real model produces derived rows in the hundreds or thousands (plan Step 10's example shows 818). The fixtures prove the *routing* is right, not that the volume is survivable |
| No array-formula fixture | inherited from the plan | Plan Step 8 records spilled cells as a known gap with no action required |
| Only the diff tool's own tabs are covered | inherent | The fixtures encode the plan's expectations; they cannot catch a case the plan itself omits |
| Expected results are a human checklist, not assertions | this generator | Out of scope; the generator shares no code with the tool by design |
| Column insertion and absolute-column relocation | inherited from the plan | Non-goal in the plan; only the dimension guard is exercised |
| Single `.gs` file, not the plan's twelve-file layout | this generator | Deliberate. Plan §1.1 splits the diff tool to enforce a purity boundary — `SpreadsheetApp` in the wrong file becomes visible in the file tree. The generator has no such boundary to enforce: it is I/O end to end, its pure helpers are four functions, and splitting it would buy nothing while adding a load-order constraint (plan §1.1a) that does not currently exist |
