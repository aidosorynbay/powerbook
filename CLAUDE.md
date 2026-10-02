# PowerBook — notes for Claude

PowerBook (powerbook.kz) is a Kazakhstan reading community, running since 2021 (it began
as a Telegram group): monthly reading rounds («круги») with daily minutes, leaderboards and
streaks, a 3D bookshelf, a shared library, a used-book bazaar, a reader with a reading room,
and AI letters. The founder writes in Russian; answer in Russian, plainly.

## Layout

- `app/` — FastAPI backend. `api/routes/` (HTTP), `services/` (logic), `repositories/`
  (queries), `models/` (SQLAlchemy), `schemas/` (Pydantic). `/admin` is set up in
  `app/admin.py` (+ `admin_books.py`, `admin_coverage.py`).
- `alembic/versions/` — migrations. Revision ids follow the running pattern
  (`y5z6a7b8c9d0`, `z6a7b8c9d0e1`, …); `down_revision` is the previous head.
- `frontend/` — React 18 + Vite + TypeScript, laid out as `app/`, `pages/`, `widgets/`,
  `shared/` (`shared/lib` for api/i18n/types/analytics, `shared/ui` for components).
- `app-shell/` — Capacitor wrapper (iOS/Android) around the same frontend build.
- `tests/` — pytest; each feature test builds its own in-memory SQLite (see
  `tests/test_watch_notify.py` for the fixture pattern).

## Deploy

**A push to `master` deploys to production** (`.github/workflows/deploy.yml`): the server
pulls `master`, rebuilds the Docker backend and builds the frontend. The backend container
runs `alembic upgrade head` on start (`scripts/entrypoint.sh`), so a migration ships with
its code. Check the run in GitHub Actions after pushing; then check powerbook.kz itself.

The founder's workflow is to commit straight to `master`. A cloud session pushes only if
the Claude GitHub App is installed on `aidosorynbay/powerbook`; without it, hand changes
over as a `git format-patch` file the founder applies with `git am` and pushes.

Server access (`ssh powerbook`, `/opt/powerbook`, `.env`, the production database) exists
only from the founder's Mac. Linking archive nicknames for readers is done there or in
/admin → «Архив: покрытие».

## Checks before pushing

```bash
pytest -q                                  # backend
cd frontend && npx tsc -b && npx vite build  # types + build
```

Two tests depend on the current date and fail regardless of changes
(`test_books_market.py::test_reading_overview_recommendations_and_notebook`,
`test_reading_room.py::test_the_day_in_the_chat`); confirm a failure also happens on
`master` before calling it pre-existing. For UI changes, run the app locally and look at
it in a browser, phone width (390px) included.

## Conventions

- **Three languages everywhere:** every UI string goes into `frontend/src/shared/lib/i18n.tsx`
  for `ru`, `kk` and `en`.
- **Commits:** an English subject that says what changed for readers (see `git log`), and a
  body that starts from what the founder asked and explains the why. Several small commits
  over one large one.
- **Comments** explain why, in the same plain voice as the existing code.
- **AI:** all AI features go through `app/services/llm.py` (DeepSeek when
  `DEEPSEEK_API_KEY` is set). Letters are written in a background thread
  (`reading_ai.py`); a deploy restarts the server and kills such threads.
- **Analytics:** `track()` from `shared/lib/analytics.ts` (GA4 `G-RRHCW0VR2X`), by account
  id only, never names or e-mails. Errors go to Sentry.
- **Archive readers:** old Telegram-era participants exist as claimable "ghost" users;
  `ClaimsRepository.effective_user_ids` merges a reader with their claimed archive.
- **Reading logs:** one `reading_logs` row per reader per day holds the day's total and
  score; `reading_log_books` splits it across books («Что читаю»). A finished book's title
  is also the first line of the day's comment, which the shelf and covers read.
- Existing members stay free forever; monetisation ideas must not take away what they have.
