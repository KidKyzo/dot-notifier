# AGENTS.md

Guidance for AI coding agents working on **Dot Notifier**: a lightweight Windows overlay that shows three dots (AI Task, Notifications, System) in a screen corner and expands them into a pill or panel. Product scope lives in `docs/PRD.md`; follow the phase you are assigned and nothing beyond it.

> Assumptions to confirm once: package manager `pnpm`, UI test runner `vitest`, lint `eslint`. If the repo uses something else, change the commands below and keep everything else.

## Stack and layout

- Tauri 2 (Rust core) + React + TypeScript UI. Windows 10/11 only.
- `src/core/` island state machine, event store, settings, i18n
- `src/modules/{ai-task,notifications,system}/` one folder per dot: UI + module logic
- `src/core/mock.ts` fake data; the UI must always run without the native app
- `src-tauri/src/window.rs` click-through window, cursor polling, hit-testing
- `src-tauri/src/bus.rs` local WebSocket event bus (127.0.0.1, per-session token)
- `src-tauri/src/adapters/` one adapter per source: `codex`, `winnotify`, `system` (NVML + PDH)
- `fixtures/` captured sample payloads used by adapter tests

## Commands

Run from the repo root. Use these exact commands; do not invent alternatives.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| UI only, mock data (browser) | `pnpm dev:mock` |
| Full app with hot reload | `pnpm app:dev` |
| Typecheck | `pnpm typecheck` |
| Lint (TS) | `pnpm lint` |
| Unit tests (TS) | `pnpm test` |
| Rust format check | `cargo fmt --all --check` (in `src-tauri/`) |
| Rust lint | `cargo clippy --all-targets -- -D warnings` |
| Rust tests | `cargo test` |
| **Everything above** | `pnpm check` |
| Build installer | `pnpm app:build` |

`pnpm check` must pass before you report a task as done. If it fails for a reason unrelated to your change, say so and stop; do not "fix" unrelated code to turn it green.

## Boundaries

### Always
- Work on one PRD phase or one requirement ID (for example `F5`) per change set. Name it in the commit message.
- Add or update tests for any logic you touch: event upsert, priority queue, thresholds, adapter parsers.
- Keep the UI runnable in `dev:mock`. New states or events get a mock scenario in `src/core/mock.ts`.
- Validate every external payload (Codex `notify`, Windows notifications, hook bodies) against the event schema. Unknown fields are ignored; a malformed payload is dropped and logged, never thrown.
- Keep adapters fail-open: an adapter crash must never crash the core or block the UI.
- Respect budgets: idle CPU under 1%, idle RAM under 80 MB, animations at 60 fps. Metric polling is adaptive (about 2 s idle, 0.5-1 s when the panel is open).
- Use relative work-area positioning (not full screen size) and support multiple monitors.
- Read `docs/PRD.md` and the event schema section before changing `src-tauri/src/bus.rs` or any adapter.

### Ask first
- Adding or upgrading any dependency (Rust crate or npm package), and anything that needs admin rights or a kernel driver (for example LibreHardwareMonitor).
- Changing the event schema, bus protocol, or the click-through and hit-testing logic in `window.rs`.
- Writing to files outside this repo, including `~/.codex/config.toml` or any other user config. If approved: back up first, preserve existing entries, make it reversible.
- Changing default thresholds, polling intervals, or the corner/placement behavior.
- Anything touching installer, signing, auto-update, or release workflows.
- Deleting or renaming files, or touching more than about 10 files in one change.

### Never
- Scrape WhatsApp Web, automate other apps' UIs, or use unofficial chat libraries. Chat comes only from Windows notifications (`UserNotificationListener`).
- Persist message bodies or sender names to disk, or log them at info level or above.
- Add telemetry, analytics, crash reporting, or any outbound network call that the PRD does not list.
- Bind the bus to anything other than `127.0.0.1`, or accept a connection without the session token.
- Depend on NZXT CAM or any vendor app being installed. System data comes from NVML and Windows performance counters.
- Copy code from GPL-licensed projects (for example `HeyyCzer/windows-dynamic-island`) into this repo. Read for ideas, then write your own. Check a license before reusing anything.
- Hardcode secrets, tokens, or personal paths. Commit `.env` files or build artifacts.
- Disable, skip, or loosen a test, lint rule, or clippy warning to make a check pass.
- Make the overlay capture clicks outside the dot or panel area.

## Testing rules

- **Unit (automated, required):** event upsert by `id`, peek queue priority (error and needs-input first), system threshold logic including the 30 s hold and cooldown, adapter parsers using files in `fixtures/`.
- **Adapters:** every parser has at least one valid fixture, one malformed fixture, and one with unknown extra fields.
- **UI:** state transitions idle to alert to peek to expanded and back, tested against mock events. No snapshot tests of animations.
- **Native behavior (manual, cannot be automated):** click-through, hover hit-testing, fullscreen hiding, multi-monitor, taskbar placement. Add a line to `docs/manual-checklist.md` when you change any of these, and list in your report which items you could not verify.
- A bug fix starts with a failing test that reproduces it.

## Automation

- **Pre-commit** (`lefthook` or `husky`): runs `pnpm lint`, `pnpm typecheck`, `cargo fmt --all --check`. Fast checks only.
- **CI** (`.github/workflows/check.yml`, `windows-latest`): on every push and PR run `pnpm install --frozen-lockfile`, then `pnpm check`. Cache pnpm and cargo. A PR cannot merge while red.
- **Performance smoke** (`pnpm perf:smoke`, optional job): starts the app with mock data for 60 s and fails if idle CPU is above 1% or RAM above 80 MB.
- **Release:** tag `vX.Y.Z` triggers the installer build. Agents never tag or publish.

## Pull request checklist

Include this in the PR description and fill it honestly:

- [ ] Phase and requirement IDs: ...
- [ ] `pnpm check` passes (paste the last lines of output)
- [ ] Tests added or updated for changed logic
- [ ] `dev:mock` still works; mock scenario added if needed
- [ ] Manual checklist items affected: ... (verified / not verified)
- [ ] No new dependency, schema change, or outside-repo write (or it was approved: link)
- [ ] No message content stored or logged

## Working style

- Make the smallest change that satisfies the requirement. No drive-by refactors.
- If the PRD is ambiguous or two requirements conflict, stop and ask. Do not guess on privacy, permissions, or schema.
- Keep functions small and typed. Rust: no `unwrap()` or `expect()` outside tests and startup; return errors. TypeScript: no `any`, no non-null assertions without a comment.
- Comments explain why, not what. User-facing strings go through i18n, never inline.
- Final report: what changed, what was tested, what was not verified, and any follow-ups. Under 150 words.
