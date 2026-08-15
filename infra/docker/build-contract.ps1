Set-StrictMode -Version 2.0

$script:ProductionDockerPlatform = "linux/amd64"

function Get-ProductionDockerBuildArguments {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ImageTag,
        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot
    )

    return @(
        "build",
        "--platform", $script:ProductionDockerPlatform,
        "--provenance=false",
        "--sbom=false",
        "--file", (Join-Path $RepositoryRoot "Dockerfile"),
        "--tag", $ImageTag,
        $RepositoryRoot
    )
}

function Assert-ProductionDockerBuildHelp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$HelpText
    )

    foreach ($requiredFlag in @("--platform", "--provenance", "--sbom")) {
        if ($HelpText -notmatch [regex]::Escape($requiredFlag)) {
            throw "Installed Docker CLI does not support the required '$requiredFlag' production build flag. Upgrade Docker outside this automation; no build or push was attempted."
        }
    }
}

function Get-DockerInspectProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }
    return $null
}

function Assert-ProductionDockerImageJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$JsonText,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedTag
    )

    try {
        $parsed = $JsonText | ConvertFrom-Json
        $images = @()
        foreach ($candidate in $parsed) {
            $images += $candidate
        }
    }
    catch {
        throw "docker image inspect returned invalid JSON for '$ExpectedTag'."
    }
    if ($images.Count -ne 1) {
        throw "docker image inspect did not resolve exactly one local image for '$ExpectedTag'."
    }

    $image = $images[0]
    $imageId = [string](Get-DockerInspectProperty -InputObject $image -Name "Id")
    $operatingSystem = [string](Get-DockerInspectProperty -InputObject $image -Name "Os")
    $architecture = [string](Get-DockerInspectProperty -InputObject $image -Name "Architecture")
    $repoTags = @((Get-DockerInspectProperty -InputObject $image -Name "RepoTags"))
    $repoDigests = @((Get-DockerInspectProperty -InputObject $image -Name "RepoDigests"))
    $tagResolved = $false
    foreach ($repoTag in $repoTags) {
        if ([string]::Equals([string]$repoTag, $ExpectedTag, [StringComparison]::Ordinal)) {
            $tagResolved = $true
            break
        }
    }

    if (-not $imageId) {
        throw "Local Docker tag '$ExpectedTag' resolved to an image without an ID."
    }
    if (-not $tagResolved) {
        throw "Local Docker image exists, but the expected tag '$ExpectedTag' does not resolve to it."
    }
    $actualPlatform = "$operatingSystem/$architecture"
    if ($actualPlatform -cne $script:ProductionDockerPlatform) {
        throw "Local Docker image '$ExpectedTag' has platform '$actualPlatform'; required platform is '$($script:ProductionDockerPlatform)'."
    }

    return [pscustomobject]@{
        Id = $imageId
        Tag = $ExpectedTag
        Platform = $actualPlatform
        RepoDigests = @($repoDigests | Where-Object { $_ })
    }
}

function Get-ProductionDockerRepositoryDigest {
    param(
        [Parameter(Mandatory = $true)]
        [object]$ImageDescriptor,
        [Parameter(Mandatory = $true)]
        [string]$Repository
    )

    $prefix = "$Repository@"
    foreach ($repoDigest in @($ImageDescriptor.RepoDigests)) {
        $value = [string]$repoDigest
        if ($value.StartsWith($prefix, [StringComparison]::Ordinal)) {
            return $value.Substring($prefix.Length)
        }
    }
    return $null
}
