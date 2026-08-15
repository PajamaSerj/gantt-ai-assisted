from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
YANDEX_ROOT = REPOSITORY_ROOT / "infra" / "yandex"
SCRIPT_NAMES = ("common.ps1", "bootstrap.ps1", "deploy.ps1", "smoke.ps1", "rollback.ps1")


def script(name: str) -> str:
    return (YANDEX_ROOT / name).read_text(encoding="utf-8")


def run_windows_powershell(command: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            command,
        ],
        capture_output=True,
        check=False,
        text=True,
    )


def test_yandex_delivery_files_are_present() -> None:
    expected = {
        "config.example.psd1",
        "common.ps1",
        "bootstrap.ps1",
        "deploy.ps1",
        "smoke.ps1",
        "rollback.ps1",
        "README.md",
    }

    actual = {path.name for path in YANDEX_ROOT.iterdir() if path.is_file()}
    actual.discard("config.psd1")
    assert expected == actual


def test_local_yandex_configuration_and_state_are_ignored() -> None:
    gitignore = (REPOSITORY_ROOT / ".gitignore").read_text(encoding="utf-8")
    dockerignore = (REPOSITORY_ROOT / ".dockerignore").read_text(encoding="utf-8")

    for pattern in (
        "infra/yandex/config.psd1",
        "infra/yandex/*.local.json",
        "infra/yandex/.state/",
    ):
        assert pattern in gitignore
        assert pattern.rstrip("/") in dockerignore


def test_config_is_non_secret_and_validated_by_an_allowlist() -> None:
    template = (YANDEX_ROOT / "config.example.psd1").read_text(encoding="utf-8")
    common = script("common.ps1")

    assert "FolderId" in template
    assert "LockboxSecretName" in template
    assert "LockboxSecretKey" in template
    assert "AiModel" in template
    assert "AiBaseUrl" in template
    assert "Public" in template
    assert "API key value" not in template
    assert "ApiKeyValue" not in template
    assert "Password" not in template
    assert "AllowedConfigKeys" in common
    assert "ApiKeyValue" in common
    assert "SecretPayload" in common


def test_plan_guards_precede_every_mutating_entry_point() -> None:
    mutation_markers = {
        "bootstrap.ps1": (
            '"create"',
            '"add-access-binding"',
            '"configure-docker"',
            '"allow-unauthenticated-invoke"',
        ),
        "deploy.ps1": (
            '"build"',
            '"push"',
            '"revision", "deploy"',
        ),
        "rollback.ps1": ('"rollback"',),
    }

    for name, markers in mutation_markers.items():
        content = script(name)
        guard = content.index("if (-not $Apply)")
        for marker in markers:
            assert content.index(marker) > guard, f"{marker} is not behind {name}'s Apply guard"


def test_mutations_require_apply_and_confirmation() -> None:
    for name in ("bootstrap.ps1", "deploy.ps1", "rollback.ps1"):
        content = script(name)
        assert "[switch]$Apply" in content
        assert "[switch]$Force" in content
        assert "Confirm-CloudMutation" in content
        assert "if (-not $Apply)" in content

    common = script("common.ps1")
    assert "Invoke-YcMutation" in common
    assert "ApplyAuthorized" in common


def test_secret_and_iam_safety_contract() -> None:
    scripts = "\n".join(script(name) for name in SCRIPT_NAMES)

    assert "lockbox payload get" not in scripts.lower()
    assert '"payload", "get"' not in scripts.lower()
    assert '"--payload"' not in scripts
    assert "[string]$ApiKey" not in scripts
    assert "ApiKey =" not in scripts
    assert "ai.languageModels.user" in scripts
    assert "container-registry.images.puller" in scripts
    assert "lockbox.payloadViewer" in scripts
    for broad_role in ("admin", "editor", "resource-manager.admin"):
        assert f'"{broad_role}"' not in scripts


def test_deploy_uses_immutable_sha_lockbox_and_local_gate() -> None:
    deploy = script("deploy.ps1")

    smoke_index = deploy.index("infra\\docker\\smoke.ps1")
    push_index = deploy.index('"push"')
    assert smoke_index < push_index
    assert "ShortSha" in deploy
    assert "cr.yandex" in deploy
    assert '"--secret"' in deploy
    assert "version-id=" in deploy
    assert "key=" in deploy
    assert "environment-variable=YANDEX_CLOUD_API_KEY" in deploy
    assert '"delete"' not in deploy


