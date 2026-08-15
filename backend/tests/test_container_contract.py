from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_root_dockerfile_has_frozen_runtime_contract() -> None:
    dockerfile = (REPOSITORY_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "FROM node:" in dockerfile
    assert "npm ci" in dockerfile
    assert "npm run build" in dockerfile
    assert "FROM python:3.12-slim" in dockerfile
    assert "pip install" in dockerfile
    assert "--no-deps" in dockerfile
    assert "COPY --from=frontend-build" in dockerfile
    assert "USER app" in dockerfile
    assert "PORT=8080" in dockerfile
    assert "exec uvicorn app.main:app --host 0.0.0.0 --port" in dockerfile
    assert "${PORT:-8080}" in dockerfile
    assert "YANDEX_CLOUD_API_KEY" not in dockerfile
    assert "ARG " not in dockerfile


def test_docker_context_excludes_local_and_generated_files() -> None:
    patterns = (REPOSITORY_ROOT / ".dockerignore").read_text(encoding="utf-8")

    for pattern in (
        ".git",
        ".env",
        "**/.venv",
        "**/__pycache__",
        "**/node_modules",
        "**/ms-playwright",
        "frontend/dist",
        "frontend/playwright-report",
        "frontend/screenshots",
        "tmp",
    ):
        assert pattern in patterns

    assert "frontend/package-lock.json" not in patterns
    assert "frontend/src" not in patterns
    assert "backend/pyproject.toml" not in patterns
    assert "backend/app" not in patterns


def test_powershell_smoke_covers_the_runtime_acceptance_checks() -> None:
    smoke = (REPOSITORY_ROOT / "infra" / "docker" / "smoke.ps1").read_text(
        encoding="utf-8"
    )

    for required_fragment in (
        "docker build",
        "docker run",
        "/api/health",
        "/api/seed",
        "/api/does-not-exist",
        "Traceback",
        "docker exec",
        "docker rm --force",
    ):
        assert required_fragment in smoke
