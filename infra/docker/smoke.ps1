[CmdletBinding()]
param(
    [string]$ImageTag = "ai-gantt-planner:local",
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,
    [string]$EnvFile,
    [switch]$SkipBuild,
    [switch]$KeepContainer
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
. (Join-Path $PSScriptRoot "build-contract.ps1")
$containerName = "ai-gantt-planner-smoke-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$containerCreated = $false
$httpClient = [System.Net.Http.HttpClient]::new()
$httpClient.Timeout = [TimeSpan]::FromSeconds(5)
$baseUri = "http://127.0.0.1:$Port"

function Assert-Smoke {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-SmokeResponse {
    param([string]$Path)

    $response = $httpClient.GetAsync("$baseUri$Path").GetAwaiter().GetResult()
    try {
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $contentType = $response.Content.Headers.ContentType.MediaType
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Content = $content
            ContentType = $contentType
        }
    }
    finally {
        $response.Dispose()
    }
}

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker CLI is not available. Install/start Docker outside this script, then rerun."
    }

    & docker info *> $null
    Assert-Smoke ($LASTEXITCODE -eq 0) "Docker daemon is not available."

    if (-not $SkipBuild) {
        $buildHelp = (& docker build --help 2>&1 | Out-String)
        Assert-Smoke ($LASTEXITCODE -eq 0) "Could not inspect the installed Docker build contract."
        Assert-ProductionDockerBuildHelp -HelpText $buildHelp
        $buildArguments = Get-ProductionDockerBuildArguments `
            -ImageTag $ImageTag -RepositoryRoot $repositoryRoot
        & docker @buildArguments
        Assert-Smoke ($LASTEXITCODE -eq 0) "docker build failed."
    }

    $imageJson = (& docker image inspect $ImageTag 2>&1 | Out-String)
    Assert-Smoke ($LASTEXITCODE -eq 0) "Local Docker tag '$ImageTag' could not be inspected."
    [void](Assert-ProductionDockerImageJson -JsonText $imageJson -ExpectedTag $ImageTag)

    $runArguments = @(
        "run",
        "--detach",
        "--name", $containerName,
        "--publish", "${Port}:${Port}"
    )
    if ($EnvFile) {
        $resolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
        $runArguments += @("--env-file", $resolvedEnvFile)
    }
    $runArguments += @("--env", "PORT=$Port", $ImageTag)

    $containerId = (& docker @runArguments 2>&1 | Out-String).Trim()
    Assert-Smoke ($LASTEXITCODE -eq 0) "docker run failed: $containerId"
    $containerCreated = $true

    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $health = Get-SmokeResponse "/api/health"
            if ($health.StatusCode -eq 200) {
                $ready = $true
                break
            }
        }
        catch {
        }
        Start-Sleep -Milliseconds 750
    }
    Assert-Smoke $ready "Container did not become ready within 45 seconds."

    $root = Get-SmokeResponse "/"
    Assert-Smoke ($root.StatusCode -eq 200) "GET / did not return 200."
    Assert-Smoke ($root.Content -match "AI Gantt Planner") "GET / did not return the application shell."

    $assetMatch = [regex]::Match($root.Content, '(/assets/[^"'']+\.(?:js|css))')
    Assert-Smoke $assetMatch.Success "Application shell did not reference a built asset."
    $asset = Get-SmokeResponse $assetMatch.Groups[1].Value
    Assert-Smoke ($asset.StatusCode -eq 200) "Built asset did not return 200."
    Assert-Smoke ($asset.ContentType -match "(javascript|css)") "Built asset has an unexpected content type."

    $healthBody = $health.Content | ConvertFrom-Json
    Assert-Smoke ($healthBody.status -eq "ok") "Health response is invalid."

    $seed = Get-SmokeResponse "/api/seed"
    Assert-Smoke ($seed.StatusCode -eq 200) "GET /api/seed did not return 200."
    $seedBody = $seed.Content | ConvertFrom-Json
    Assert-Smoke ($seedBody.tasks.Count -eq 7) "Seed response does not contain exactly seven tasks."

    $unknownApi = Get-SmokeResponse "/api/does-not-exist"
    Assert-Smoke ($unknownApi.StatusCode -eq 404) "Unknown API route did not return 404."
    Assert-Smoke ($unknownApi.ContentType -eq "application/json") "Unknown API route returned SPA HTML."

    $running = (& docker inspect --format "{{.State.Running}}" $containerName 2>&1 | Out-String).Trim()
    Assert-Smoke (($LASTEXITCODE -eq 0) -and ($running -eq "true")) "Container is not running."

    # Uvicorn writes normal INFO logs to stderr. cmd.exe performs the
    # redirection before Windows PowerShell 5.1 can convert it into
    # a terminating NativeCommandError.
    $logs = (& cmd.exe /d /c "docker logs $containerName 2>&1" | Out-String)
    $logsExitCode = $LASTEXITCODE
    Assert-Smoke ($logsExitCode -eq 0) "Could not read container logs."
    Assert-Smoke ($logs -notmatch "Traceback") "Container logs contain a Python traceback."

    $runtimeUid = (& docker exec $containerName id -u 2>&1 | Out-String).Trim()
    Assert-Smoke (($LASTEXITCODE -eq 0) -and ($runtimeUid -ne "0")) "Container runs as root."

    Write-Host "PASS: production container smoke checks succeeded at $baseUri" -ForegroundColor Green
}
catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    $httpClient.Dispose()
    if ($containerCreated -and -not $KeepContainer) {
        & docker rm --force $containerName *> $null
    }
}


