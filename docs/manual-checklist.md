# Manual Windows checklist

- [ ] Verify clicks pass through the transparent window outside the dots and expanded panel.
- [ ] Verify hovering the dots still expands the overlay after click-through is enabled.
- [ ] Verify the overlay stays within the primary monitor work area above the taskbar.
- [ ] Verify the tray menu can pause notifications, enable quiet mode, open the overlay, and quit.
- [ ] Verify each corner choice stays inside the selected monitor's work area above the taskbar.
- [ ] Verify changing the selected display moves the overlay to that monitor and survives app restart.
- [ ] Verify peek duration and monitored-app filters persist after app restart.
- [ ] Verify auto-start adds and removes the current-user Windows login entry.
- [ ] Verify peeks are suppressed in fullscreen and Windows presentation states, then resume afterward.
- [ ] Verify Windows 11 Focus Session suppresses peeks, then restores them when ended.
- [ ] Verify Windows 10 Focus Assist suppression (not currently exposed by the implemented documented APIs).
- [ ] Verify incoming Windows toast notifications from monitored apps (e.g. WhatsApp, Telegram) appear in the Notifications dot.
