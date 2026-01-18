import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, displayName);
      nav("/app");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Register failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Register</h2>
        <form onSubmit={onSubmit}>
          <div className="field">
            <div className="label">Display name</div>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="label">Email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <div className="label">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="min 6 chars"
            />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </button>
            <span className="hint">
              Already have an account? <Link to="/login">Login</Link>
            </span>
          </div>
        </form>
        {error && <div className="toast error">{error}</div>}
      </div>

      <div className="card">
        <h2>Security</h2>
        <div className="hint">
          Your token is stored in <code>localStorage</code> for this MVP. Later we can switch to httpOnly cookies.
        </div>
      </div>
    </div>
  );
}

