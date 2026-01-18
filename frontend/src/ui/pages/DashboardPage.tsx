import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, GroupOut, RoundOut, api } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function DashboardPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [groupSlug, setGroupSlug] = useState("");
  const [group, setGroup] = useState<GroupOut | null>(null);
  const [round, setRound] = useState<RoundOut | null>(null);
  const [date, setDate] = useState(todayIso());
  const [minutes, setMinutes] = useState(30);

  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<any | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const canUseGroup = useMemo(() => !!group && !!token, [group, token]);
  const canUseRound = useMemo(() => !!round && !!token, [round, token]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      const res = await fn();
      setToast("Done");
      return res;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function loadGroup(slug: string) {
    if (!token) return;
    const g = await run(() => api.groups.bySlug(slug, token));
    setGroup(g);
    const r = await run(() => api.groups.currentRound(g.id, token));
    setRound(r);
    setCalendar(null);
    setLeaderboard(null);
  }

  useEffect(() => {
    const slug = searchParams.get("group");
    if (!slug) return;
    setGroupSlug(slug);
    loadGroup(slug).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, token]);

  return (
    <div className="grid">
      <div className="card">
        <h2>Group</h2>
        <div className="field">
          <div className="label">Group slug</div>
          <input value={groupSlug} onChange={(e) => setGroupSlug(e.target.value)} placeholder="powerbook" />
          <div className="hint">Enter a group slug to load the group and see the current month’s round.</div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            disabled={!token || !groupSlug || busy}
            onClick={async () => {
              await loadGroup(groupSlug);
            }}
          >
            Load group
          </button>
          {canUseGroup && (
            <span className="pill">
              <strong>{group!.name}</strong>
              <span>@{group!.slug}</span>
            </span>
          )}
        </div>

        {(toast || error) && <div className={`toast ${error ? "error" : ""}`}>{error || toast}</div>}

        {group && (
          <div style={{ marginTop: 12 }}>
            <div className="hint">
              Current round:{" "}
              {round ? (
                <>
                  <strong>
                    {round.year}-{String(round.month).padStart(2, "0")}
                  </strong>{" "}
                  (status: {round.status})
                </>
              ) : (
                <strong>none</strong>
              )}
            </div>

            {round ? (
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn primary"
                  disabled={!canUseRound || busy}
                  onClick={() => run(() => api.rounds.join(round.id, token!))}
                >
                  Join
                </button>
                <button
                  className="btn danger"
                  disabled={!canUseRound || busy}
                  onClick={() => run(() => api.rounds.leave(round.id, token!))}
                >
                  Leave
                </button>
                <button
                  className="btn"
                  disabled={!canUseRound || busy}
                  onClick={async () => {
                    const c = await run(() => api.rounds.calendar(round.id, token!));
                    setCalendar(c);
                  }}
                >
                  Refresh calendar
                </button>
                <button
                  className="btn"
                  disabled={!canUseRound || busy}
                  onClick={async () => {
                    const l = await run(() => api.rounds.leaderboard(round.id, token!));
                    setLeaderboard(l);
                  }}
                >
                  Refresh leaderboard
                </button>
              </div>
            ) : (
              <div className="toast" style={{ marginTop: 10 }}>
                No round for the current month yet.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Log minutes</h2>
        <div className="row">
          <div className="field">
            <div className="label">Date</div>
            <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="YYYY-MM-DD" />
          </div>
          <div className="field">
            <div className="label">Minutes</div>
            <input
              value={String(minutes)}
              onChange={(e) => setMinutes(parseInt(e.target.value || "0", 10))}
              placeholder="0..1440"
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            disabled={!canUseRound || busy}
            onClick={() => run(() => api.rounds.logMinutes(round!.id, token!, date, minutes))}
          >
            Save
          </button>
          <span className="hint">Rule: ≥30 minutes = 1 point/day.</span>
        </div>
      </div>

      <div className="card">
        <h2>Calendar</h2>
        {!calendar ? (
          <div className="hint">Click “Refresh calendar”.</div>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="pill">
                <span>Total minutes:</span> <strong>{calendar.total_minutes}</strong>
              </span>
              <span className="pill">
                <span>Total score:</span> <strong>{calendar.total_score}</strong>
              </span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Minutes</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {calendar.days?.map((d: any) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.minutes}</td>
                    <td>
                      <span className={`status ${d.score === 1 ? "ok" : "bad"}`}>{d.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h2>Leaderboard</h2>
        {!leaderboard ? (
          <div className="hint">Click “Refresh leaderboard”.</div>
        ) : leaderboard.length === 0 ? (
          <div className="hint">No data yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Score</th>
                <th>Days read</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row: any) => (
                <tr key={row.user_id}>
                  <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {row.user_id.slice(0, 8)}…
                  </td>
                  <td>{row.total_score}</td>
                  <td>{row.days_read}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          MVP “near-real-time”: poll this every 5–10 seconds from the client.
        </div>
      </div>
    </div>
  );
}

