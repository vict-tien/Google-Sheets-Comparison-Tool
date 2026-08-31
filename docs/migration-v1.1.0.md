---
title: Sheets Diff Tool — v1.1.0 Migration Plan
status: **EXECUTED — Stage 0, Track B and Track A are complete; §5 (Step 11) is not.** Retire this document once Step 11 passes; it is a record, not a reference. See the note under §0
date: 2026-08-22
target: Google Apps Script (V8), thirteen-file project, no external libraries
migrates: SheetsDiff.gs (unversioned, 3,524 lines, one file) → v1.1.0
towards: Google Sheets Difference Comparison Tool Implementation Plan.md, revision 2026-08-22
gap_analysis: docs/implementation.md §11
audience: coding agent, or whoever continues the diff tool build
---

# v1.1.0 Migration Plan

**Reference conventions.** **§n** points within this document. **Plan §n** and
**Step n** refer to *Google Sheets Difference Comparison Tool Implementation
Plan.md*, revision 2026-08-22 — its numbered sections and build steps. **Rule n**
is a row in plan §0.1, which now holds fifteen. **Test n** is a row in the plan's
acceptance-test table, which now holds thirty-eight; a quoted id (**Test '4a'**)
is local to the shipped build. **Doc §n** refers to
[`implementation.md`](implementation.md) — **doc §11 is the gap analysis this
plan acts on** and is not restated here. **Fixture doc §n** refers to
[`fixture-generator.md`](fixture-generator.md).

**This document is a record, not a reference.** It describes a migration that has
been executed; the paths in its body are the ones that were current while it ran,
before the repository was reorganised into `src/`, `tools/`, `fixtures/` and
`docs/`. Read [`implementation.md`](implementation.md) for how the code is laid
out and run today.

---

## 0. Execution note — 2026-08-22

**Everything below was carried out except §5.** What actually happened, against
what this document asked for:

| | Asked for | Done |
|---|---|---|
| §1.1 | `git init`, baseline commit, `clasp clone` | git yes, baseline at the commit before the migration. **`clasp clone` not done** — no Apps Script project has been touched from here |
| §1.2 | Capture the golden CSV and summary | **Not done as a file pair.** No Apps Script project existed to run the stubbed dry run against at Stage 0. Track B's oracle was the 74-test suite and three mechanical checks instead; §1.2's *purpose* — test 36 — is discharged as a unit assertion, and the file-level comparison moves to Step 11. **This is the one place the plan's oracle was weakened, and it is recorded rather than glossed** |
| §1.3 | Runner asserts declared totals, goes red at 33/38 | Done. It went red, as intended, before any feature work |
| B1–B6 | Rename, split, per-module tests, Script Properties, `VERSION`, commits | Done. Twenty-three `.gs` files plus `appsscript.json`. Purity grep empty, no duplicate global, every top-level statement a declaration |
| A1–A8 | `SECTION_2_TYPES`, `sectionOf`, two-block `toCsv`, `DERIVED_VALUE` + the noise split in one commit, the summary, four restated tests, tests 34–38, five sabotage rows | Done. **79 tests pass; 20 sabotage rows, 20 caught, 0 decorative, 8 still caught by a single test each** |
| §4 | Documentation | Done. *Sheets Diff Tool - Implementation Documentation.md* is rewritten against v1.1.0; its §11 is a conformance note |
| §5 | Step 11 | **Not done.** Needs a live spreadsheet. Doc §1.3 is the procedure and doc §6.4 the checklist |

Three things were found in execution that this plan did not anticipate, and all
three are in the implementation documentation rather than here:

1. **`verifyReferenceForms` called the harness's `pad_`.** Harmless in one file;
   impossible after the split, since production code cannot reach into a test
   file. It uses `padR_` now — an identical body, so the output is unchanged.
2. **The "one row map per formula" sabotage row fails 2 tests, not the 10 the
   v1.0.0 matrix recorded.** Only a formula holding two references into two tabs
   whose maps *disagree* can see it. Doc §6.3 and §10 record it as a real
   thinness in the fixtures rather than as a migration regression.
