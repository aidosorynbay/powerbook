export type TokenResponse = { access_token: string; token_type: "bearer" | string };

export type UserOut = {
    id: string;
    email: string;
    display_name: string;
    gender: "male" | "female" | null;
    system_role: "user" | "admin" | "superadmin";
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type ExchangePairOut = {
    id: string;
    round_id: string;
    giver_user_id: string;
    receiver_user_id: string;
    giver_marked_given_at: string | null;
    receiver_marked_received_at: string | null;
    created_at: string;
    updated_at: string;
};

export type GroupOut = {
    id: string;
    name: string;
    slug: string;
    owner_user_id: string;
    created_at: string;
    updated_at: string;
};

export type RoundOut = {
    id: string;
    group_id: string;
    year: number;
    month: number;
    status: string;
    registration_open_until_day: number;
    timezone: string;
    started_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
};

function apiBaseUrl(): string {
    return (import.meta as any).env?.VITE_API_BASE_URL || "http://localhost:8000/api";
}

export class ApiError extends Error {
    status: number;
    detail?: unknown;
    constructor(message: string, status: number, detail?: unknown) {
        super(message);
        this.status = status;
        this.detail = detail;
    }
}

async function request<T>(
    path: string,
    opts: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<T> {
    const url = `${apiBaseUrl()}${path}`;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

    const res = await fetch(url, {
        method: opts.method || "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
        const msg = typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`;
        throw new ApiError(msg, res.status, data);
    }
    return data as T;
}

function safeJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

export const api = {
    auth: {
        register: (email: string, password: string, display_name: string) =>
            request<TokenResponse>("/auth/register", {
                method: "POST",
                body: { email, password, display_name },
            }),
        login: (email: string, password: string) =>
            request<TokenResponse>("/auth/login", {
                method: "POST",
                body: { email, password },
            }),
        me: (token: string) => request<UserOut>("/auth/me", { token }),
    },
    rounds: {
        join: (round_id: string, token: string) =>
            request<any>(`/rounds/${round_id}/join`, { method: "POST", token }),
        leave: (round_id: string, token: string) =>
            request<any>(`/rounds/${round_id}/leave`, { method: "POST", token }),
        logMinutes: (round_id: string, token: string, date: string, minutes: number) =>
            request<any>(`/rounds/${round_id}/reading_logs`, {
                method: "POST",
                token,
                body: { date, minutes },
            }),
        calendar: (round_id: string, token: string) => request<any>(`/rounds/${round_id}/calendar`, { token }),
        leaderboard: (round_id: string, token: string) => request<any[]>(`/rounds/${round_id}/leaderboard`, { token }),
    },
    exchange: {
        my: (token: string) => request<ExchangePairOut[]>("/exchange/me", { token }),
        markGiven: (pair_id: string, token: string) =>
            request<ExchangePairOut>(`/exchange/${pair_id}/mark_given`, { method: "POST", token }),
        markReceived: (pair_id: string, token: string) =>
            request<ExchangePairOut>(`/exchange/${pair_id}/mark_received`, { method: "POST", token }),
    },
    groups: {
        bySlug: (slug: string, token: string) => request<GroupOut>(`/groups/by-slug/${encodeURIComponent(slug)}`, { token }),
        currentRound: (group_id: string, token: string) =>
            request<RoundOut | null>(`/groups/${group_id}/current_round`, { token }),
        create: (name: string, slug: string, token: string) =>
            request<GroupOut>("/groups", { method: "POST", token, body: { name, slug } }),
    },
};

