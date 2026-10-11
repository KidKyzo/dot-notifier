param()

$ErrorActionPreference = "Stop"
$payloadText = if ($args.Count -gt 0) { [string]$args[0] } else { [Console]::In.ReadToEnd() }
if ([string]::IsNullOrWhiteSpace($payloadText) -or $payloadText.Length -gt 65536) {
    [Console]::Error.WriteLine("Dot Notifier: dropped malformed Codex notification.")
    exit 0
}

try {
    $notification = ConvertFrom-Json -InputObject $payloadText -ErrorAction Stop
} catch {
    [Console]::Error.WriteLine("Dot Notifier: dropped malformed Codex notification.")
    exit 0
}

$isPermissionRequest = $notification.hook_event_name -eq "PermissionRequest"
$threadId = if ($isPermissionRequest) { $notification.session_id } else { $notification.'thread-id' }
if ([string]::IsNullOrWhiteSpace($threadId) -and -not $isPermissionRequest) { $threadId = $notification.thread_id }
if ($threadId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    [Console]::Error.WriteLine("Dot Notifier: dropped Codex notification without a valid thread id.")
    exit 0
}

$status = if ($isPermissionRequest) {
    "needs_input"
} else {
    switch ([string]$notification.type) {
        "agent-turn-complete" { "done" }
        default { $null }
    }
}
if ($null -eq $status) {
    [Console]::Error.WriteLine("Dot Notifier: ignored unsupported Codex notification type.")
    exit 0
}

$title = switch ($status) {
    "done" { "Codex task completed" }
    "needs_input" { "Codex is waiting for permission. Respond in Codex." }
}
$detail = if ($isPermissionRequest) { $null } else { $notification.'last-assistant-message' }
if ($detail -isnot [string]) { $detail = $null }
if ($null -ne $detail) {
    $detail = ($detail -replace '\s+', ' ').Trim()
    if ($detail.Length -gt 280) { $detail = $detail.Substring(0, 277) + "..." }
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $null }
}
$eventJson = if ($isPermissionRequest) {
    $notification | Add-Member -NotePropertyName pid -NotePropertyValue $PID -Force
    $notification | ConvertTo-Json -Compress -Depth 20
} else {
    @{
        id = $threadId.ToLowerInvariant()
        source = "ai"
        agent = "codex"
        sessionId = $threadId.ToLowerInvariant()
        kind = "task"
        status = $status
        title = $title
        body = $detail
        pid = $PID
    } | ConvertTo-Json -Compress
}

$sessionPath = Join-Path $env:LOCALAPPDATA "com.dotnotifier.app\bus-session.json"
try {
    $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $socket.Options.SetRequestHeader("Authorization", "Bearer $($session.token)")
    $timeout = if ($isPermissionRequest) { 90_000 } else { 250 }
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMilliseconds($timeout))
    $socket.ConnectAsync([Uri]$session.url, $deadline.Token).GetAwaiter().GetResult()
    $bytes = [Text.Encoding]::UTF8.GetBytes($eventJson)
    $segment = [ArraySegment[byte]]::new($bytes)
    $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $deadline.Token).GetAwaiter().GetResult()
    if ($isPermissionRequest) {
        $buffer = [byte[]]::new(4096)
        $response = [ArraySegment[byte]]::new($buffer)
        $received = $socket.ReceiveAsync($response, $deadline.Token).GetAwaiter().GetResult()
        if ($received.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Text -and $received.Count -le $buffer.Length) {
            [Console]::Out.WriteLine([Text.Encoding]::UTF8.GetString($buffer, 0, $received.Count))
        }
    } else {
        $socket.Abort()
    }
    $deadline.Dispose()
    $socket.Dispose()
} catch {
    if ($null -ne $socket) { $socket.Dispose() }
    if ($null -ne $deadline) { $deadline.Dispose() }
    [Console]::Error.WriteLine("Dot Notifier: could not send Codex notification to the local event bus.")
    exit 0
}
