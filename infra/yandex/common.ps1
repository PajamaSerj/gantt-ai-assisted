Set-StrictMode -Version 2.0

$script:AllowedConfigKeys = @(
    "FolderId",
    "RegistryName",
    "RepositoryName",
    "ContainerName",
    "ServiceAccountName",
    "LockboxSecretName",
    "LockboxSecretKey",
    "Cores",
    "Memory",
    "ExecutionTimeout",
    "Concurrency",
    "AiModel",
    "AiBaseUrl",
    "Public"
)
$script:ForbiddenConfigKeys = @(
    "ApiKeyValue",
    "Token",
    "Password",
    "SecretPayload"
)

function Get-RepositoryRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Get-ObjectProperty {
    param(
        [Parameter(Mandatory = $true)]
        [object]$InputObject,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($InputObject -is [hashtable]) {
        if ($InputObject.ContainsKey($Name)) {
            return $InputObject[$Name]
        }
        return $null
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($property) {
        return $property.Value
    }
    return $null
}

function Protect-SensitiveText {
    param([AllowNull()][string]$Text)

    if (-not $Text) {
        return ""
    }

    $redacted = $Text
    $patterns = @(
        '(?i)(YANDEX_CLOUD_API_KEY\s*[=:]\s*)[^\s,;]+',
        '(?i)((?:api[-_]?key|password|token|secret[-_]?(?:value|payload))\s*[=:]\s*)[^\s,;]+'
    )
    foreach ($pattern in $patterns) {
        $redacted = [regex]::Replace($redacted, $pattern, '${1}<redacted>')
    }
    return $redacted
}

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$InstallMessage = "Install it outside this automation and retry."
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is not available. $InstallMessage"
    }
}

function ConvertTo-NativeArgument {
    param([AllowEmptyString()][string]$Argument)

    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') {
        return $Argument
    }

    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq [char]92) {
            $backslashes += 1
            continue
        }
        if ($character -eq [char]34) {
            if ($backslashes -gt 0) {
                [void]$builder.Append(('\' * ($backslashes * 2)))
                $backslashes = 0
            }
            [void]$builder.Append('\"')
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Invoke-NativeCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [switch]$AllowFailure
    )

    $command = Get-Command $FilePath -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "$FilePath is not available."
    }
    $processInfo = New-Object Diagnostics.ProcessStartInfo
    $processInfo.FileName = $command.Source
    $processInfo.Arguments = (@($Arguments | ForEach-Object {
        ConvertTo-NativeArgument -Argument ([string]$_)
    }) -join " ")
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $processInfo.StandardOutputEncoding = $utf8
    $processInfo.StandardErrorEncoding = $utf8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $processInfo

    try {
        if (-not $process.Start()) {
            throw "Process failed to start."
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $stdoutTask.GetAwaiter().GetResult().TrimEnd()
        $stderr = $stderrTask.GetAwaiter().GetResult().TrimEnd()
        $exitCode = $process.ExitCode
    }
    catch {
        $stdout = ""
        $stderr = $_.Exception.Message
        $exitCode = 1
    }
    finally {
        $process.Dispose()
    }

    $result = [pscustomobject]@{
        ExitCode = [int]$exitCode
        Output = if ($stdout) { @($stdout -split "`r?`n") } else { @() }
        ErrorOutput = if ($stderr) { @($stderr -split "`r?`n") } else { @() }
    }
    if (($result.ExitCode -ne 0) -and (-not $AllowFailure)) {
        $diagnostics = @($result.ErrorOutput) + @($result.Output)
        $safeOutput = Protect-SensitiveText (($diagnostics -join [Environment]::NewLine).Trim())
        if (-not $safeOutput) {
            $safeOutput = "no diagnostic output"
        }
        throw "$FilePath exited with code $($result.ExitCode): $safeOutput"
    }
    return $result
}

function Convert-NativeJson {
    param(
        [Parameter(Mandatory = $true)]
        [object]$NativeResult,
        [Parameter(Mandatory = $true)]
        [string]$Context
    )

    $text = (($NativeResult.Output -join [Environment]::NewLine).Trim())
    if (-not $text) {
        return @()
    }
    try {
        return ($text | ConvertFrom-Json)
    }
    catch {
        throw "Invalid JSON returned by $Context."
    }
}

function Invoke-YcJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$FolderId
    )

    $scopedArguments = @($Arguments) + @("--folder-id", $FolderId, "--format", "json")
    $result = Invoke-NativeCommand -FilePath "yc" -Arguments $scopedArguments
    return (Convert-NativeJson -NativeResult $result -Context "yc")
}

