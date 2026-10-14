# Motion and visual polish log

Companion to the external “PRD & Dev Plan: Animation and Visual Polish”. This file records measurements and decisions by phase.

## M0: baseline and measurement

Date: 2026-10-12  
Status: lab scaffolded and browser baseline captured; native-app measurements pending.

### Current implementation inspected

- The HUD begins at 64 × 24 px. A normal peek uses 300 × 44 px; expanded uses 320 px wide and the measured panel content height. Approval, chat, and call peeks can be taller.
- The shell uses a 550 ms `cubic-bezier(0.32, 0.72, 0, 1)` transition for width, height, and radius. Content fades over 300 ms after a 140 ms delay. Dot status colors transition over 300 ms.
- The native Tauri window is fixed at 380 × 500 px, transparent, and has no native shadow. The UI shell uses a translucent dark fill, 26 px CSS backdrop blur, an inset highlight, and a fine outline.
- Existing CSS shape changes use the same HUD element, so the simulated glass pill follows the shell's width, height, and radius morph.

### Rendering decision

Use CSS-simulated glass in the morphing shell. Keep the pill shape attached to the animated shell; retain a readable semi-opaque base, inner highlight, and fine outline. Do not add a native Acrylic/Mica backdrop or animation dependency for M0. The current browser preview can demonstrate CSS blur over its own wallpaper background, but that does not verify blur of the desktop behind a transparent WebView2 window.

### Motion lab

In mock development mode, open `?motion-lab` to use the lab. It samples requestAnimationFrame deltas for each current transition case and reports p50, p95, p99, count of deltas over 16.7 ms, and sample count. Bright, dark, and busy synthetic backdrops are available for visual comparison. The lab is dev-only and does not run a sampling loop while idle.

### Baseline results

Captured 2026-10-12 in the Codex in-app browser at its default viewport, using the lab's synthetic busy backdrop. The browser host did not expose GPU, display refresh rate, browser/WebView2 build, or CPU/RAM details. These timings describe the CSS lab preview, not the full Tauri app or desktop compositor.

| Transition | p50 | p95 | p99 | Deltas >16.7 ms | Frames |
| --- | ---: | ---: | ---: | ---: | ---: |
| Idle → alert | 5.6 ms | 5.7 ms | 5.7 ms | 0 | 161 |
| Alert → peek | 5.6 ms | 5.6 ms | 5.7 ms | 0 | 162 |
| Peek → idle | 5.5 ms | 5.7 ms | 5.7 ms | 0 | 162 |
| Idle → expanded | 5.6 ms | 5.7 ms | 5.7 ms | 0 | 162 |
| Peek → expanded | 5.5 ms | 5.7 ms | 5.7 ms | 0 | 162 |
| Expanded → idle | 5.6 ms | 5.6 ms | 5.7 ms | 0 | 162 |
| Burst → panel | 5.6 ms | 5.7 ms | 5.7 ms | 0 | 162 |
| Row enter / exit | 5.5 ms | 5.7 ms | 5.7 ms | 0 | 162 |
| Status change | 5.6 ms | 5.6 ms | 5.7 ms | 0 | 162 |
| Interruption | 5.6 ms | 5.7 ms | 5.7 ms | 0 | 162 |

`pnpm check` passes (TypeScript, ESLint, 27 frontend tests, Rust checks and 36 Rust tests). The first sandboxed attempt could not resolve `node_modules` (`EPERM`); it passed when run with filesystem access. The preview's synthetic bright backdrop was also visually inspected. No native WebView2 timing, CPU/RAM reading, real wallpaper screenshots, or desktop backdrop-filter result is claimed. Record the host GPU, display resolution/refresh rate, WebView2 version, and idle/morph CPU and RAM after a native-app run.

### Visual review and glitches

- Inspected the lab shell over synthetic bright, dark, and busy backgrounds. Its rounded shell and simulated glass surface remain one shape as it changes from dot to pill to panel.
- No visible glitch was recorded in the browser preview. The in-app browser displays the lab inside an opaque page, so this does not establish how blur or contrast behaves over real desktop wallpaper in WebView2.
- Remaining native visual review: bright, dark, and busy real wallpapers in both app themes; inspect for edge flicker, text contrast, or blur changes during morph.

### Open measurement items

- Run the lab on the reference machine and capture frame timing for every case.
- Measure idle and morph CPU/RAM in the full Tauri app; browser timing alone does not provide these measurements.
- Compare bright, dark, and busy real desktop wallpapers in both light and dark themes.
- Verify whether `backdrop-filter` in the transparent WebView2 window samples the desktop. Keep this unresolved until the native-app check is run.
- Record visible glitches and host/display details during native-app review.

## M1: motion foundation

Status: implemented; native hit-test synchronization included after explicit user approval.

