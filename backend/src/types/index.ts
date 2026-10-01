import { Socket } from "socket.io";
import type { RoomDifficulty } from "../config/roomDifficulty";

// ============================================
// User & Auth Types
// ============================================

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  elo: number;
}

export interface AuthenticatedSocket extends Socket {
  user: AuthUser;
}

// ============================================
// Queue Types
// ============================================

export interface QueueEntry {
  userId: string;
  socketId: string;
  username: string;
  elo: number;
  joinedAt: number;
}

// ============================================
// Match Types
// ============================================

export type MatchStatus = "pending" | "active" | "finished" | "abandoned";

/**
 * ranked: two people from the queue, rated and recorded.
 * practice: a person against a bot, unrated and not recorded.
 * friend: two people from a duel room, unrated and not recorded; the room keeps score.
 */
export type MatchMode = "ranked" | "practice" | "friend";

export interface MatchState {
  id: string;
  player1: {
    id: string;
    socketId: string;
    username: string;
    elo: number;
  };
  player2: {
    id: string;
    socketId: string;
    username: string;
    elo: number;
  };
  problemId: string;
  problemTitle: string;
  status: MatchStatus;
  winnerId: string | null;
  startedAt: number;
  finishedAt: number | null;
  mode: MatchMode;
  /** Duel room the match was started from (friend matches only) */
  roomCode?: string;
}

export interface MatchFoundPayload {
  matchId: string;
  problem: {
    id: string;
    title: string;
    description: string;
    // Codeforces rating as an integer. Was a string until migration 007; the
    // DB column is now integer so range filters compare numerically.
    difficulty: number;
    testCases: TestCase[];
  };
  opponent: {
    id: string;
    username: string;
    elo: number;
    /** Practice bot rather than a person */
    isBot?: boolean;
  };
  startTime: number;
  mode?: MatchMode;
  /** Duel room to return to for a rematch (friend matches only) */
  roomCode?: string;
}

// ============================================
// Duel Room Types
// ============================================

export interface RoomPlayer {
  id: string;
  username: string;
  elo: number;
}

/** A duel room as stored in Redis */
export interface Room {
  code: string;
  status: "open" | "closed";
  host: RoomPlayer;
  guest: RoomPlayer | null;
  hostReady: boolean;
  guestReady: boolean;
  hostWins: number;
  guestWins: number;
  /** Latest match started from this room; it may have finished */
  matchId: string | null;
  /** Problem band for the next match; the host picks it */
  difficulty: RoomDifficulty;
  /** Problems this room played recently, newest first, so rematches do not repeat */
  recentProblemIds: string[];
  createdAt: number;
}

export interface RoomSeatView extends RoomPlayer {
  /** Has the room open right now */
  online: boolean;
  ready: boolean;
  /** Rounds won against the current guest */
  wins: number;
}

/** A room as its two players see it */
export interface RoomView {
  code: string;
  status: "open" | "closed";
  host: RoomSeatView;
  guest: RoomSeatView | null;
  difficulty: RoomDifficulty;
  /** The match the two are playing right now, if any */
  activeMatchId: string | null;
}

/** What an invite link shows before anyone joins or signs in */
export interface RoomPreview {
  code: string;
  status: "open" | "closed";
  host: { username: string; online: boolean };
  guest: { username: string } | null;
  difficulty: RoomDifficulty;
}

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_CLOSED"
  | "ROOM_FULL"
  | "ROOM_ERROR";

export type RoomAck =
  | { ok: true; room: RoomView }
  | { ok: false; code: RoomErrorCode; message: string; preview?: RoomPreview };

// ============================================
// Problem & Test Case Types
// ============================================

export interface TestCase {
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
}

// Checker types for problems with multiple valid answers
export type CheckerType =
  | "exact" // Exact string match (default)
  | "special_chars" // Validates special character count
  | "any_order" // Output lines can be in any order
  | "yes_no" // Case-insensitive YES/NO check
  | "float_tolerance" // Numbers within tolerance
  | "multiline_any" // Multiple valid answers
  | "custom"; // Custom checker function

export interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  testCases: TestCase[];
  checkerType?: CheckerType; // How to validate answers (defaults to 'exact')
  checkerCode?: string; // Custom JS code for 'custom' checker type
}

// ============================================
// Submission Types
// ============================================

export interface SubmitCodePayload {
  code: string;
  languageId: number;
}