function Invoke-YcMutation {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$ApplyAuthorized,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$FolderId,
        [switch]$Json
    )

    if (-not $ApplyAuthorized) {
        throw "Mutation refused: -Apply authorization is required."
    }

    $scopedArguments = @($Arguments) + @("--folder-id", $FolderId)
    if ($Json) {
        $scopedArguments += @("--format", "json")
    }
    $result = Invoke-NativeCommand -FilePath "yc" -Arguments $scopedArguments
    if ($Json) {
        return (Convert-NativeJson -NativeResult $result -Context "yc mutation")
    }
    return $result
}

function Resolve-RegistryImageByTag {
    param(
        [AllowEmptyCollection()]
        [object[]]$Images = @(),
        [Parameter(Mandatory = $true)]
        [string]$RegistryId,
        [Parameter(Mandatory = $true)]
        [string]$RepositoryName,
        [Parameter(Mandatory = $true)]
        [string]$Tag
    )

    $expectedRepository = "$RegistryId/$RepositoryName"
    $matches = @($Images | Where-Object {
        $image = $_
        $name = [string](Get-ObjectProperty -InputObject $image -Name "name")
        if (-not [string]::Equals($name, $expectedRepository, [StringComparison]::Ordinal)) {
            return $false
        }
        foreach ($candidateTag in @((Get-ObjectProperty -InputObject $image -Name "tags"))) {
            if ([string]::Equals([string]$candidateTag, $Tag, [StringComparison]::Ordinal)) {
                return $true
            }
        }
        return $false
    })
    if ($matches.Count -gt 1) {
        throw "Registry returned multiple completed images for immutable tag '$expectedRepository`:$Tag'."
    }
    if ($matches.Count -eq 0) {
        return $null
    }

    $digest = [string](Get-ObjectProperty -InputObject $matches[0] -Name "digest")
    if ([string]::IsNullOrWhiteSpace($digest)) {
        throw "Registry image '$expectedRepository`:$Tag' has no digest; deployment cannot continue."
    }
    return [pscustomobject]@{
        Repository = $expectedRepository
        Tag = $Tag
        Digest = $digest
        Raw = $matches[0]
    }
}

function Assert-YcHelpContains {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string[]]$RequiredFragments
    )

    $result = Invoke-NativeCommand -FilePath "yc" -Arguments (@($Arguments) + @("--help"))
    $help = $result.Output -join [Environment]::NewLine
    foreach ($fragment in $RequiredFragments) {
        if ($help -notmatch [regex]::Escape($fragment)) {
            throw "Installed yc CLI does not support the required '$fragment' contract for: yc $($Arguments -join ' ')"
        }
    }
}

