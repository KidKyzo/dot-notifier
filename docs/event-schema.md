# Event schema

Version 1 of the local event contract for AI tasks and Windows notifications.
The system metrics adapter uses the same envelope with `source: "system"` and
`kind: "metric"`.

## Fields

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `id` | string | yes | UUID; stable across updates to the same event |
| `source` | enum | yes | `codex`, `antigravity`, `chat`, or `system` |
| `kind` | enum | yes | `task`, `message`, or `metric` |
| `status` | enum | task/message: yes; metric: no | `running`, `done`, `error`, `needs_input`, `unread`, `warn`, or `crit` |
| `title` | string | yes | Short display label |
| `body` | string | no | Optional preview; never persisted to disk by default |
| `progress` | number | no | Task progress from `0` through `1` |
| `startedAt` | string | no | ISO-8601 timestamp |
| `meta` | object | no | Source-specific fields, such as app and sender |

Allowed source/kind/status combinations:

- `codex` and `antigravity` task events: `running`, `done`, `error`, or
  `needs_input`.
- `chat` message events: `unread`.
- `system` metric events: `warn` or `crit` enter the peek queue. Normal metric
  snapshots are delivered to the panel and may omit `status`.

Receivers validate the envelope, ignore unknown fields, and drop malformed
payloads with a warning-level diagnostic that excludes message bodies and
sender names. Reusing an `id` replaces the prior event so task progress updates
do not create duplicates.

## Example

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "source": "codex",
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
the connection. The bus accepts a schema event envelope or a Codex `notify`
payload and validates it before sending `bus-event` to the UI. Invalid payloads
are dropped with a diagnostic that does not include content. Unknown fields are
ignored.

The Codex hook maps the currently supported `agent-turn-complete` notification
to a done task event. Codex supplies its JSON as a command argument; the script
also accepts stdin for local manual checks. Task IDs use the Codex thread UUID,
so later notifications upsert the same task. It forwards only
`last-assistant-message` as an optional, whitespace-collapsed preview capped at
280 characters. The UI keeps that preview in memory; the adapter ignores user
input messages and all other Codex payload fields, and does not log the preview.

To enable the hook, add this to the user-level `~/.codex/config.toml`, replacing
the script path with the absolute path to this repository:

```toml
notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\path\\to\\Dotfication\\scripts\\codex-notify.ps1"]
```

The protocol and schema version must be reviewed together before changing
either one.
