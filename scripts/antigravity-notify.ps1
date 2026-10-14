param(
    [ValidateSet("auto", "antigravity-app", "antigravity-cli", "antigravity-ide")]
    [string]$Agent = "auto",
    [ValidateSet("PreInvocation", "Stop")]
    [string]$Event = "Stop",
    [string]$WorkerPayload
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrEmpty($WorkerPayload)) {
    try {
        $eventJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($WorkerPayload))
        if ($eventJson.Length -gt 65536) { exit 0 }
        $event = ConvertFrom-Json -InputObject $eventJson -ErrorAction Stop
        $sessionPath = Join-Path $env:LOCALAPPDATA "com.dotnotifier.app\bus-session.json"
        $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
        $uri = [Uri]$session.url
        if ($uri.Scheme -ne "ws" -or -not $uri.IsLoopback -or $session.token -notmatch '^[0-9a-f]{64}$') { exit 0 }

        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.SetRequestHeader("Authorization", "Bearer $($session.token)")
        $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMilliseconds(2000))
        $socket.ConnectAsync($uri, $timeout.Token).GetAwaiter().GetResult()
        $bytes = [Text.Encoding]::UTF8.GetBytes($eventJson)
        $segment = [ArraySegment[byte]]::new($bytes)
        $socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $timeout.Token).GetAwaiter().GetResult()
        $socket.Abort()
        $timeout.Dispose()
        $socket.Dispose()
    } catch {
        # Hook delivery is best effort; failures must not affect Antigravity.
    }
    exit 0
}

# Antigravity hooks are synchronous, so keep stdout inert and hand off delivery.
[Console]::Out.WriteLine("{}")

try {
    $payloadText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($payloadText) -or $payloadText.Length -gt 65536) { exit 0 }
    $payload = ConvertFrom-Json -InputObject $payloadText -ErrorAction Stop

    $conversationId = [string]$payload.conversationId
    if ($conversationId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        $transcriptPath = [string]$payload.transcriptPath
        if ($transcriptPath -match '(?i)(?:^|[\\/])brain[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/]\.system_generated[\\/]logs[\\/]transcript\.jsonl$') {
            $conversationId = $Matches[1]
        } else {
            exit 0
        }
    }

    $resolvedAgent = $Agent
    if ($resolvedAgent -eq "auto") {
        $transcriptPath = [string]$payload.transcriptPath
        if ($transcriptPath -match '(?i)(?:^|[\\/])antigravity-cli[\\/]brain[\\/]') {
            $resolvedAgent = "antigravity-cli"
        } elseif ($transcriptPath -match '(?i)(?:^|[\\/])antigravity-ide[\\/]brain[\\/]') {
            $resolvedAgent = "antigravity-ide"
        } elseif ($transcriptPath -match '(?i)(?:^|[\\/])antigravity[\\/]brain[\\/]') {
            $resolvedAgent = "antigravity-app"
        } else {
            exit 0
        }
    }

    $status = if ($Event -eq "PreInvocation") {
        "running"
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$payload.error) -or $payload.terminationReason -eq "error") {
        "error"
    } elseif ($payload.fullyIdle -eq $true) {
        "done"
    } else {
        "running"
    }

    $agentName = switch ($resolvedAgent) {
        "antigravity-cli" { "CLI" }
        "antigravity-app" { "App" }
        default { "IDE" }
    }
    $title = switch ($status) {
        "running" { "Antigravity $agentName task running" }
        "done" { "Antigravity $agentName task completed" }
        "error" { "Antigravity $agentName task failed" }
    }
    $eventJson = @{
        id = $conversationId.ToLowerInvariant()
        source = "ai"
        agent = $resolvedAgent
        sessionId = $conversationId.ToLowerInvariant()
        kind = "task"
        status = $status
        title = $title
    } | ConvertTo-Json -Compress
    $encodedPayload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($eventJson))
    $powershellName = if ($PSVersionTable.PSEdition -eq "Core") { "pwsh.exe" } else { "powershell.exe" }
    $powershellPath = Join-Path $PSHOME $powershellName
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSCommandPath`" -WorkerPayload $encodedPayload"
    Start-Process -FilePath $powershellPath -ArgumentList $arguments -WindowStyle Hidden -ErrorAction Stop | Out-Null
} catch {
    # Malformed input and launch failures are intentionally silent and fail open.
    exit 0
}