3. **`t_opts` was added to the harness.** Three tests carried a six-key opts
   literal each, and a literal that omits `derivedCap` reads as *no cap* — a
   different behaviour from the default, silently.

---

## 0. What this is

The shipped tool implements the plan's 2026-08-07 revision completely: 33 of its
acceptance tests plus 41 local ones, all green, with a sabotage matrix behind
them (doc §6.3). The plan has since been revised twice and the code has not
moved. This plan closes that gap.

The two revisions are **independent**, and this plan keeps them independent:

| Track | Closes | Changes behaviour? | Oracle |
|---|---|---|---|
| **B — layout, config, versioning** | Plan's 2026-08-22 revision (doc §11.2) | **No.** Byte-identical CSV, byte-identical summary | The existing 74 tests, plus a golden-file comparison |
| **A — the second CSV section** | Plan's 2026-08-19 revision (doc §11.1) | **Yes.** New change type, new CSV block, new summary column | Tests 34–38, plus four restated tests |

### 0.1 Track B runs first, and the reason is the oracle

Track B is a pure refactor: thirteen files where there was one, a rename, a
config lift. Its acceptance test is the strongest kind available — **the output
must not change at all** — and that test evaporates the moment Track A starts
rewriting the output.

Run in the other order, the file split lands on a taxonomy that changed last
week, and any regression it introduces is indistinguishable from an intended
behaviour change. Run in this order, every step of Track B is falsifiable by
`diff`.

> **Corollary: do not "just add `DERIVED_VALUE` while you are in there."** The
> value of Track B is entirely in the fact that it changes nothing. One
> behavioural change smuggled into a 3,500-line move destroys that, and there is
> no test that will tell you.

### 0.2 What must not regress

The shipped build's real asset is not the 74 passing tests — it is the sabotage
matrix (doc §6.3), which establishes what those passes *mean*. Fifteen mutations
are tracked and **eight are caught by a single test each**. Doc §11.4 lists
eleven plan rules the code already satisfies.

**The matrix is the acceptance gate for this migration, re-run at the end of each
track**, not the test suite alone. A green suite after a 3,500-line move proves
that the tests still run; the matrix proves they still bite.

### 0.3 Non-goals of this migration

| Excluded | Why |
|---|---|
| Any change to the taxonomy beyond `DERIVED_VALUE` | Rules 1–12 are implemented and guarded. Touching them re-opens closed questions |
| Reordering `diffCell` rule 5's two branches | `ctx.volatile` before the derived branch is rule 14, and it is **already correct** (doc §11.4). This is the one line most likely to be "tidied" |
| Adding formula-cell values to `hashRow` | Plan Step 5 names this as the way rule 15 fails upstream of the noise ratio |
| A `section` field on `Change` | Plan §0.5. Membership is computed by `sectionOf`, or it is not enforceable |
| Extending `REF_ERROR_TOKENS` | Rule from the original plan, guarded by Test 11 |
| Rewriting `verifyReferenceForms` to the plan's narrower `verifyR1C1` | It does strictly more (doc §4.9). Settle the name, keep the behaviour |
| Fixing the `alignRows`/`hashGrid` double-hash | A known, measured, negligible inefficiency (doc §10). Not this plan's business |
| Running Step 11 mid-migration | §5. Once, at the end, against a fixture pair already built for the new output |
| Anything in the plan's own Non-goals table | Unchanged and still binding |

---

## 1. Stage 0 — gates

**Nothing below starts until all three are done.** Each removes a way for a later
step to report success against its own bookkeeping.

### 1.1 Version control

`git init`, commit `SheetsDiff.gs`, `GenerateTestWorkbooks.gs` and both
implementation documents as the baseline, then `clasp clone` per plan §1.1d.

Without this there is no way to answer "did the split change anything?", which is
Track B's entire acceptance criterion. The project directory is not currently a
repository (doc §11.2).

### 1.2 Capture the golden output

Run the stubbed dry run described in doc §1.4 and **save its CSV and its summary
text to files.** These are Track B's oracle: after every step of Track B, the
regenerated pair must be byte-identical.

