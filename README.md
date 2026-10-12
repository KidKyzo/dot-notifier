# Dot Notifier

[![Windows](<https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?logo=windows>)](https://www.microsoft.com/windows)
[![Tauri 2](https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri&logoColor=black)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-v19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Release](https://img.shields.io/badge/Release-v0.2.0-brightgreen.svg)](https://github.com/KidKyzo/dot-notifier/releases)

A lightweight, non-intrusive Windows desktop overlay designed for multi-tasking developers. Dot Notifier places ambient, minimal indicators in your screen corner to track **AI Agent progress**, **Windows notifications**, and **system performance**—expanding into informative pills and panels only when you need them.

## Demo

![Dot Notifier mock demo showing ambient dots, grouped agent updates, expanded tasks, chat, and a system alert](assets/demo/dot-notifier-demo.gif)

[Watch the 13-second HD video](assets/demo/dot-notifier-demo.mp4) · Captured from `pnpm dev:mock` with synthetic events.

---

## Overview & Concept

When working with long-running AI coding agents (such as Codex or Antigravity), switching windows or constantly checking terminal tabs breaks flow state. Windows toast notifications are disruptive and clutter the screen.

Dot Notifier solves this with an ambient **three-dot micro-UI** positioned seamlessly in your display's work area:

1. **AI Task Dot** – Monitors running, waiting, finished, or errored agent workflows in real-time.
2. **Notifications Dot** – Surfaces incoming notifications (e.g., WhatsApp, chats, system apps) with privacy-first ephemeral filtering.
3. **System Dot** – Tracks CPU, RAM, and GPU load with dynamic threshold alerts and cooldown protection.

### Overlay States

| State              | Visual Behavior                                                                                            | Trigger                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Idle**     | Low-opacity, minimal dots sitting cleanly in the screen corner.                                            | Default quiescent state                                      |
| **Alert**    | Dot pulses or transitions color (e.g., blue running, green complete, orange waiting for input, red error). | New event or state change                                    |
| **Peek**     | Morphing pill (icon + single concise line) that appears and auto-dismisses after 3–4 seconds.             | Incoming message, task finished, or metric threshold crossed |
| **Expanded** | Interactive flyout panel with detailed task queues, notification list, and resource sparklines.            | Hover or click                                               |

---

## Key Features

- **Click-Through Transparency**: Transparent overlay that ignores mouse clicks on empty regions; input is only captured when hovering over dots or active panels.
- **Local-First & Ephemeral Privacy**:
  - Operates over an isolated local WebSocket event bus (`127.0.0.1`) secured by a per-session handshake token.
  - No message bodies or private chat content are stored to disk.
  - Zero cloud sync, zero telemetry, and zero outbound network tracking.
- **Adaptive Polling**:
  - System performance monitors poll at ~2 s intervals while idle, dropping to 0.5–1 s only when the metrics panel is expanded.
- **Multi-Monitor & Taskbar Aware**: Positions reliably relative to Windows work areas without being clipped by the Windows taskbar.
- **Mock Mode**: Develop and iterate on the UI completely inside the browser (`pnpm dev:mock`) without requiring the native Rust build.

---

## Tech Stack

- **Desktop Framework**: [Tauri 2](https://tauri.app/) (Rust core with Windows MSVC toolchain, WinRT `UserNotificationListener`, PDH performance counters, and NVML integration).
- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/).
- **Styling**: Modern, fluid CSS with spring morphing animations.
- **Testing**: [Vitest](https://vitest.dev/) for frontend unit tests; `cargo test` for Rust bus, adapter parsers, and threshold logic.

---

## Project Structure

```
├── .github/workflows/         # CI check & automated validation workflows
├── docs/                      # PRD, event schemas, design palettes, checklists
│   ├── PRD.md                 # Product specifications and milestones
│   ├── event-schema.md        # WebSocket bus event schema & specs
│   └── notifications.md       # Windows notification listener guide
├── fixtures/                  # Real-world test fixtures for adapters
├── scripts/                   # Integration bridges (Codex, Claude, Antigravity)
├── src/                       # Frontend application
│   ├── core/                  # Event store, state machine, settings, metrics
│   ├── App.tsx                # Dynamic island overlay component
│   └── main.tsx               # Client entry point
├── src-tauri/                 # Rust desktop shell
│   ├── src/
│   │   ├── bus.rs             # Local WebSocket bus (127.0.0.1 + token)
│   │   ├── codex_logs.rs      # Codex agent rollout and log watcher
│   │   ├── notification_filter.rs # Per-app notification filtering
│   │   ├── system_monitor.rs  # PDH & NVML hardware telemetry
│   │   ├── win_notifications.rs   # Windows toast listener
│   │   └── lib.rs             # Tauri application setup & window hit-testing
│   └── tauri.conf.json        # Tauri configuration & window metadata
```

---

## Getting Started

### Prerequisites

- **Node.js**: `24` or newer
- **pnpm**: `11.25.0` (managed via `corepack enable pnpm`)
- **Rust**: Stable with MSVC toolchain (`rustup default stable-x86_64-pc-windows-msvc`)
- **Windows Build Tools**: Microsoft C++ Build Tools and WebView2 Runtime (pre-installed on Windows 10/11)

### Installation

Clone the repository and install dependencies:

```powershell
git clone https://github.com/KidKyzo/dot-notifier.git
cd dot-notifier
pnpm install
```

---

## Development & Testing

### 1. Run in Mock Mode (Fast UI Development)

Run the frontend in your browser with realistic mock events without compiling Rust:

```powershell
pnpm dev:mock
```

### 2. Run the Full Native Desktop App

Launch the full Tauri 2 app with native Windows hooks, notification listener, and live hot-reloading:

```powershell
pnpm app:dev
```

### 3. Run Validation & Quality Checks

Run the complete test suite (TypeScript typecheck, ESLint, Vitest frontend tests, and Rust format/clippy/unit tests):

```powershell
pnpm check
```

You can also run individual checks:

```powershell
pnpm typecheck   # Typecheck TypeScript files
pnpm lint        # Run ESLint
pnpm test        # Run Vitest unit tests
```

---

## Building a Release

To compile an optimized production build and generate the Windows installer / standalone binary:

```powershell
pnpm app:build
```

The output bundles (`.exe` installer and portable executables) will be located in `src-tauri/target/release/bundle/`.

---

## Integration Bridges

Dot Notifier comes with bridge scripts for agent hooks located under `scripts/`:

- `codex-notify.ps1`: Integration hook for Codex agent lifecycle events.
- `claude-notify.ps1`: Bridge hook for Claude notifications.
- `antigravity-notify.ps1`: Bridge hook for Antigravity notifications.
