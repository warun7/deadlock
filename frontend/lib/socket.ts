import { io, Socket } from 'socket.io-client';
import { supabase } from './supabase';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

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

  leaveQueue() {
    if (!this.socket?.connected) return;
    console.log('Leaving queue...');
    this.socket.emit('leave_queue');
  }

  // Game methods
  submitCode(code: string, languageId: number) {
    if (!this.socket?.connected) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('submit_code', { code, languageId });
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

  // Event listeners
  on(event: string, callback: (...args: any[]) => void) {
    this.socket?.on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void) {
    this.socket?.off(event, callback);
  }
}

export const gameSocket = new GameSocket();