Capture them with `includeDerived: false` — the shipped default. That same CSV
becomes Test 36's expected output in Track A, where `derivedSection: false` must
reproduce the pre-revision file exactly.

### 1.3 Make the runner assert its total — expect it to go red

`runTests()` currently computes its "total" from the tests it happens to hold and
prints `33 total` (doc §6.1). Plan Step 1 requires the opposite. Replace the
computed figure with a declared one:

```js
const T_PLAN_TOTAL = 38;          // plan's acceptance-test table
const T_LOCAL_TOTAL = 41;         // local tests of unnumbered branches
```

The runner must **fail** when the numeric ids present do not cover `1..38`
exactly, and when the local count does not match. Report the missing ids by
number, not as a bare count — "5 missing" sends someone hunting; "missing 34, 35,
36, 37, 38" does not.

> **This step turns the suite red before any feature work begins, and that is the
> point.** Five acceptance tests have been absent since 2026-08-19 with a green
> run reporting `33 total`. Every later step of this plan is measured by the
> suite; a suite that grades itself measures nothing.

**Done when:** `runTests()` reports `FAIL — plan acceptance tests: missing 34, 35,
36, 37, 38` and 74 individual passes.

---

## 2. Track B — layout, config, versioning

Behaviour-preserving throughout. **After each step: 74 passes, and both golden
files byte-identical.**

### 2.1 B1 — rename every test global to `t_`

Plan §1.1b. Mechanical, whole-file, one commit:

`fixture` → `t_fixture`, `sheet` → `t_sheet`, `workbook` → `t_workbook`,
`emptyFormulas` → `t_emptyFormulas`, `filler_` → `t_filler`, `plantG_` →
`t_plantG`, `plant_` → `t_plant`, `inserted_` → `t_inserted`, `unalignable_` →
`t_unalignable`, `stubSheet_` → `t_stubSheet`, `diffFixture_` → `t_diffFixture`,
`cmp_` → `t_cmp`, `assertEqual`/`assertCount`/`assertNone`/`assertTotal` →
`t_assert*`, `fail_` → `t_fail`, `describe_` → `t_describe`, `pad_` → `t_pad`,
`TEST_STATE` → `T_STATE`, `TESTS` → `T_TESTS`, `PENDING` → `T_PENDING`.

> **Do this before the split, not after.** In one file a collision between a test
> helper and a production function is a visible redeclaration. Across thirteen
> files it is a silent last-one-wins overwrite with no error, and the symptom is
> a test passing against the wrong helper (plan §1.1b). `sheet`, `fixture` and
> `workbook` are the live hazards — all three are plausible production names.

`pad_` and `padR_` are **different functions** (doc §7.5): `pad_` is the harness's
left-aligner, `padR_` is the summary's. Renaming `pad_` to `t_pad` is what makes
that non-confusable; do not merge them.

### 2.2 B2 — split the production code into thirteen files

Plan §1.1, plus `70_Compare.gs` for `compareWorkbooks` (doc §11.3):

