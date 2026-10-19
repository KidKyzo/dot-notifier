# PRD v2: Dot Notifier for Windows (Codex-focused)

Version 2.0 · Replaces v0.1 (kept in the two v1 tabs) · Baseline: v0.1.0 is already built ([KidKyzo/dot-notifier](https://github.com/KidKyzo/dot-notifier)). This PRD scopes v0.2 onward.

## 1. Summary

Dot Notifier is a Windows tray app with an ambient overlay of three dots in a screen corner: **AI Task** (Codex, with other adapters only where explicitly scoped), **Notifications**, and **System** (PC performance). Dots expand smoothly into a pill (peek) or a panel (expanded) only when needed. Style: minimal, macOS-like, not a Dynamic Island.

v2 adds: a tray-only shell with a custom app icon (no taskbar button), a per-agent list, click-to-focus, token and quota readout, and conditional Codex Approve/Reject from the pill after verification.

## 2. Changes from v1

- **Corrected:** Codex does have a waiting-for-approval signal (`approval-requested`, a `[[hooks.PermissionRequest]]` hook that must be trusted via `/hooks`, and detection from the session rollout). The v1 risk row saying otherwise is retired.
- **Corrected:** Antigravity does have hooks, both for the CLI (`agy`) and the IDE. The adapter moves from P2 to P1.
- **New:** tray-only shell and custom icon, per-agent list, click-to-focus, tokens and quota, and conditional Codex Approve/Reject after verification.
- **Baseline already shipped in v0.1.0:** click-through overlay with three dots and four states, local WebSocket bus with per-session token, Windows notification listener with per-app filter, system monitor (PDH and NVML), Codex log watcher and bridge, Antigravity bridge, mock mode, and `pnpm check`.

## 3. Goals and Non-goals

**Goals**

- One ambient place to see all agent tasks, messages, and PC load without breaking focus.
- Invisible by default: tray-only, no taskbar button, dots at low opacity when idle.
- Adapter architecture: a new agent or source is one adapter plus one fixture set.
- Privacy first: local only; anything leaving the PC is opt-in.

**Non-goals for v0.2**

- Replying to chat messages, macOS or Linux, scraping WhatsApp Web, cloud sync or accounts.
- Remote approval of agent actions; approval stays in the local app.

## 4. App Shell: Tray-only and Custom Icon (new)

The app starts directly in the system tray. It never shows a main window or a taskbar button.

- F24. **Tray-only.** All windows use `skipTaskbar: true`. The overlay is also created as a tool window so it does not appear in Alt+Tab (verify on Windows 10 and 11). No window is shown at launch except the overlay dots.
- F25. **Single instance.** A second launch does not start a new process; it opens Settings in the running instance.
- F26. **Custom icon set.** One 1024x1024 source (SVG kept in `assets/icon/`) generates the app `.ico` (16, 24, 32, 48, 64, 128, 256), installer icon, and tray icons at 16, 20, 24, 32 px for different DPI. The design must stay legible at 16 px, work on light and dark taskbars (provide light and dark tray variants), and must not reuse any agent vendor's logo.
- F27. **Tray menu and tooltip.** Menu: show or hide overlay, pause, quiet mode, open Settings, open config folder, quit. The tooltip shows the aggregate status (for example "2 running, 1 waiting"). Optional: a small status color badge on the tray icon.
- F28. **Auto-start to tray.** Launch on login with the window initially hidden during setup, then show the overlay dots automatically without flashing a main window.
- Windows 11 may place a new tray icon in the hidden-icons overflow. Show a one-time first-run hint explaining how to pin it.
- Set a stable App User Model ID so the app identity and icon are consistent in Windows features that use it.

## 5. UX Concept

| State | Appearance | Trigger |
| --- | --- | --- |
| Idle | Three dots, low opacity | Default |
| Alert | Dot pulses or changes color | New event |
| Peek | Dot stretches into a pill (icon + one line), closes after 3-4 s; shows Approve/Reject when the agent supports it | Message, task done, waiting, threshold crossed |
| Expanded | Panel with per-agent list, notifications, system sparklines | Hover or click |

**Dot rules**

- Three fixed dots: AI Task, Notifications, System. Never one per notification.
- Colors: gray (idle), blue (running), green (done), red (error), orange (needs input or permission).
- The AI Task dot shows the highest-priority state across all agents: needs input, then error, then running, then done. It has a thin progress ring while anything runs.
- The Notifications dot shows an unread badge. The System dot shows a ring for the highest load (CPU or GPU), colored by thresholds.
- Tokens and quota live inside the AI Task panel. A fourth dot is an opt-in setting (P2), off by default.

**Expanded AI Task panel:** one row per agent session: agent icon, name, project (folder name), status, duration, tokens. Clicking a row focuses that agent's window.

**Simultaneous events (applies to AI Task, Notifications, and System):** when two or more peek-worthy events arrive within a short window (default 1.5 s, configurable) or while a peek is already showing, they are not queued as separate pills. The peek morphs into the expanded panel with a grouped list of the burst.

- Items from the burst are highlighted at the top; needs-input and error items come first; at most 5 rows are shown, then "+N more".
- The panel never takes focus. It auto-collapses after about 6 s without hover; hovering keeps it open.
- If any item is waiting for input, auto-collapse does not apply: the panel shrinks to a pill with a count and the dot stays orange until the user acts or dismisses.
- Only one expanded panel exists at a time. If several dots have bursts, it holds one section per dot, ordered by priority.
- A single event keeps the normal peek. Quiet mode and fullscreen or Focus Assist suppression apply unless the user opts into fullscreen notification peeks; Focus Session suppression always applies.
- The dot shows a count badge while a burst is unresolved.

**Animation:** one morphing element (width, height, radius) with spring easing; content fades in after the size is nearly final; dots brighten when the cursor is within about 100 px.

## 6. Functional Requirements

**P0: v0.2 core**

- F24-F28. App shell (section 4).
- F29. Event schema v2 (section 7) with upsert by `agent` + `sessionId`.
- F30. Per-agent list in the AI Task panel and aggregate dot color.

* F43. Event coalescing: simultaneous events on a dot expand into a grouped panel instead of sequential peeks (see section 5).

- F47. Notification reliability (Phase R): no stale notifications peek after start, resume, or reconnect; no delivered message is silently lost; measured latency; diagnostics without message content.

**P1**

- F31. Antigravity CLI adapter (`agy` hooks).
- F32. Antigravity 2.0 app and IDE adapters (`hooks.json` and `transcript.jsonl`), kept distinct and deduplicated by `conversationId` per agent.
- F33. Codex waiting detection via rollout watcher and, optionally, `[[hooks.PermissionRequest]]`.
- F34. Click-to-focus: window level (pid to process tree to window handle).
- F35. Tokens and quota readout in the panel; no currency, because subscriptions have no per-token price.

**P1, late (after verification spikes)**

- F37. Bidirectional bus and Codex Approve/Reject from the pill, only if the verification spike confirms Codex can return a decision.

**P2**

- F39. Experimental Antigravity IDE extension via the community `antigravity-sdk` (monitoring and step approval; unofficial, fragile).
- F40. Optional fourth dot for tokens and quota.
- F41. LibreHardwareMonitor or HWiNFO for CPU temperature, fans, power (admin rights).

**Extended Phase (to be decided, after Phase F)**

- F44. Now Playing module: read title, artist, cover, and play state from Windows System Media Transport Controls, with play, pause, next. Optional, off by default. Recognized music app IDs are accepted; browser sessions require a separate opt-in because Windows does not identify the site. No Spotify or YouTube API, no outbound.
- F46. WhatsApp-style message card and incoming-call peek: sender initials as avatar, one line of text; call peek with an "Open WhatsApp" button.

## 7. Event Schema v2

```json
{
  "id": "uuid",
  "source": "ai | chat | system",
  "agent": "codex | antigravity-cli | antigravity-ide | omp",
  "sessionId": "conversation or session id",
  "kind": "task | message | metric",
  "status": "running | done | error | needs_input | unread | warn | crit",
  "title": "refactor auth",
  "progress": 0.42,
  "startedAt": "ISO-8601",
  "cwd": "C:/work/app",
  "pid": 1234,
  "usage": { "tokens": 18200, "quotaLeft": 0.63 },
  "actions": ["approve", "reject"],
  "meta": {}
}
```

- Upsert key: `agent` + `sessionId` (fallback `id`).
- Action message from UI to bus: `{ "type": "action", "eventId": "...", "action": "approve | reject", "nonce": "..." }`. The nonce is bound to one event and expires.
- `actions` is present only when the agent can really act on the response.
- Message bodies are never stored on disk.

## 8. Agent Integration Matrix

| Agent | Mechanism | Running/done | Waiting | Approve/Reject |
| --- | --- | --- | --- | --- |
| Codex CLI | `notify` (turn complete), `[[hooks.PermissionRequest]]` (needs `/hooks` Trust), rollout watcher | Yes | Yes | Verify that the hook can return a decision |
| Antigravity CLI (`agy`) | `hooks.json` or `settings.json` (location varies by version); event name passed via argv; hooks run synchronously | Yes | Unclear (`Notification` fires on turn end and on user input) | No (observe-only) |
| Antigravity 2.0 app | `hooks.json` with `PreInvocation` and `Stop`; transcript under `~/.gemini/antigravity/brain` | Yes | Unverified | No (observe-only) |
| Antigravity IDE | `hooks.json` in `.agents/` or `~/.gemini/config/`; stdin JSON with `conversationId`; `transcript.jsonl` as backup | Yes | Unverified | Unverified |
| omp | Unknown | Out of scope (separate project) | No | No |

WSL note: if an agent runs in WSL, its hooks run inside WSL and must reach the bus on Windows localhost. Verify networking (mirrored mode or forwarding) before promising WSL support.

## 9. Architecture

- **UI:** Tauri 2 (Rust + React + TypeScript), one small transparent window in the corner.
- **Core:** Rust process with the event bus, cursor polling and `set_ignore_cursor_events`, tray, single-instance guard, and focus helper.
- **Bus:** local WebSocket on 127.0.0.1 with a per-session token, now **bidirectional** (events in, actions out).
- **Adapters:** `codex` (notify, hooks, rollout), `antigravity-cli`, `antigravity-ide`, `winnotify`, `system` (PDH and NVML), optional extensions.
- **Hook rules (all agents):** scripts are fire-and-forget with a short timeout and fail open (never block or break the agent if the bus is down); use absolute paths; edit agent config only with a backup, preserve existing entries, and make it reversible.
- **Approval hook:** the script blocks waiting for the UI response with a timeout. On timeout, UI dismissal, or an answer given in the terminal, it returns fallthrough so the agent's own prompt appears. **It never auto-approves.** The bus detects a dead hook process and removes the buttons from the pill.
- **Focus:** from `pid`, walk the process tree to a top-level window and bring it forward. Window-level focus is the target; focusing a specific Windows Terminal tab is not guaranteed.

## 10. Privacy and Security

- Default is **zero outbound**. README and settings must say "zero outbound by default".
- The app makes no outbound network requests.
- No message bodies or sender names on disk or in logs at info level or above.
- The bus binds to localhost only and requires the session token. Action nonces are single-use.
- No telemetry. No dependency on NZXT CAM or any vendor app.
- Do not copy code from GPL projects into this repo; check licenses first.

## 11. Non-Functional Requirements

- Idle RAM under 80 MB, idle CPU under 1%, animations at 60 fps.
- Event-to-display latency under 300 ms.
- Hook script overhead under 50 ms per event.
- Works on Windows 10 and 11, one or two monitors, taskbar-aware placement.

## 12. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Antigravity hook format and config location differ by version and source | Adapter breaks on update | Detect the existing file, validate payloads, fixtures per version, check docs for the installed version |
| `agy` may not run natively on Windows | Adapter unusable outside WSL | Verify first; support WSL only after the networking check |
| Antigravity hooks run synchronously | A slow script slows the agent | Fire-and-forget, short timeout, fail open |
| Antigravity `Notification` mixes done and waiting | Wrong orange state | Treat as done unless transcript or payload proves waiting |
| Codex PermissionRequest hook may not return decisions | No Approve/Reject for Codex | Status only for Codex until verified |
| Wrong or stale approval | An action runs that the user did not intend | Single-use nonce, timeout to fallthrough, never auto-approve, remove buttons when the hook dies |
| Tray icon hidden in Windows 11 overflow | User thinks the app is not running | First-run pin hint, overlay dots as primary UI |
| Tray-only app has no visible window | Hard to recover if overlay is off-screen | Tray menu always works; single-instance relaunch opens Settings |
| Toast duplicates (original and overlay) | Bad UX | Guide users to disable source app toasts |
| Metric polling overhead | The monitor loads the PC | Adaptive polling, pause on lock |

## 13. Roadmap

Estimates for one part-time developer (10-15 hours per week). About 8-9 weeks for P0 and P1 (Phase R adds about 1 week), excluding P2 and the Extended Phase.

**Spikes first (2-3 days total, before building adapters)**

- Does `agy` run natively on Windows, and where do its hooks live in your version?
- Does `hooks.json` fire in the Antigravity IDE, with which events, and is there any "waiting" signal?
- Can Codex's PermissionRequest hook return a decision?

**Phase A: Shell and identity (3-4 days)**

- Tray-only, `skipTaskbar`, single instance, hidden auto-start, tray menu and tooltip, full icon set.
- Done when: launching shows no taskbar button; the tray icon is crisp at 100%, 150%, 200% DPI.

**Phase R: Notification reliability hotfix (about 1 week; run right after Phase A)**

Symptoms seen in v0.1.0: WhatsApp notifications sometimes arrive late, some messages never appear, and old notifications suddenly peek again. These are hypotheses to confirm, not established causes.

- **Old notifications peek again.** The listener returns everything currently in Action Center, so after start, reconnect, or sleep and resume, old items can look new. Fix: record a baseline at start and after resume, ignore anything created before it, and keep a seen-set keyed by notification id and creation time plus a content hash (hash only, never the text).
- **Messages missing.** Candidates: an app updates one notification in place (same id, new text); dedupe drops repeated identical text such as two "ok" messages; `notification_filter.rs` or the peek queue caps or drops items; `NotificationChanged` is missed. Fix: treat a changed hash or newer creation time as a new event; dedupe on id plus creation time, never on text alone; never drop, coalesce into the grouped panel with a true count; add a periodic reconcile poll as a safety net next to the event. Microsoft's guidance is to sync with `GetNotificationsAsync` and diff for added and removed items; `NotificationChanged` is an in-memory foreground event.
- **Delay.** Separate three causes: source delay (WhatsApp or Windows delivered late), our listener or poll interval, and our own peek queue and coalescing window. Source-side causes to rule out: WhatsApp focused, muted chats, Focus Assist, app notification settings.
- **Diagnostics first (2 days).** A ring buffer of metadata only (app id, notification id, creation time, received time, decision such as shown, deduped, filtered, queued, dropped, and the reason). Never body or sender. A tray item exports it to a local file on explicit user action. Log `received - created` and `displayed - received`.
- **Replay tests with fixtures:** start with existing notifications (zero peeks); in-place update (new peek); identical repeated messages (two events); burst of 10 (one grouped panel counting 10); sleep and resume (no old peeks); Focus Assist on; app restart; a call notification.
- **Done when:** 20 start and resume cycles produce zero stale peeks; every delivered toast is accounted for in diagnostics with a reason; the p95 of `displayed - received` is under 1 s in normal mode, with source delay reported separately.

**Phase B: Schema v2 and per-agent list (1 week)**

- Schema and upsert, aggregate dot color, expanded list, mock scenarios for several agents.

* Coalescing window, grouped expanded panel, count badge, and mock burst scenarios (F43).

**Phase C: Agent adapters (1.5 weeks)**

- Codex waiting detection and Antigravity app, CLI, and IDE adapters.

**Phase D: Tokens, quota, and click-to-focus (1 week)**

- Usage readout where the agent exposes it; pid to window focus with graceful fallback.

**Phase F: Codex Approve/Reject (1.5 weeks, conditional on the verification spike)**

- Bidirectional bus, blocking hook with timeout and fallthrough, nonce, pill buttons, stale-state cleanup.

**Phase G: Experimental extensions (optional)**

- Antigravity IDE extension behind a clearly labeled experimental setting.

**Extended Phase (to be decided, not scheduled)**

Modules to think about after the core is stable. Each one is optional, off by default, and behind a setting.

- **Now Playing (F44):** Windows System Media Transport Controls gives title, artist, cover, and state, and accepts play, pause, next, for apps that integrate it. Only sessions with source app IDs identifying Spotify, Apple Music, or YouTube Music are included by default. An explicit setting can include Chrome/Edge sessions, but Windows does not expose the website, so any media played by that browser may appear. It is local, with no login and no outbound request. Shown as a section in the panel; a peek on track change is optional and off by default.
- **WhatsApp-style card and call peek (F46):** the Windows listener probably does not provide a profile photo, so use colored initials. Answering or declining a call from the overlay is not promised; "Open WhatsApp" is.
- **Not adopted from Quick Pill:** tasks, timer, clipboard manager, calendar, weather, quick apps. Out of scope unless decided later.
- **Decision criteria:** the core phases are stable, idle CPU and RAM budgets still hold with the module enabled, and the module can be removed without touching core code.

**Definition of Done for every phase:** `pnpm check` passes; tested manually on Windows 10 and 11; no click-through regression; idle CPU and RAM stay within budget.

## 14. Success Metrics

- No taskbar button in any normal state; app reachable from the tray every time.
- Event-to-display latency under 300 ms.
- Zero reports of the overlay blocking clicks outside the dot area.
- Zero outbound connections.
- A pending permission is visible and actionable without opening the agent window.

## 15. Open Questions

- Decided: the Settings window never shows a taskbar button, even while open.
- Which license for the repo, given the GPL-3.0 projects used as references?
- Decided: omp integration is out of scope here and will be a separate project.
- Distribution: regular installer or MSIX (needed for some notification features)?
- Default corner: top right or bottom right?

* Which Extended Phase modules, if any, should be built, and in what order?

## 16. Reference Projects

Found through searches; code and licenses not audited. Check a license before using any code.

| Project | Platform | Relevance |
| --- | --- | --- |
| [HeyyCzer/windows-dynamic-island](https://github.com/HeyyCzer/windows-dynamic-island) | Windows | Same stack; click-through hit-testing, modular providers, mock mode. GPL-3.0 or later. |
| [yazelin/agentpulse](https://github.com/yazelin/agentpulse) | Not verified | Multi-provider (Antigravity, Codex, Copilot) and tray; useful comparison for the v0.2 scope. |
| [souverth/dynamic-island-4win](https://github.com/souverth/dynamic-island-4win) | Windows | Notification hub and hardware monitor. |
| [nabil24024004/Quick-Pill-Dynamic-Island-for-Windows](https://github.com/nabil24024004/Quick-Pill-Dynamic-Island-for-Windows) | Cross-platform | Spring morphing, Windows notifications. |
| [devcode90/Dynamic-Island-for-Windows](https://github.com/devcode90/Dynamic-Island-for-Windows) | Windows (Windhawk) | Game overlay metrics, Do Not Disturb handling. |
| [686f6c61/agent-bar](https://github.com/686f6c61/agent-bar) | Linux | Hook management and session transcript parsing. |
| [mpashka/gnome-widget-panel](https://github.com/mpashka/gnome-widget-panel) | Linux | Single agent-status dot concept. |
| [Kanezal/antigravity-sdk](https://github.com/Kanezal/antigravity-sdk) | Antigravity IDE | Unofficial SDK for IDE extensions (monitoring, step approval); reverse-engineered, so fragile. |
