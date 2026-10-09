# Windows notifications

Windows toast notifications from monitored apps (e.g. WhatsApp, Telegram) are captured
via the WinRT `UserNotificationListener` API and forwarded to the event bus and UI.

Notification permissions can be requested from the Settings panel in the UI. For environments
requiring an explicit Windows Package Identity, a Sparse Package manifest is provided
at `src-tauri/AppxManifest.xml` and can be registered using `scripts/register-sparse-package.ps1`.

On first launch, the app creates `notification-filter.json` in the app's local data directory
(the same directory as `bus-session.json`) with WhatsApp as the only monitored app. Add other
app names or app IDs in the Settings UI to monitor them too. Matching ignores letter case.
An empty array in a manually edited filter allows every app; when the array has entries,
events without `meta.app` are dropped. Settings updates take effect dynamically.

For deduplication, a notification event can include its Windows notification
ID in `meta.notificationId`. The bus suppresses repeats with the same app and
notification ID for up to ten minutes. This cache exists only in memory and is
bounded; it never stores message titles, bodies, or sender names. Events without
a notification ID pass through and can still be upserted by their event `id`.

Example filter file:

```json
{
  "monitoredApps": ["WhatsApp", "Telegram"]
}
```
