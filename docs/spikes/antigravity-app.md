# Antigravity 2.0 app activity spike (F32)

Date: 2026-10-14

## Checks

- Read Google's [Antigravity hooks documentation](https://www.antigravity.google/docs/hooks). It identifies `~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/transcript.jsonl` as the Antigravity 2.0 app transcript path and documents `PreInvocation` and `Stop` with `conversationId` and `transcriptPath`.
- Confirmed the local `~/.gemini/antigravity/brain` directory contains UUID conversation directories and transcript files. Inspected only metadata keys and record types in a recent transcript; it uses `PLANNER_RESPONSE`, `status`, `source`, and `tool_calls` as the existing parser expects. No conversation content was copied.
- Reviewed the existing bridge: it currently labels the `antigravity/brain` path as `antigravity-ide`, and the transcript watcher scans only `antigravity-cli` and `antigravity-ide`.

## Result

The app has a distinct documented root and can use the existing status-only parser and hook observer with a separate `antigravity-app` agent identity. Live hook delivery and latency from Antigravity 2.0 still need a manual check after the user enables the integration in Settings.
