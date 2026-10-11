# Event schema

Version 2 of the local event contract for AI tasks and Windows notifications.
System metrics use the same envelope with `source: "system"` and
`kind: "metric"`.

## Fields

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | string | yes | UUID; identifies this snapshot |
| `source` | enum | yes | `ai`, `chat`, or `system` |
| `agent` | enum | no | `codex`, `antigravity-cli`, `antigravity-ide`, or `omp` |
| `sessionId` | string | no | Non-empty agent session or conversation id |
| `kind` | enum | yes | `task`, `message`, or `metric` |
| `status` | enum | task/message: yes; metric: no | `running`, `done`, `error`, `needs_input`, `unread`, `warn`, or `crit` |
| `title` | string | yes | Short display label |
| `body` | string | no | Optional preview; kept in memory only |
| `progress` | number | no | Task progress from `0` through `1` |
| `startedAt` | string | no | ISO-8601 timestamp |
| `cwd` | string | no | Working directory |
| `pid` | number | no | Process id |
| `usage` | object | no | Optional `tokens` and `quotaLeft` values |
| `actions` | string array | no | `approve` or `reject`; present only when the agent can act on the response |
| `actionNonce` | string | no | Single-use nonce bound to the active approval event; paired with `actions` |
| `meta` | object | no | Source-specific metadata |

Allowed source/kind/status combinations:

- `ai` task events accept an optional supported `agent` and non-empty
  `sessionId`, and use one of `running`, `done`, `error`, or `needs_input`.
- `chat` message events use `unread`.
- `system` metric events use `warn` or `crit` to enter the peek queue. Normal
  metric snapshots may omit `status`.

AI task snapshots with both identity fields upsert by `agent` + `sessionId`;
when either key is absent, receivers fall back to `id`. This keeps one current
row per agent session while allowing separate agents with the same session
identifier. Other event kinds continue to use `id`.

Receivers validate the envelope, ignore unknown fields, and drop malformed
payloads with a diagnostic that excludes message bodies and sender names.
Message bodies are never persisted to disk.

## Example

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "ai",
  "agent": "codex",
  "sessionId": "thread-123",
  "kind": "task",
  "status": "running",
  "title": "Refactor auth",
  "progress": 0.42,
  "startedAt": "2026-10-09T12:00:00Z"
}
```

## Bus transport

The event bus listens on `127.0.0.1` and requires a random token scoped to the
current app session. On each app launch it chooses an ephemeral port and writes
the URL and token to `bus-session.json` in the app's local data directory. A
client authenticates the WebSocket upgrade with
`Authorization: Bearer <session-token>`, sends one JSON text frame, then closes
the connection. The bus accepts a schema event envelope, a Codex `notify`
payload, or a Codex `PermissionRequest` hook payload and validates it before
sending `bus-event` to the UI. Invalid payloads are dropped with a diagnostic
that does not include content. Unknown fields are ignored.

The Codex hook maps the currently supported `agent-turn-complete` notification
to an `ai` task event. Codex supplies its JSON as a command argument; the script
also accepts stdin for local manual checks. The Codex thread UUID is used for
both `id` and `sessionId`, so later notifications upsert the same task. It
forwards only `last-assistant-message` as an optional, whitespace-collapsed
preview capped at 280 characters. The UI keeps that preview in memory; the
adapter ignores user input messages and all other Codex payload fields, and does
not log the preview.

The same `codex-notify.ps1` script can be registered as a `PermissionRequest`
hook. It maps the hook's `session_id` to the task identity and emits only a
static `needs_input` status. Tool input, descriptions, and transcript paths are
ignored. For an active hook connection, the bus adds `actions` and a
single-use `actionNonce`, then waits up to 90 seconds for an explicit UI action.
The response is bound to that event and expires; disconnect, timeout, UI
dismissal, or an invalid action returns no decision, allowing Codex's normal
permission prompt to continue. A UI approve/reject click returns the documented
Codex hook decision. When Codex later emits a task completion, that snapshot
upserts the same session row.

To enable the hook, add this to the user-level `~/.codex/config.toml`, replacing
the script path with the absolute path to this repository:

```toml
notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\path\\to\\Dot-Notifier\\scripts\\codex-notify.ps1"]
```

To also show a passive waiting status, add this hook to the same user-level
configuration, using the absolute script path. Keep existing hook entries and
review/trust the hook in Codex with `/hooks`:

```toml
[[hooks.PermissionRequest]]
command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\path\\to\\Dot-Notifier\\scripts\\codex-notify.ps1"'
    timeout_sec = 95
```

The hook only reports that Codex is waiting. Open Codex to inspect and answer
the permission prompt there.

The protocol and schema version must be reviewed together before changing
either one.
