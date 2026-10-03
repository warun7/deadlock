import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/app/AppNav";
import { EmptyState } from "../components/app/MatchList";
import { Button } from "../components/ui/Button";
import Dialog from "../components/ui/Dialog";
import { Label, Tag } from "../components/ui/Chrome";
import { apiGet, apiPost, ApiError } from "../lib/http";
import { formatClock, formatDate, formatRelative } from "../lib/format";

/*
  Fair-play review, the funnel and seasons. Admins only: the server checks
  ADMIN_USER_IDS / ADMIN_EMAILS on every call and answers 404 to anyone else.
*/

type Tab = "flags" | "players" | "reports" | "funnel" | "seasons";
type Status = "open" | "cleared" | "confirmed" | "all";

const FLAG_TEXT: Record<string, string> = {
  paste_attempt: "Tried to paste 50+ characters from outside the editor",
  copy_attempt: "Tried to copy the problem",
  left_tab: "Away from the tab for a long stretch",
  code_not_typed: "Submitted code that was never typed",
  robotic_typing: "Typing rhythm too even or too fast",
  fast_solve: "Solved fast, far above their rating",
};
const STRONG = new Set(["code_not_typed", "robotic_typing"]);

interface IntegrityRow {
  created_at: string;
  player: string | null;
  opponent: string | null;
  flags: string[];
  reports: number;
  won: boolean | null;
  end_reason: string;
  duration_seconds: number;
  problem_rating: number | null;
  player_rating: number | null;
  paste_blocked: number;
  paste_blocked_max_chars: number;
  copy_blocked: number;
  away_count: number;
  away_seconds: number;
  unexplained_chars: number | null;
  keystroke_intervals: number | null;
  interval_mean_ms: number | null;
  interval_cv: number | null;
  match_id: string;
  player_id: string;
  review_status: "open" | "cleared" | "confirmed";
  review_note: string | null;
  mode: string;
  typed_chars: number | null;
  pasted_chars: number | null;
  code_chars: number | null;
  submissions: number;
  rating_change: number | null;
  rating_voided: boolean | null;
}

const Stat: React.FC<{ label: string; value: React.ReactNode; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="min-w-0">
    <dt className="label text-fg-3">{label}</dt>
    <dd className={`tabular mt-0.5 text-[15px] ${warn ? "text-accent-ink" : "text-fg"}`}>{value}</dd>
  </div>
);

