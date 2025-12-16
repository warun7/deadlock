import { Socket } from 'socket.io';

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

export type MatchStatus = 'pending' | 'active' | 'finished' | 'abandoned';

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
}

export interface MatchFoundPayload {
  matchId: string;
  problem: {
    id: string;
    title: string;
    description: string;
    difficulty: string;
    testCases: TestCase[];
  };
  opponent: {
    id: string;
    username: string;
    elo: number;
  };
  startTime: number;
}

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
  | 'exact'           // Exact string match (default)
  | 'special_chars'   // Validates special character count
  | 'any_order'       // Output lines can be in any order  
  | 'yes_no'          // Case-insensitive YES/NO check
  | 'float_tolerance' // Numbers within tolerance
  | 'multiline_any'   // Multiple valid answers
  | 'custom';         // Custom checker function

export interface Problem {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  testCases: TestCase[];
  checkerType?: CheckerType;  // How to validate answers (defaults to 'exact')
  checkerCode?: string;       // Custom JS code for 'custom' checker type
}

// ============================================
// Submission Types
// ============================================

export interface SubmitCodePayload {
  code: string;
  languageId: number;
}

export interface SubmissionResult {
  status: 'accepted' | 'wrong_answer' | 'runtime_error' | 'time_limit' | 'compile_error';
  passed: number;
  total: number;
  stdout?: string;
  stderr?: string;
  time?: string;
  memory?: number;
  testResults?: TestResult[];
}

export interface TestResult {
  testIndex: number;
  passed: boolean;
  status: string;
  stdout?: string;
  expected?: string;
  time?: string;
  memory?: number;
}

// ============================================
// Judge0 Types
// ============================================

export interface Judge0Submission {
  source_code: string;
  language_id: number;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  memory_limit?: number;
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
  leave_queue: () => void;
  submit_code: (payload: SubmitCodePayload) => void;
  forfeit: () => void;
  rejoin_match: (matchId: string) => void;  // Request to rejoin an active match
}

// Server -> Client Events
export interface ServerToClientEvents {
  queue_joined: (data: { position: number }) => void;
  queue_left: () => void;
  match_found: (data: MatchFoundPayload) => void;
  submission_result: (data: SubmissionResult) => void;
  opponent_progress: (data: { playerId: string; status: string; testsProgress?: string }) => void;
  game_over: (data: { winnerId: string | null; reason: string; newElo?: number }) => void;
  error: (data: { message: string; code?: string }) => void;
}

// Inter-Server Events (for Redis adapter)
export interface InterServerEvents {
  ping: () => void;
}

// Socket Data
export interface SocketData {
  user: AuthUser;
  currentMatchId?: string;
}

// ============================================
// Game Over Types
// ============================================

export interface GameOverPayload {
  winnerId: string;
  loserId: string;
  reason: 'solved' | 'forfeit' | 'timeout' | 'disconnect';
  matchId: string;
  duration: number;
}


