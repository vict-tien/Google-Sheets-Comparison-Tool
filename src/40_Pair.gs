/**
 * ============================================================================
 * 40_Pair.gs — matching A's tabs to B's, by name alone
 * ============================================================================
 *
 * Pure and deterministic over the two name lists, which is what lets 90_Main.gs
 * call it once to decide what is worth reading and 70_Compare.gs call it again
 * to decide what to compare, without the two ever disagreeing.
 */

/**
 * Plan Step 7. Pairs A's tabs to B's by name.
 *
 *   1. exact name match
 *   2. normalised match on what remains -> pair, and emit TAB_RENAMED
 *   3. unmatched in A -> TAB_DELETED;  unmatched in B -> TAB_ADDED
 *
 * Returns { tabMap, pairs, added, deleted, changes, warnings }. `tabMap` is the
 * { aTabName: bTabName } map Step 4d consumes to relocate sheet names; `pairs`
 * drives Step 9's two phases.
 *
 * Normalisation is lowercase with punctuation and whitespace stripped, and
 * NOTHING else. It will not pair "Rates" with "Rates v2" — a version suffix is
 * a different name under this rule, and those two tabs are reported as one
 * TAB_DELETED plus one TAB_ADDED. That is the plan's rule working as specified:
 * a wrong pairing generates a full-tab phantom diff, so it never guesses.
 *
 * If two A tabs normalise to the same string, both are withdrawn from
 * normalised matching and a warning is recorded — same on the B side.
 */
function pairTabs(namesA, namesB) {
  const tabMap = {}, pairs = [], added = [], deleted = [];
  const changes = [], warnings = [];

  const takenB = {};
  const leftA = [];

  // 1. exact
  for (let i = 0; i < namesA.length; i++) {
    const a = namesA[i];
    if (namesB.indexOf(a) !== -1 && !takenB[a]) {
      tabMap[a] = a; pairs.push([a, a]); takenB[a] = true;
    } else {
      leftA.push(a);
    }
  }
  const leftB = namesB.filter(function (b) { return !takenB[b]; });

  // 2. normalised, on the remainder only
  const norm = function (s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const bucket = function (names) {
    const m = {};
    for (let i = 0; i < names.length; i++) {
      const k = norm(names[i]);
      (m[k] = m[k] || []).push(names[i]);
    }
    return m;
  };
  const bA = bucket(leftA), bB = bucket(leftB);
  const pairedA = {}, pairedB = {};

  Object.keys(bA).forEach(function (k) {
    if (!bB[k]) return;
    if (bA[k].length > 1 || bB[k].length > 1) {
      warnings.push('ambiguous tab name normalisation "' + k + '": [' +
                    bA[k].join(', ') + '] vs [' + bB[k].join(', ') +
                    '] — left unpaired rather than guessed');
      return;
    }
    const a = bA[k][0], b = bB[k][0];
    tabMap[a] = b; pairs.push([a, b]);
    pairedA[a] = true; pairedB[b] = true;
    changes.push({ tab: a, change: 'TAB_RENAMED', aRef: '', bRef: '',
                   column: '', old: a, new: b });
  });

  // 3. leftovers
  for (let i = 0; i < leftA.length; i++) {
    if (pairedA[leftA[i]]) continue;
    deleted.push(leftA[i]);
    changes.push({ tab: leftA[i], change: 'TAB_DELETED', aRef: '', bRef: '',
                   column: '', old: leftA[i], new: '' });
  }
  for (let i = 0; i < leftB.length; i++) {
    if (pairedB[leftB[i]]) continue;
    added.push(leftB[i]);
    changes.push({ tab: leftB[i], change: 'TAB_ADDED', aRef: '', bRef: '',
                   column: '', old: '', new: leftB[i] });
  }

  return { tabMap: tabMap, pairs: pairs, added: added, deleted: deleted,
           changes: changes, warnings: warnings };
}
