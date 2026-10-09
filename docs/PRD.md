# PRD & Dev Plan: Dot Notifier for Windows

Version 0.1 · Draft for solo-developer scoping (English translation of the main tab)

## 1. Summary

Dot Notifier is a lightweight Windows desktop app that shows a few small dots in a screen corner. The dots represent three event categories: AI Task (Codex, Antigravity), Notifications (chat and other apps), and System (PC performance). When something happens, the relevant dot changes color or pulses, and it can smoothly expand into a pill (peek) or a full panel (expanded) with more detail. The visual style is minimal, macOS-like, and explicitly not a Dynamic Island.

## 2. Problem and Goals

**Problem**

- AI agent tasks (Codex, Antigravity) run for a long time, and users have to keep checking windows.
- Windows toast notifications feel intrusive and are not consolidated.

**Goals**

- One ambient place to monitor AI task status and incoming messages without breaking focus.
- Nearly invisible when idle; full details only when needed.
- Adapter architecture so new sources are easy to add.

**Non-goals for v1**

- Replying to messages from the overlay.
- macOS/Linux support.
- Scraping WhatsApp Web or using unofficial libraries.
- Cloud sync or user accounts.

## 3. Target Users

Developers who use several AI coding agents at once and often run long tasks while working on something else. Primary persona: Windows 11 user with one or two monitors.

## 4. UX Concept

| State    | Appearance                                                             | Trigger                      |
| -------- | ---------------------------------------------------------------------- | ---------------------------- |
| Idle     | 2-5 small dots, low opacity                                            | Default                      |
| Alert    | Dot pulses or changes color                                            | New event                    |
| Peek     | Dot stretches into a pill (icon + one line), closes itself after 3-4 s | Incoming chat, task finished |
| Expanded | Panel with task list, progress, latest messages                        | Hover or click               |

**Dot rules**

- Three fixed dots, one per category (AI Task, Notifications, System), not one per notification.
- Colors: gray (idle), blue (running), green (done), red (error), orange (needs input or permission).
- A running task dot has a thin progress ring. The Notifications dot shows an unread badge. The System dot shows a ring for the highest load (CPU or GPU) with color based on thresholds.

**Animation**

- One morphing element (width, height, radius) with spring easing. Content fades in staggered once the size is nearly final.
- The dot brightens when the cursor is within about 100px.

## 5. Functional Requirements

**P0 (required for MVP)**

- F1. Transparent, always-on-top overlay in the user-selected corner, using the work area (not covered by the taskbar).
- F2. Four UI states with smooth transitions.
- F3. Click-through in empty areas; interaction enabled only when the cursor is over a dot or the panel.
- F4. Local event bus (WebSocket on 127.0.0.1) with a standard event schema.
- F5. Codex adapter via the `notify` option in config.toml.
- F6. Windows notification adapter (UserNotificationListener) with per-app filtering.
- F7. Peek queue with priority: errors and needs-input go first.
- F8. Tray icon: pause, quiet mode, open settings, quit.

**P1**

- F9. Settings: corner, peek duration, monitored apps, auto-start on login.
- F10. Click a dot or item to focus the source app window.
- F11. Hide peeks while an app is fullscreen or Focus Assist is on.
- F12. Multi-monitor support.

**P1 additions: system monitor (third dot)**

- F16. System adapter: NVML for NVIDIA GPUs, Windows Performance Counters (PDH) for CPU, RAM, disk, network, and cross-vendor GPU.
- F17. System dot with a ring for the highest load; color changes by threshold (default: yellow above 80°C or RAM above 90%, red above 90°C).
- F18. Expanded System panel: CPU, GPU, RAM, VRAM, and temperature, each with a 60-second sparkline.
- F19. System peek only when a threshold is exceeded for more than 30 seconds, with a cooldown to avoid repeats.
- F20. Adaptive polling: about 2 s when idle, 0.5 to 1 s when the panel is open.

**P2**

- F13. Antigravity adapter (see risks).
- F14. Watch Codex session logs for more detailed progress.
- F15. Automatic light/dark theme following the system.

