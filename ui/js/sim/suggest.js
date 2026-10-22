// "did you mean ...?": the closest known name to a misspelt one.

/** Edit distance between two strings (insert, delete, change one letter). */
export function distance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * The best suggestion for a misspelt name, or null.
 * A difference only in capitals always counts (digitalwrite → digitalWrite).
 * @param {string} name
 * @param {Iterable<string>} candidates
 */
export function suggest(name, candidates) {
  const lower = name.toLowerCase();
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    if (!c || c === name || c.startsWith("__")) continue;
    if (c.toLowerCase() === lower) return c;
    const d = distance(name, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  const limit = Math.max(1, Math.floor((name.length + 2) / 4));
  return bestD <= limit ? best : null;
}