| File | Contents |
|---|---|
| `00_Config.gs` | `VERSION`, `OPTS`, `REF_ERROR_TOKENS`, `ALIGN_WINDOW_MAX`, `HASH_CELL_SEP`, `HASH_FORMULA`, `READ_PACE_TABS`, `READ_PACE_MS`, `CHANGE_TYPES`, `SECTION_2_TYPES` |
| `01_Types.gs` | The JSDoc `@typedef`s currently in the file header |
| `10_Values.gs` | `valuesEqual`, `normaliseValue`, `displayValue`, `errorState` |
| `11_Refs.gs` | `columnLetter`, `a1`, `headerText_` |
| `20_Align.gs` | `trimGrid`, `hashRow`, `isAnchorable`, `hashGrid`, `alignRows`, `lcsMatch_`, `resolveGap_`, `rowSimilarity_` |
| `21_Relocate.gs` | `REF_RE`, `ABS_ROW_RE`, `rewriteRefs_`, `protectStrings_`, `restoreStrings_`, `isRefBoundary_`, `formatRef_`, `relocate`, `maskUnresolvable`, `unresolvableTargets`, `isVolatile` |
| `30_DiffCell.gs` | `diffCell` — and nothing else |
| `31_DiffTab.gs` | `diffTab`, `scanErrorsUnaligned`, `headerMismatch_`, `gridWidth_`, `preview_` |
| `40_Pair.gs` | `pairTabs` |
| `50_Csv.gs` | `CSV_HEADER`, `sectionOf`, `csvField`, `toCsv`, `changeIsRoot_`, `sideIsRoot_` |
| `60_Summary.gs` | `SUMMARY_COLS`, `SUMMARY_TYPE_COL`, `buildSummary`, `summaryCell_`, `summaryNotes_`, `padR_`, `padL_`, `repeat_`, `signed_` |
| `70_Compare.gs` | `compareWorkbooks` — **pure**, and the deviation from plan §1.1 recorded in doc §11.3 |
| `90_Main.gs` | `run`, `runWith`, `readTab`, `readSheets_`, `sheetNames_`, `stamp_`, `verifyReferenceForms` — **the only impure file** |

Add `appsscript.json` verbatim from plan §1.1c, with `spreadsheets.readonly`.
Drop `script.external_request`: nothing in this build makes an external request,
and plan §1.1c lists it only so its absence is a decision.

**Three checks, all mechanical:**

| Check | Command | Must return |
|---|---|---|
| Purity boundary | grep `SpreadsheetApp\|DriveApp\|PropertiesService\|Utilities\|Session\|MimeType` outside `90_Main.gs` | nothing |
| No top-level computation | every top-level statement is a literal declaration (plan §1.1a) | true of all nine current constants |
| No duplicate globals | every function name declared once across all files | true |

> **The one load-order question this split raises, and its answer.**
> `31_DiffTab.gs` will call `sectionOf`, which lives in `50_Csv.gs` — a call
> "backwards" through the load order. **This is safe.** Function declarations
> hoist across every file in the shared scope; only top-level `const` and `let`
> initialisation is order-sensitive (plan §1.1a). `SECTION_2_TYPES` is a top-level
> const, and it lives in `00_Config.gs`, which loads first. The rule to hold is
> the one plan §1.1a states: **keep every top-level statement a declaration.**

### 2.3 B3 — split the suite into per-module test files

`98_TestLib.gs` (`t_suite`, `t_test`, the assertions, `T` state) and
`99_TestRunner.gs` (`runTests`, the registration list, `T_PLAN_TOTAL`), plus one
`.test.gs` per module. The current `T_TESTS` array becomes explicit `t_suite`
registrations, allocated by the step each test belongs to (doc §6.2):

| Test file | Tests |
|---|---|
| `10_Values.test.gs`, `30_DiffCell.test.gs` | 1–6, 9, 11, 30; '2b'–'2i' |
| `20_Align.test.gs` | 13–16, 20; '3a'–'3g' |
| `21_Relocate.test.gs` | 17, 19, 23–25, 27–29, 31; '4a'–'4e', '4z' |
| `31_DiffTab.test.gs` | 7, 12, 32; '5a'–'5f' |
| `50_Csv.test.gs` | 8, 33; '6a' |
| `40_Pair.test.gs` | 10, 21; '7a', '7b' |
| `70_Compare.test.gs` | 18, 22, 26 |
| `90_Main.test.gs` | '8a', '8b', '10a'–'10i' |

`98_TestLib.gs` also holds the fixture builders (`t_fixture`, `t_sheet`,
`t_plantG`, …), since every test file needs them.

**The failure this step introduces, and the guard §1.3 already installed.** A
test file whose suite is never registered in `99_TestRunner.gs` passes
vacuously and silently — plan §1.1 calls this out as the thing that *will*
happen on a multi-file project. The declared totals from §1.3 are the only
defence. Verify by deliberately unregistering one suite and confirming the run
goes red.

**Done when:** 74 passes, both totals asserted, golden files unchanged.