function Import-DeploymentConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Configuration file was not found: $Path"
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $resolvedPath,
        [ref]$tokens,
        [ref]$parseErrors
    )
    if ($parseErrors.Count -gt 0) {
        throw "Configuration is not valid PowerShell data syntax."
    }
    $dataAst = $ast.Find(
        { param($node) $node -is [System.Management.Automation.Language.HashtableAst] },
        $false
    )
    if (-not $dataAst) {
        throw "Configuration must contain one PowerShell data hashtable."
    }
    try {
        $config = $dataAst.SafeGetValue()
    }
    catch {
        throw "Configuration may contain only constant PowerShell data values."
    }
    if (-not ($config -is [hashtable])) {
        throw "Configuration must contain one PowerShell data hashtable."
    }

    foreach ($forbidden in $script:ForbiddenConfigKeys) {
        if ($config.ContainsKey($forbidden)) {
            throw "Forbidden credential-bearing configuration property: $forbidden"
        }
    }
    foreach ($key in $config.Keys) {
        if ($script:AllowedConfigKeys -notcontains $key) {
            throw "Unknown configuration property '$key'. Credential values are not accepted."
        }
    }
    foreach ($required in $script:AllowedConfigKeys) {
        if (-not $config.ContainsKey($required)) {
            throw "Required configuration property '$required' is missing."
        }
    }

    $textFields = @(
        "FolderId",
        "RegistryName",
        "RepositoryName",
        "ContainerName",
        "ServiceAccountName",
        "LockboxSecretName",
        "LockboxSecretKey",
        "Memory",
        "ExecutionTimeout",
        "AiModel",
        "AiBaseUrl"
    )
    foreach ($field in $textFields) {
        $value = [string]$config[$field]
        if ([string]::IsNullOrWhiteSpace($value) -or $value -match '<[^>]+>') {
            throw "Configuration property '$field' must be set to a non-placeholder value."
        }
    }

    $namePattern = '^[a-z][a-z0-9-]{1,61}[a-z0-9]$'
    foreach ($field in @("RegistryName", "ContainerName", "ServiceAccountName", "LockboxSecretName")) {
        if ([string]$config[$field] -notmatch $namePattern) {
            throw "Configuration property '$field' must be 3-63 lowercase letters, digits, or hyphens and must start with a letter."
        }
    }
    if ([string]$config.RepositoryName -notmatch '^[a-z0-9]+(?:[._-][a-z0-9]+)*$') {
        throw "RepositoryName contains unsupported Docker repository characters."
    }
    if ([string]$config.LockboxSecretKey -notmatch '^[A-Za-z0-9_.-]+$') {
        throw "LockboxSecretKey contains unsupported characters."
    }
    if ([string]$config.FolderId -notmatch '^[a-z0-9]{10,64}$') {
        throw "FolderId is not a valid Yandex Cloud resource identifier."
    }
    if (($config.Cores -isnot [int]) -or ([int]$config.Cores -lt 1)) {
        throw "Cores must be a positive integer."
    }
    if ([string]$config.Memory -notmatch '^[1-9][0-9]*(MB|GB)$') {
        throw "Memory must use a positive MB or GB value, for example 512MB."
    }
    if ([string]$config.ExecutionTimeout -notmatch '^[1-9][0-9]*s$') {
        throw "ExecutionTimeout must be a positive seconds value, for example 60s."
    }
    if (($config.Concurrency -isnot [int]) -or ([int]$config.Concurrency -lt 1)) {
        throw "Concurrency must be a positive integer."
    }
    if ($config.Public -isnot [bool]) {
        throw "Public must be a Boolean value."
    }

    $uri = $null
    if (-not [Uri]::TryCreate([string]$config.AiBaseUrl, [UriKind]::Absolute, [ref]$uri)) {
        throw "AiBaseUrl must be an absolute URL."
    }
    if ($uri.Scheme -ne "https") {
        throw "AiBaseUrl must use HTTPS."
    }

    return $config
}

function Get-ExactYcResource {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$ListArguments,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$FolderId
    )

    $items = @(Invoke-YcJson -Arguments $ListArguments -FolderId $FolderId)
    $matches = @($items | Where-Object { (Get-ObjectProperty -InputObject $_ -Name "name") -eq $Name })
    if ($matches.Count -gt 1) {
        throw "Multiple resources named '$Name' were returned in folder '$FolderId'."
    }
    if ($matches.Count -eq 0) {
        return $null
    }
    return $matches[0]
}

function Test-YcAccessBinding {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$ListArguments,
        [Parameter(Mandatory = $true)]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [string]$SubjectId,
        [Parameter(Mandatory = $true)]
        [string]$FolderId
    )

    $bindings = @(Invoke-YcJson -Arguments $ListArguments -FolderId $FolderId)
    foreach ($binding in $bindings) {
        $subject = Get-ObjectProperty -InputObject $binding -Name "subject"
        if (-not $subject) {
            continue
        }
        if (((Get-ObjectProperty -InputObject $binding -Name "role_id") -eq $Role) -and
            ((Get-ObjectProperty -InputObject $subject -Name "id") -eq $SubjectId)) {
            return $true
        }
    }
    return $false
}

function Test-PublicContainer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ContainerId,
        [Parameter(Mandatory = $true)]
        [string]$FolderId
    )

    $bindings = @(Invoke-YcJson -Arguments @(
        "serverless", "container", "list-access-bindings", "--id", $ContainerId
    ) -FolderId $FolderId)
    foreach ($binding in $bindings) {
        $subject = Get-ObjectProperty -InputObject $binding -Name "subject"
        if (-not $subject) {
            continue
        }
        $role = Get-ObjectProperty -InputObject $binding -Name "role_id"
        $subjectType = Get-ObjectProperty -InputObject $subject -Name "type"
        $subjectId = Get-ObjectProperty -InputObject $subject -Name "id"
        if (($role -eq "serverless-containers.containerInvoker") -and
            ($subjectType -eq "system") -and ($subjectId -eq "allUsers")) {
            return $true
        }
    }
    return $false
}

