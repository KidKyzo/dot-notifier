# AGENTS.md

Guidance for AI coding agents working on **Dot Notifier** (v0.2 and later): a Windows tray app with an ambient overlay of three dots (AI Task, Notifications, System) that expands into a pill or panel.

Product scope is `docs/PRD.md` (PRD v2). Work only on the phase you are assigned. If this file conflicts with a tool-specific file such as `.agents/`, the **Boundaries** section below wins.

## Stack and layout

- Tauri 2 (Rust, MSVC toolchain) + React 19 + TypeScript + Vite. Windows 10/11 only. Node 24+, pnpm 11.25.0 (`corepack enable pnpm`).
- `src/core/` event store, state machine, settings, metrics. `src/App.tsx` overlay. `src/main.tsx` entry.
- `src-tauri/src/lib.rs` app setup and window hit-testing.
- `src-tauri/src/bus.rs` local WebSocket bus (127.0.0.1 + per-session token).
- `src-tauri/src/codex_logs.rs`, `notification_filter.rs`, `system_monitor.rs`, `win_notifications.rs` existing adapters and helpers.
- `scripts/` agent bridge scripts: `codex-notify.ps1`, `claude-notify.ps1`, `antigravity-notify.ps1`.
- `fixtures/` captured sample payloads for adapter tests. `docs/` PRD, `event-schema.md`, `notifications.md`, `manual-checklist.md`, `spikes/`.
- `.env.mock` mock mode config. `assets/icon/` icon source (added in Phase A).
- Suggested new modules for v0.2: `tray.rs`, `focus.rs`, `relay_telegram.rs`, one adapter file per agent. One concern per module.

## Commands

