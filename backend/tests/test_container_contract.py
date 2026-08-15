import shutil
import subprocess
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DOCKER_ROOT = REPOSITORY_ROOT / "infra" / "docker"


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
    smoke = (DOCKER_ROOT / "smoke.ps1").read_text(encoding="utf-8")

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


def test_production_build_contract_is_shared_and_registry_compatible() -> None:
    contract = (DOCKER_ROOT / "build-contract.ps1").read_text(encoding="utf-8")
    smoke = (DOCKER_ROOT / "smoke.ps1").read_text(encoding="utf-8")
    deploy = (REPOSITORY_ROOT / "infra" / "yandex" / "deploy.ps1").read_text(
        encoding="utf-8"
    )

    for required_fragment in (
        '"linux/amd64"',
        '"--platform"',
        '"--provenance=false"',
        '"--sbom=false"',
        "Get-ProductionDockerBuildArguments",
        "Assert-ProductionDockerBuildHelp",
        "Assert-ProductionDockerImageJson",
    ):
        assert required_fragment in contract

    for consumer in (smoke, deploy):
        assert "build-contract.ps1" in consumer
        assert "Get-ProductionDockerBuildArguments" in consumer

    assert "Assert-ProductionDockerImageJson" in smoke
    assert "Assert-ProductionDockerImageJson" in deploy
    assert "--provenance=false" not in smoke
    assert "--provenance=false" not in deploy


@pytest.mark.skipif(
    shutil.which("powershell.exe") is None,
    reason="Windows PowerShell 5.1 is not available on this host",
)
def test_production_build_contract_arguments_and_image_validation() -> None:
    contract_path = str(DOCKER_ROOT / "build-contract.ps1").replace("'", "''")
    command = rf"""
. '{contract_path}'
$arguments = @(Get-ProductionDockerBuildArguments -ImageTag 'planner:test' -RepositoryRoot 'C:\repo')
$expected = @(
    'build', '--platform', 'linux/amd64', '--provenance=false', '--sbom=false',
    '--file', 'C:\repo\Dockerfile', '--tag', 'planner:test', 'C:\repo'
)
if (($arguments -join '|') -ne ($expected -join '|')) {{ exit 8 }}
Assert-ProductionDockerBuildHelp -HelpText '--platform value --provenance value --sbom value'
try {{
    Assert-ProductionDockerBuildHelp -HelpText '--platform value --provenance value'
    exit 4
}}
catch {{
    if ($_.Exception.Message -notmatch '--sbom') {{ exit 3 }}
}}
$descriptor = Assert-ProductionDockerImageJson -JsonText @'
[{{"Id":"sha256:abc","RepoTags":["planner:test"],"RepoDigests":[],"Os":"linux","Architecture":"amd64"}}]
'@ -ExpectedTag 'planner:test'
if ($descriptor.Platform -ne 'linux/amd64') {{ exit 7 }}
try {{
    Assert-ProductionDockerImageJson -JsonText @'
{{"Id":"sha256:def","RepoTags":["planner:test"],"RepoDigests":[],"Os":"linux","Architecture":"arm64"}}
'@ -ExpectedTag 'planner:test'
    exit 6
}}
catch {{
    if ($_.Exception.Message -notmatch 'linux/amd64') {{ exit 5 }}
}}
exit 0
"""

    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
