import React, { useEffect, useState } from "react";
import { BellRinging, BellSlash } from "@phosphor-icons/react";
import { Label } from "../ui/Chrome";
import { Button } from "../ui/Button";
import type { LobbyStats } from "../../lib/socket";
import { localTime, untilText } from "../../lib/useLobby";
import { alertsState, disableAlerts, enableAlerts, type AlertsState } from "../../lib/alerts";

/**
 * The daily ranked hour, in the player's own time, and a switch for alerts:
 * when someone is waiting in ranked, and when the hour starts.
 */
const RankedHour: React.FC<{ stats: LobbyStats | null; className?: string }> = ({ stats, className = "" }) => {
  const [now, setNow] = useState(Date.now());
  const [alerts, setAlerts] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    alertsState()
      .then((s) => !cancelled && setAlerts(s))
      .catch(() => !cancelled && setAlerts("unavailable"));
    return () => {
      cancelled = true;
    };
  }, []);

  const hour = stats?.rankedHour;
  if (!hour && (alerts === null || alerts === "unavailable")) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setAlerts(alerts === "on" ? await disableAlerts() : await enableAlerts());
    } catch {
      setError("Could not change alerts. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const live = !!hour && (hour.live || (now >= hour.startsAt && now < hour.endsAt));

  return (
    <section aria-labelledby="ranked-hour-title" className={className}>
      <Label as="h2" id="ranked-hour-title" aside={live ? <span className="text-pass-ink">On now</span> : hour ? "Daily" : undefined}>
        Ranked hour
      </Label>
      {hour && (
        <p className="mt-4 text-[15px] leading-snug text-fg-2">
          {live ? (
            <>
              <strong className="font-medium text-fg">On until {localTime(hour.endsAt)}.</strong> Everyone queues in this hour, so
              matches come fast.
            </>
          ) : (
            <>
              <strong className="font-medium text-fg">
                Next at {localTime(hour.startsAt)}, {untilText(hour.startsAt - now)}.
              </strong>{" "}
              Everyone queues in the same hour, so matches come fast.
            </>
          )}
        </p>
      )}

      {alerts === "off" || alerts === "on" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="sm" variant={alerts === "on" ? "ghost" : "outline"} loading={busy} onClick={() => void toggle()}>
            {alerts === "on" ? <BellSlash className="size-3.5" /> : <BellRinging className="size-3.5" />}
            {alerts === "on" ? "Turn alerts off" : "Alert me"}
          </Button>
          <span className="label text-fg-3">
            {alerts === "on" ? "Alerts on in this browser" : "When someone is waiting, and when the hour starts"}
          </span>
        </div>
      ) : alerts === "blocked" ? (
        <p className="label mt-4 text-fg-3">Alerts are blocked for this site in your browser settings.</p>
      ) : alerts === "unsupported" ? (
        <p className="label mt-4 text-fg-3">This browser cannot show alerts. On iPhone, add Deadlock to your home screen first.</p>
      ) : null}
      {error && <p className="mt-2 text-[13px] text-accent-ink">{error}</p>}
    </section>
  );
};

export default RankedHour;
