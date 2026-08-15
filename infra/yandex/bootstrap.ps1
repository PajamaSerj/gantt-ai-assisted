[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot "config.psd1"),
    [switch]$Apply,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$settings = Import-DeploymentConfig -Path $Config
Assert-CommandAvailable -Name "yc" -InstallMessage "Install and initialize the Yandex Cloud CLI outside this script."

$activeProfile = Get-YcActiveProfile
$currentFolder = Get-YcConfiguredFolder
$folderMatches = ($currentFolder -eq [string]$settings.FolderId)
$dockerAvailable = Test-DockerAvailable
$credentialHelperConfigured = Test-DockerCredentialHelper

$registry = Get-ExactYcResource -ListArguments @(
    "container", "registry", "list"
) -Name $settings.RegistryName -FolderId $settings.FolderId
$serviceAccount = Get-ExactYcResource -ListArguments @(
    "iam", "service-account", "list"
) -Name $settings.ServiceAccountName -FolderId $settings.FolderId
$container = Get-ExactYcResource -ListArguments @(
    "serverless", "container", "list"
) -Name $settings.ContainerName -FolderId $settings.FolderId
$secret = Get-ExactYcResource -ListArguments @(
    "lockbox", "secret", "list"
) -Name $settings.LockboxSecretName -FolderId $settings.FolderId

$serviceAccountId = $null
$registryId = $null
$containerId = $null
$secretId = $null
if ($serviceAccount) { $serviceAccountId = [string](Get-ObjectProperty $serviceAccount "id") }
if ($registry) { $registryId = [string](Get-ObjectProperty $registry "id") }
if ($container) { $containerId = [string](Get-ObjectProperty $container "id") }
if ($secret) { $secretId = [string](Get-ObjectProperty $secret "id") }

$languageRoleReady = $false
$registryPullRoleReady = $false
$secretRoleReady = $false
$publicReady = $false
$secretVersion = $null
$callerUseReady = $false

