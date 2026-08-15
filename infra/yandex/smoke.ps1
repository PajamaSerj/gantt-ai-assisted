[CmdletBinding()]
param(
    [string]$Url,
    [string]$Config = (Join-Path $PSScriptRoot "config.psd1"),
    [switch]$LiveAi,
    [ValidateRange(15, 300)]
    [int]$RetryWindowSeconds = 90
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if (-not $Url) {
    $settings = Import-DeploymentConfig -Path $Config
    Assert-CommandAvailable -Name "yc" -InstallMessage "Install and initialize the Yandex Cloud CLI outside this script."
    $container = Get-ExactYcResource -ListArguments @(
        "serverless", "container", "list"
    ) -Name $settings.ContainerName -FolderId $settings.FolderId
    if (-not $container) {
        throw "Serverless Container '$($settings.ContainerName)' was not found."
    }
    $container = Invoke-YcJson -Arguments @(
        "serverless", "container", "get", "--id", ([string](Get-ObjectProperty $container "id"))
    ) -FolderId $settings.FolderId
    $Url = [string](Get-ObjectProperty $container "url")
}

$baseUri = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$baseUri)) {
    throw "Cloud smoke URL must be absolute."
}
if ($baseUri.Scheme -ne "https") {
    throw "Cloud smoke URL must use HTTPS."
}
$origin = $baseUri.GetLeftPart([UriPartial]::Authority)
$client = New-CloudHttpClient -RequestTimeoutSeconds 20

try {
    $root = Invoke-CloudHttpRequest -Client $client -Method "GET" `
        -Uri ([Uri]::new("$origin/")) -ExpectedStatus @(200) `
        -RetryWindowSeconds $RetryWindowSeconds
    if ($root.Content -notmatch "AI Gantt Planner") {
        throw "GET / did not return the AI Gantt Planner application shell."
    }

    $assetMatch = [regex]::Match($root.Content, '(/assets/[^"'']+\.(?:js|css))')
    if (-not $assetMatch.Success) {
        throw "Application shell did not reference a built JS/CSS asset."
    }
    $asset = Invoke-CloudHttpRequest -Client $client -Method "GET" `
        -Uri ([Uri]::new("$origin$($assetMatch.Groups[1].Value)")) `
        -ExpectedStatus @(200) -RetryWindowSeconds 30
    if ($asset.ContentType -notmatch "(javascript|css)") {
        throw "Built asset returned an unexpected content type."
    }

    $health = Invoke-CloudHttpRequest -Client $client -Method "GET" `
        -Uri ([Uri]::new("$origin/api/health")) -ExpectedStatus @(200) `
        -RetryWindowSeconds 30
    $healthBody = $health.Content | ConvertFrom-Json
    if ($healthBody.status -ne "ok") {
        throw "Health response is invalid."
    }

    $seed = Invoke-CloudHttpRequest -Client $client -Method "GET" `
        -Uri ([Uri]::new("$origin/api/seed")) -ExpectedStatus @(200) `
        -RetryWindowSeconds 30
    $seedBody = $seed.Content | ConvertFrom-Json
    if (@($seedBody.tasks).Count -ne 7) {
        throw "Seed response does not contain exactly seven demo tasks."
    }

    $unknown = Invoke-CloudHttpRequest -Client $client -Method "GET" `
        -Uri ([Uri]::new("$origin/api/does-not-exist")) -ExpectedStatus @(404) `
        -RetryWindowSeconds 30
    if ($unknown.ContentType -notmatch "application/json") {
        throw "Unknown API route was served as SPA HTML instead of JSON 404."
    }

    if ($LiveAi) {
        $readOnlyMessage = [Text.Encoding]::UTF8.GetString(
            [Convert]::FromBase64String(
                "0J/QtdGA0LXRh9C40YHQu9C4INC30LDQtNCw0YfQuCDQsdC10Lcg0LjQt9C80LXQvdC10L3QuNGPINC/0LvQsNC90LAu"
            )
        )
        $chatRequest = @{
            message = $readOnlyMessage
            plan = $seedBody
            conversation_context = @()
        } | ConvertTo-Json -Depth 30 -Compress
        $chat = Invoke-CloudHttpRequest -Client $client -Method "POST" `
            -Uri ([Uri]::new("$origin/api/chat")) -ExpectedStatus @(200, 502, 503) `
            -RetryWindowSeconds $RetryWindowSeconds -JsonBody $chatRequest
        $chatBody = $chat.Content | ConvertFrom-Json
        if ($chatBody.status -eq "provider_error") {
            throw "Live AI smoke returned provider_error."
        }
        $originalPlan = $seedBody | ConvertTo-Json -Depth 30 -Compress
        $returnedPlan = $chatBody.plan | ConvertTo-Json -Depth 30 -Compress
        if ($originalPlan -ne $returnedPlan) {
            throw "Read-only live AI smoke mutated the plan."
        }
    }

    Write-Host "PASS: unauthenticated cloud smoke succeeded at $origin" -ForegroundColor Green
    if ($LiveAi) {
        Write-Host "PASS: optional read-only live AI smoke succeeded." -ForegroundColor Green
    }
}
catch {
    Write-Host "FAIL: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    $client.Dispose()
}
