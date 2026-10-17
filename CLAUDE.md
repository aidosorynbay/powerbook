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
`test_reading_room.py::test_the_day_in_the_chat`); since 18 Oct 2026 three `test_clan_war.py` tests fail too
(they patch `_today` but the logs get the real `created_at`, so «logged before midnight» turns false);
`test_watch_notify.py::test_answers_under_a_review_are_a_little_chat` is flaky. Confirm a failure also happens on
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
- **One book, one face:** a book of the shared library looks the same everywhere — shelf, card, Round, room,
  stickers, profile. Show a book only through `app/services/book_face.py` (`dress` for a shelf copy; `face`,
  `of_title`, `spelling` elsewhere), never from a `book_covers` row of one spelling, a file's `cover_data` or
  raw typed text (`tests/test_book_faces.py` guards it). `catalog._build` decides each face per title
  (`face_key`: «три товарища!!» = «Три товарища»; a translation or a volume keeps its own): the spelling, the
  cover (an edition a reader picked outranks lookups; photos never leave their shelf) and the author — voted
  over all sources with names compared as people (`app/core/authors.py`: «Ремарк» = "Erich Maria Remarque"),
  lookups taking the author most editions name, not a translator. Only what a reader chose for their own copy
  stays theirs. The founder fixes an author in /admin → «Книги: склейка» (`book_authors`; «Автор под
  вопросом» lists books whose sources disagree). Painted covers are seeded by the book's key (`BookFace seed`).
  The same goes for what hangs on a book: who else read it, the books two readers share, its card, marks and
  watchers come from the catalog work (`work.readers`, `idx.by_person`, the copy's `work_key`), never from
  comparing spellings — the guard test fails on a new module that turns titles into keys itself.
- Existing members stay free forever; monetisation ideas must not take away what they have.
- **Awards** («Мои награды», enamel pins): `app/services/awards.py` works them out from `reading_logs` (score 1 =
  a day of 30+ minutes, archive nicknames folded in) and writes each one to `reader_awards` the first time it is
  found — never delete those rows: an award once given stays. Catalog: `TRACKS`/`SPECIAL` there, mirrored in
  `frontend/src/widgets/Awards/catalog.ts`; texts are `aw.*` in i18n; pictures are `frontend/public/award-pins/`
  (`<key>.webp` 768 px, `s/<key>.webp` 256 px; a folder named like a page would shadow the route). The UI is
  admins-only while `FOR_EVERYONE` in `widgets/Awards/Awards.tsx` is false. Research and council behind it:
  `~/Desktop/powerbook-sync/reports/nagrady_*.md`.
- **Reading room pictures:** `frontend/public/reading-room/` and `widgets/ReadingRoom/casts.js` are built on the
  founder's Mac by `~/powerbook-sync/prototypes/reading-room/` (not in git): `seg_birefnet.py` → `dump_owners.py` →
  `sam_masks.py` → `build_figures.py` → `build_lids.py` → `casts_js.py`. The top-left corner of each `*-people.png`
  holds the readers' closed eyelids: never crop or repaint it. The engine asks for these files with a hash of their
  bytes in the URL (`__RR_V__`, set in `vite.config.ts`), so a changed picture reaches browsers at once.
