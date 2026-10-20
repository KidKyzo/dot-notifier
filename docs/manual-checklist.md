# Manual Windows checklist

- [done] Verify clicks pass through the transparent window outside the dots and expanded panel.
- [done] Verify hovering the dots still expands the overlay after click-through is enabled.
- [ ] Verify hover remains stable through 50 consecutive morphs at the selected display's native refresh rate.
- [ ] While hovering the All panel, trigger the mock burst of 10 chat notifications. Move the cursor outside the panel: it should collapse automatically, and the chat list should remain scrollable while open.
- [ ] Verify the morph stays crisp at 100%, 125%, 150%, and 200% Windows scaling; include mixed-DPI monitors.
- [ ] Compare 60 Hz, 120 Hz, and 144 Hz displays using the motion lab's matching refresh target; record frame timings and display details in `docs/motion.md`.
- [ ] Verify reduced-motion changes snap an in-progress morph to its target and remove pulses.
- [ ] On a remote desktop or GPU-disabled session, verify the overlay remains usable and record whether the spring should fall back to crossfades.
- [ ] Measure native idle CPU/RAM and active morph CPU/RAM; record whether idle stays below 1% CPU and 80 MB RAM.
- [ ] Verify the overlay stays within the primary monitor work area above the taskbar.
- [ ] Verify the tray menu can pause notifications, enable quiet mode, open the overlay, and quit.
- [ ] Verify launch shows no taskbar button or Alt+Tab entry; verify a legacy `--hidden` auto-start entry still shows the overlay dots after setup.
- [ ] Verify a second launch opens Settings in the running instance.
- [ ] Verify the tray icon and aggregate tooltip on Windows 10 and 11, including light and dark taskbars at 100%, 150%, and 200% DPI.
- [ ] Verify the tray menu opens Settings and the app config folder, and toggles overlay visibility.
- [ ] Verify each overlay position, including top center, stays inside the selected monitor's work area above the taskbar; confirm the pill remains centered while expanding and collapsing.
- [ ] Verify changing the selected display moves the overlay to that monitor and survives app restart.
- [ ] Verify peek duration and monitored-app filters persist after app restart.
- [ ] Verify auto-start adds and removes the current-user Windows login entry.
- [ ] Verify peeks are suppressed in fullscreen and Windows presentation states, then resume afterward.
- [ ] Verify the opt-in fullscreen setting allows notification peeks in a borderless fullscreen game while Focus Session still suppresses them.
- [ ] Verify Windows 11 Focus Session suppresses peeks, then restores them when ended.
- [ ] Verify Windows 10 Focus Assist suppression (not currently exposed by the implemented documented APIs).
- [ ] Verify clicking a Codex task row restores and focuses its top-level window, including when the row event comes from a short-lived PowerShell hook.
- [ ] Verify token and quota values appear for task events that expose usage, and missing values stay hidden.
- [ ] Verify incoming Windows toast notifications from monitored apps (e.g. WhatsApp, Telegram) appear in the Notifications dot.
- [ ] Verify a trusted Codex `PermissionRequest` shows Approve, Reject, and Dismiss in the pill; only an explicit button click returns a decision, while timeout, dismissal, and hook exit fall through.
- [ ] Enable Antigravity hooks in Settings and verify CLI and IDE `PreInvocation`/`Stop` events show running, completed, and failed states; confirm the hook returns `{}`, conversation IDs upsert, existing hook entries survive enable/disable, and transcript contents never appear in the overlay or logs.
- [ ] Run a live Antigravity 2.0 app task and verify its own running, completed, and failed rows appear without being labeled IDE; check hook delivery after enabling or refreshing the Settings integration.
- [ ] Leave a WhatsApp toast in Action Center for over ten minutes, then receive a new one during an AI task peek. Verify the old toast does not re-peek, the new message leads, the mixed group shows both sources and the true count, and hovering reveals every message in the scrollable panel.
- [ ] Enable Now Playing and verify title, artist, artwork, playback state, and controls for Spotify and Apple Music; then opt into browser media and verify a YouTube Music tab in Chrome/Edge. Confirm browser media is excluded when the opt-in is off.
- [ ] With browser media enabled, compare the pill's elapsed timestamp with a YouTube video in Chrome/Edge while playing, seeking, pausing, and resuming; confirm it stays in sync.
- [ ] Run two sessions from one agent and tasks from Antigravity App, CLI, and IDE; confirm the panel separates source names, does not show transient activity as a completed task name, and shows status, elapsed time, and session hints clearly.
- [ ] Complete an agent task; confirm the AI dot stays green for 5 seconds, returns to idle, and still shows the completed task in panel history. A waiting, failed, or running task must keep its higher-priority dot state.
- [ ] Schedule a reminder and start a timer, then enable Now Playing. Confirm all active labels fit left of the dots, the pill grows without leaving the work area, due items alert once, and timer time survives app restart and sleep/resume.
- [ ] Enable WhatsApp style cards and verify sender initials, single-line message preview, incoming call detection, and the Open WhatsApp action with real Windows notifications.

