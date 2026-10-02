import { Server as SocketServer } from "socket.io";
import { config } from "../config";
import type { AuthenticatedSocket, ClientToServerEvents, LobbyStats, ServerToClientEvents } from "../types";

const LOBBY_ROOM = "lobby";

/**
 * Who is around: signed-in players with the app open, how many wait in the
 * ranked queue and how many are in matches, plus the daily ranked hour. The
 * lobby shows it live, so a player can see the queue is worth joining.
 */
export class LobbyService {
  private pending: NodeJS.Timeout | null = null;
  private lastSent = "";

  constructor(
    private io: SocketServer<ClientToServerEvents, ServerToClientEvents>,
    private queueLength: () => number
  ) {
    // Counts also drift as matches end and sockets come and go; a slow tick
    // keeps watchers honest without an event for every change
    const tick = setInterval(() => this.touch(), 15_000);
    tick.unref?.();
  }

  stats(now = Date.now()): LobbyStats {
    const online = new Set<string>();
    const playing = new Set<string>();
    for (const s of this.io.sockets.sockets.values()) {
      const id = (s as AuthenticatedSocket).user?.id;
      if (!id) continue;
      online.add(id);
      if (s.data?.currentMatchId) playing.add(id);
    }
    return {
      online: online.size,
      inQueue: this.queueLength(),
      inMatches: playing.size,
      rankedHour: rankedHourWindow(now),
      ghosts: config.ghost.enabled,
    };
  }

  /** Whether this player has the app open anywhere */
  isOnline(userId: string): boolean {
    for (const s of this.io.sockets.sockets.values()) {
      if ((s as AuthenticatedSocket).user?.id === userId) return true;
    }
    return false;
  }

  watch(socket: AuthenticatedSocket): LobbyStats {
    socket.join(LOBBY_ROOM);
    return this.stats();
  }

  unwatch(socket: AuthenticatedSocket): void {
    socket.leave(LOBBY_ROOM);
  }

  /** Something changed: tell watchers, at most once a second */
  touch(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      const stats = this.stats();
      // Watchers already have the rest (a new one gets stats in its ack)
      const key = JSON.stringify({ ...stats, rankedHour: stats.rankedHour?.live });
      if (key === this.lastSent) return;
      this.lastSent = key;
      this.io.to(LOBBY_ROOM).emit("lobby_stats", stats);
    }, 1000);
    this.pending.unref?.();
  }
}

/**
 * The ranked hour around now: the one on now, else the next. A window that
 * starts late in the day runs past midnight, so yesterday's is checked too.
 */
export function rankedHourWindow(now = Date.now()): LobbyStats["rankedHour"] {
  const start = config.rankedHour.start;
  if (!start) return null;
  const length = config.rankedHour.minutes * 60_000;
  const day = new Date(now);
  const todayStart = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), start.hour, start.minute);
  for (const startsAt of [todayStart - 86_400_000, todayStart, todayStart + 86_400_000]) {
    const endsAt = startsAt + length;
    if (now < endsAt) return { startsAt, endsAt, live: now >= startsAt };
  }
  return null;
}