def test_rollback_preserves_history_and_requires_target() -> None:
    rollback = script("rollback.ps1")

    assert "[string]$RevisionId" in rollback
    assert '"revision", "list"' in rollback
    assert "if (-not $RevisionId)" in rollback
    assert '"--revision-id"' in rollback
    assert '"delete"' not in rollback
    assert "smoke.ps1" in rollback


def test_cloud_smoke_is_https_unauthenticated_and_same_origin() -> None:
    smoke = script("smoke.ps1")

    assert 'Scheme -ne "https"' in smoke
    assert "/api/health" in smoke
    assert "/api/seed" in smoke
    assert "/api/does-not-exist" in smoke
    assert "/api/chat" in smoke
    assert "Authorization" not in smoke
    assert "provider_error" in smoke
    assert "LiveAi" in smoke


def test_scripts_scope_yc_resource_operations_to_folder() -> None:
    common = script("common.ps1")

    assert '"--folder-id"' in common
    assert "Invoke-YcJson" in common
    assert "Invoke-YcMutation" in common


@pytest.mark.skipif(
    shutil.which("powershell.exe") is None,
    reason="Windows PowerShell 5.1 is not available on this host",
)
def test_config_validation_accepts_template_shape_and_rejects_credentials(
    tmp_path: Path,
) -> None:
    template = (YANDEX_ROOT / "config.example.psd1").read_text(encoding="utf-8")
    valid = template.replace("<folder-id>", "b1g00000000000000000")
    valid_path = tmp_path / "valid.psd1"
    invalid_path = tmp_path / "invalid.psd1"
    valid_path.write_text(valid, encoding="utf-8")
    invalid_path.write_text(
        valid.replace("\n}", "\n    ApiKeyValue = 'must-not-be-accepted'\n}"),
        encoding="utf-8",
    )
    common_path = str(YANDEX_ROOT / "common.ps1").replace("'", "''")
    valid_arg = str(valid_path).replace("'", "''")
    invalid_arg = str(invalid_path).replace("'", "''")
    command = rf"""
. '{common_path}'
Import-DeploymentConfig -Path '{valid_arg}' | Out-Null
try {{
    Import-DeploymentConfig -Path '{invalid_arg}' | Out-Null
    exit 9
}}
catch {{
    if ($_.Exception.Message -notmatch 'Forbidden credential-bearing') {{ exit 8 }}
}}
exit 0
"""

    result = run_windows_powershell(command)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "must-not-be-accepted" not in result.stdout + result.stderr


@pytest.mark.skipif(
    shutil.which("powershell.exe") is None,
    reason="Windows PowerShell 5.1 is not available on this host",
)
def test_common_helper_refuses_mutation_without_apply() -> None:
    common_path = str(YANDEX_ROOT / "common.ps1").replace("'", "''")
    command = rf"""
. '{common_path}'
try {{
    Invoke-YcMutation -ApplyAuthorized $false -Arguments @('should-not-run') -FolderId 'b1g00000000000000000'
    exit 9
}}
catch {{
    if ($_.Exception.Message -notmatch '-Apply authorization is required') {{ exit 8 }}
}}
exit 0
"""

    result = run_windows_powershell(command)

    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.skipif(
    shutil.which("powershell.exe") is None,
    reason="Windows PowerShell 5.1 is not available on this host",
)
def test_native_helper_preserves_quoted_arguments_and_stdout() -> None:
    common_path = str(YANDEX_ROOT / "common.ps1").replace("'", "''")
    command = rf"""
. '{common_path}'
$result = Invoke-NativeCommand -FilePath 'powershell.exe' -Arguments @(
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Console]::Out.Write("value with spaces")'
)
if (($result.Output -join '') -ne 'value with spaces') {{ exit 8 }}
exit 0
"""

    result = run_windows_powershell(command)

    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.skipif(
    shutil.which("powershell.exe") is None,
    reason="Windows PowerShell 5.1 is not available on this host",
)
def test_windows_powershell_51_parser_accepts_all_scripts() -> None:
    escaped_root = str(YANDEX_ROOT).replace("'", "''")
    command = rf"""& {{
param([string]$Root)
$errors = @()
Get-ChildItem -LiteralPath $Root -Filter *.ps1 | ForEach-Object {{
    $tokens = $null
    $fileErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $_.FullName,
        [ref]$tokens,
        [ref]$fileErrors
    )
    $errors += $fileErrors
}}
if ($errors.Count -gt 0) {{
    $errors | ForEach-Object {{ Write-Error $_.Message }}
    exit 1
}}
}} '{escaped_root}'
"""
    result = run_windows_powershell(command)

    assert result.returncode == 0, result.stdout + result.stderr
