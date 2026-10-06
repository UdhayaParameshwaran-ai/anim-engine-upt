/** Levenshtein distance, capped early once it exceeds `max`. */
export function distance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * The single closest candidate within `max` edits (case-insensitive), or
 * undefined if there is none or the best match is ambiguous. Ambiguity
 * matters: auto-fixing to a coin-flip choice would hide a real mistake.
 */
export function closest(word: string, candidates: Iterable<string>, max = 2): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestD = max + 1;
  let tie = false;
  for (const c of candidates) {
    const d = distance(w, c.toLowerCase(), max);
    if (d < bestD) {
      best = c;
      bestD = d;
      tie = false;
    } else if (d === bestD && c !== best) {
      tie = true;
    }
  }
  return bestD <= max && !tie ? best : undefined;
}
