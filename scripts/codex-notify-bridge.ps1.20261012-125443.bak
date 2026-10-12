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

exit 0
