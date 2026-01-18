import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";

function slugify(input: string): string {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}

export function CreateGroupPage() {
    const { token } = useAuth();
    const nav = useNavigate();
    const [name, setName] = useState("");
    const [slug, setSlug] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!token) return;
        setBusy(true);
        setError(null);
        try {
            const g = await api.groups.create(name, slug, token);
            nav(`/app?group=${encodeURIComponent(g.slug)}`);
        } catch (e) {
            setError(e instanceof ApiError ? e.message : "Failed to create group");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="grid">
            <div className="card">
                <h2>Create group</h2>
                <form onSubmit={onSubmit}>
                    <div className="field">
                        <div className="label">Name</div>
                        <input
                            value={name}
                            onChange={(e) => {
                                const v = e.target.value;
                                setName(v);
                                if (!slug) setSlug(slugify(v));
                            }}
                            placeholder="PowerBook Алматы"
                        />
                    </div>
                    <div className="field" style={{ marginTop: 10 }}>
                        <div className="label">Slug</div>
                        <input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder="powerbook-almaty" />
                        <div className="hint">Used in URLs. Letters/numbers/dashes only.</div>
                    </div>

                    <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn primary" disabled={busy || !name || !slug}>
                            {busy ? "Creating…" : "Create"}
                        </button>
                        <button className="btn" type="button" onClick={() => nav("/app")} disabled={busy}>
                            Cancel
                        </button>
                    </div>
                </form>
                {error && <div className="toast error">{error}</div>}
            </div>

            <div className="card">
                <h2>What happens</h2>
                <div className="hint">
                    You’ll become the <strong>owner</strong> and be added as a <strong>group admin</strong>. Then you can create
                    rounds for this group (admin API for now).
                </div>
            </div>
        </div>
    );
}