Run from the repo root. Use exactly these.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| UI only, mock data (browser) | `pnpm dev:mock` |
| Full native app, hot reload | `pnpm app:dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Unit tests (frontend) | `pnpm test` |
| **Everything** (typecheck, lint, Vitest, Rust fmt, clippy, unit tests) | `pnpm check` |
| Release build | `pnpm app:build` |

`pnpm check` must pass before you report a task as done. If it fails for an unrelated reason, say so and stop. Do not change unrelated code to make it green.

## Phase workflow

- One PRD phase (A to G) and one requirement ID (for example `F24`) per change set. Name both in the commit message.
- Order: spikes, then A (shell and identity), **R (notification reliability hotfix)**, B (schema v2, per-agent list), C (adapters), D (tokens, focus), E (Telegram), F (Approve/Reject), G (experimental).
- The **Extended Phase** (Now Playing, search launcher, WhatsApp-style card) is not scheduled. Do not start it unless it is assigned explicitly. Each module must be off by default and removable without touching core code.
- **Spikes first.** Every PRD cell marked "verify" or "unverified" needs a short note in `docs/spikes/<topic>.md` (what you ran, versions, result) before any adapter relies on it. Do not build on an assumption.

## Boundaries

### Always
- Add or update tests for logic you touch: upsert, priority queue, thresholds, parsers, approval flow.
- Keep the UI runnable in `pnpm dev:mock`. New states or events get a mock scenario.
- Validate every external payload against the event schema. Unknown fields are ignored; malformed payloads are dropped and logged without content.
- Keep adapters fail-open: an adapter crash never crashes the core or blocks the UI.
- Hook scripts are fire-and-forget with a short timeout (under 50 ms overhead), use absolute paths, and never block or slow the agent.
- Edit an agent's config (`~/.claude/settings.json`, `~/.codex/config.toml`, `hooks.json`, anything under `~/.gemini/`) only from an explicit user action in Settings, never silently at startup. Back up first, preserve entries you did not write, make it reversible.
- Every window uses `skipTaskbar: true`. Any new window type must do the same.
- Generate icons from the single source in `assets/icon/` with `tauri icon`. Do not hand-edit generated files.
- Deduplicate events by `agent` + `sessionId` (and `conversationId` for Antigravity CLI and IDE).
- Keep `docs/event-schema.md` in sync with any schema change.
- Notification pipeline: take a baseline at start, reconnect, and after sleep or resume; ignore anything created before it. Dedupe by notification id and creation time, never by text alone. Never silently drop a delivered notification: coalesce it and count it.
- Respect budgets: idle CPU under 1%, idle RAM under 80 MB, 60 fps animation, adaptive metric polling.

### Ask first
- Adding or upgrading any dependency, or anything needing admin rights or a kernel driver.
- Changing the event schema, bus protocol, action messages, or hit-testing and click-through logic.
- Anything that changes the approval flow (section "Approve/Reject").
- Any new outbound network call, or any change to the Telegram module.
- Writing outside the repo other than the explicit config-install flow above.
- Changing default thresholds, polling intervals, placement, or tray behavior.
- Installer, signing, auto-update, or release workflows.
- Deleting or renaming files, or touching more than about 10 files in one change.

### Never
- Scrape WhatsApp Web, automate other apps' UIs, or use unofficial chat libraries. Chat comes only from Windows notifications.
- Persist or log message bodies or sender names (info level or above). Notification diagnostics hold metadata only (app id, notification id, timestamps, decision, reason); any content comparison uses a hash.
- Open a browser or any program through a shell string. Use process arguments, URL-encode user input, and allow only http and https for URL-like input.
- Call the Spotify or YouTube APIs, or any network service, for media info. Use Windows System Media Transport Controls only.
- Add telemetry, analytics, or crash reporting.
- Make any outbound request except the opt-in Telegram relay to `api.telegram.org`, and only while the user has enabled it. Default is zero outbound.
- Forward chat or notification content to Telegram or anywhere else. The relay carries only finished, waiting, and error events with a truncated title.
- Store the Telegram token in files, `settings.json`, or logs. Use Windows Credential Manager.
- Bind the bus to anything but `127.0.0.1`, or accept a connection without the session token.
- **Auto-approve.** Never return `allow` unless the user explicitly acted on that exact event in the UI. Timeout, dismissal, an answer given in the terminal, or a dead hook process all return fallthrough so the agent's own prompt appears.
- Show a taskbar button, an Alt+Tab entry, or a main window at launch.
- Make hooks block the agent loop (Antigravity runs hooks synchronously).
- Depend on NZXT CAM or any vendor app. Bundle vendor logos (Claude, Codex, Antigravity and so on); use generic glyphs or initials.
- Copy code from GPL-licensed projects (for example `HeyyCzer/windows-dynamic-island`). Read for ideas, then write your own.
- Hardcode secrets or personal paths. Commit `.env` secrets or build artifacts.
- Disable, skip, or loosen a test, lint rule, or clippy warning to pass a check.
- Capture clicks outside the dot or panel area.

## Agent integration rules

- **Claude Code (CLI, IDE, desktop Code tab):** hooks `Stop`, `Notification`, `PermissionRequest` in `~/.claude/settings.json`. Register them directly, not through a plugin, and use absolute paths (the desktop app spawns hooks with a limited PATH). `PermissionRequest` can answer allow, deny, or fallthrough.
- **Codex:** `notify` (turn complete), `[[hooks.PermissionRequest]]` (the user must trust it via `/hooks`), and the rollout watcher in `codex_logs.rs`. Use the user-level config; `notify` must be a top-level TOML key before any table. Do not assume the hook can return a decision until a spike proves it.
- **Antigravity CLI (`agy`):** hook config location varies by version (`~/.gemini/config/hooks.json` or `settings.json`); detect it, never assume. The payload has no event-type field, so pass the event name as an argument. Hooks are observe-only: print `{}` on stdout unless a spike shows otherwise.
- **Antigravity IDE:** `hooks.json` in `.agents/` or `~/.gemini/config/`, stdin JSON with `conversationId`, and `transcript.jsonl` as backup. If one `hooks.json` serves both CLI and IDE, deduplicate by `conversationId`.
- **WSL:** do not claim support until the localhost networking check passes.
- **omp:** out of scope (separate project).
- **claude.ai web (P2, experimental):** status only, behind a clearly labeled setting, host permissions limited to claude.ai, never read or send conversation content.

## Approve/Reject (Phase F)

- The hook script blocks waiting for the bus response with a timeout, then returns fallthrough.
- Each action carries a single-use nonce bound to one event and an expiry. Replays are rejected.
- Buttons appear only when `actions` is present on the event. The bus removes them when the hook process disconnects.
- Claude Code first. Other agents only after a spike proves a decision can be returned.

## Testing rules

- **Unit (required):** upsert by `agent` + `sessionId`, peek priority (needs input and error first), aggregate dot color, system thresholds with hold and cooldown, adapter parsers.
- **Fixtures:** each adapter has a valid fixture, a malformed one, and one with unknown extra fields, per agent version you support.
- **Coalescing (F43):** two events inside the window produce one grouped expanded panel, not two peeks; events further apart stay separate peeks; a burst with a needs-input item does not auto-collapse; at most 5 rows plus "+N more"; the panel never takes focus; quiet mode suppresses it. Test the window with fake timers, not real sleeps.
- **Notification pipeline (Phase R):** replay fixtures for start with existing notifications (zero peeks), in-place update (new event), identical repeated messages (two events), burst of 10 (one grouped panel counting 10), sleep and resume (no stale peeks), Focus Assist, restart, and a call notification. Every delivered toast must be accounted for in diagnostics with a reason.
- **Approval flow:** timeout to fallthrough, dismissal to fallthrough, dead hook cleanup, nonce replay rejected, no buttons without `actions`.
- **Outbound guard:** a test asserts zero outbound requests when Telegram is disabled. Telegram tests use a mocked HTTP layer.
- **UI:** state transitions idle, alert, peek, expanded against mock events. No animation snapshots.
- **Manual (cannot be automated), recorded in `docs/manual-checklist.md`:** no taskbar button and no Alt+Tab entry, tray icon crisp at 100, 150, 200% DPI in light and dark taskbars, click-through, hover hit-testing, fullscreen hiding, multi-monitor, single-instance relaunch opens Settings, hidden auto-start. List in your report which items you could not verify.
- A bug fix starts with a failing test that reproduces it.

## Automation

- **Pre-commit** (`lefthook` or `husky`): `pnpm lint`, `pnpm typecheck`, `cargo fmt --all --check`.
- **CI** (`.github/workflows/`, `windows-latest`): on every push and PR run `pnpm install --frozen-lockfile` then `pnpm check`. A PR cannot merge while red.
- **Performance smoke** (optional job): run with mock data for 60 s; fail above 1% idle CPU or 80 MB RAM.
- **Release:** a `vX.Y.Z` tag builds the installer. Agents never tag or publish.

## Pull request checklist

- [ ] Phase and requirement IDs: ...
- [ ] `pnpm check` passes (paste the last lines)
- [ ] Tests added or updated; spike note added for any "verify" item used
- [ ] `dev:mock` works; mock scenario added if needed
- [ ] No taskbar button, Alt+Tab entry, or launch-time window introduced
- [ ] No new outbound call, dependency, schema change, or outside-repo write (or approved: link)
- [ ] No message content stored or logged; no auto-approve path
- [ ] Manual checklist items affected: ... (verified / not verified)

## Working style

- Smallest change that satisfies the requirement. No drive-by refactors.
- If the PRD is ambiguous or two requirements conflict, stop and ask. Never guess on privacy, permissions, approvals, or schema.
- Rust: no `unwrap()` or `expect()` outside tests and startup; return errors. TypeScript: no `any`; no non-null assertions without a comment.
- Comments explain why, not what. User-facing strings go through i18n.
- Final report: what changed, what was tested, what was not verified, follow-ups. Under 150 words.