### 2.4 B4 — Script Properties and the `run` / `runWith` split

Plan §1.1f. Delete the `URL_A` / `URL_B` constants from source:

```js
function run() {
  const props = PropertiesService.getScriptProperties();
  const urlA = props.getProperty('URL_A');
  const urlB = props.getProperty('URL_B');
  if (!urlA || !urlB) throw new Error(
    'Set URL_A and URL_B in Project Settings → Script Properties.');
  return runWith(urlA, urlB, OPTS);
}
```

`runWith(urlA, urlB, opts)` is today's `run` body with the `|| URL_A` fallbacks
removed. It already takes no ambient state and already returns its counts (doc
§7.4), so this step is a rename plus a four-line wrapper.

`OPTS` **stays in source** — it is behaviour, and behaviour belongs under review.

Entry points in the dropdown, and only these: `run`, `runWith`, `runTests`,
`verifyReferenceForms`.

### 2.5 B5 — `VERSION`

`const VERSION = '1.1.0';` in `00_Config.gs`, bumped by hand. It appears in two
places:

| Place | Today | After |
|---|---|---|
| CSV filename | `changes-<yyyyMMdd-HHmm>.csv` | `changes-<yyyyMMdd-HHmm>-v<VERSION>.csv` |
| Summary head | `A:` / `B:` titles only | A `VERSION` stamp beside them |

The fixture generator already stamps `FIXTURE_VERSION` into both workbook names
(fixture doc §1). Until this lands, a CSV and the fixture pair that produced it
cannot be matched up — which matters precisely at Step 11, where a run is
compared against a checklist written for a specific fixture version.

**This changes the golden filename.** It is the one place Track B's
byte-identical rule is relaxed; the *contents* must still match.

### 2.6 B6 — commit and push

`clasp push`. Commit at each of B1–B5 separately: the value of thirteen files and
a working suite is that a regression bisects, and one squashed commit throws that
away (plan Build sequence).

**Track B done when:** 74 passes, both totals asserted, golden CSV contents
byte-identical, the purity grep returns nothing, and the sabotage matrix (doc
§6.3) reproduces all fifteen rows with the same failure sets.

---

## 3. Track A — the second CSV section

Behaviour-changing. The golden-file oracle is gone from here on; the tests in
§3.6 replace it.

### 3.1 A1 — config

In `00_Config.gs`:

```js
const SECTION_2_TYPES = new Set(['DERIVED_VALUE']);

const OPTS = {
  derivedSection:  true,   // was: includeDerived: false
  derivedCap:      5000,   // new
  expandRows:      false,
  epsilon:         1e-9,
  similarity:      0.5,
  editDistanceCap: 0.30,
  noiseWarn:       0.30
};
```

**Delete `includeDerived` rather than aliasing it.** It is not a partial
`derivedSection`: it emits `VALUE` into section 1 with no cap, which is the
merged table rule 13 forbids (doc §11.1). An alias leaves a switch in the config
that quietly produces the output the revision exists to prevent. Test '2g' tests
it today and must be rewritten, not deleted — it becomes the `derivedSection`
test.

### 3.2 A2 — `sectionOf` and the two-block `toCsv`

Build the emission layer **before** anything emits into it, so the first
`DERIVED_VALUE` row produced lands somewhere correct.

`50_Csv.gs`:

```js
function sectionOf(change) { return SECTION_2_TYPES.has(change.change) ? 2 : 1; }
```

`toCsv(changes, opts)` gains a second parameter and this layout (plan §6.1):
partition by `sectionOf`, sort each independently, join. Section 1 keeps today's
error-first sort exactly (doc §7.3). Section 2 is **workbook order only** — no
error class exists there and no severity ranking is meaningful.

Truncation, per plan §6.3: above `opts.derivedCap`, keep the first `derivedCap`
rows **in sorted order**, drop the rest, append

```
,DERIVED_TRUNCATED,,,,,<N> further derived rows suppressed — raise OPTS.derivedCap
```

