#!/bin/bash
set -e

echo "Running database migrations..."
alembic upgrade head

echo "Starting uvicorn..."
exec uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
