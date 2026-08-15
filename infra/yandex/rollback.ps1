[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot "config.psd1"),
    [string]$RevisionId,
    [switch]$Apply,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$settings = Import-DeploymentConfig -Path $Config
Assert-CommandAvailable -Name "yc" -InstallMessage "Install and initialize the Yandex Cloud CLI outside this script."
$container = Get-ExactYcResource -ListArguments @(
    "serverless", "container", "list"
) -Name $settings.ContainerName -FolderId $settings.FolderId
if (-not $container) {
    throw "Serverless Container '$($settings.ContainerName)' was not found."
}
$containerId = [string](Get-ObjectProperty $container "id")
$revisions = @(Invoke-YcJson -Arguments @(
    "serverless", "container", "revision", "list", "--container-id", $containerId
) -FolderId $settings.FolderId)
$activeRevision = $revisions | Where-Object {
    (Get-ObjectProperty $_ "status") -eq "ACTIVE"
} | Select-Object -First 1

if (-not $RevisionId) {
    $items = @()
    foreach ($revision in $revisions) {
        $items += "Revision $([string](Get-ObjectProperty $revision 'id')); status=$([string](Get-ObjectProperty $revision 'status')); image=$([string](Get-ObjectProperty $revision 'image'))"
    }
    if ($items.Count -eq 0) {
        $items += "No immutable revisions were returned for '$($settings.ContainerName)'."
    }
    Write-CloudPlan -Title "Available revisions (read-only)" -Items $items
    Write-Host "Specify -RevisionId to prepare a rollback plan. No state was modified." -ForegroundColor Yellow
    return
}

$targetRevision = $revisions | Where-Object {
    (Get-ObjectProperty $_ "id") -eq $RevisionId
} | Select-Object -First 1
if (-not $targetRevision) {
    throw "Revision '$RevisionId' does not belong to container '$($settings.ContainerName)'."
}
$activeRevisionId = if ($activeRevision) {
    [string](Get-ObjectProperty $activeRevision "id")
}
else {
    "<none>"
}
Write-CloudPlan -Title "Rollback plan (read-only)" -Items @(
    "Container: $($settings.ContainerName)",
    "Current active revision: $activeRevisionId",
    "Target immutable revision: $RevisionId",
    "Activate the target without deleting any revision or image.",
    "Run unauthenticated HTTPS cloud smoke after activation."
)

if (-not $Apply) {
    Write-Host "PLAN ONLY: no revision was activated and no resource was modified." -ForegroundColor Yellow
    return
}

[void](Confirm-CloudMutation -Operation "Rollback to revision $RevisionId" -Apply $Apply -Force:$Force)
Assert-YcHelpContains -Arguments @("serverless", "container", "rollback") `
    -RequiredFragments @("--revision-id")
[void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
    "serverless", "container", "rollback", "--id", $containerId,
    "--revision-id", $RevisionId
) -FolderId $settings.FolderId -Json)

$container = Invoke-YcJson -Arguments @(
    "serverless", "container", "get", "--id", $containerId
) -FolderId $settings.FolderId
$publicUrl = [string](Get-ObjectProperty $container "url")
if (-not $publicUrl) {
    throw "Rollback completed, but the container public URL could not be resolved for smoke."
}

$cloudSmoke = Join-Path $PSScriptRoot "smoke.ps1"
$powerShell = Get-CurrentPowerShellExecutable
[void](Invoke-NativeCommand -FilePath $powerShell -Arguments @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cloudSmoke,
    "-Config", (Resolve-Path -LiteralPath $Config).Path,
    "-Url", $publicUrl
))
Write-Host "Rollback completed and smoke passed. Revision history was preserved." -ForegroundColor Green
