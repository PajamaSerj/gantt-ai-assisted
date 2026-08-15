[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot "config.psd1"),
    [switch]$Apply,
    [switch]$Force,
    [switch]$AllowDirty,
    [switch]$SkipLocalSmoke
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
. (Join-Path $PSScriptRoot "..\docker\build-contract.ps1")

function Get-LocalProductionImageDescriptor {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ImageTag
    )

    $inspect = Invoke-NativeCommand -FilePath "docker" -Arguments @(
        "image", "inspect", $ImageTag
    )
    $json = $inspect.Output -join [Environment]::NewLine
    return (Assert-ProductionDockerImageJson -JsonText $json -ExpectedTag $ImageTag)
}

function Get-RemoteImmutableRegistryImage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RegistryId,
        [Parameter(Mandatory = $true)]
        [string]$RepositoryName,
        [Parameter(Mandatory = $true)]
        [string]$Tag,
        [Parameter(Mandatory = $true)]
        [string]$FolderId
    )

    $images = @(Invoke-YcJson -Arguments @(
        "container", "image", "list", "--registry-id", $RegistryId
    ) -FolderId $FolderId)
    return (Resolve-RegistryImageByTag -Images $images -RegistryId $RegistryId `
        -RepositoryName $RepositoryName -Tag $Tag)
}

function Wait-RemoteImmutableRegistryImage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RegistryId,
        [Parameter(Mandatory = $true)]
        [string]$RepositoryName,
        [Parameter(Mandatory = $true)]
        [string]$Tag,
        [Parameter(Mandatory = $true)]
        [string]$FolderId,
        [int]$Attempts = 6
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        $image = Get-RemoteImmutableRegistryImage -RegistryId $RegistryId `
            -RepositoryName $RepositoryName -Tag $Tag -FolderId $FolderId
        if ($image) {
            return $image
        }
        if ($attempt -lt $Attempts) {
            Start-Sleep -Seconds 2
        }
    }
    throw "Yandex Container Registry did not expose completed immutable tag '$RegistryId/$RepositoryName`:$Tag' with a digest after push; revision deployment was not attempted."
}

$settings = Import-DeploymentConfig -Path $Config
Assert-CommandAvailable -Name "yc" -InstallMessage "Install and initialize the Yandex Cloud CLI outside this script."
$repositoryRoot = Get-RepositoryRoot
$localSmokeScript = Join-Path $repositoryRoot "infra\docker\smoke.ps1"
$gitIdentity = Get-GitImageIdentity -RepositoryRoot $repositoryRoot -AllowDirty:$AllowDirty

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

$registryId = $null
$serviceAccountId = $null
$containerId = $null
$secretId = $null
if ($registry) { $registryId = [string](Get-ObjectProperty $registry "id") }
if ($serviceAccount) { $serviceAccountId = [string](Get-ObjectProperty $serviceAccount "id") }
if ($container) { $containerId = [string](Get-ObjectProperty $container "id") }
if ($secret) { $secretId = [string](Get-ObjectProperty $secret "id") }

