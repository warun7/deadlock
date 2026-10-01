/**
 * Difficulty levels a duel room can be set to, as Codeforces rating bands.
 *
 * Ranked stays capped at 1200, but about 900 judge-safe problems are rated
 * above that (backend/scripts/README.md), so friend duels can go harder.
 * The frontend mirrors this list in frontend/lib/rooms.ts.
 */
export const ROOM_DIFFICULTIES = {
  easy: { label: "Easy", minRating: 800, maxRating: 1000 },
  medium: { label: "Medium", minRating: 1100, maxRating: 1400 },
  hard: { label: "Hard", minRating: 1500, maxRating: 1900 },
  expert: { label: "Expert", minRating: 2000, maxRating: 2400 },
} as const;

export type RoomDifficulty = keyof typeof ROOM_DIFFICULTIES;

export const DEFAULT_ROOM_DIFFICULTY: RoomDifficulty = "easy";

export function isRoomDifficulty(value: unknown): value is RoomDifficulty {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROOM_DIFFICULTIES, value);
}

/** "Medium · problems rated 1100–1400", for link previews */
export function describeDifficulty(difficulty: RoomDifficulty): string {
  const d = ROOM_DIFFICULTIES[difficulty];
  return `${d.label} · problems rated ${d.minRating}–${d.maxRating}`;
}
