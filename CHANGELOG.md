# Changelog

Notable changes to the Sheets Diff Tool. The version lives in `VERSION` in
[`src/00_Config.gs`](src/00_Config.gs), is bumped by hand at the commit that
changes behaviour, and is stamped into both the CSV filename and the summary head
so an output file can be attributed to a build.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-08-31

**The comparison basis changes for the first time**, and in both cases because
the tool was under-reporting: one reference form was never relocated, and one
kind of authored edit was invisible to every pass in the build.

87 tests pass — the 79 that existed are **unchanged and green**, which is the
regression gate for both changes. The sabotage matrix runs to 24 rows, all
caught, none decorative.

### Fixed

- **`REF_RE` now matches whole-row and whole-column references.** The literal
  `R` and the literal `C` were both mandatory, so `Rates!R4` (`=SUM(Rates!$4:$4)`)
  and `Rates!C2` (`=SUM(Rates!$B:$B)`) matched nothing at all. Two bugs followed,
  and only the first is the obvious one:
  - a whole-**row** reference carries an **absolute row that was never
    relocated**, so inserting a row above it reported a `FORMULA` nobody authored;
  - a whole-**column** reference has no row to relocate — which is why it looked
    harmless — but still carries a **sheet name that `tabMap` never reached**, so
    renaming a tab reported a `FORMULA` on every one of them.

  `formatRef_` now takes the reference's `form` and re-emits it, because emitting
  `R4C` for a whole-row reference corrupts it silently. `isRefBoundary_` is
  unchanged but now guards a much wider class: the shortest possible match went
  from `RC` to `R4`.

### Added

- **`NAME_REDEFINED`** — the first new change type since the taxonomy was
  written. A defined name repointed from `Rates!$B$4` to `Rates!$B$9` leaves
  **every formula byte-identical in both files** while the numbers move; no other
  pass in this build can see it.
  - `src/41_Names.gs`, a workbook-level pass that runs **after alignment**, so a
    definition is relocated before it is compared. Without that ordering, every
    name below an inserted row reports as redefined.
  - Reports **redefinition only**. A deleted name surfaces as `#NAME?` through the
    error scan, and an added one changes nothing until it is used.
  - `readNames_` in `src/90_Main.gs` reads them via `getNamedRanges()`, which
    `spreadsheets.readonly` already covers — **no manifest change**.
- `sheetPrefix_` (`src/11_Refs.gs`) — one source of truth for sheet-name quoting,
  now shared by the R1C1 and A1 renderers.
- `tools/dryrun.js` stubs `getNamedRanges()` and drives the new pass end to end:
  one name explained by the row map (**must stay silent**), one genuinely
  repointed (**must report**), and one whose `getRange()` throws (**must be
  skipped, not fatal**). That third branch has no other coverage — the suite
  cannot reach `90_Main.gs` at all, which is how the first version of this
  change shipped a `TypeError` that 87 green tests could not see.
- Fixture generator: a `Whole Range` tab holding both new reference forms, each
  pointed at the mutation that exposes it. **Both must emit nothing**, so a
  regression adds a row rather than changing one. `FIXTURE_VERSION` is `1.2.0`.

## [Unreleased]

Repository layout only — **no behaviour change**, and all 79 tests plus the
twenty-row sabotage matrix reproduce unchanged.

### Changed

- Source moved to `src/`, harness scripts to `tools/`, documentation to `docs/`.
  The three harnesses now resolve `src/` from their own `__dirname`, so they run
  correctly from any working directory.
- **`GenerateTestWorkbooks.gs` moved to its own `fixtures/` directory with its own
  manifest.** It is a separate Apps Script project and always was: it *creates*
  spreadsheets, so its scopes are read-write — the opposite of the tool's. Sitting
  in the same directory, a single `clasp push` would have uploaded write-scoped
  code into the project whose manifest promises `spreadsheets.readonly`. Two
  directories are two `rootDir` values and therefore two projects.
- The harnesses no longer carry an exclusion list. `src/` is exactly what gets
  pushed, so "what the harness loads" and "what Apps Script loads" are now the
  same set by construction rather than by two filters agreeing.

### Added

- `README.md`, `LICENSE` (Apache 2.0), this changelog, and `.clasp.json.example`.
- `fixtures/appsscript.json` — the read-write manifest the fixture documentation
  had specified since 2026-08-22 but which had never been checked in.

### Fixed

- Documented file counts. The docs said twenty-three `.gs` files (thirteen
  production, two harness, eight test); there are twenty-four — the test count is
  nine.

## [1.1.0] — 2026-08-22

### Added

- **`DERIVED_VALUE` and a second CSV section.** Cells whose formula is identical
  in both files and whose value changed are no longer suppressed — they are
  emitted into a second table below the first, capped at `derivedCap`. Before
  this, a downstream tab whose numbers moved produced nothing but a count in the
  summary.
- `sectionOf()`, which computes section membership from the change type. It is
  never stored on a `Change`; a `section` field would be a second source of truth
  that nothing enforces.
- `derivedSection` and `derivedCap` options.
- **Multi-file layout** — twenty-four `.gs` files with numeric load-order
  prefixes, replacing a single 3,524-line `SheetsDiff.gs`. `00_Config.gs` loads
  first and holds every tunable; `90_Main.gs` loads last and is the only file that
  touches a Google service, which makes the purity boundary checkable with one
  `grep`.
- Per-module test files, so a failing test names the file that broke.
- Checked-in `appsscript.json` with explicit `oauthScopes`. The read-only
  guarantee becomes a platform constraint rather than a promise the code makes
  about itself.
- `VERSION`, stamped into the CSV filename and summary head.
- `tools/dryrun.js` — stubs all six Google globals and drives `runWith()` end to
  end, asserting the scope boundary mechanically.

### Changed

- **Spreadsheet URLs moved out of source into Script Properties** (`URL_A`,
  `URL_B`). No document id in version control, and the checked-in default is no
  longer "whatever was last compared". `OPTS` deliberately stays in source: it is
  behaviour, and behaviour belongs under review.

### Removed

- **The `includeDerived` switch, deleted rather than aliased.** It emitted `VALUE`
  into section 1 with no cap — the merged table that rule 13 exists to forbid. An
  alias would have left a config key that quietly produces the output the revision
  exists to prevent.

## [1.0.0] — 2026-08-22

Baseline. The tool as originally specified, as a single unversioned
`SheetsDiff.gs`: 33 acceptance tests, twelve rules, one CSV table. Committed as a
starting point for the v1.1.0 migration, together with the fixture generator and
both implementation documents.

---

**Not yet released against a live spreadsheet.** No version above has been run
end to end against two real files. See "Known gaps" in the [README](README.md).
