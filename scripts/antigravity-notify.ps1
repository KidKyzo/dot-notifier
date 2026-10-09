param(
    [string]$State = "running"
)

$ErrorActionPreference = "Stop"

# Return required JSON on stdout immediately so Antigravity execution is never blocked
$defaultResponse = @{ decision = "allow" } | ConvertTo-Json -Compress
[Console]::WriteLine($defaultResponse)

$context = $null
try {
    $payloadText = [Console]::In.ReadToEnd()
    if (-not [string]::IsNullOrWhiteSpace($payloadText)) {
        $context = ConvertFrom-Json -InputObject $payloadText -ErrorAction SilentlyContinue
    }
} catch {
    exit 0
}

# Resolve conversation ID or generate a fallback UUID to satisfy bus validation
$conversationId = if ($context -and $context.conversationId) { [string]$context.conversationId } else { $null }
if ([string]::IsNullOrWhiteSpace($conversationId) -or $conversationId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    # Well-known fallback UUID for Antigravity session if not provided
    $conversationId = "a0a0a0a0-0000-4000-8000-000000000001"
}

$status = if ($State -eq "running") {
    "running"
} elseif ($context -and (($context.terminationReason -match "error") -or (-not [string]::IsNullOrEmpty($context.error)))) {
    "error"
} else {
    "done"
}

$title = if ($status -eq "running") {
    "Antigravity task running"
} elseif ($status -eq "error") {
    "Antigravity task failed"
} else {
    "Antigravity task completed"
}

$eventJson = @{
    id = $conversationId.ToLowerInvariant()
    source = "antigravity"
    kind = "task"
    status = $status
    title = $title
} | ConvertTo-Json -Compress

$sessionPath = Join-Path $env:LOCALAPPDATA "com.dotnotifier.app\bus-session.json"
if (Test-Path -LiteralPath $sessionPath) {
    try {
        $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.SetRequestHeader("Authorization", "Bearer $($session.token)")
        $null = $socket.ConnectAsync([Uri]$session.url, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $bytes = [Text.Encoding]::UTF8.GetBytes($eventJson)
        $segment = [ArraySegment[byte]]::new($bytes)
        $null = $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $null = $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "sent", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $socket.Dispose()
    } catch {
        # Fail open: never disrupt agent execution if Dot Notifier is offline
    }
}