export interface SubmissionResult {
  status:
    | "accepted"
    | "wrong_answer"
    | "runtime_error"
    | "time_limit"
    | "compile_error";
  passed: number;
  total: number;
  stdout?: string;
  stderr?: string;
  time?: string;
  memory?: number;
  testResults?: TestResult[];
}

// Internal results carry stdout/expected/message for every test.
// Results sent to clients go through sanitizeSubmissionResult first, which
// strips everything but testIndex/passed/status/hidden from hidden tests.
export interface TestResult {
  testIndex: number;
  passed: boolean;
  status: string;
  hidden?: boolean;
  stdout?: string;
  expected?: string;
  message?: string; // Checker detail, may quote the expected output
  time?: string;
  memory?: number;
}

// ============================================
// Judge0 Types
// ============================================

export interface Judge0Submission {
  /** Absent for multi-file programs (language 89), which ship everything in additional_files */
  source_code?: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  memory_limit?: number;
  /**
   * Base64-encoded ZIP whose entries Judge0 extracts into the sandbox (/box).
   * Used to hand a problem checker its input/expected/submission files.
   */
  additional_files?: string;
  /** Space-separated argv passed to the program. Used to invoke checkers. */
  command_line_arguments?: string;
  compiler_options?: string;
  wall_time_limit?: number;
  stack_limit?: number;
  /** Largest file the program may write, in KB (stdout included) */
  max_file_size?: number;
}

export interface Judge0Response {
  token?: string;
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  status: {
    id: number;
    description: string;
  };
  time: string;
  memory: number;
}

// ============================================
// Socket Event Types
// ============================================

// Client -> Server Events
export interface ClientToServerEvents {
  join_queue: () => void;
  join_practice: () => void; // Start an unrated match against a bot
  leave_queue: () => void;
  submit_code: (payload: SubmitCodePayload) => void;
  forfeit: () => void;
  rejoin_match: (matchId: string) => void; // Request to rejoin an active match
  check_active_match: () => void; // Check if user has an active match

  // Duel rooms: invite a friend with a link
  create_room: (ack: (res: RoomAck) => void) => void; // Your open room, or a new one
  join_room: (code: string, ack: (res: RoomAck) => void) => void; // Take a seat and watch the room
  room_ready: (payload: { code: string; ready: boolean }) => void; // Both ready starts a match
  room_settings: (payload: { code: string; difficulty: RoomDifficulty }) => void; // Host only
  leave_room: (code: string) => void; // Guest gives up the seat; host closes the room
  unwatch_room: (code: string) => void; // Left the room page; the seat is kept
}

// Server -> Client Events
export interface ServerToClientEvents {
  queue_joined: (data: { position: number }) => void;
  queue_left: () => void;
  match_found: (data: MatchFoundPayload) => void;
  submission_result: (data: SubmissionResult) => void;
  opponent_progress: (data: {
    playerId: string;
    status: string;
    testsProgress?: string;
    /** Epoch ms by which a disconnected player must be back */
    reconnectDeadline?: number;
  }) => void;
  game_over: (data: {
    winnerId: string | null;
    reason: string;
    /** Rating points gained (+) or lost (-); only for rated, recorded matches */
    ratingChange?: number;
    newRating?: number;
    /** Practice match against a bot: unrated and not recorded */
    practice?: boolean;
    /** Friend match from a duel room: unrated and not recorded */
    friendly?: boolean;
    roomCode?: string;
    /** Rounds won in the room so far, this one included */
    score?: { you: number; opponent: number };
  }) => void;
  error: (data: { message: string; code?: string }) => void;
  active_match_found: (data: { matchId: string }) => void; // Notify client of active match
  room_update: (room: RoomView) => void;
  room_closed: (data: { code: string }) => void;
}

// Inter-Server Events (for Redis adapter)
export interface InterServerEvents {
  ping: () => void;
}

// Socket Data
export interface SocketData {
  user: AuthUser;
  currentMatchId?: string;
  /** Duel room this socket has open */
  roomCode?: string;
}

// ============================================
// Bot Types
// ============================================

export interface BotCompletionResult {
  botId: string;
  result: "success" | "failed";
  testsPassed: number;
  totalTests: number;
}

export interface BotPlayerInfo {
  id: string;
  username: string;
  stats?: {
    totalMatches: number;
    winRate: number;
  };
}

// ============================================
// Game Over Types
// ============================================

export interface GameOverPayload {
  winnerId: string;
  loserId: string;
  reason:
    | "solved"
    | "forfeit"
    | "timeout"
    | "disconnect"
    | "bot_won"
    | "bot_failed";
  matchId: string;
  duration: number;
  isBotMatch?: boolean;
}
