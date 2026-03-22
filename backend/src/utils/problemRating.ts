/** Supabase may return difficulty as text or (after migration) integer. */
export function normalizeProblemRating(value: unknown): string {
  if (value === null || value === undefined) return "1000";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  const s = String(value).trim();
  return s.length > 0 ? s : "1000";
}

/** Integer rating for filtering; avoids lexicographic comparisons on text columns. */
export function difficultyRatingAsInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;

  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
