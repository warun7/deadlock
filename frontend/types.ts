import React from 'react';

declare global {
  interface Window {
    google?: any;
  }
}

export interface Feature {
  title: string;
  description: string;
  icon: React.ReactNode;
}

export interface CardProps {
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Nightmare';
  ratingChange?: number; // E.g., +25
  description: string;
  tags: string[];
  codeSnippet?: string;
  players?: number;
}

export type GameState = 'idle' | 'searching' | 'found' | 'playing';

export interface Problem {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Nightmare';
  description: string;
  examples: {
    input: string;
    output: string;
    explanation?: string;
  }[];
  starterCode: string;
}

export interface Judge0Response {
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

export interface MatchFoundPayload {
  matchId: string;
  problem: {
    id: string;
    title: string;
    description: string;
    difficulty: string;
    testCases: Array<{
      input: string;
      expectedOutput: string;
      isHidden?: boolean;
    }>;
  };
  opponent: {
    id: string;
    username: string;
    elo: number;
    /** Practice bot rather than a person */
    isBot?: boolean;
  };
  startTime: number;
  mode?: "ranked" | "practice" | "friend";
  /** Duel room to go back to for a rematch (friend duels only) */
  roomCode?: string;
}
