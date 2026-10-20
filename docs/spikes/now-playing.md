# Now Playing spike (F44)

Date: 2026-10-11

## Checks

- Reviewed Microsoft's `GlobalSystemMediaTransportControlsSessionManager.RequestAsync`, current-session, playback-info, media-properties, and play/pause/next APIs. The APIs expose session metadata and control requests locally; the current-session API documents Windows 10 build 17763 and later.
- Reviewed Microsoft's `SourceAppUserModelId` and `GetSessions` APIs. The adapter can allow app IDs identifying Spotify, Apple Music, or YouTube Music and ignore generic browser sessions.
- A regular YouTube Music tab reports its browser as the source app, which does not identify the site. Browser sessions are excluded by default; the Settings opt-in can include Chrome/Edge media sessions, with the limitation that other media from that browser may appear too.
- Rechecked Microsoft's timeline contract: `Position` is valid as of `LastUpdatedTime`. The adapter now passes that timestamp through so the overlay can account for the age of a browser timeline sample. Unit coverage checks Windows-time to Unix-time conversion; a live YouTube video still needs manual verification.
- Inspected the already locked `windows` Rust crate at 0.62.2 for those bindings and the thumbnail stream reader.
- The host denied access to OS-version discovery, and no active Spotify or browser media session was available to verify. Runtime compatibility, album-art formats, and app-specific behavior remain unverified.

## Result

The adapter uses only Windows System Media Transport Controls, caps artwork reads at 512 KiB, and keeps a same-track artwork cache in memory. It is opt-in and only reads while the expanded panel or Now Playing peek is active. Source filtering is based on the session app ID; installed app IDs and behavior still need manual verification on Windows 10 and 11.
