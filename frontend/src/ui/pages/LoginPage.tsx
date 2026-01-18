import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav("/app");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Login</h2>
        <form onSubmit={onSubmit}>
          <div className="field">
            <div className="label">Email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="label">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy}>
              {busy ? "Logging in…" : "Login"}
            </button>
            <span className="hint">
              No account? <Link to="/register">Create one</Link>
            </span>
          </div>
        </form>
        {error && <div className="toast error">{error}</div>}
      </div>

      <div className="card">
        <h2>Tip</h2>
        <div className="hint">
          This is an MVP UI: once you’re logged in you can paste a <strong>round_id</strong> and start joining/logging
          minutes.
        </div>
      </div>
    </div>
  );
}