const FlagCard: React.FC<{ row: IntegrityRow; onChanged: () => void }> = ({ row, onChanged }) => {
  const [note, setNote] = useState(row.review_note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);

  const review = async (status: "cleared" | "confirmed" | "open") => {
    setBusy(status);
    setMessage(null);
    try {
      await apiPost("/admin/review", { matchId: row.match_id, playerId: row.player_id, status, note });
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const voidRating = async () => {
    setConfirmVoid(false);
    setBusy("void");
    setMessage(null);
    try {
      const res = await apiPost<{ message: string }>("/admin/void", { matchId: row.match_id });
      setMessage(res.message);
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not void the rating change.");
    } finally {
      setBusy(null);
    }
  };

  const unexplainedWarn = (row.unexplained_chars ?? 0) >= 150;
  const cvWarn = (row.keystroke_intervals ?? 0) >= 150 && ((row.interval_cv ?? 1) <= 0.35 || (row.interval_mean_ms ?? 1000) <= 60);

  return (
    <li className="border-b border-line py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[clamp(1.125rem,1.8vw,1.5rem)] leading-tight tracking-[-0.03em] text-fg">
          {row.player ? (
            <Link to={`/u/${encodeURIComponent(row.player)}`} className="hover:text-accent-ink">
              {row.player}
            </Link>
          ) : (
            "Unknown player"
          )}
          <span className="text-fg-3"> vs {row.mode === "ghost" ? `${row.opponent ?? "?"}'s ghost` : row.opponent ?? "?"}</span>
        </p>
        <p className="label flex flex-wrap items-center gap-2 text-fg-3">
          <span>{formatRelative(row.created_at)}</span>
          <span aria-hidden="true">·</span>
          <span>{row.mode}</span>
          <span aria-hidden="true">·</span>
          <span>{row.won === null ? "draw" : row.won ? "won" : "lost"} by {row.end_reason}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular">{formatClock(row.duration_seconds)}</span>
          <Tag tone={row.review_status === "confirmed" ? "fail" : row.review_status === "cleared" ? "pass" : "warn"}>{row.review_status}</Tag>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {row.flags.map((f) => (
          <span
            key={f}
            title={FLAG_TEXT[f] ?? f}
            className={`label inline-flex h-[22px] items-center rounded-[3px] border px-1.5 text-[10.5px] ${
              STRONG.has(f) ? "border-accent-ink/60 bg-accent/10 text-accent-ink" : "border-warn-ink/50 text-warn-ink"
            }`}
          >
            {f.replace(/_/g, " ")}
          </span>
        ))}
        {row.reports > 0 && <Tag tone="fail">{row.reports === 1 ? "1 report" : `${row.reports} reports`}</Tag>}
        {row.flags.length === 0 && row.reports === 0 && <Tag>No flags</Tag>}
      </div>
      {row.flags.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[13px] text-fg-2">
          {row.flags.map((f) => (
            <li key={f}>{FLAG_TEXT[f] ?? f}</li>
          ))}
        </ul>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Ratings" value={`${row.player_rating ?? "?"} on ${row.problem_rating ?? "?"}`} />
        <Stat label="Submissions" value={row.submissions} />
        <Stat label="Typed / pasted / code" value={`${row.typed_chars ?? "–"} / ${row.pasted_chars ?? "–"} / ${row.code_chars ?? "–"}`} />
        <Stat label="Never typed" value={row.unexplained_chars ?? "–"} warn={unexplainedWarn} />
        <Stat
          label="Keystrokes · mean · cv"
          value={`${row.keystroke_intervals ?? "–"} · ${row.interval_mean_ms != null ? Math.round(row.interval_mean_ms) : "–"}ms · ${row.interval_cv ?? "–"}`}
          warn={cvWarn}
        />
        <Stat label="Blocked paste (max)" value={`${row.paste_blocked} (${row.paste_blocked_max_chars})`} warn={row.paste_blocked_max_chars >= 50} />
        <Stat label="Copy attempts" value={row.copy_blocked} />
        <Stat label="Away" value={`${row.away_count}× · ${formatClock(row.away_seconds)}`} />
        <Stat
          label="Rating change"
          value={row.rating_voided ? "voided" : row.rating_change != null ? `${row.rating_change > 0 ? "+" : ""}${row.rating_change}` : "–"}
        />
      </dl>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          placeholder="Note (optional)"
          aria-label={`Review note for ${row.player ?? "this player"}`}
          className="h-9 min-w-0 flex-1 rounded-[3px] border border-line bg-bg px-3 text-[14px] text-fg placeholder:text-fg-3 focus:border-fg focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" loading={busy === "cleared"} onClick={() => void review("cleared")}>
            Clear
          </Button>
          <Button size="sm" variant="danger" loading={busy === "confirmed"} onClick={() => void review("confirmed")}>
            Confirm cheating
          </Button>
          {row.rating_change != null && !row.rating_voided && (
            <Button size="sm" variant="ghost" loading={busy === "void"} onClick={() => setConfirmVoid(true)}>
              Void rating
            </Button>
          )}
          {row.review_status !== "open" && (
            <Button size="sm" variant="ghost" loading={busy === "open"} onClick={() => void review("open")}>
              Reopen
            </Button>
          )}
        </div>
      </div>
      {message && <p className="mt-2 text-[13px] text-fg-2">{message}</p>}

      <Dialog open={confirmVoid} onClose={() => setConfirmVoid(false)} eyebrow="Void rating" title="Undo this match's rating change?">
        <p className="mt-4 text-[16px] leading-snug text-fg-2">
          Both players&apos; ratings go back by what this match moved them. The match stays in their history with no rating
          change. This cannot be undone from here.
        </p>
        <div className="mt-8 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmVoid(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => void voidRating()}>
            Void rating
          </Button>
        </div>
      </Dialog>
    </li>
  );
};

function useAdminData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setError(null);
    apiGet<T>(path)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load."));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

const pct = (n: unknown, of: unknown) => {
  const a = Number(n);
  const b = Number(of);
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? `${Math.round((a / b) * 100)}%` : "–";
};

const AdminPage: React.FC = () => {
  const [access, setAccess] = useState<"checking" | "ok" | "denied" | "signed_out" | "error">("checking");
  const [tab, setTab] = useState<Tab>("flags");
  const [status, setStatus] = useState<Status>("open");
  const [seasonName, setSeasonName] = useState("");
  const [confirmSeason, setConfirmSeason] = useState(false);
  const [seasonMessage, setSeasonMessage] = useState<string | null>(null);

  useEffect(() => {
    apiGet("/admin/me")
      .then(() => setAccess("ok"))
      .catch((e: unknown) => setAccess(e instanceof ApiError ? (e.status === 401 ? "signed_out" : e.status === 404 ? "denied" : "error") : "error"));
  }, []);

  const ok = access === "ok";
  const flags = useAdminData<{ rows: IntegrityRow[] }>(ok && tab === "flags" ? `/admin/integrity?status=${status}` : null);
  const players = useAdminData<{ rows: any[] }>(ok && tab === "players" ? "/admin/players" : null);
  const reports = useAdminData<{ rows: any[] }>(ok && tab === "reports" ? "/admin/reports" : null);
  const funnel = useAdminData<{ rows: any[] }>(ok && tab === "funnel" ? "/admin/funnel?weeks=8" : null);
  const seasons = useAdminData<{ seasons: { id: number; name: string; startsAt: string; endsAt: string | null }[] }>(
    ok && tab === "seasons" ? "/admin/seasons" : null
  );

  if (access !== "ok") {
    return (
      <AppShell>
        <p className="label text-fg-3">Review</p>
        <h1 className="mt-3 text-[clamp(2.5rem,7vw,6.5rem)] font-medium leading-[0.9] tracking-[-0.06em] text-fg">
          {access === "checking" ? "Checking access" : access === "signed_out" ? "Log in first" : access === "denied" ? "Page not found" : "Could not load"}
        </h1>
        {access === "denied" && <p className="mt-5 text-[17px] text-fg-2">There is nothing at this address.</p>}
      </AppShell>
    );
  }

  const startSeason = async () => {
    setConfirmSeason(false);
    setSeasonMessage(null);
    try {
      await apiPost("/admin/seasons", { name: seasonName.trim() });
      setSeasonMessage(`${seasonName.trim()} has started. Ratings moved halfway back to 1000.`);
      setSeasonName("");
      seasons.reload();
    } catch (e) {
      setSeasonMessage(e instanceof Error ? e.message : "Could not start the season.");
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "flags", label: "Flags" },
    { id: "players", label: "Players" },
    { id: "reports", label: "Reports" },
    { id: "funnel", label: "Funnel" },
    { id: "seasons", label: "Seasons" },
  ];

  return (
    <AppShell>
      <p className="label text-fg-3">Admin</p>
      <h1 className="mt-3 text-[clamp(3rem,9vw,8.25rem)] font-medium leading-[0.88] tracking-[-0.06em] text-fg">Review</h1>

      <div className="mt-10 flex flex-wrap gap-[3px]" role="tablist" aria-label="Review sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`label h-8 rounded-[3px] px-3 transition-colors ${tab === t.id ? "bg-fg text-bg" : "bg-bg-2 text-fg hover:bg-bg-3"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "flags" && (
        <section className="mt-10" aria-label="Flagged matches">
          <Label
            aside={
              <span className="flex gap-[3px]" role="radiogroup" aria-label="Review status">
                {(["open", "cleared", "confirmed", "all"] as Status[]).map((s) => (
                  <button
                    key={s}
                    role="radio"
                    aria-checked={status === s}
                    onClick={() => setStatus(s)}
                    className={`label h-6 rounded-[3px] px-2 ${status === s ? "bg-fg text-bg" : "text-fg-2 hover:bg-bg-2"}`}
                  >
                    {s}
                  </button>
                ))}
              </span>
            }
          >
            Matches with a flag or a report
          </Label>
          <p className="mt-3 max-w-[70ch] text-[14px] leading-snug text-fg-3">
            A flag is a reason to look, never a verdict. An open match flagged &ldquo;code not typed&rdquo; or &ldquo;robotic
            typing&rdquo;, or any confirmed one, keeps the player off the leaderboard and out of ghost duels until it is cleared.
          </p>
          {flags.error ? (
            <EmptyState title="Could not load flags" body={flags.error} />
          ) : !flags.data ? (
            <p className="label mt-6 text-fg-3">Loading</p>
          ) : flags.data.rows.length === 0 ? (
            <EmptyState title="Nothing to review" body={`No ${status === "all" ? "" : `${status} `}matches with flags or reports.`} />
          ) : (
            <ul className="mt-2">
              {flags.data.rows.map((r) => (
                <FlagCard key={`${r.match_id}:${r.player_id}`} row={r} onChanged={flags.reload} />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "players" && (
        <section className="mt-10" aria-label="Players">
          <Label>Players by flagged matches</Label>
          {players.error ? (
            <EmptyState title="Could not load players" body={players.error} />
          ) : !players.data ? (
            <p className="label mt-6 text-fg-3">Loading</p>
          ) : players.data.rows.length === 0 ? (
            <EmptyState title="No rated matches yet" body="Players show up here after their first ranked or ghost match." />
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[14px]">
                <thead className="label text-fg-3">
                  <tr className="border-b border-rule">
                    {["Player", "Rated", "Flagged", "Not typed", "Robotic", "Paste", "Left tab", "Fast", "Reports", "Last"].map((h) => (
                      <th key={h} className="py-2 pr-4 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {players.data.rows.map((p: any) => (
                    <tr key={p.player_id} className="border-b border-line">
                      <td className="py-2 pr-4">{p.player ? <Link to={`/u/${encodeURIComponent(p.player)}`}>{p.player}</Link> : "?"}</td>
                      <td className="pr-4">{p.ranked_matches}</td>
                      <td className="pr-4">
                        {p.flagged_matches} <span className="text-fg-3">({pct(p.flagged_matches, p.ranked_matches)})</span>
                      </td>
                      <td className={`pr-4 ${p.code_not_typed ? "text-accent-ink" : ""}`}>{p.code_not_typed}</td>
                      <td className={`pr-4 ${p.robotic_typing ? "text-accent-ink" : ""}`}>{p.robotic_typing}</td>
                      <td className="pr-4">{p.paste_attempt}</td>
                      <td className="pr-4">{p.left_tab}</td>
                      <td className="pr-4">{p.fast_solve}</td>
                      <td className="pr-4">{p.reports}</td>
                      <td className="pr-4 text-fg-3">{p.last_match_at ? formatRelative(p.last_match_at) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "reports" && (
        <section className="mt-10" aria-label="Reports">
          <Label>Player reports</Label>
          {reports.error ? (
            <EmptyState title="Could not load reports" body={reports.error} />
          ) : !reports.data ? (
            <p className="label mt-6 text-fg-3">Loading</p>
          ) : reports.data.rows.length === 0 ? (
            <EmptyState title="No reports" body="Players can report an opponent from the result of a ranked match." />
          ) : (
            <ul className="mt-2">
              {reports.data.rows.map((r: any) => (
                <li key={r.id} className="border-b border-line py-3">
                  <p className="text-[16px] text-fg">
                    {r.reporter ?? "?"} <span className="text-fg-3">reported</span> {r.reported ?? "?"}
                    <span className="label ml-3 text-fg-3">
                      {r.reason === "outside_help" ? "AI or outside help" : "Something else"} · {formatRelative(r.created_at)}
                    </span>
                  </p>
                  {r.note && <p className="mt-1 text-[14px] text-fg-2">&ldquo;{r.note}&rdquo;</p>}
                  <p className="label mt-1 text-fg-3">Match {r.match_id}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "funnel" && (
        <section className="mt-10" aria-label="Funnel">
          <Label aside="By sign-up week">Invite link, sign-up, first match, second match</Label>
          <p className="mt-3 max-w-[70ch] text-[14px] leading-snug text-fg-3">
            Each week counts the accounts made that week and how many of them went on to finish one and two matches of any
            kind. Invite visitors are signed-out people who opened a duel link, counted in the week of their first visit.
          </p>
          {funnel.error ? (
            <EmptyState title="Could not load the funnel" body={funnel.error} />
          ) : !funnel.data ? (
            <p className="label mt-6 text-fg-3">Loading</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[14px]">
                <thead className="label text-fg-3">
                  <tr className="border-b border-rule">
                    {["Week of", "Invite visitors", "Sign-ups", "From invites", "Played 1", "Played 2", "Invited: played 1", "Invited: played 2"].map((h) => (
                      <th key={h} className="py-2 pr-4 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular">
                  {funnel.data.rows.map((w: any) => (
                    <tr key={w.week} className="border-b border-line">
                      <td className="py-2 pr-4">{formatDate(w.week)}</td>
                      <td className="pr-4">{w.invite_visitors}</td>
                      <td className="pr-4">{w.signups}</td>
                      <td className="pr-4">
                        {w.signups_from_invites} <span className="text-fg-3">({pct(w.signups_from_invites, w.invite_visitors)} of visitors)</span>
                      </td>
                      <td className="pr-4">
                        {w.played_one} <span className="text-fg-3">({pct(w.played_one, w.signups)})</span>
                      </td>
                      <td className="pr-4">
                        {w.played_two} <span className="text-fg-3">({pct(w.played_two, w.signups)})</span>
                      </td>
                      <td className="pr-4">{w.invite_played_one}</td>
                      <td className="pr-4">{w.invite_played_two}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "seasons" && (
        <section className="mt-10 max-w-2xl" aria-label="Seasons">
          <Label>Seasons</Label>
          {seasons.error ? (
            <EmptyState title="Could not load seasons" body={seasons.error} />
          ) : (
            <ul className="mt-2">
              {(seasons.data?.seasons ?? []).map((s) => (
                <li key={s.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3">
                  <span className="text-[17px] text-fg">{s.name}</span>
                  <span className="label text-fg-3">
                    {formatDate(s.startsAt)} – {s.endsAt ? formatDate(s.endsAt) : "now"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-8 border-t border-rule pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (seasonName.trim()) setConfirmSeason(true);
            }}
          >
            <label htmlFor="season-name" className="label text-fg">
              / Start the next season
            </label>
            <p className="mt-2 text-[14px] leading-snug text-fg-3">
              Saves the current standings for good, then moves every rating halfway back to 1000 (a 1600 starts at 1300).
            </p>
            <div className="mt-3 flex gap-2">
              <input
                id="season-name"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value.slice(0, 60))}
                placeholder="Season 2"
                className="h-10 min-w-0 flex-1 rounded-[3px] border border-line bg-bg px-3 text-[15px] text-fg placeholder:text-fg-3 focus:border-fg focus:outline-none"
              />
              <Button type="submit" variant="danger" disabled={!seasonName.trim()}>
                Start season
              </Button>
            </div>
            {seasonMessage && <p className="mt-2 text-[13px] text-fg-2">{seasonMessage}</p>}
          </form>
          <Dialog open={confirmSeason} onClose={() => setConfirmSeason(false)} eyebrow="Seasons" title={`Start ${seasonName.trim()}?`}>
            <p className="mt-4 text-[16px] leading-snug text-fg-2">
              The current season ends now and its standings are saved. Every player&apos;s rating moves halfway back to 1000.
              This cannot be undone.
            </p>
            <div className="mt-8 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmSeason(false)}>
                Not yet
              </Button>
              <Button variant="danger" onClick={() => void startSeason()}>
                Start the season
              </Button>
            </div>
          </Dialog>
        </section>
      )}
    </AppShell>
  );
};

export default AdminPage;
