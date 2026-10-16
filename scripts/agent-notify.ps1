param(
    [string]$Product,
    [string]$SessionId,
    [string]$Status,
    [string]$WorkerPayload
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrEmpty($WorkerPayload)) {
    try {
        $eventJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($WorkerPayload))
        if ($eventJson.Length -gt 65536) { exit 0 }
        $sessionPath = Join-Path $env:LOCALAPPDATA "com.dotnotifier.app\bus-session.json"
        $session = Get-Content -Raw -LiteralPath $sessionPath | ConvertFrom-Json -ErrorAction Stop
        $uri = [Uri]$session.url
        if ($uri.Scheme -ne "ws" -or $uri.Host -ne "127.0.0.1" -or [string]$session.token -notmatch '^[0-9a-f]{64}$') { exit 0 }

        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMilliseconds(1500))
        try {
            $socket.Options.SetRequestHeader("Authorization", "Bearer $($session.token)")
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
        # A failed notification must not change the calling agent's result.
    }
    exit 0
}

try {
    if ($Product -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$' -or $Product.EndsWith(' ')) { exit 0 }
    if ([string]::IsNullOrWhiteSpace($SessionId) -or $SessionId.Length -gt 256 -or $SessionId -match '[\x00-\x1f\x7f]') { exit 0 }
    if ($Status -notin @("running", "needs_input", "done", "error")) { exit 0 }

    $scopedSession = "$Product`:$SessionId"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($scopedSession))
    } finally {
        $sha256.Dispose()
    }
    $guidBytes = [byte[]]$hash[0..15]
    $guidBytes[6] = ($guidBytes[6] -band 0x0F) -bor 0x40
    $guidBytes[8] = ($guidBytes[8] -band 0x3F) -bor 0x80
    $eventId = [Guid]::new($guidBytes).ToString().ToLowerInvariant()
    $title = switch ($Status) {
        "running" { "$Product task running" }
        "needs_input" { "$Product needs your input" }
        "done" { "$Product task completed" }
        "error" { "$Product task failed" }
    }
    $eventJson = @{
        id = $eventId
        source = "ai"
        agent = "external"
        sessionId = $scopedSession
        kind = "task"
        status = $Status
        title = $title
        meta = @{ product = $Product }
    } | ConvertTo-Json -Compress -Depth 3
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($eventJson))
    $executable = if ($PSVersionTable.PSEdition -eq "Core") { "pwsh.exe" } else { "powershell.exe" }
    $powerShellPath = Join-Path $PSHOME $executable
    Start-Process -FilePath $powerShellPath -ArgumentList @(
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", ('"' + $PSCommandPath + '"'), "-WorkerPayload", $encoded
    ) -WindowStyle Hidden | Out-Null
} catch {
    # Hooks are best effort and return immediately even when Dot Notifier is closed.
}

exit 0