- Motion constants are centralized in `src/core/motion.ts` and mirrored as CSS custom properties. Morph width, height, and radius use the time-based spring; an active spring retargets without resetting its current velocity.
- The fixed 380 × 500 native window is unchanged. The morphing glass shell clips fixed-size content layers, so text and panel rows do not scale with the shell.
- Reduced-motion users receive immediate shell geometry updates while the existing opacity transition remains available.
- `src/App.tsx` reports the current shell bounds during the active spring. The native hit-area check uses a 4 px enter margin and 8 px leave hysteresis; the 60 ms cursor poll remains unchanged.
- The spring helpers and native margin behavior have unit coverage, including preserving velocity on retarget and separate enter/leave bounds.

## M2: transition choreography

Status: choreography implemented and browser-lab run is clean; reference-machine acceptance remains pending native measurements and side-by-side video review.

- Central timing tokens now cover content fade, content delay, color, dot settle, badge pop, row stagger/exit, hover leave, and progress-ring motion.
- Alert, badge, row entry/exit, proximity hover-out, and panel collapse use staged timing. The collapse waits for the content fade; dismissed chat rows remain mounted through their exit animation.
- Reduced-motion mode removes the shell spring and alert pulses and uses a short content crossfade.
- The dev motion lab now drives its shell with the app's retargetable spring helper and measures animation-frame deltas while exercising the M2 transition cases. It remains idle until a run begins.
- Browser lab run (Codex in-app browser, 2026-10-12): all 10 cases completed; p95 was 5.6–5.7 ms and no sampled delta exceeded 16.7 ms. This is browser frame scheduling only, not a GPU/compositor or native performance guarantee.
- `pnpm check` passed after the M2 implementation: TypeScript, ESLint, 29 frontend tests, Rust checks, and 37 Rust tests.

Native manual verification still needed: click-through and hover hit-testing, DPI scaling, multi-monitor behavior, reduced-motion behavior in WebView2, CPU/RAM budgets, and appearance over real desktop wallpapers. These are not established by the browser lab.

## M3: visual material

Status: CSS material pass implemented; native wallpaper and contrast review remains pending.

- Kept the simulated glass surface on the morphing shell. The shell has a restrained top sheen, inner highlight, and fine outline; blur is not animated during morphs. The outer CSS shadow was removed after native review.
- Added system light/dark material tokens for shell fill, text, outlines, nested cards, controls, hover surfaces, and ring tracks. Status colors remain distinct in both palettes.
- Added a subtle status-colored dot glow and refined the mock motion lab glass to match the app shell. Segoe UI Variable remains the preferred system font, with existing tabular numerals and truncation retained.
- The CSS theme follows `prefers-color-scheme`; there is no separate in-app theme setting. The lab's synthetic wallpaper choices remain available for contrast review.

Not verified in native WebView2: desktop backdrop sampling, real bright/dark/busy wallpaper contrast, and the light palette on the reference machine. The preview can show CSS blur only over its own page content.

## M4: performance and hardening

Status: hardening changes implemented; reference-machine acceptance remains open.

- Existing placement uses monitor work areas and applies the 20 CSS-pixel margin at each monitor's scale factor. Hit-test cursor coordinates are converted from physical pixels to CSS pixels with the active window scale factor. Existing Rust tests cover corner placement and tray icon sizing at 100%, 150%, and 200% scale.
- The motion lab now lets the operator choose 60, 120, or 144 Hz and counts deltas above that target's frame budget. Select the actual display rate before comparing; browser measurements do not prove native GPU performance.
- Verified the 120 Hz target in the Codex browser: the threshold changed to 8.3 ms; the selected sample was p95 5.7 ms with 0 intervals above the threshold (162 frames). The browser host's physical refresh rate is unknown, so this checks the lab's threshold calculation only.
- If Windows reduced-motion preference changes during a morph, the active spring now cancels, snaps to its target, and reports the final hit area. Morph rAF remains event-driven and exits when the spring settles; the lab only samples while a run is active. No `will-change` hint is used.
- Removed the optional Now Playing ticker's infinite animation; long titles truncate with an ellipsis so no marquee continues while the HUD is idle.
- The manual checklist now includes mixed-DPI, high-refresh, 50 hover-morph trials, reduced-motion, GPU-disabled/remote desktop, and native CPU/RAM checks.

Still open: run `pnpm app:dev` on the reference machine and record WebView2/GPU, display rates, idle and morph CPU/RAM, and hover results. The command compiled and returned successfully in this session, but no native process remained for sustained inspection. There is no reliable supported signal in the current app to identify that CSS rendering has lost GPU acceleration; keep the no-GPU crossfade fallback unresolved until that detection is spiked and tested rather than guessing from unrelated browser capabilities.

## M5: optional delight pass

Status: small, event-driven interactions implemented; native performance acceptance remains pending M4 measurements.

- Task rows get a 2 px hover/focus nudge with a short color transition. Action buttons lift slightly on hover/focus and compress briefly on press.
- These effects are CSS-only, run only during direct interaction, and are disabled under reduced motion. Existing badge pop and dot settle remain the only status embellishments; no continuous animation was added.
- Recheck the CPU/RAM and frame budgets during the M4 native pass before treating M5 as fully accepted.