function Get-CurrentSecretVersionInfo {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Secret,
        [Parameter(Mandatory = $true)]
        [string]$RequiredKey,
        [Parameter(Mandatory = $true)]
        [string]$FolderId
    )

    $secretId = [string](Get-ObjectProperty -InputObject $Secret -Name "id")
    $currentVersionId = Get-ObjectProperty -InputObject $Secret -Name "current_version_id"
    if (-not $currentVersionId) {
        $currentVersion = Get-ObjectProperty -InputObject $Secret -Name "current_version"
        if ($currentVersion) {
            $currentVersionId = Get-ObjectProperty -InputObject $currentVersion -Name "id"
        }
    }

    $versions = @(Invoke-YcJson -Arguments @(
        "lockbox", "secret", "list-versions", "--id", $secretId
    ) -FolderId $FolderId)
    $version = $null
    if ($currentVersionId) {
        $version = $versions | Where-Object {
            (Get-ObjectProperty -InputObject $_ -Name "id") -eq $currentVersionId
        } | Select-Object -First 1
    }
    if (-not $version) {
        $version = $versions | Where-Object {
            (Get-ObjectProperty -InputObject $_ -Name "status") -eq "ACTIVE"
        } | Sort-Object {
            Get-ObjectProperty -InputObject $_ -Name "created_at"
        } -Descending | Select-Object -First 1
    }

    $keys = @()
    if ($version) {
        $entryKeys = Get-ObjectProperty -InputObject $version -Name "payload_entry_keys"
        if ($entryKeys) {
            $keys = @($entryKeys)
        }
    }
    return [pscustomobject]@{
        IsReady = [bool]($version -and ($keys -contains $RequiredKey))
        VersionId = if ($version) { [string](Get-ObjectProperty -InputObject $version -Name "id") } else { $null }
        HasRequiredKey = [bool]($keys -contains $RequiredKey)
    }
}

function Get-YcActiveProfile {
    $result = Invoke-NativeCommand -FilePath "yc" -Arguments @("config", "profile", "list")
    foreach ($line in $result.Output) {
        if ($line -match '^\s*(\S+)\s+ACTIVE\s*$') {
            return $matches[1]
        }
    }
    return "<unknown>"
}

function Get-YcConfiguredFolder {
    $result = Invoke-NativeCommand -FilePath "yc" -Arguments @("config", "get", "folder-id") -AllowFailure
    if ($result.ExitCode -ne 0) {
        return $null
    }
    return (($result.Output -join "").Trim())
}

function Get-YcCallerId {
    param([Parameter(Mandatory = $true)][string]$FolderId)

    $result = Invoke-NativeCommand -FilePath "yc" -Arguments @(
        "iam", "whoami", "--folder-id", $FolderId, "--format", "json"
    ) -AllowFailure
    if ($result.ExitCode -ne 0) {
        return $null
    }
    $text = (($result.Output -join [Environment]::NewLine).Trim())
    if (-not $text) {
        return $null
    }
    try {
        $value = $text | ConvertFrom-Json
        if ($value -is [string]) {
            return $value
        }
    }
    catch {
    }
    return $text.Trim('"')
}

function Test-CallerCanUseServiceAccount {
    param(
        [Parameter(Mandatory = $true)][string]$CallerId,
        [Parameter(Mandatory = $true)][string]$ServiceAccountId,
        [Parameter(Mandatory = $true)][string]$FolderId
    )

    $folderBinding = Test-YcAccessBinding -ListArguments @(
        "resource-manager", "folder", "list-access-bindings", "--id", $FolderId
    ) -Role "iam.serviceAccounts.user" -SubjectId $CallerId -FolderId $FolderId
    if ($folderBinding) {
        return $true
    }
    return (Test-YcAccessBinding -ListArguments @(
        "iam", "service-account", "list-access-bindings", "--id", $ServiceAccountId
    ) -Role "iam.serviceAccounts.user" -SubjectId $CallerId -FolderId $FolderId)
}

function Test-DockerAvailable {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        return $false
    }
    $result = Invoke-NativeCommand -FilePath "docker" -Arguments @("info") -AllowFailure
    return ($result.ExitCode -eq 0)
}