if ($serviceAccountId) {
    $languageRoleReady = Test-YcAccessBinding -ListArguments @(
        "resource-manager", "folder", "list-access-bindings", "--id", $settings.FolderId
    ) -Role "ai.languageModels.user" -SubjectId $serviceAccountId -FolderId $settings.FolderId
    if ($registryId) {
        $registryPullRoleReady = Test-YcAccessBinding -ListArguments @(
            "container", "registry", "list-access-bindings", "--id", $registryId
        ) -Role "container-registry.images.puller" -SubjectId $serviceAccountId -FolderId $settings.FolderId
    }
    if ($secretId) {
        $secretRoleReady = Test-YcAccessBinding -ListArguments @(
            "lockbox", "secret", "list-access-bindings", "--id", $secretId
        ) -Role "lockbox.payloadViewer" -SubjectId $serviceAccountId -FolderId $settings.FolderId
    }
    $callerId = Get-YcCallerId -FolderId $settings.FolderId
    if ($callerId) {
        $callerUseReady = Test-CallerCanUseServiceAccount -CallerId $callerId `
            -ServiceAccountId $serviceAccountId -FolderId $settings.FolderId
    }
}
if ($containerId -and $settings.Public) {
    $publicReady = Test-PublicContainer -ContainerId $containerId -FolderId $settings.FolderId
}
if ($secret) {
    $secretVersion = Get-CurrentSecretVersionInfo -Secret $secret `
        -RequiredKey $settings.LockboxSecretKey -FolderId $settings.FolderId
}

$statusItems = @(
    "Active yc profile: $activeProfile",
    "Configured folder: $($settings.FolderId)",
    "Current yc folder: $(if ($currentFolder) { $currentFolder } else { '<not configured>' })",
    "Folder match: $folderMatches",
    "Docker daemon available: $dockerAvailable",
    "Docker credential helper for cr.yandex: $credentialHelperConfigured",
    "Container Registry '$($settings.RegistryName)': $([bool]$registry)",
    "Runtime service account '$($settings.ServiceAccountName)': $([bool]$serviceAccount)",
    "Role ai.languageModels.user: $languageRoleReady",
    "Registry-scoped role container-registry.images.puller: $registryPullRoleReady",
    "Serverless Container '$($settings.ContainerName)': $([bool]$container)",
    "Lockbox secret metadata '$($settings.LockboxSecretName)': $([bool]$secret)",
    "Lockbox active version/key metadata ready: $([bool]($secretVersion -and $secretVersion.IsReady))",
    "Secret-scoped role lockbox.payloadViewer: $secretRoleReady",
    "Caller iam.serviceAccounts.user directly confirmed: $callerUseReady",
    "Public unauthenticated invocation ready: $publicReady"
)
Write-CloudPlan -Title "Yandex Cloud bootstrap inspection (read-only)" -Items $statusItems

$actions = @()
if (-not $folderMatches) { $actions += "Use explicit folder scope '$($settings.FolderId)'; do not change the active yc profile." }
if (-not $registry) { $actions += "Create Container Registry '$($settings.RegistryName)'." }
if (-not $serviceAccount) { $actions += "Create runtime service account '$($settings.ServiceAccountName)'." }
if (-not $languageRoleReady) { $actions += "Add folder role ai.languageModels.user to the runtime service account." }
if (-not $registryPullRoleReady) { $actions += "Add registry-scoped role container-registry.images.puller to the runtime service account." }
if (-not $container) { $actions += "Create Serverless Container metadata '$($settings.ContainerName)'." }
if (-not $secret) { $actions += "Create Lockbox secret metadata '$($settings.LockboxSecretName)' without a payload." }
if (-not $secretRoleReady) { $actions += "Add secret-scoped role lockbox.payloadViewer to the runtime service account." }
if ((-not $credentialHelperConfigured) -and $dockerAvailable) {
    $actions += "Configure the yc Docker credential helper for cr.yandex."
}
elseif (-not $credentialHelperConfigured) {
    $actions += "Docker is unavailable; credential-helper configuration remains blocked and will be skipped."
}
if ($settings.Public -and (-not $publicReady)) { $actions += "Allow unauthenticated invocation of the container." }
if (-not ($secretVersion -and $secretVersion.IsReady)) {
    $actions += "Stop for the manual Lockbox console step; no credential value is accepted by automation."
}
if (-not $callerUseReady) {
    $actions += "Report that iam.serviceAccounts.user for the current caller is not directly confirmed; do not grant it automatically."
}
if ($actions.Count -eq 0) {
    $actions += "No bootstrap mutations are required."
}
Write-CloudPlan -Title "Actions that -Apply would perform" -Items $actions

if (-not $Apply) {
    Write-Host "PLAN ONLY: no Yandex Cloud, IAM, Lockbox payload, or Docker configuration was modified." -ForegroundColor Yellow
    return
}

[void](Confirm-CloudMutation -Operation "Bootstrap" -Apply $Apply -Force:$Force)
Assert-YcHelpContains -Arguments @("lockbox", "secret", "create") `
    -RequiredFragments @("--name")
Assert-YcHelpContains -Arguments @("serverless", "container", "allow-unauthenticated-invoke") `
    -RequiredFragments @("--id")

if (-not $registry) {
    $registry = Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "container", "registry", "create", "--name", $settings.RegistryName
    ) -FolderId $settings.FolderId -Json
    $registryId = [string](Get-ObjectProperty $registry "id")
}
if (-not $serviceAccount) {
    $serviceAccount = Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "iam", "service-account", "create", "--name", $settings.ServiceAccountName
    ) -FolderId $settings.FolderId -Json
    $serviceAccountId = [string](Get-ObjectProperty $serviceAccount "id")
}
if (-not $languageRoleReady) {
    [void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "resource-manager", "folder", "add-access-binding", "--id", $settings.FolderId,
        "--role", "ai.languageModels.user", "--service-account-id", $serviceAccountId
    ) -FolderId $settings.FolderId)
}
if (-not $registryPullRoleReady) {
    [void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "container", "registry", "add-access-binding", "--id", $registryId,
        "--role", "container-registry.images.puller", "--service-account-id", $serviceAccountId
    ) -FolderId $settings.FolderId)
}
if (-not $container) {
    $container = Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "serverless", "container", "create", "--name", $settings.ContainerName
    ) -FolderId $settings.FolderId -Json
    $containerId = [string](Get-ObjectProperty $container "id")
}
if (-not $secret) {
    $secret = Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "lockbox", "secret", "create", "--name", $settings.LockboxSecretName,
        "--description", "Runtime credential metadata for AI Gantt Planner"
    ) -FolderId $settings.FolderId -Json
    $secretId = [string](Get-ObjectProperty $secret "id")
}
if (-not $secretRoleReady) {
    [void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "lockbox", "secret", "add-access-binding", "--id", $secretId,
        "--role", "lockbox.payloadViewer", "--service-account-id", $serviceAccountId
    ) -FolderId $settings.FolderId)
}
if ((-not $credentialHelperConfigured) -and $dockerAvailable) {
    [void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "container", "registry", "configure-docker"
    ) -FolderId $settings.FolderId)
}
if ($settings.Public -and (-not $publicReady)) {
    [void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "serverless", "container", "allow-unauthenticated-invoke", "--id", $containerId
    ) -FolderId $settings.FolderId)
}

$secretVersion = Get-CurrentSecretVersionInfo -Secret $secret `
    -RequiredKey $settings.LockboxSecretKey -FolderId $settings.FolderId
if (-not $secretVersion.IsReady) {
    Write-Host ""
    Write-Host "Manual Lockbox handoff required in the Yandex Cloud console:" -ForegroundColor Yellow
    Write-Host "  secret: $($settings.LockboxSecretName)"
    Write-Host "  key: $($settings.LockboxSecretKey)"
    Write-Host "  value: <existing Yandex AI Studio API key>"
    Write-Host "Then rerun bootstrap.ps1 without -Apply and confirm that version/key metadata is ready."
    throw "Bootstrap is intentionally incomplete until the manual Lockbox version is active."
}

if (-not $dockerAvailable) {
    throw "Bootstrap cloud resources may be ready, but Docker is unavailable and credential-helper readiness cannot be completed."
}
if (-not (Test-DockerCredentialHelper)) {
    throw "Docker credential helper for cr.yandex is not ready after bootstrap."
}

if (-not $callerUseReady) {
    Write-Warning "iam.serviceAccounts.user for the current caller was not directly confirmed. Automation will not grant caller permissions; ask a cloud administrator to verify the effective binding before deploy."
}
Write-Host "Bootstrap apply completed idempotently. Re-run plan mode before deployment." -ForegroundColor Green
