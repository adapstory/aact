/**
 * Hungarian / Kuhn-Munkres assignment for rectangular bipartite
 * matching. Globally-optimal replacement for the greedy
 * sort-by-score-take-first pattern previously used in
 * `detectRenames`.
 *
 * For rename detection at aact's scale (V ≤ 300, typical unmatched
 * sets ≤ 30 on each side), O(N³) is trivial — sub-millisecond. The
 * payoff is correctness on the hard case: when several plausible
 * pairings exist with overlapping scores, greedy can pick a locally
 * good but globally suboptimal assignment.
 *
 * Implementation: Jonker-Volgenant / shortest-augmenting-path Hungarian
 * for rectangular cost matrices. Rows are minimised; if rows > cols
 * the caller transposes (`hungarianMin` handles square + rows ≤ cols
 * directly).
 *
 * Cost convention: `cost[r][c]` is the price of assigning row r to
 * column c. Lower is better. Use `Number.POSITIVE_INFINITY` to
 * forbid an assignment (e.g. cross-kind elements in rename detection).
 *
 * Output: `assignment[r]` is the column index assigned to row r, or
 * `undefined` when no feasible assignment exists (row was forced to
 * an infinite-cost slot). Total cost is sum of assigned cell costs.
 */

export interface HungarianResult {
  /** `assignment[r] = c` when row r is paired with column c, or
   *  `undefined` when r could not be assigned (forbidden cell). */
  readonly assignment: ReadonlyArray<number | undefined>;
  /** Sum of assigned cell costs. Finite when every row is matched. */
  readonly totalCost: number;
}

/**
 * Solve the rectangular assignment problem. `cost` must be a
 * non-empty rectangular matrix; all rows must have the same length.
 * Returns optimal `assignment` minimising total cost.
 *
 * Algorithm: dense O(min(n,m)² · max(n,m)) ≈ O(n³) augmenting-path
 * Hungarian. For aact scale (n ≤ ~30 in practice), constant factor
 * matters less than correctness of the assignment.
 */
export const hungarian = (
  cost: readonly (readonly number[])[],
): HungarianResult => {
  const n = cost.length;
  if (n === 0) return { assignment: [], totalCost: 0 };
  const m = cost[0].length;
  if (m === 0) {
    return {
      assignment: Array.from<undefined>({ length: n }),
      totalCost: 0,
    };
  }

  // The JV algorithm wants rows ≤ cols. If we have more rows than
  // columns, transpose, solve, untranspose. We pad either way to a
  // square if needed via virtual columns with cost = +Infinity, which
  // the algorithm treats as "no real match here".
  if (n > m) {
    return hungarianTransposed(cost, n, m);
  }
  return hungarianRowsLeMin(cost, n, m);
};

/** Internal: rows ≤ cols path. */
const hungarianRowsLeMin = (
  cost: readonly (readonly number[])[],
  rowCount: number,
  colCount: number,
): HungarianResult => {
  const n = rowCount;
  const m = colCount;
  // 1-indexed arrays to match the standard textbook formulation;
  // sentinel row/col 0 holds "phantom" potentials used by the algo.
  // `u`, `v` are dual potentials. `p[j]` is the row currently
  // matched to column j (0 = unmatched). `way[j]` records the
  // augmenting-path predecessor column.
  const INF = Number.POSITIVE_INFINITY;
  const u: number[] = Array.from({ length: n + 1 }, () => 0);
  const v: number[] = Array.from({ length: m + 1 }, () => 0);
  const p: number[] = Array.from({ length: m + 1 }, () => 0);
  const way: number[] = Array.from({ length: m + 1 }, () => 0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv: number[] = Array.from({ length: m + 1 }, () => INF);
    const used: boolean[] = Array.from({ length: m + 1 }, () => false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      // No reachable next column — graph is disconnected (every
      // cell on the augmenting path is +Infinity). Bail: this row
      // can't be matched. Leave its slot at 0 (unassigned).
      if (j1 === -1 || !Number.isFinite(delta)) break;
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    // Augment along the recorded predecessor chain.
    while (j0 !== 0) {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    }
  }

  const assignment: (number | undefined)[] = Array.from<undefined>({
    length: n,
  });
  let totalCost = 0;
  for (let j = 1; j <= m; j++) {
    const row = p[j];
    if (row === 0) continue;
    const c = cost[row - 1][j - 1];
    if (!Number.isFinite(c)) continue; // forbidden cell, treat as unmatched
    assignment[row - 1] = j - 1;
    totalCost += c;
  }
  return { assignment, totalCost };
};

/** Internal: rows > cols — transpose, solve, untranspose. */
const hungarianTransposed = (
  cost: readonly (readonly number[])[],
  n: number,
  m: number,
): HungarianResult => {
  const transposed: number[][] = Array.from({ length: m }, () =>
    Array.from({ length: n }, () => 0),
  );
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < m; c++) {
      transposed[c][r] = cost[r][c];
    }
  }
  const inner = hungarianRowsLeMin(transposed, m, n);
  const assignment: (number | undefined)[] = Array.from<undefined>({
    length: n,
  });
  for (let i = 0; i < m; i++) {
    const j = inner.assignment[i];
    if (j !== undefined) assignment[j] = i;
  }
  return { assignment, totalCost: inner.totalCost };
};
