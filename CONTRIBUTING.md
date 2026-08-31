# Contributing

The full procedure for extending the tool is
[docs/implementation.md](docs/implementation.md) §9. This page is the short
version: the rules that are not guessable from the code, and that break things
quietly when broken.

## Before you change anything

```bash
node tools/runner.js   out.txt        # expect: 79 passed, 0 failed
node tools/sabotage.js sabotage.txt   # expect: 20 caught, 0 caught by nothing
node tools/dryrun.js   dryrun.txt
```

Run from the repository root. If the baseline is not green, fix that first — a
green suite is the only thing standing between a change and a silently wrong diff.

## The four rules

**1. File names are the load order.** Apps Script sorts files by name, and while
function declarations hoist across the whole shared scope, top-level `const`
initialisation runs in file order. Renaming a file, or adding one whose prefix
puts it in the wrong place, can leave a constant reading `undefined` with no error
anywhere. `00_Config.gs` loads first and every statement in it must be a literal
declaration — never a value computed from another global.

**2. Nothing outside `src/90_Main.gs` may touch a Google service.** This must
name that file and nothing else:

```bash
grep -l 'SpreadsheetApp\|DriveApp\|PropertiesService\|Utilities\|Session\|MimeType' src/*.gs
```

This must name `src/90_Main.gs` **and nothing else** — including from a comment.
A comment that merely mentions one of these globals joins the grep's output and
costs it its precision, so prose elsewhere spells them around: see the note in
`src/01_Types.gs`.

The property it protects is that `runTests()` raises **no authorisation prompt**,
which is what lets 87 tests run on in-memory fixtures. No test can catch a
violation, because the suite never runs inside Apps Script. The grep is the whole
defence.

**3. Nothing may write to either source spreadsheet.** `tools/dryrun.js` enforces
this: every stub sheet is a `Proxy` that throws on any method but `getName` and
`getDataRange`. If your change reaches for a setter, that harness is where you
want to find out.

**4. A new test is not done until a mutation proves it bites.** Add the
corresponding row to `tools/sabotage.js` and confirm the test goes red. A test no
mutation can break is decorative, and the matrix exists to say so out loud —
currently eight mutations are caught by exactly one test each, and that number is
what to watch after a refactor.

## Adding a change type

The taxonomy is written down once, and adding to it means touching every place
that enumerates it:

1. `CHANGE_TYPES` in `src/00_Config.gs`
2. `SUMMARY_TYPE_COL` in `src/60_Summary.gs`
3. If it is an error type: `toCsv`'s rank map and `buildSummary`'s error tally
4. `sectionOf` in `src/50_Csv.gs` if it belongs in section 2

## Versioning

`VERSION` in `src/00_Config.gs` is bumped **by hand, at the commit that changes
behaviour** — not at release time. It is stamped into the CSV filename and the
summary head, so an output file someone brings back months later can be attributed
to a build. Record the change in [CHANGELOG.md](CHANGELOG.md).

## Documentation

`docs/implementation.md` describes shipped code. If a change makes a section of it
untrue, the change is not finished. Its frontmatter `revised:` line records what
changed and when.

`docs/migration-v1.1.0.md` is a historical record of an executed migration — do
not update it to match new work.
