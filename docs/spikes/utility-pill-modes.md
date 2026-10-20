# Clipboard pill mode spike

Date: 2026-10-19
Host: Windows NT 10.0.26200.0
Toolchain: Rust 1.99.0, `windows` crate 0.62.2, Node.js 24.11.1, pnpm 11.25.0

## What was checked

- Reviewed Microsoft's [clipboard API guidance](https://learn.microsoft.com/en-us/windows/win32/dataxchg/using-the-clipboard) and the `OpenClipboard`, `GetClipboardData`, and global-memory APIs exposed by `windows` 0.62.2. `CF_UNICODETEXT` can be read on demand without registering a clipboard listener. The adapter reads only from the explicit command, caps its in-memory preview at 8,192 UTF-16 units, and releases the clipboard and global-memory lock with RAII guards.
- Ran `cargo test --lib` in `src-tauri` on the Windows host: 62 tests passed, including clipboard preview bounds.
- Ran `cargo clippy --all-targets -- -D warnings` in `src-tauri`: passed with no warnings.
- Ran `pnpm check` from the repository root: typecheck and lint passed; Vitest passed 82 tests across 14 files, but one suite could not open a sandbox temp file (`ENOENT`) during module import. The script stopped before its Rust stages; those stages were run separately as recorded above.

## Result and limits

The original preview was command-driven and had no history. F50 now opts into text capture only while Clipboard mode is selected: the adapter checks the Windows clipboard sequence number before reading Unicode text, and the UI stores captured entries locally until deleted. The app does not inspect non-text formats, log text, or make outbound requests. Rapid changes between samples may be missed and still need live verification.

This spike does not replace live checks on Windows 10 and 11. Verify clipboard formats and close behavior, themes, DPI, click-through, reduced motion, and idle CPU/RAM using `docs/manual-checklist.md`.
