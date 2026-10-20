# Music session volume spike (F50)

Date: 2026-10-20
Host: Windows 10.0.26200
Toolchain: Rust 1.99.0, `windows` 0.62.2, Node.js 24.11.1, pnpm 11.25.0

## What was checked

- Reviewed Microsoft's Core Audio documentation for `IMMDeviceEnumerator`, `IAudioSessionManager2`, `IAudioSessionControl2`, and `ISimpleAudioVolume`. The media transport session exposes an app user model ID, not the Core Audio session ID or process ID.
- Enabled the existing `windows` crate's `Win32_Media_Audio` feature. The adapter maps only recognized music source IDs to a process image, inspects sessions on the default multimedia output device, and returns a volume control only when exactly one audio session matches. Browser tabs or multiple audio sessions from one app may be ambiguous and leave the control disabled.
- `cargo check --tests` passed on this host. Native playback/volume behavior was not available to exercise with a live Spotify, Apple Music, or browser session.

## Result and limits

The implementation does not adjust the Windows master volume. It controls one matched app audio session and refuses ambiguous matches. Verify the selected output device, browser cases, app packages, and external volume changes on Windows 10 and 11 before claiming full compatibility.