function Test-DockerCredentialHelper {
    if (-not (Get-Command docker-credential-yc -ErrorAction SilentlyContinue)) {
        return $false
    }
    $userProfile = [Environment]::GetFolderPath("UserProfile")
    $dockerConfig = Join-Path (Join-Path $userProfile ".docker") "config.json"
    if (-not (Test-Path -LiteralPath $dockerConfig -PathType Leaf)) {
        return $false
    }
    try {
        $config = Get-Content -LiteralPath $dockerConfig -Raw -Encoding UTF8 | ConvertFrom-Json
        $helpers = Get-ObjectProperty -InputObject $config -Name "credHelpers"
        if (-not $helpers) {
            return $false
        }
        return ((Get-ObjectProperty -InputObject $helpers -Name "cr.yandex") -eq "yc")
    }
    catch {
        return $false
    }
}

function Get-GitImageIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [switch]$AllowDirty
    )

    Assert-CommandAvailable -Name "git"
    $status = Invoke-NativeCommand -FilePath "git" -Arguments @(
        "-C", $RepositoryRoot, "status", "--porcelain"
    )
    $isDirty = [bool](($status.Output -join "").Trim())
    if ($isDirty -and (-not $AllowDirty)) {
        throw "Git worktree is dirty. Commit/stash changes or pass -AllowDirty explicitly."
    }
    $short = Invoke-NativeCommand -FilePath "git" -Arguments @(
        "-C", $RepositoryRoot, "rev-parse", "--short=12", "HEAD"
    )
    $full = Invoke-NativeCommand -FilePath "git" -Arguments @(
        "-C", $RepositoryRoot, "rev-parse", "HEAD"
    )
    return [pscustomobject]@{
        ShortSha = (($short.Output -join "").Trim().ToLowerInvariant())
        FullSha = (($full.Output -join "").Trim().ToLowerInvariant())
        IsDirty = $isDirty
    }
}

function Confirm-CloudMutation {
    param(
        [Parameter(Mandatory = $true)][string]$Operation,
        [Parameter(Mandatory = $true)][bool]$Apply,
        [switch]$Force
    )

    if (-not $Apply) {
        return $false
    }
    if ($Force) {
        return $true
    }
    $answer = Read-Host "$Operation will modify Yandex Cloud or local Docker state. Type APPLY to continue"
    if ($answer -cne "APPLY") {
        throw "Confirmation was not received; no mutation was performed."
    }
    return $true
}

function Write-CloudPlan {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string[]]$Items
    )

    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    foreach ($item in $Items) {
        Write-Host ("  - " + (Protect-SensitiveText $item))
    }
}

function Get-CurrentPowerShellExecutable {
    return (Get-Process -Id $PID).Path
}

function New-CloudHttpClient {
    param([int]$RequestTimeoutSeconds = 15)

    Add-Type -AssemblyName System.Net.Http
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds($RequestTimeoutSeconds)
    return $client
}

function Invoke-CloudHttpRequest {
    param(
        [Parameter(Mandatory = $true)][System.Net.Http.HttpClient]$Client,
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][Uri]$Uri,
        [int[]]$ExpectedStatus = @(200),
        [int]$RetryWindowSeconds = 90,
        [AllowNull()][string]$JsonBody
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($RetryWindowSeconds)
    $lastStatus = $null
    do {
        $request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::new($Method),
            $Uri
        )
        if ($JsonBody) {
            $request.Content = [System.Net.Http.StringContent]::new(
                $JsonBody,
                [Text.Encoding]::UTF8,
                "application/json"
            )
        }
        try {
            $response = $Client.SendAsync($request).GetAwaiter().GetResult()
            try {
                $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $lastStatus = [int]$response.StatusCode
                if ($ExpectedStatus -contains $lastStatus) {
                    return [pscustomobject]@{
                        StatusCode = $lastStatus
                        Content = $content
                        ContentType = [string]$response.Content.Headers.ContentType.MediaType
                    }
                }
            }
            finally {
                $response.Dispose()
            }
        }
        catch {
        }
        finally {
            $request.Dispose()
        }
        if ([DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Seconds 2
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($lastStatus) {
        throw "HTTP $Method $Uri did not return an expected status; last status was $lastStatus."
    }
    throw "HTTP $Method $Uri did not complete within $RetryWindowSeconds seconds."
}