$secretVersion = $null
if ($secret) {
    $secretVersion = Get-CurrentSecretVersionInfo -Secret $secret `
        -RequiredKey $settings.LockboxSecretKey -FolderId $settings.FolderId
}
$dockerAvailable = Test-DockerAvailable
$credentialHelperConfigured = Test-DockerCredentialHelper
$languageRoleReady = $false
$registryPullRoleReady = $false
$secretRoleReady = $false
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

$revisions = @()
$activeRevision = $null
if ($containerId) {
    $revisions = @(Invoke-YcJson -Arguments @(
        "serverless", "container", "revision", "list", "--container-id", $containerId
    ) -FolderId $settings.FolderId)
    $activeRevision = $revisions | Where-Object {
        (Get-ObjectProperty $_ "status") -eq "ACTIVE"
    } | Select-Object -First 1
}

$localImage = "ai-gantt-planner:$($gitIdentity.ShortSha)"
if ($registryId) {
    $remoteImage = "cr.yandex/$registryId/$($settings.RepositoryName):$($gitIdentity.ShortSha)"
}
else {
    $remoteImage = "cr.yandex/<registry-id>/$($settings.RepositoryName):$($gitIdentity.ShortSha)"
}

$blockers = @()
if (-not $registry) { $blockers += "Container Registry is missing; run bootstrap first." }
if (-not $serviceAccount) { $blockers += "Runtime service account is missing; run bootstrap first." }
if (-not $container) { $blockers += "Serverless Container metadata is missing; run bootstrap first." }
if (-not $secret) { $blockers += "Lockbox secret metadata is missing; run bootstrap first." }
if (-not ($secretVersion -and $secretVersion.IsReady)) { $blockers += "Active Lockbox version/key metadata is missing; complete the manual console step." }
if (-not $languageRoleReady) { $blockers += "Runtime role ai.languageModels.user is missing." }
if (-not $registryPullRoleReady) { $blockers += "Registry-scoped image pull role is missing." }
if (-not $secretRoleReady) { $blockers += "Secret-scoped payload viewer role is missing." }
if (-not $callerUseReady) { $blockers += "iam.serviceAccounts.user for the caller is not directly confirmed; automation will not grant it." }
if (-not $dockerAvailable) { $blockers += "Docker CLI/daemon is unavailable." }
if (-not $credentialHelperConfigured) { $blockers += "Docker credential helper for cr.yandex is not configured." }
if (-not (Test-Path -LiteralPath $localSmokeScript -PathType Leaf)) { $blockers += "Accepted local Docker smoke script is missing." }
if (-not $settings.Public) { $blockers += "Public=false is incompatible with the accepted unauthenticated demo and cloud-smoke contract." }

$plan = @(
    "Git commit: $($gitIdentity.FullSha)",
    "Immutable local image: $localImage",
    "Immutable remote image: $remoteImage",
    "Production image contract: linux/amd64 single manifest; provenance and SBOM attestations disabled for this registry path.",
    "Run accepted local Docker smoke before push: $(-not $SkipLocalSmoke)",
    "Push only the immutable Git-SHA tag.",
    "Deploy a new revision; preserve every previous revision and image.",
    "Attach runtime service account '$($settings.ServiceAccountName)'.",
    "Set non-secret provider/folder environment variables from config.",
    "Attach Lockbox by secret ID, active version ID, configured key, and target environment variable.",
    "Use the current Preview integration for Lockbox-to-Serverless-Container attachment.",
    "Run unauthenticated HTTPS cloud smoke after revision activation."
)
if ($activeRevision) {
    $plan += "Previous active revision available for rollback: $([string](Get-ObjectProperty $activeRevision 'id'))"
}
Write-CloudPlan -Title "Deployment plan (read-only)" -Items $plan
if ($blockers.Count -gt 0) {
    Write-CloudPlan -Title "Deployment blockers" -Items $blockers
}

if (-not $Apply) {
    Write-Host "PLAN ONLY: no image was built/pushed and no revision, IAM, Lockbox, or container state was modified." -ForegroundColor Yellow
    return
}

if ($blockers.Count -gt 0) {
    throw "Deployment preflight failed. Resolve every reported blocker before using -Apply."
}
[void](Confirm-CloudMutation -Operation "Deploy immutable revision $($gitIdentity.ShortSha)" -Apply $Apply -Force:$Force)
Assert-YcHelpContains -Arguments @("serverless", "container", "revision", "deploy") `
    -RequiredFragments @("--image", "--service-account-id", "--environment", "--secret", "version-id", "environment-variable")

$imagePushed = $false
$revisionDeployed = $false
$newRevisionId = $null
$previousRevisionId = $null
if ($activeRevision) {
    $previousRevisionId = [string](Get-ObjectProperty $activeRevision "id")
}

try {
    if ($SkipLocalSmoke) {
        $dockerBuildHelp = Invoke-NativeCommand -FilePath "docker" -Arguments @(
            "build", "--help"
        )
        Assert-ProductionDockerBuildHelp `
            -HelpText ($dockerBuildHelp.Output -join [Environment]::NewLine)
        $productionBuildArguments = Get-ProductionDockerBuildArguments `
            -ImageTag $localImage -RepositoryRoot $repositoryRoot
        [void](Invoke-NativeCommand -FilePath "docker" -Arguments $productionBuildArguments)
    }
    else {
        $powerShell = Get-CurrentPowerShellExecutable
        [void](Invoke-NativeCommand -FilePath $powerShell -Arguments @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $localSmokeScript,
            "-ImageTag", $localImage
        ))
    }

    [void](Get-LocalProductionImageDescriptor -ImageTag $localImage)

    [void](Invoke-NativeCommand -FilePath "docker" -Arguments @(
        "tag", $localImage, $remoteImage
    ))
    $taggedLocalImage = Get-LocalProductionImageDescriptor -ImageTag $remoteImage
    $remoteRepository = "cr.yandex/$registryId/$($settings.RepositoryName)"
    $existingRemoteImage = Get-RemoteImmutableRegistryImage -RegistryId $registryId `
        -RepositoryName $settings.RepositoryName -Tag $gitIdentity.ShortSha `
        -FolderId $settings.FolderId
    $verifiedRemoteImage = $null
    if ($existingRemoteImage) {
        $knownLocalDigest = Get-ProductionDockerRepositoryDigest `
            -ImageDescriptor $taggedLocalImage -Repository $remoteRepository
        if ((-not $knownLocalDigest) -or ($knownLocalDigest -cne $existingRemoteImage.Digest)) {
            throw "Immutable remote tag '$remoteImage' already exists with digest '$($existingRemoteImage.Digest)', but the local image cannot be proven identical. Refusing to overwrite the tag."
        }
        $verifiedRemoteImage = $existingRemoteImage
        Write-Host "Existing immutable remote image matches the local digest; push is not repeated."
    }
    else {
        [void](Invoke-NativeCommand -FilePath "docker" -Arguments @(
            "push", $remoteImage
        ))
        $imagePushed = $true
        $verifiedRemoteImage = Wait-RemoteImmutableRegistryImage -RegistryId $registryId `
            -RepositoryName $settings.RepositoryName -Tag $gitIdentity.ShortSha `
            -FolderId $settings.FolderId

        $pushedLocalImage = Get-LocalProductionImageDescriptor -ImageTag $remoteImage
        $pushedLocalDigest = Get-ProductionDockerRepositoryDigest `
            -ImageDescriptor $pushedLocalImage -Repository $remoteRepository
        if ($pushedLocalDigest -and ($pushedLocalDigest -cne $verifiedRemoteImage.Digest)) {
            throw "Remote digest '$($verifiedRemoteImage.Digest)' does not match local pushed digest '$pushedLocalDigest'; revision deployment was not attempted."
        }
    }
    if (-not $verifiedRemoteImage) {
        throw "Immutable remote image verification did not complete; revision deployment was not attempted."
    }

    $environment = "YANDEX_CLOUD_FOLDER_ID=$($settings.FolderId),AI_MODEL=$($settings.AiModel),AI_BASE_URL=$($settings.AiBaseUrl)"
    $secretAttachment = "environment-variable=YANDEX_CLOUD_API_KEY,id=$secretId,version-id=$($secretVersion.VersionId),key=$($settings.LockboxSecretKey)"
    $revision = Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
        "serverless", "container", "revision", "deploy",
        "--container-id", $containerId,
        "--image", $remoteImage,
        "--cores", [string]$settings.Cores,
        "--memory", [string]$settings.Memory,
        "--execution-timeout", [string]$settings.ExecutionTimeout,
        "--concurrency", [string]$settings.Concurrency,
        "--service-account-id", $serviceAccountId,
        "--environment", $environment,
        "--secret", $secretAttachment
    ) -FolderId $settings.FolderId -Json
    $newRevisionId = [string](Get-ObjectProperty $revision "id")
    $revisionDeployed = $true

    $deployedRevisions = @(Invoke-YcJson -Arguments @(
        "serverless", "container", "revision", "list", "--container-id", $containerId
    ) -FolderId $settings.FolderId)
    $newActiveRevision = $deployedRevisions | Where-Object {
        (Get-ObjectProperty $_ "status") -eq "ACTIVE"
    } | Select-Object -First 1
    if ($newActiveRevision) {
        $newRevisionId = [string](Get-ObjectProperty $newActiveRevision "id")
    }
    if (-not $newRevisionId) {
        throw "Revision deployment returned no resolvable active revision ID."
    }

    if ($settings.Public -and (-not (Test-PublicContainer -ContainerId $containerId -FolderId $settings.FolderId))) {
        [void](Invoke-YcMutation -ApplyAuthorized $true -Arguments @(
            "serverless", "container", "allow-unauthenticated-invoke", "--id", $containerId
        ) -FolderId $settings.FolderId)
    }

    $container = Invoke-YcJson -Arguments @(
        "serverless", "container", "get", "--id", $containerId
    ) -FolderId $settings.FolderId
    $publicUrl = [string](Get-ObjectProperty $container "url")
    if (-not $publicUrl) {
        throw "The deployed container did not expose a public URL."
    }

    $cloudSmoke = Join-Path $PSScriptRoot "smoke.ps1"
    $powerShell = Get-CurrentPowerShellExecutable
    [void](Invoke-NativeCommand -FilePath $powerShell -Arguments @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cloudSmoke,
        "-Config", (Resolve-Path -LiteralPath $Config).Path,
        "-Url", $publicUrl
    ))

    Write-Host "Deployment succeeded." -ForegroundColor Green
    Write-Host "URL: $publicUrl"
    Write-Host "Revision: $newRevisionId"
    if ($previousRevisionId) {
        Write-Host "Rollback: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\yandex\rollback.ps1 -Config $Config -RevisionId $previousRevisionId -Apply"
    }
}
catch {
    if ($imagePushed -and (-not $revisionDeployed)) {
        Write-Warning "The immutable image was pushed but revision deployment failed. Orphan image retained: $remoteImage"
    }
    if ($revisionDeployed) {
        Write-Warning "The new revision was deployed but a later gate failed. No automatic rollback was performed."
        if ($previousRevisionId) {
            Write-Warning "Rollback command: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\yandex\rollback.ps1 -Config $Config -RevisionId $previousRevisionId -Apply"
        }
    }
    throw
}
