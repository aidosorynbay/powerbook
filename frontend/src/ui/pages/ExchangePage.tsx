import { useEffect, useState } from "react";
import { ApiError, ExchangePairOut, api } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

function fmt(ts: string | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function ExchangePage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<ExchangePairOut[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const list = await api.exchange.my(token!);
      setItems(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load obligations");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid">
      <div className="card">
        <h2>My book obligations</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
          <span className="hint">
            You can mark <strong>given</strong> if you are the giver; mark <strong>received</strong> if you are the
            receiver.
          </span>
        </div>
        {error && <div className="toast error">{error}</div>}
        {!items ? (
          <div className="hint">Loading…</div>
        ) : items.length === 0 ? (
          <div className="hint">No obligations yet (publish results for a round first).</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Round</th>
                <th>Role</th>
                <th>Given</th>
                <th>Received</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const isGiver = p.giver_user_id === user!.id;
                const isReceiver = p.receiver_user_id === user!.id;
                return (
                  <tr key={p.id}>
                    <td style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                      {p.round_id.slice(0, 8)}…
                    </td>
                    <td>{isGiver ? "giver" : isReceiver ? "receiver" : "—"}</td>
                    <td className={p.giver_marked_given_at ? "status ok" : "status bad"}>{fmt(p.giver_marked_given_at)}</td>
                    <td className={p.receiver_marked_received_at ? "status ok" : "status bad"}>
                      {fmt(p.receiver_marked_received_at)}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="btn primary"
                          disabled={!isGiver || busy || !!p.giver_marked_given_at}
                          onClick={async () => {
                            setBusy(true);
                            setError(null);
                            try {
                              await api.exchange.markGiven(p.id, token!);
                              await refresh();
                            } catch (e) {
                              setError(e instanceof ApiError ? e.message : "Failed");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Mark given
                        </button>
                        <button
                          className="btn"
                          disabled={!isReceiver || busy || !!p.receiver_marked_received_at}
                          onClick={async () => {
                            setBusy(true);
                            setError(null);
                            try {
                              await api.exchange.markReceived(p.id, token!);
                              await refresh();
                            } catch (e) {
                              setError(e instanceof ApiError ? e.message : "Failed");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Mark received
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Notes</h2>
        <div className="hint">
          In MVP we store timestamps for “given/received”. Later we can add shipment details, book title, and admin
          dispute resolution.
        </div>
      </div>
    </div>
  );
}