Truncating after the sort is what makes the file deterministic and re-runnable —
Test 37 asserts a re-run is identical, and truncating before the sort passes a
count check while failing that.

Three properties that are easy to get almost right:

| Property | Why |
|---|---|
| Emit the section 2 block **only when it has rows** | A marker over an empty table reads as a tool bug rather than an absence of derived changes |
| `derivedSection: false` → no marker, no blank line, no second header | Test 36 asserts byte-identity with the §1.2 golden file. "Almost identical" fails it, which is the intent |
| The `#` marker is **not** passed through `csvField` | `csvField` neutralises `=`, `+`, `-`, `@` — not `#`. Quoting the marker breaks the layout (plan §6.1) |

### 3.3 A3 + A4 — the emission and the noise ratio, in one commit

**These two are a single commit. Splitting them ships a build that warns on every
well-behaved workbook.**

**A3 — `30_DiffCell.gs`, rule 5.** The derived branch only:

```js
if (fA !== '' && fB !== '' && fA === fB) {
  if (!valuesEqual(vA, vB, opts)) {
    if (ctx.volatile)        return { change: 'VOLATILE_VALUE', ... };   // UNCHANGED
    if (opts.derivedSection) return { change: 'DERIVED_VALUE',
                                      old: displayValue(vA),
                                      new: displayValue(vB) };
  }
  return null;
}
```

The `ctx.volatile` line is **already in the right place** and stays exactly as it
is (doc §11.4). Rule 14 is the plan's most-warned-about ordering and this build
satisfies it; the risk here is not implementing it but disturbing it.

`DERIVED_VALUE` carries the two **values**, not the formula — the formula is
identical by definition of reaching this branch, so printing it wastes the
column.

**A4 — `31_DiffTab.gs`, rule 15.** `stats.noise` is currently
`stats.emitted / stats.compared` (doc §11.1), and `stats.emitted` counts every
emitted cell change. Split the counter:

```js
if (sectionOf(result) === 2) stats.derived++;
else                         stats.emitted++;
stats.noise = stats.compared > 0 && (stats.emitted / stats.compared) > opts.noiseWarn;
```

`stats.derivedSuppressed` becomes `stats.derived` and keeps its consumer — the
summary needs the same number, now for a `DERIV` column rather than a
suppression line. The duplicated rule-5 condition documented as a compromise in
doc §5.2 **disappears**: the count now comes from rows that exist, not from
re-testing why a row does not.

> **Why one commit.** Ship A3 alone and every tab whose formulas recalculate
> crosses `noiseWarn`, because derived rows are a function of how connected the
> model is, not how badly it aligned (plan Step 5). A warning that fires on every
> correct run is not read when it matters — and Test 38 is the only guard, so
> until §3.6 lands there is nothing to catch it.

The edit-distance cap needs **no change**. Alignment hashes exclude formula-cell
values by construction, so recalculation cannot move a row's identity hash (plan
Step 5). This is why "improving" `hashRow` is a non-goal (§0.3).

### 3.4 A5 — the summary

`60_Summary.gs`, per plan Step 10:

| Element | Change |
|---|---|
| `SUMMARY_COLS` | Append `DERIV`, **past a rule**, after `±COL`. It runs one to three orders of magnitude larger than every column left of it, and a wide number mid-table drags the eye off the ones that need reading |
| `SUMMARY_TYPE_COL` | Map `DERIVED_VALUE` → `DERIV`. A type absent from this map is treated as structural and counts toward nothing (doc §9) |
| Totals block | Add `DERIVED: N cells recalculated with unchanged formulas (section 2).` |
| Footer | `(88 rows in section 1, 818 in section 2)` — two counts, not one. They describe very different review jobs |
| Notes | Replace `ℹ Derived values suppressed` with the plan's `ℹ Derived values` line, **plus** the `ℹ The CSV holds two tables` line warning that a plain import reads the separator, marker and second header as three data rows |
| Notes | Add `⚠ Section 2 truncated at N rows` — **above** both `ℹ` lines, because it reports loss |

