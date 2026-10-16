# Claude Code notification hook spike

## What I checked

- Checked for the Claude Code CLI with `Get-Command claude`; it is not installed or available on PATH in this environment.
- Read Anthropic's official [Hooks reference](https://code.claude.com/docs/en/hooks) on 2026-10-16.
- Confirmed user hooks are configured in `~/.claude/settings.json`; command hooks receive JSON on stdin; `UserPromptSubmit`, `Stop`, `Notification`, and `PermissionRequest` are documented events. `Notification` includes a session ID and notification type. Command hooks can run asynchronously.

## Result

The opt-in adapter can use the documented local hook format and remain fail-open. Live delivery on this machine and the installed Claude Code version remain unverified. The hook reports only status and session identity; it does not forward message content or make permission decisions.
