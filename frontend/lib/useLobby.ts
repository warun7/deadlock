import { useEffect, useState } from "react";
import { gameSocket, type LobbyStats } from "./socket";
import { supabase } from "./supabase";

/**
 * Live lobby counts (who is online, waiting, playing) and the ranked hour.
 * Null until the server answers; the lobby simply shows nothing until then.
 */
export function useLobbyStats(enabled = true): LobbyStats | null {
  const [stats, setStats] = useState<LobbyStats | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let cleanup = () => {};

    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const socket = gameSocket.connect(session.access_token);

      const watch = () => {
        gameSocket
          .watchLobby()
          .then((s) => !cancelled && setStats(s))
          .catch(() => {
            /* the counts are a nicety; the lobby works without them */
          });
      };
      const onStats = (s: LobbyStats) => !cancelled && setStats(s);

      socket.on("lobby_stats", onStats);
      // A reconnect is a new socket on the server: watch again
      socket.on("connect", watch);
      if (socket.connected) watch();

      cleanup = () => {
        socket.off("lobby_stats", onStats);
        socket.off("connect", watch);
        gameSocket.unwatchLobby();
      };
    };

    void run();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled]);

  return stats;
}

/** "in 3h 12m", "in 4m", "now" */
export function untilText(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return `in ${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

/** The ranked hour's start in the viewer's own time, e.g. "8:30 PM" */
export function localTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