The `SKIPPED` / `added` / `deleted` dash logic extends to `DERIV` unchanged: a
tab nothing compared shows `—`, not `0` (doc §5.7).

Both mandatory error lines stay exactly as they are (doc §7.5). Test '10b'
asserts them by their text and must still pass.

### 3.5 A6 — restate the four tests that now pass for the wrong reason

Before writing the new tests. Each of these is currently green and will stay
green after Track A while asserting less than its plan row claims:

| Test | Add |
|---|---|
| 4 | The downstream cells appear as `DERIVED_VALUE` **in section 2 and nowhere else** — today it asserts only that they are suppressed |
| 27 | `0 DERIVED_VALUE` alongside the existing `1 VOLATILE_VALUE` |
| 28 | The same. Plan §0.3 is explicit that 4, 27 and 28 are a three-way contrast over *identical observable state*, separated only by the volatile test |
| 33 | Both rows are in **section 1** — an error is never derived |

### 3.6 A7 — tests 34–38

| Test | Fixture | Asserts |
|---|---|---|
| 34 | Identical formulas, differing values, non-volatile | 1 `DERIVED_VALUE`; `sectionOf` returns 2; `old`/`new` hold the two values, not the formula |
| 35 | 1 `FORMULA`, 1 `REF_ERROR_NEW`, 40 `DERIVED_VALUE` | Both blocks present; section 1 holds exactly 2 rows, error first; the 40 sit **below** the blank line and repeated header; **zero `DERIVED_VALUE` above it** |
| 36 | Test 34's fixture, `derivedSection: false` | 0 rows, and the CSV is byte-identical to the §1.2 golden file |
| 37 | 25 derived rows, `derivedCap: 10` | First 10 in workbook order + 1 `DERIVED_TRUNCATED` reading 15; **section 1 untouched**; a re-run yields an identical file |
| 38 | One input change recalculates 90% of a correctly-aligned tab | **No noise warning** |

Two of these do not fail loudly, which decides how they must be written:

- **35** is satisfied by any output containing the right rows in the wrong place.
  Assert the **position** of the marker line relative to the `DERIVED_VALUE`
  rows, not merely that both exist.
- **38** is satisfied by any run that happens not to cross `noiseWarn`. Its
  fixture must recalculate enough of the tab that a section-2-counting
  implementation *certainly* trips — the fixture generator's `Cascade` tab is
  built for exactly this (fixture doc §5.2), 40 formula cells from one input.

Fixtures must clear the edit-distance cap: 16–20 rows via `t_filler` (doc §7.6).

### 3.7 A8 — extend the sabotage matrix

Five new mutations, each with its expected failure set:

| Mutation | Should fail |
|---|---|
| `sectionOf` returns 1 for everything | 34, 35 |
| `sectionOf` returns 2 for everything | 35, and every section-1 count test |
| Rule 5's two branches swapped — `derivedSection` tested before `ctx.volatile` | 27, 28 — **and nothing else.** This is rule 14, and the plan's warning is that the failure *mislabels rather than drops*, so no count looks wrong |
| Noise ratio counts section 2 | 38 alone |
| `derivedCap` truncates before sorting | 37 alone |

If any mutation fails **no** test, the corresponding test is decorative and must
be rewritten before the track is called done (doc §9).

**Track A done when:** all 38 acceptance tests and 41 local tests pass — 79 in
total — the runner asserts both declared totals, and all twenty sabotage rows
reproduce.

---

## 4. Documentation

Both documents are updated as part of the migration, not after it:

| Document | Change |
|---|---|
| *Sheets Diff Tool - Implementation Documentation.md* | §11 collapses to a short "conformance: current" note. §0's revision table loses its two "No" rows. §1.1's config block, §2's call tree, §5.2, §6.1–§6.3, §7.3, §7.5 and §10 all describe the new behaviour. **The frontmatter's `revised:` line records what changed and when** |
| *Test Fixture Generator - Implementation Documentation.md* | **Already realigned** (fixture doc frontmatter, 2026-08-22). Its §6 expectations — 41 section-1 rows, 45 section-2 rows, the `Cascade` tab, the two variant runs — become checkable for the first time at Step 11 |
| This document | Retire it once Step 11 passes. A migration plan for a completed migration is a record, not a reference; move it beside the plan or delete it |

