import { io, Socket } from 'socket.io-client';
import { supabase } from './supabase';
import type { RoomAck, RoomDifficulty } from './rooms';
import type { SubmissionTelemetry } from '../components/arena/fairPlay';

export type FairPlayEvent =
  | { kind: 'away' }
  | { kind: 'back' }
  | { kind: 'paste_blocked'; chars: number }
  | { kind: 'drop_blocked'; chars: number }
  | { kind: 'bulk_blocked'; chars: number }
  | { kind: 'copy_blocked' };

export type ReportReason = 'outside_help' | 'other';
export type ReportAck = { ok: true } | { ok: false; message: string };

// The game server; it also serves the few REST endpoints (room previews)
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

class GameSocket {
  private socket: Socket | null = null;

  private bindCoreListeners(socket: Socket) {
    socket.on('connect', () => {
      console.log('✅ Socket connected:', socket.id);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });
  }

  connect(token: string) {
    if (this.socket) {

      if (this.socket.connected) {
        console.log('Socket already connected');
      } else {
        console.log('Reconnecting to socket:', SOCKET_URL);
        this.socket.connect();
      }

      return this.socket;
    }

    console.log('Connecting to socket:', SOCKET_URL);

    this.socket = io(SOCKET_URL, {
      // Read the session on every (re)connect: Supabase refreshes access
      // tokens hourly, and a reconnect with an expired one would be refused.
      auth: (cb) => {
        supabase.auth
          .getSession()
          .then(({ data }) => cb({ token: data.session?.access_token ?? token }))
          .catch(() => cb({ token }));
      },
      transports: ['websocket', 'polling'],
      // Keep trying: the server holds an active match for 45s while a player
      // is away, and a laptop waking up can take longer than a few attempts.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      autoConnect: false,
    });
    this.bindCoreListeners(this.socket);
    this.socket.connect();

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket() {
    return this.socket;
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  // Matchmaking methods
  joinQueue() {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected');
    }
    console.log('Joining queue...');
    this.socket.emit('join_queue');
  }

  // Unrated match against a bot, started right away
  startPractice() {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('join_practice');
  }

  leaveQueue() {
    if (!this.socket?.connected) return;
    console.log('Leaving queue...');
    this.socket.emit('leave_queue');
  }

  // Game methods
  submitCode(code: string, languageId: number, telemetry?: SubmissionTelemetry) {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('submit_code', telemetry ? { code, languageId, telemetry } : { code, languageId });
  }

  // Fair play: what the arena blocked, and leaving or returning to the tab
  sendFairPlay(event: FairPlayEvent) {
    this.socket?.emit('fair_play', event);
  }

  // After a ranked match
  reportPlayer(matchId: string, reason: ReportReason, note: string): Promise<ReportAck> {
    if (!this.socket?.connected) {
      return Promise.reject(new Error('Socket not connected'));
    }
    return this.socket.timeout(8000).emitWithAck('report_player', { matchId, reason, note });
  }

  forfeit() {
    if (!this.socket?.connected) return;
    this.socket.emit('forfeit');
  }

  rejoinMatch(matchId: string) {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected');
    }
    console.log('Requesting rejoin for match:', matchId);
    this.socket.emit('rejoin_match', matchId);
  }

  // Duel rooms. Opening and joining answer through an acknowledgement.
  createRoom(): Promise<RoomAck> {
    return this.request('create_room');
  }

  joinRoom(code: string): Promise<RoomAck> {
    return this.request('join_room', code);
  }

  setRoomReady(code: string, ready: boolean) {
    this.socket?.emit('room_ready', { code, ready });
  }

  // Host only. Clears both ready flags.
  setRoomDifficulty(code: string, difficulty: RoomDifficulty) {
    this.socket?.emit('room_settings', { code, difficulty });
  }

  // Guest: give up the seat. Host: close the room.
  leaveRoom(code: string) {
    this.socket?.emit('leave_room', code);
  }

  // Left the room page; the seat is kept
  unwatchRoom(code: string) {
    if (!this.socket?.connected) return;
    this.socket.emit('unwatch_room', code);
  }

  private request(event: string, ...args: unknown[]): Promise<RoomAck> {
    if (!this.socket?.connected) {
      return Promise.reject(new Error('Socket not connected'));
    }
    return this.socket.timeout(8000).emitWithAck(event, ...args);
  }

  // Event listeners
  on(event: string, callback: (...args: any[]) => void) {
    this.socket?.on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void) {
    this.socket?.off(event, callback);
  }
}

export const gameSocket = new GameSocket();
