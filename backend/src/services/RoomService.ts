import { randomInt } from "crypto";
import { Server as SocketServer } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { redisService } from "./RedisService";
import { isRoomDifficulty, ROOM_DIFFICULTIES } from "../config/roomDifficulty";
import type { MatchmakingService } from "./MatchmakingService";
import {
  AuthenticatedSocket,
  ClientToServerEvents,
  ServerToClientEvents,
  Room,
  RoomAck,
  RoomPlayer,
  RoomPreview,
  RoomSeatView,
  RoomView,
} from "../types";

// No 0/O or 1/I/L: codes get read out loud and typed on phones
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** Uppercased room code, or null if it cannot be one */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Socket.IO room for everyone who has a duel room open */
const channel = (code: string) => `room:${code}`;

// Enough to keep a session of rematches from repeating a problem
const RECENT_PROBLEMS_KEPT = 15;

const NOT_FOUND: RoomAck = {
  ok: false,
  code: "ROOM_NOT_FOUND",
  message: "This invite has expired or the link is wrong.",
};

/**
 * RoomService - duel rooms: challenge a friend with a link, no queue.
 *
 * A host opens a room and shares its link; the first person to open it takes
 * the guest seat and keeps it until they leave. When both players are ready a
 * friend match starts. Friend matches are unrated and not recorded; the room
 * keeps a running score instead, so the two can rematch from the same link.
 *
 * Rooms live in Redis, so links and scores survive a backend restart. Who is
 * in the room right now is not stored: it is whoever has a socket in the
 * room's Socket.IO channel. A ready flag only counts while its player is there.
 */
export class RoomService {
  private io: SocketServer<ClientToServerEvents, ServerToClientEvents>;
  private matchmakingService: MatchmakingService | null = null;

  constructor(io: SocketServer<ClientToServerEvents, ServerToClientEvents>) {
    this.io = io;
  }

  setMatchmakingService(matchmakingService: MatchmakingService): void {
    this.matchmakingService = matchmakingService;
  }

