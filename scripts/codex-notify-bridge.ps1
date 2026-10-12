param(
    [Parameter(Mandatory = $true)]
    [string]$ExistingCommand,
    [Parameter(Mandatory = $true)]
    [string]$ExistingArgument,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$NotificationArguments
)

$ErrorActionPreference = "Continue"
$notificationPayload = $null
foreach ($candidate in $NotificationArguments) {
    if ($candidate -notmatch '^\s*\{') { continue }
    try {
        $parsed = ConvertFrom-Json -InputObject $candidate -ErrorAction Stop
        if ($parsed.type -eq "agent-turn-complete") {
            $notificationPayload = $candidate
        }
    } catch {
        continue
    }
}

$existingArguments = @($ExistingArgument) + @($NotificationArguments)
try {
    if (Test-Path -LiteralPath $ExistingCommand) {
        & $ExistingCommand @existingArguments
    }
} catch {
    # Keep the notification bridge fail-open if the existing handler is unavailable.
}

if ($null -ne $notificationPayload) {
    try {
        & (Join-Path $PSScriptRoot "codex-notify.ps1") $notificationPayload
    } catch {
        # A failed overlay notification must not interrupt Codex.
    }
}


# Forward supported Codex notifications to AI Task Board while preserving Dotfication above.
$trackerNotification = $null
foreach ($candidate in $NotificationArguments) {
    if ($candidate -notmatch '^\s*\{') { continue }
    try {
        $parsed = ConvertFrom-Json -InputObject $candidate -ErrorAction Stop
        $isCompleted = $parsed.type -eq "agent-turn-complete"
        $isPermissionRequest = $parsed.hook_event_name -eq "PermissionRequest"
        $isApproval = [string]$parsed.type -match 'approval|permission|blocked'
        if ($isCompleted -or $isPermissionRequest -or $isApproval) {
            $trackerNotification = $candidate
            break
        }
    } catch {
        continue
    }
}

if ($null -ne $trackerNotification) {
    $trackerScript = "D:\Dokumen Kampus - Ariel\Project\Agent Task Tracker\integrations\codex-notify\notify.mjs"
    try {
        $trackerNotification | & node $trackerScript
        if ($LASTEXITCODE -ne 0) {
            [Console]::Error.WriteLine("Task Board notifier exited with code $LASTEXITCODE.")
        }
    } catch {
        [Console]::Error.WriteLine("Task Board notifier failed: $($_.Exception.Message)")
    }
}
exit 0
