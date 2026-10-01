import { SOCKET_URL } from "./socket";

/*
  Duel rooms: challenge a friend with a link. Shapes mirror the backend
  (backend/src/types RoomView, RoomPreview, RoomAck).
*/

/** Mirror of backend/src/config/roomDifficulty.ts */
export const ROOM_DIFFICULTIES = {
  easy: { label: "Easy", minRating: 800, maxRating: 1000 },
  medium: { label: "Medium", minRating: 1100, maxRating: 1400 },
  hard: { label: "Hard", minRating: 1500, maxRating: 1900 },
  expert: { label: "Expert", minRating: 2000, maxRating: 2400 },
} as const;

export type RoomDifficulty = keyof typeof ROOM_DIFFICULTIES;

export const DIFFICULTY_ORDER: RoomDifficulty[] = ["easy", "medium", "hard", "expert"];

export const difficultyRange = (d: RoomDifficulty) =>
  `${ROOM_DIFFICULTIES[d].minRating}\u2013${ROOM_DIFFICULTIES[d].maxRating}`;

export interface RoomSeat {
  id: string;
  username: string;
  elo: number;
  /** Has the room open right now */
  online: boolean;
  ready: boolean;
  /** Rounds won against the current guest */
  wins: number;
}

export interface RoomView {
  code: string;
  status: "open" | "closed";
  host: RoomSeat;
  guest: RoomSeat | null;
  /** Problem band for the next match; the host picks it */
  difficulty: RoomDifficulty;
  /** The match the two are playing right now, if any */
  activeMatchId: string | null;
}

/** What an invite shows before the visitor joins or signs in */
export interface RoomPreview {
  code: string;
  status: "open" | "closed";
  host: { username: string; online: boolean };
  guest: { username: string } | null;
  difficulty: RoomDifficulty;
}

export interface RoomRefusal {
  ok: false;
  code: "ROOM_NOT_FOUND" | "ROOM_CLOSED" | "ROOM_FULL" | "ROOM_ERROR";
  message: string;
  preview?: RoomPreview;
}

export type RoomAck = { ok: true; room: RoomView } | RoomRefusal;

/** Narrows an ack (this project's tsconfig is not strict, so `if (res.ok)` alone does not) */
export const isRoomRefusal = (res: RoomAck): res is RoomRefusal => !res.ok;

export const roomUrl = (code: string) => `${window.location.origin}/duel/${code}`;

/** Null when the room does not exist (or expired); throws when the server is unreachable */
export async function fetchRoomPreview(code: string): Promise<RoomPreview | null> {
  const res = await fetch(`${SOCKET_URL}/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Room preview failed: ${res.status}`);
  return res.json();
}
