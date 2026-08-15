# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080 \
    FRONTEND_DIST_DIR=/app/frontend/dist

WORKDIR /app

COPY backend/pyproject.toml infra/docker/install-runtime-dependencies.py /tmp/build/
RUN python /tmp/build/install-runtime-dependencies.py /tmp/build/pyproject.toml

COPY backend/pyproject.toml /tmp/backend/pyproject.toml
COPY backend/app /tmp/backend/app
RUN python -m pip install --no-cache-dir --no-deps /tmp/backend \
    && rm -rf /tmp/backend /tmp/build

COPY --from=frontend-build /build/frontend/dist /app/frontend/dist

RUN groupadd --system app \
    && useradd --system --gid app --home-dir /nonexistent --no-create-home app

USER app
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"${PORT:-8080}\""]
