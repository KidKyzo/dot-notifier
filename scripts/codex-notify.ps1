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

$threadId = $notification.'thread-id'
if ([string]::IsNullOrWhiteSpace($threadId)) { $threadId = $notification.thread_id }
if ($threadId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
    [Console]::Error.WriteLine("Dot Notifier: dropped Codex notification without a valid thread id.")
    exit 0
}

$status = switch ([string]$notification.type) {
    "agent-turn-complete" { "done" }
    default { $null }
}
if ($null -eq $status) {
    [Console]::Error.WriteLine("Dot Notifier: ignored unsupported Codex notification type.")
    exit 0
}

$title = switch ($status) {
    "done" { "Codex task completed" }
}
$detail = $notification.'last-assistant-message'
if ($detail -isnot [string]) { $detail = $null }
if ($null -ne $detail) {
    $detail = ($detail -replace '\s+', ' ').Trim()
    if ($detail.Length -gt 280) { $detail = $detail.Substring(0, 277) + "..." }
    if ([string]::IsNullOrWhiteSpace($detail)) { $detail = $null }
}
$eventJson = @{
    id = $threadId.ToLowerInvariant()
    source = "codex"
    kind = "task"
    status = $status
    title = $title
    body = $detail
} | ConvertTo-Json -Compress

$sessionPath = Join-Path $env:LOCALAPPDATA "com.dotnotifier.app\bus-session.json"
try {
    $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $socket.Options.SetRequestHeader("Authorization", "Bearer $($session.token)")
    $socket.ConnectAsync([Uri]$session.url, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $bytes = [Text.Encoding]::UTF8.GetBytes($eventJson)
    $segment = [ArraySegment[byte]]::new($bytes)
    $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "sent", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $socket.Dispose()
} catch {
    [Console]::Error.WriteLine("Dot Notifier: could not send Codex notification to the local event bus.")
    exit 0
}