## Timer/reminder motion polish (Extended Phase, F44)

- [ ] Verify liquid progress in All and Timer views, including short timers and long reminder titles, in light and dark themes.
- [ ] Verify pause freezes liquid motion and dims the fill; resume restores it.
- [ ] Verify completion sweeps once and text enters without clipping at 100%, 150%, and 200% DPI.
- [ ] Verify reduced motion disables liquid and completion animations; verify native click-through, hover, and CPU/RAM budgets.

Mock preview verified the timer and reminder pills, pause/resume and cancel controls, a long reminder title, due message, and timer completion state. The latest `pnpm check` passed: 85 frontend and 57 Rust tests. Native Windows checks above remain unverified, including both themes, DPI, click-through, reduced motion, and CPU/RAM budgets.

- [ ] Compare the Music pill against the empty Agents pill at 100%, 150%, and 200% DPI; both should measure 340 × 40 CSS px with no clipped music title or playback position.
- [ ] Play a song with a long title in All and Music pills and in both expanded song cards. Confirm it moves one way, the next copy enters from the right, and the full title rests briefly before scrolling again. Artist and time stay fixed; short titles stay still, a new song starts at the beginning, and reduced motion keeps titles static.

## Utility pill modes (Extended Phase, F48–F49)

- [ ] Expand each panel and confirm the five mode shortcuts stay available, show the selected mode, switch all modes, and keep Music/Timer feature enablement consistent with Settings. Confirm Settings has no duplicate Pill view selector.
- [ ] Confirm All remains selected on a fresh profile and Clipboard stays opt-in.
- [ ] In Clipboard mode, copy several Unicode text items while the panel is open and collapsed; confirm both appear in order, line breaks render, and the entries remain after switching modes and restarting.
- [ ] Delete one Clipboard entry and clear the list; confirm removed text does not reappear without a new copy. Test an empty clipboard, non-text content, text longer than 8,192 UTF-16 units, and rapid copies.
- [ ] In Clipboard mode, confirm the pill and panel show the same saved-item count after each copy, single deletion, bulk clear, mode switch, and restart. Inspect the Clipboard cards and empty state at 100%, 150%, and 200% DPI in light and dark themes; long text should remain readable without clipping the delete control.
- [ ] In Agents mode, run tasks from multiple agents through running, waiting, done, and error states; confirm agent attribution and task history survive restart, then clear history. For a Codex completion, confirm the final-answer preview is readable in the current session, is absent after restart, and no completed row says "Writing response".
- [ ] In Music mode, inspect the song card, playback controls, and volume slider at 100%, 150%, and 200% DPI in light and dark themes. Check long song/artist names, missing artwork, paused playback, and no media. Change the matched app audio-session volume without changing Windows master volume; test multiple browser tabs and ambiguous audio sessions, where the slider must stay unavailable.
- [ ] In Timer/reminders mode, verify active timer/reminders and month navigation. Confirm reminder markers appear on their local calendar dates, including across a daylight-saving transition; inspect the calendar card at 100%, 150%, and 200% DPI in light and dark themes for clipping and clear selected/today states.
- [ ] Create a relative and a dated reminder, then start, pause, resume, and cancel a timer from the Timer/reminders panel. Confirm the forms are absent from Settings, submitting a form does not collapse the panel, and the active items remain visible.

The local browser smoke test on port 1421 checked the previous non-Tauri Clipboard fallback and restored the saved pill mode to All. The revised Clipboard history, session volume, persistent agent history, and calendar still require the live Windows checks above.
