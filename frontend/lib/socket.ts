import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

class GameSocket {
  private socket: Socket | null = null;

  connect(token: string) {
    if (this.socket?.connected) {
      console.log('Socket already connected');
      return this.socket;
    }

    console.log('Connecting to socket:', SOCKET_URL);

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('✅ Socket connected:', this.socket?.id);
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

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
