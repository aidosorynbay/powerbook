## FastAPI starter

## Frontend (MVP)

See `frontend/README.md`.

### Requirements
- Python 3.11+ recommended

### Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

### Run (dev)

```bash
uvicorn app.main:app --reload
```

If you accidentally run `uvicorn` from inside the `app/` folder, you may see `ModuleNotFoundError: No module named 'app'`.
Fix by running from the project root (command above), or use:

```bash
uvicorn app.main:app --reload --app-dir .
```

Then open:
- `http://127.0.0.1:8000/` (root)
- `http://127.0.0.1:8000/health` (health)
- `http://127.0.0.1:8000/docs` (Swagger UI)

### Tests

```bash
pytest
```

### Migrations (Alembic)

- Install deps:

```bash
pip install -r requirements-dev.txt
```

- Run migrations:

```bash
alembic upgrade head
```

### Environment variables
- Copy `env.example` → `.env` and edit as needed.

