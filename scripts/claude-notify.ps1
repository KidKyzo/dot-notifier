param(
    [ValidateSet("UserPromptSubmit", "Stop", "Notification", "PermissionRequest")]
    [string]$Event = "Stop"
)

$ErrorActionPreference = "Stop"

try {
    $payloadText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($payloadText) -or $payloadText.Length -gt 65536) { exit 0 }
    $payload = ConvertFrom-Json -InputObject $payloadText -ErrorAction Stop
    $sessionId = [string]$payload.session_id
    if ([string]::IsNullOrWhiteSpace($sessionId) -or $sessionId.Length -gt 256) { exit 0 }

    $status = switch ($Event) {
        "UserPromptSubmit" { "running"; break }
        "Stop" { "done"; break }
        "PermissionRequest" { "needs_input"; break }
        "Notification" {
            switch ([string]$payload.notification_type) {
                { $_ -in @("idle_prompt", "agent_needs_input") } { "needs_input"; break }
                default { $null }
            }
            break
        }
    }
    if ($null -eq $status) { exit 0 }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($sessionId))
    } finally {
        $sha256.Dispose()
    }
    $guidBytes = [byte[]]$hash[0..15]
    $guidBytes[6] = ($guidBytes[6] -band 0x0F) -bor 0x40
    $guidBytes[8] = ($guidBytes[8] -band 0x3F) -bor 0x80
    $eventId = [Guid]::new($guidBytes).ToString().ToLowerInvariant()
    $title = switch ($status) {
        "running" { "Claude is working" }
        "done" { "Claude task completed" }
        default { "Claude is waiting for you" }
    }
    $eventJson = @{
        id = $eventId
        source = "ai"
        agent = "claude"
        sessionId = $sessionId
        kind = "task"
        status = $status
        title = $title
    } | ConvertTo-Json -Compress

    $sessionPath = Join-Path (Split-Path -Parent $PSScriptRoot) "bus-session.json"
    if (-not (Test-Path -LiteralPath $sessionPath)) { exit 0 }
    $busSession = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
    $uri = [Uri]$busSession.url
    if ($uri.Scheme -ne "ws" -or -not $uri.IsLoopback -or [string]$busSession.token -notmatch '^[0-9a-f]{64}$') { exit 0 }

    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $socket.Options.SetRequestHeader("Authorization", "Bearer $($busSession.token)")
    $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMilliseconds(1500))
    try {
        $socket.ConnectAsync($uri, $timeout.Token).GetAwaiter().GetResult()
        $bytes = [Text.Encoding]::UTF8.GetBytes($eventJson)
        $segment = [ArraySegment[byte]]::new($bytes)
        $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $timeout.Token).GetAwaiter().GetResult()
    } finally {
        $socket.Abort()
        $timeout.Dispose()
        $socket.Dispose()
    }
} catch {
    # Notification hooks are best effort and never affect Claude Code.
}

exit 0
