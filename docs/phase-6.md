# Phase 6 spike: Codex session logs

## Finding

Codex rollout files under `CODEX_HOME/sessions` (or `%USERPROFILE%\.codex\sessions`)
contain structured `event_msg` records for `task_started` and `task_complete`.
These markers are enough to show that a Codex task is running and when it ends.
The rollout protocol is an implementation detail and may change; the adapter
therefore ignores unrecognized records and fails open. See the
[Codex protocol definitions](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs).

The adapter reads recent rollout files and follows appended bytes. It derives
the task ID from the rollout filename and sends only a static title plus the
task status to the existing UI event bus. It does not forward transcript text,
tool input/output, or error messages, and it does not write rollout data.
The existing `notify` integration may send a duplicate completion update;
the stable thread ID makes it an upsert of the same task.

No supported Antigravity session log or lifecycle event source was found in
this repository's scope. Antigravity log integration is deferred until an
official, stable source is available.

## Current limits

- Codex is recognized through rollout lifecycle markers only. It does not
  estimate a percentage or expose model messages as progress.
- Rollout files from the last 24 hours are discovered. On startup, a running
  task is restored when its latest `task_started` timestamp is within three
  minutes; file modification time is the fallback for older record formats.
  This handles session files whose modification time does not advance with
  appended lifecycle records.
- Log structure is not a public compatibility contract. Unknown and malformed
  lines are ignored, and the normal `notify` completion adapter remains usable
  if rollout parsing stops matching a future Codex version.