  /** Open the host's room: their current one if it is still open, else a new one */
  async createRoom(socket: AuthenticatedSocket): Promise<RoomAck> {
    const user = socket.user;

    const existing = await redisService.getUserRoomCode(user.id, "room_create_get_user_room");
    if (existing) {
      const ack = await this.joinRoom(socket, existing);
      if (ack.ok) return ack;
    }

    const host: RoomPlayer = { id: user.id, username: user.username, elo: user.elo };
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode();
      if (await redisService.createRoom(code, host)) {
        await redisService.setUserRoomCode(user.id, code);
        console.log(`🚪 ${user.username} opened duel room ${code}`);
        return this.joinRoom(socket, code);
      }
    }
    return { ok: false, code: "ROOM_ERROR", message: "Could not open a room. Try again." };
  }

  /** Take (or retake) a seat and start receiving room updates */
  async joinRoom(socket: AuthenticatedSocket, rawCode: unknown): Promise<RoomAck> {
    const code = normalizeRoomCode(rawCode);
    if (!code) return NOT_FOUND;
    const user = socket.user;

    const seat = await redisService.claimRoomSeat(code, {
      id: user.id,
      username: user.username,
      elo: user.elo,
    });
    if (seat === "missing") return NOT_FOUND;
    if (seat === "closed") {
      return { ok: false, code: "ROOM_CLOSED", message: "The host closed this room." };
    }
    if (seat === "full") {
      return {
        ok: false,
        code: "ROOM_FULL",
        message: "This room already has two players.",
        preview: (await this.getPreview(code)) ?? undefined,
      };
    }
    if (seat === "host") await redisService.setUserRoomCode(user.id, code);

    // One room open per socket
    if (socket.data.roomCode && socket.data.roomCode !== code) {
      await this.unwatchRoom(socket, socket.data.roomCode);
    }
    socket.join(channel(code));
    socket.data.roomCode = code;

    const room = await redisService.getRoom(code, "room_join_read");
    if (!room) return NOT_FOUND;
    const view = await this.toView(room);
    socket.to(channel(code)).emit("room_update", view);
    console.log(`🚪 ${user.username} is in room ${code} (${seat})`);
    return { ok: true, room: view };
  }

  /** Ready or not. When both players are ready and here, the match starts. */
  async setReady(socket: AuthenticatedSocket, rawCode: unknown, ready: boolean): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (!code || socket.data.roomCode !== code) {
      socket.emit("error", { message: "Open the room first.", code: "NOT_IN_ROOM" });
      return;
    }

    const room = await redisService.getRoom(code, "room_ready_read");
    if (!room || room.status !== "open") {
      socket.emit("error", { message: "This room is closed.", code: "ROOM_CLOSED" });
      return;
    }
    const seat = this.seatOf(room, socket.user.id);
    if (!seat) {
      socket.emit("error", { message: "You are not in this room.", code: "NOT_IN_ROOM" });
      return;
    }
    if (ready && (await this.activeMatchId(room))) {
      socket.emit("error", { message: "Your duel is still running.", code: "ROOM_BUSY" });
      return;
    }

    await redisService.setRoomReady(code, seat, ready);
    if (ready) await this.tryStart(code);
    await this.broadcast(code);
  }

  /**
   * The host sets the problem band for the next match. Both ready flags are
   * cleared, so nobody starts a match at a level they did not agree to.
   */
  async setDifficulty(socket: AuthenticatedSocket, rawCode: unknown, difficulty: unknown): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (!code || socket.data.roomCode !== code) {
      socket.emit("error", { message: "Open the room first.", code: "NOT_IN_ROOM" });
      return;
    }
    if (!isRoomDifficulty(difficulty)) return;

    const room = await redisService.getRoom(code, "room_settings_read");
    if (!room || room.status !== "open") {
      socket.emit("error", { message: "This room is closed.", code: "ROOM_CLOSED" });
      return;
    }
    if (room.host.id !== socket.user.id) {
      socket.emit("error", { message: "Only the host can change the difficulty.", code: "NOT_ROOM_HOST" });
      return;
    }
    if (room.difficulty === difficulty) return;

    await redisService.updateRoom(code, { difficulty, host_ready: "0", guest_ready: "0" }, "room_set_difficulty");
    console.log(`🚪 Room ${code} difficulty: ${difficulty}`);
    await this.broadcast(code);
  }

  /** The guest gives up their seat; the host closes the room */
  async leaveRoom(socket: AuthenticatedSocket, rawCode: unknown): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (!code) return;
    const user = socket.user;
    const room = await redisService.getRoom(code, "room_leave_read");
    if (!room) return;

    if (room.host.id === user.id) {
      await redisService.closeRoom(code, user.id);
      this.io.to(channel(code)).emit("room_closed", { code });
      for (const s of this.socketsIn(code)) this.stopWatching(s, code);
      console.log(`🚪 ${user.username} closed room ${code}`);
      return;
    }

    if (room.guest?.id === user.id) {
      await redisService.clearRoomGuest(code, user.id);
      for (const s of this.socketsIn(code, user.id)) this.stopWatching(s, code);
      console.log(`🚪 ${user.username} left room ${code}`);
      await this.broadcast(code);
    }
  }

  /** Left the room page. The seat is kept; the ready flag is not. */
  async unwatchRoom(socket: AuthenticatedSocket, rawCode: unknown): Promise<void> {
    const code = normalizeRoomCode(rawCode);
    if (!code) return;
    this.stopWatching(socket, code);
    await this.afterPresenceLoss(code, socket.user.id);
  }

  /** The socket is gone; Socket.IO has already taken it out of the channel */
  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const code = socket.data.roomCode;
    if (!code) return;
    await this.afterPresenceLoss(code, socket.user.id);
  }

  /**
   * Count the winner's round. Returns each player's wins in this room, or
   * null if the match no longer belongs to the room's current pair.
   */
  async recordWin(code: string, matchId: string, winnerId: string): Promise<Map<string, number> | null> {
    const wins = await redisService.recordRoomWin(code, matchId, winnerId);
    if (!wins) return null;
    const room = await redisService.getRoom(code, "room_record_win_read");
    if (!room?.guest) return null;
    await this.broadcastRoom(room);
    return new Map([
      [room.host.id, room.hostWins],
      [room.guest.id, room.guestWins],
    ]);
  }

  /** What an invite link shows to someone who has not joined (or signed in) */
  async getPreview(rawCode: unknown): Promise<RoomPreview | null> {
    const code = normalizeRoomCode(rawCode);
    if (!code) return null;
    const room = await redisService.getRoom(code, "room_preview_read");
    if (!room) return null;
    return {
      code,
      status: room.status,
      host: { username: room.host.username, online: this.socketsIn(code, room.host.id).length > 0 },
      guest: room.guest ? { username: room.guest.username } : null,
      difficulty: room.difficulty,
    };
  }

  // ============================================
  // Internals
  // ============================================

  private async tryStart(code: string): Promise<void> {
    const room = await redisService.getRoom(code, "room_start_read");
    if (!room || room.status !== "open" || !room.guest || !room.hostReady || !room.guestReady) return;

    const hostSockets = this.socketsIn(code, room.host.id);
    const guestSockets = this.socketsIn(code, room.guest.id);
    if (hostSockets.length === 0 || guestSockets.length === 0) return;

    // Neither player may be in another live match (ranked or practice in another tab)
    for (const player of [room.host, room.guest]) {
      if (await this.isInActiveMatch(player.id)) {
        await redisService.setRoomReady(code, player.id === room.host.id ? "host" : "guest", false);
        this.io.to(channel(code)).emit("error", {
          message: `${player.username} is still in another match.`,
          code: "PLAYER_BUSY",
        });
        return;
      }
    }

    const matchId = uuidv4();
    // Both players can press ready at the same moment; only one start wins
    if (!(await redisService.claimRoomStart(code, room.host.id, room.guest.id, matchId))) return;

    const problemId = await this.matchmakingService?.startFriendMatch({
      matchId,
      roomCode: code,
      host: room.host,
      hostSockets,
      guest: room.guest,
      guestSockets,
      difficulty: room.difficulty,
      excludeProblemIds: room.recentProblemIds,
    });
    if (!problemId) {
      this.io.to(channel(code)).emit("error", {
        message: `Could not find a ${ROOM_DIFFICULTIES[room.difficulty].label.toLowerCase()} problem. Press ready to try again, or pick another level.`,
        code: "ROOM_START_FAILED",
      });
      return;
    }

    const recent = [problemId, ...room.recentProblemIds.filter((id) => id !== problemId)].slice(0, RECENT_PROBLEMS_KEPT);
    await redisService.updateRoom(code, { recentProblems: recent.join(",") }, "room_record_problem");
  }

  private async afterPresenceLoss(code: string, userId: string): Promise<void> {
    // Another tab of the same player still has the room open
    if (this.socketsIn(code, userId).length > 0) return;
    const room = await redisService.getRoom(code, "room_presence_read");
    if (!room || room.status !== "open") return;
    const seat = this.seatOf(room, userId);
    if (seat && (seat === "host" ? room.hostReady : room.guestReady)) {
      await redisService.setRoomReady(code, seat, false);
    }
    await this.broadcast(code);
  }

  private stopWatching(socket: AuthenticatedSocket, code: string): void {
    socket.leave(channel(code));
    if (socket.data.roomCode === code) socket.data.roomCode = undefined;
  }

  private async broadcast(code: string): Promise<void> {
    const room = await redisService.getRoom(code, "room_broadcast_read");
    if (room) await this.broadcastRoom(room);
  }

  private async broadcastRoom(room: Room): Promise<void> {
    this.io.to(channel(room.code)).emit("room_update", await this.toView(room));
  }

  private async toView(room: Room): Promise<RoomView> {
    const seat = (player: RoomPlayer, ready: boolean, wins: number): RoomSeatView => {
      const online = this.socketsIn(room.code, player.id).length > 0;
      return { ...player, online, ready: ready && online, wins };
    };
    return {
      code: room.code,
      status: room.status,
      host: seat(room.host, room.hostReady, room.hostWins),
      guest: room.guest ? seat(room.guest, room.guestReady, room.guestWins) : null,
      difficulty: room.difficulty,
      activeMatchId: await this.activeMatchId(room),
    };
  }

  private seatOf(room: Room, userId: string): "host" | "guest" | null {
    if (room.host.id === userId) return "host";
    if (room.guest?.id === userId) return "guest";
    return null;
  }

  private async activeMatchId(room: Room): Promise<string | null> {
    if (!room.matchId) return null;
    const match = await redisService.getMatch(room.matchId, "room_read_match");
    return match?.status === "active" ? match.id : null;
  }

  private async isInActiveMatch(userId: string): Promise<boolean> {
    const matchId = await redisService.getUserMatchId(userId, "room_start_get_user_match");
    if (!matchId) return false;
    const match = await redisService.getMatch(matchId, "room_start_read_user_match");
    return match?.status === "active";
  }

  /**
   * Sockets with the room open, optionally only one player's. Single-instance:
   * checks this server's sockets, like the match disconnect handling does.
   */
  private socketsIn(code: string, userId?: string): AuthenticatedSocket[] {
    const ids = this.io.sockets.adapter.rooms.get(channel(code));
    if (!ids) return [];
    const out: AuthenticatedSocket[] = [];
    for (const id of ids) {
      const s = this.io.sockets.sockets.get(id) as AuthenticatedSocket | undefined;
      if (s && (!userId || s.user?.id === userId)) out.push(s);
    }
    return out;
  }
}
