# Antigravity CLI hook spike (F31)

Date: 2026-10-12

## Checks

- Ran the installed CLI version command: `agy --version` reports `1.2.13`.
- Read `agy --help` and `agy hooks --help`. The CLI help lists no `hooks` subcommand and no hook-specific options, so this installed build did not provide a local way to inspect or fire hooks.
- Checked the candidate user `~/.gemini/config/hooks.json` and repository `.agents/hooks.json`; both were empty JSON objects. No hook configuration was changed.
- Read Google's official Antigravity hooks docs at <https://antigravity.google/docs/hooks> on 2026-10-12. They document CLI hooks in `~/.gemini/config/hooks.json`, stdin JSON with `conversationId` and `transcriptPath`, and `PreInvocation` and `Stop` events.

## Result

The documented CLI contract is sufficient to implement an opt-in observer, but runtime behavior on the installed `agy 1.2.13` remains unverified. The adapter uses only conversation identity, event name, `fullyIdle`, and error presence. It returns `{}` and sends status asynchronously so it cannot gate an action or approve a request. Verify a live CLI session after enabling it in Settings.