The gap analysis in doc §11 is written to be deleted. Do not carry it forward as
history — git holds that.

---

## 5. Step 11 — once, at the end

Only after both tracks are green. Plan Step 11 now runs to ten steps; steps 8–10
concern section 2 and are unreachable before Track A (doc §1.3).

1. `generateTestWorkbooks()` from `GenerateTestWorkbooks.gs`. Note the
   `FIXTURE_VERSION` in the file names.
2. Set `URL_A` / `URL_B` in **Script Properties**. Not in source — the constants
   no longer exist (§2.4).
3. `verifyReferenceForms(URL_A)`. **This gates everything else** (doc §4.9). The
   generator breaks references deliberately, so part (b) must report `KEEPS` or
   `DROPS` — never "unverified".
4. `run()`. Confirm completion inside 6 minutes and that the filename carries
   `v1.1.0`.
5. Check against fixture doc §6: **41 rows in section 1, 45 in section 2**, the
   eight reference-error rows, and the tabs that must emit nothing.
6. The two variant runs, fixture doc §6.5 — `derivedSection: false` and
   `derivedCap: 3`.

**Three results are failures that look like successes**, and each has a cause
already located:

| Looks like | Is |
|---|---|
| Section 2 empty, section 1 at 41 | `derivedSection` never fired — rule 5 still returning `null` (fixture doc §8) |
| `Volatile!B2` / `B3` in section 2 as `DERIVED_VALUE` | Rule 14 inverted. Nothing is dropped and no count is wrong; the rows are mislabelled and buried (§3.7) |
| A noise warning on `Cascade` | The noise ratio is counting section 2 — rule 15, test 38 (§3.3) |

---

## 6. Sequence and estimate

| Step | Deliverable | Gate | Est. |
|---|---|---|---|
| 0.1 | `git init`, baseline commit, `clasp clone` | — | 15 min |
| 0.2 | Golden CSV + summary captured | — | 15 min |
| 0.3 | `runTests()` asserts declared totals | **Suite goes red at 33/38** | 20 min |
| B1 | `t_` rename | 74 pass, golden identical | 20 min |
| B2 | Thirteen files + `appsscript.json` | Purity grep empty, golden identical | 60 min |
| B3 | Per-module test files, `t_suite` registration | 74 pass, unregistered suite goes red | 60 min |
| B4 | Script Properties, `run`/`runWith` | 74 pass | 20 min |
| B5 | `VERSION` in filename and summary | Golden *contents* identical | 15 min |
| B6 | Commits, `clasp push`, sabotage matrix re-run | **All 15 rows reproduce** | 30 min |
| A1 | Config: `SECTION_2_TYPES`, `derivedSection`, `derivedCap` | — | 10 min |
| A2 | `sectionOf`, two-block `toCsv`, truncation | — | 45 min |
| A3+A4 | `DERIVED_VALUE` **and** the section-1-only noise ratio — **one commit** | — | 30 min |
| A5 | Summary: `DERIV` column, `DERIVED:` line, split footer, three notes | — | 30 min |
| A6 | Restate tests 4, 27, 28, 33 | Still green, now for the right reason | 20 min |
| A7 | Tests 34–38 | **38 + 41 = 79 pass** | 60 min |
| A8 | Five new sabotage rows | **All 20 rows reproduce** | 30 min |
| 4 | Documentation updates | — | 45 min |
| 5 | Step 11 against the fixture pair | Fixture doc §6 checklist | 45 min |

**~9½ hours.** Stage 0 is 50 minutes, Track B 3½ and changes no behaviour, Track
A 3¾ and is where the acceptance tests do their work; documentation and Step 11
are the remaining 1½.

Commit at each row. Twenty-four `.gs` files — thirteen production, nine test, two
harness — and a working suite make a regression bisect in minutes; one
squashed commit at the end throws that away for nothing.
