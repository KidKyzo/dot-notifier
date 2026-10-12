# Antigravity IDE hook spike (F32)

Date: 2026-10-12

## Checks

- Checked the usual per-user Antigravity executable locations and `Get-Command Antigravity.exe`; no standalone IDE executable was available in this environment.
- Checked user `~/.gemini/config/hooks.json` and repository `.agents/hooks.json`; both were empty JSON objects. No hook configuration was changed.
- Read Google's official Antigravity hooks docs at <https://antigravity.google/docs/hooks> on 2026-10-12. They document IDE hooks in `~/.gemini/config/hooks.json`, stdin JSON with a UUID `conversationId` and `transcriptPath`, and `PreInvocation` and `Stop` events. Transcript paths are under `~/.gemini/antigravity-ide/brain/<conversationId>/.system_generated/logs/transcript.jsonl` for the IDE.

## Result

The adapter uses hook payload identity and can recover the UUID from the documented transcript path when `conversationId` is absent. It does not read transcript contents. Event delivery from a live IDE, including the transcript identity fallback, remains unverified and needs a manual check after enabling the hook in Settings.
