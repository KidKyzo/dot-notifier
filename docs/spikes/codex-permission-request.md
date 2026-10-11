# Codex PermissionRequest decision spike

**PRD:** F37 (Codex Approve/Reject)  
**Date:** 2026-10-11  
**Local CLI:** `codex-cli 0.162.0-alpha.17.2`

## Result

The current official Codex Hooks release reference documents that a
`PermissionRequest` hook can approve, deny, or decline to decide. It specifies
the JSON `hookSpecificOutput` response with
`hookEventName: "PermissionRequest"` and `decision.behavior: "allow"` or
`"deny"`; omitting a decision keeps the normal approval prompt. This confirms
that the hook protocol needed by F37 exists.

## What was checked

- Ran `codex --version` in the repository: `codex-cli 0.162.0-alpha.17.2`.
- Read the official Codex Hooks release reference on 2026-10-11, especially
  its `PermissionRequest` input, response, and fallthrough behavior:
  <https://developers.openai.com/codex/hooks>.
- Did not register or trust a user-level hook and did not run a live
  permission request. Runtime interoperability with this installed build
  therefore still needs a manual check before enabling the integration for
  users.

## Implementation constraint

The hook must print a decision only after an explicit UI action for that
request. Timeout, disconnect, malformed response, and UI dismissal must print
no decision so Codex displays its normal prompt. The UI must never derive an
allow decision from a task status or an answer outside the UI.
