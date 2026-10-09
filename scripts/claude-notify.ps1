param(
    [string]$State = "done",
    [string]$Title = "Claude task completed"
)

$ErrorActionPreference = "Stop"
$payloadText = if ($args.Count -gt 0) { [string]$args[0] } else { [Console]::In.ReadToEnd() }

$threadId = $null
$message = $null

if (-not [string]::IsNullOrWhiteSpace($payloadText)) {
    try {
        $notification = ConvertFrom-Json -InputObject $payloadText -ErrorAction SilentlyContinue
        if ($notification) {
            $threadId = $notification.'thread-id'
            if (-not $threadId) { $threadId = $notification.thread_id }
            if (-not $threadId) { $threadId = $notification.sessionId }
            if (-not $threadId) { $threadId = $notification.session_id }

            $msg = $notification.'last-assistant-message'
            if (-not $msg) { $msg = $notification.message }
            if ($msg -is [string]) { $message = $msg }
        }
    } catch {
        # ignore parse error, use defaults
    }
}

if ([string]::IsNullOrWhiteSpace($threadId) -or $threadId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    # Well-known fallback UUID for Claude task
    $threadId = "c1a0de00-0000-4000-8000-000000000001"
}

if ($message) {
    $message = ($message -replace '\s+', ' ').Trim()
    if ($message.Length -gt 280) { $message = $message.Substring(0, 277) + "..." }
}

$eventJson = @{
    id = $threadId.ToLowerInvariant()
    source = "codex"
    kind = "task"
    status = if ($State -eq "running") { "running" } else { "done" }
    title = $Title
    body = $message
} | ConvertTo-Json -Compress

$sessionPath = Join-Path $env:LOCALAPPDATA "com.dotnotifier.app\bus-session.json"
if (Test-Path -LiteralPath $sessionPath) {
    try {
        $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.SetRequestHeader("Authorization", "Bearer $($session.token)")
        $null = $socket.ConnectAsync([Uri]"$($session.url)", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $bytes = [Text.Encoding]::UTF8.GetBytes($eventJson)
        $segment = [ArraySegment[byte]]::new($bytes)
        $null = $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $null = $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "sent", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $socket.Dispose()
    } catch {
        # Fail open
    }
}
