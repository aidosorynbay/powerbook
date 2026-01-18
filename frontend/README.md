# PowerBook Frontend (MVP)

Minimal React UI for the PowerBook API.

## Setup

From repo root:

```bash
cd frontend
npm install
cp env.example .env
npm run dev
```

## Configure API base URL

The frontend calls the backend using:

- `VITE_API_BASE_URL` (default: `http://localhost:8000/api`)

Set it in `.env` (created from `env.example`).

## What’s included

- Auth: register/login/logout + `/api/auth/me`
- Rounds: join/leave, log minutes, calendar, leaderboard
- Exchange: list obligations, mark given/received