**P2 additions: advanced sensors**

- F21. CPU temperature, fans, and power via LibreHardwareMonitor (optional, requires admin rights).
- F22. Read HWiNFO shared memory for users who already run it.
- F23. NZXT cooler sensors (liquid temperature, pump) only if NZXT opens access outside CAM; out of scope until then.

## 6. Event Schema

```json
{
  "id": "uuid",
  "source": "codex | antigravity | chat",
  "kind": "task | message",
  "status": "running | done | error | needs_input | unread",
  "title": "refactor auth",
  "body": "optional",
  "progress": 0.42,
  "startedAt": "ISO-8601",
  "meta": { "app": "WhatsApp", "sender": "Rina" }
}
```

An event with the same `id` replaces the previous state (upsert), so progress can be updated without duplicates.

For the System dot, `source` gains the value `system` and `kind` gains `metric`. Metric snapshots (taken every 1-2 s) go straight to the panel; only threshold violations (`status: warn | crit`) enter the peek queue.

## 7. Architecture

- **UI**: Tauri (Rust + web UI), one small transparent window (about 360x500) in the corner.
- **Core**: Rust process that runs the event bus, polls the cursor (about 60 ms), and manages `set_ignore_cursor_events`.
- **Adapters**: a separate process or module per source, all sending standard events to the bus.
- **Windows notification listener**: a small sidecar (C# or Rust `windows` crate) that talks over a local WebSocket.

**System adapter**: a Rust module inside the core process (not a sidecar) that reads NVML and PDH, keeps a 60-sample buffer, and sends snapshots to the UI. Metrics do not share the peek queue with notifications.

## 8. Non-Functional Requirements

- Idle RAM under 80 MB, idle CPU under 1%.
- Animation at 60 fps on mid-range hardware.
- All data stays local; no telemetry. Message content is not written to disk by default.
- The bus binds to localhost only and uses a random per-session token.

## 9. Risks and Mitigations

| Risk                                                           | Impact                                  | Mitigation                                                                                        |
| -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Antigravity has no official hook                               | Unstable adapter                        | Defer to P2; evaluate a VS Code-compatible extension or watching state files                      |
| Codex payload format changes                                   | Adapter breaks                          | Isolate the parser, validate the schema, tolerate versions                                        |
| UserNotificationListener needs permission and package identity | More complex setup                      | Test early in Phase 4; prepare MSIX packaging if needed                                           |
| Duplicate toasts (original and overlay)                        | Bad UX                                  | Guide users to disable the source app's toast in settings                                         |
| Hover on a click-through window                                | Unresponsive interaction                | Native cursor polling and dot-area hit-testing                                                    |
| NZXT CAM has no local API and may lock NZXT cooler sensors     | Liquid and pump temperatures unreadable | Do not depend on CAM; read NVML and PDH directly; NZXT cooler sensors out of scope                |
| Codex has no hook for waiting-for-permission status            | Orange status unavailable for Codex     | Codex reports only done and error; orange for agents that have hooks; re-verify in the Codex docs |
| Metric polling overhead                                        | The monitor itself loads the PC         | Adaptive polling; stop when the screen is locked                                                  |

## 10. Success Metrics

- Event-to-display latency under 300 ms.
- The overlay never blocks clicks outside the dot area (0 bug reports).
- Users can tell task status without opening the agent window.

## 11. Dev Plan

Estimates for one part-time developer (about 10-15 hours per week). About 9 weeks total for P0 and P1.

**Phase 0: Setup (3-4 days)**

- Set up Tauri, repo, lint, and a Windows CI build.
- Finalize the event schema and color palette.
- Result: an empty app that runs and builds.

**Phase 1: Core UI (1.5 weeks)**

- Transparent window in the corner, one component with four states, spring animation.
- Dummy data through a debug panel.
- Result: a prototype matching the HTML demo, running in Tauri.

**Phase 2: Native interaction (1 week)**

- Click-through, cursor polling, hit-testing, work-area placement, tray icon.
- Result: the overlay does not block clicks; hover works.

**Phase 3: Event bus and Codex adapter (1 week)**

- Local WebSocket with token, event upsert, priority queue.
- Codex `notify` script that sends to the bus.
- Result: real Codex tasks appear as dots and peeks.

**Phase 3b: System monitor (1 week)**

- NVML and PDH adapter, 60-sample buffer, adaptive polling.
- System dot, panel with sparklines, thresholds, and peek on violations.
- Result: the third dot shows real load and temperature with low overhead.

**Phase 4: Windows notifications (1.5 weeks)**

- Listener sidecar, permissions, per-app filtering, deduplication.
- Result: WhatsApp and Telegram messages appear on the Notifications dot.

**Phase 5: Settings and polish (1 week)**

- Settings page, auto-start, fullscreen and Focus Assist detection, multi-monitor.
- Result: internal release candidate (v0.1).

**Phase 6: Antigravity and Codex log exploration (optional, 1-2 weeks)**

- 2-day technical spike to pick the best route, then implement if viable.

**Definition of Done for every phase**

- Feature manually tested on Windows 10 and 11, no click-through regressions, idle CPU stays low.

## 12. Open Questions

- Distribution via a regular installer or MSIX (needed for the notification listener)?
- Default corner: top right or bottom right?

**Resolved for v1:** The expanded panel can approve agent permission requests when
the source supports an explicit approval action. Each notification has an X
control to dismiss it from the active panel and peek queue, preventing dismissed
notifications from accumulating in the overlay.

## 13. Similar Projects

Found through GitHub searches. I have not audited their code or licenses, so check the license before using any code.

| Project                                                                                                                      | Platform               | Relevance                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Terryxxx/Navi](https://github.com/Terryxxx/Navi)                                                                             | Windows                | Closest architecture: pill overlay for Claude Code notifications; hooks send JSON over a named pipe to the GUI app (Rust and an HTML/CSS/JS renderer).                                 |
| [HeyyCzer/windows-dynamic-island](https://github.com/HeyyCzer/windows-dynamic-island)                                         | Windows                | Same stack (Tauri, Rust, React/TypeScript): click-through window with hover hit-testing, modular providers, Claude Code hooks, mock-data dev mode. GPL-3.0 or later; Claude Code only. |
| [souverth/dynamic-island-4win](https://github.com/souverth/dynamic-island-4win)                                               | Windows                | Notification hub (Chrome, Zalo, Messenger) and hardware monitor (CPU, RAM, storage, battery).                                                                                          |
| [nabil24024004/Quick-Pill-Dynamic-Island-for-Windows](https://github.com/nabil24024004/Quick-Pill-Dynamic-Island-for-Windows) | Windows, Linux, macOS  | Windows notification integration and Framer Motion spring morphing.                                                                                                                    |
| [devcode90/Dynamic-Island-for-Windows](https://github.com/devcode90/Dynamic-Island-for-Windows)                               | Windows (Windhawk mod) | Game overlay with FPS, CPU, GPU, RAM; respects Do Not Disturb; example of the Windows notification permission.                                                                         |
| [FlorianButz/DynamicWin](https://github.com/FlorianButz/DynamicWin)                                                           | Windows                | UX reference (C#, WPF, SkiaSharp); its README says this repo hosts releases only, with no source code.                                                                                 |
| [686f6c61/agent-bar](https://github.com/686f6c61/agent-bar)                                                                   | Linux                  | Indicator for Claude Code, Codex CLI, and Kimi; manages hooks and reads session transcripts. Notes that Codex only reports turn completion and tokens.                                 |
| [mpashka/gnome-widget-panel](https://github.com/mpashka/gnome-widget-panel)                                                   | Linux (GNOME)          | A single agent-status dot: blue while working, pulsing red when attention is needed, amber when done. Closest to the AI Task dot concept.                                              |

From these search results, none appears to combine AI tasks, notifications, and PC performance in one Windows app, so the project still has a clear niche.
