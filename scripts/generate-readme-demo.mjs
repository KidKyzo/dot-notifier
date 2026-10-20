// Capture the real mock UI into README-friendly media without extra packages.
// Run this script from the repo root; it starts the local mock UI itself.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "assets", "demo");
const profile = join(root, "node_modules", ".cache", "readme-demo-edge");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = Number(process.env.DOT_DEMO_DEBUG_PORT ?? 51556);
const mockPort = Number(process.env.DOT_DEMO_PORT ?? 1420);
const fps = 18;
const width = 1600;
const height = 900;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

// A short original electronic cue keeps the public demo independent of song licenses.
function makeSoundtrack(seconds) {
  const sampleRate = 44_100;
  const samples = Math.ceil(seconds * sampleRate);
  const pcm = Buffer.alloc(44 + samples * 4);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(sampleRate, 24);
  pcm.writeUInt32LE(sampleRate * 4, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(samples * 4, 40);
  const beat = 60 / 112;
  const roots = [110, 87.31, 130.81, 98];
  const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const beatIndex = Math.floor(t / beat);
    const phase = (t / beat) % 1;
    const bar = Math.floor(beatIndex / 4);
    const root = roots[bar % 4];
    const chord = chords[bar % 4];
    const eighth = Math.floor(t / (beat / 2));
    const arpFrequency = chord[[0, 1, 2, 1, 2, 1, 0, 1][eighth % 8]] * 2;
    const eighthPhase = (t / (beat / 2)) % 1;
    const bass = 0.16 * Math.sin(2 * Math.PI * root * t) * Math.exp(-phase * 2.8);
    const pad = chord.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * t), 0) * 0.018;
    const arp = 0.055 * Math.sin(2 * Math.PI * arpFrequency * t) * Math.exp(-eighthPhase * 5);
    const kickPhase = phase * beat;
    const kick = beatIndex % 4 === 0 || beatIndex % 4 === 2
      ? 0.28 * Math.sin(2 * Math.PI * (55 * kickPhase + 24 * Math.exp(-kickPhase * 25))) * Math.exp(-kickPhase * 17)
      : 0;
    const hash = Math.sin(i * 12.9898) * 43758.5453;
    const noise = (hash - Math.floor(hash)) * 2 - 1;
    const snare = beatIndex % 4 === 1 || beatIndex % 4 === 3 ? noise * 0.07 * Math.exp(-kickPhase * 25) : 0;
    const hatPhase = (t / (beat / 2)) % 1 * beat / 2;
    const hat = noise * 0.025 * Math.exp(-hatPhase * 90);
    const fade = Math.min(1, t / 1.1, (seconds - t) / 1.4);
    const value = Math.max(-1, Math.min(1, (bass + pad + arp + kick + snare + hat) * Math.max(0, fade)));
    pcm.writeInt16LE(Math.round(value * 32767), 44 + i * 4);
    pcm.writeInt16LE(Math.round(value * 32767), 46 + i * 4);
  }
  return pcm;
}

async function waitForJson(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch { /* The local browser is still starting. */ }
    await delay(100);
  }
  throw new Error(`Local browser did not start: ${url}`);
}

async function waitForReady(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* Vite is still starting. */ }
    await delay(100);
  }
  throw new Error(`Local mock UI did not start: ${url}`);
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    async open() { if (socket.readyState !== WebSocket.OPEN) await once(socket, "open"); },
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolveResult, reject) => {
        pending.set(id, { resolve: resolveResult, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function main() {
  await mkdir(output, { recursive: true });
  await mkdir(profile, { recursive: true });
  const server = spawn(process.execPath, [
    join(root, "node_modules", "vite", "bin", "vite.js"),
    "--config", "vite.config.ts", "--mode", "mock", "--port", String(mockPort), "--host", "127.0.0.1",
  ], { cwd: root, stdio: "inherit" });
  let browser;
  let cdp;
  try {
  await waitForReady(`http://127.0.0.1:${mockPort}/`);
  browser = spawn(edge, [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
    "--disable-gpu",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    `http://127.0.0.1:${mockPort}/`,
  ], { stdio: "inherit" });
    const pages = await waitForJson(`http://127.0.0.1:${port}/json`);
    const page = pages.find((item) => item.type === "page" && item.url.includes(`127.0.0.1:${mockPort}`));
    if (!page) throw new Error("Mock UI page was not found in the local browser");
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    await evaluate("localStorage.clear()");
    await cdp.send("Page.reload", { ignoreCache: true });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("Boolean(document.querySelector('.hud') && document.querySelector('.controls'))")) break;
      await delay(100);
    }
    if (!await evaluate("Boolean(document.querySelector('.hud'))")) {
      throw new Error(`Mock UI did not render: ${await evaluate("document.body?.innerText.slice(0, 500) || location.href")}`);
    }

    const decoration = `(() => {
      document.querySelector('.controls').style.display = 'none';
      document.querySelector('.hint').style.display = 'none';
      const style = document.createElement('style');
      style.textContent = \
        '@keyframes demo-rise { from { opacity: 0; translate: 0 22px; filter: blur(9px); } to { opacity: 1; translate: 0 0; filter: blur(0); } }' +
        '@keyframes demo-drift { from { background-position: 0 0; } to { background-position: 100px 60px; } }' +
        '.overlay-stage.preview-background { background: radial-gradient(900px 680px at 81% 24%, #193a5d65, transparent 72%), radial-gradient(850px 730px at 5% 100%, #2e244962, transparent 72%), #080e18; }' +
        '.overlay-stage.preview-background::after { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .17; background-image: linear-gradient(#9dbbdf16 1px, transparent 1px), linear-gradient(90deg, #9dbbdf16 1px, transparent 1px); background-size: 80px 80px; animation: demo-drift 26s linear infinite; }' +
        '.hud { transform: scale(1.42); transform-origin: top right; }' +
        '.demo-copy { position: fixed; left: 100px; top: 180px; width: 800px; z-index: 2; color: #f3f6ff; font-family: Segoe UI Variable Text, Segoe UI, sans-serif; }' +
        '.demo-copy.reveal .demo-kicker { animation: demo-rise .5s both; }' +
        '.demo-copy.reveal .demo-title { animation: demo-rise .65s .1s both; }' +
        '.demo-copy.reveal .demo-subtitle { animation: demo-rise .65s .2s both; }' +
        '.demo-kicker { color: #78bbff; font-size: 17px; font-weight: 700; letter-spacing: .24em; }' +
        '.demo-title { margin: 24px 0 18px; font-size: 76px; line-height: 1.01; letter-spacing: -.055em; font-weight: 750; text-wrap: balance; }' +
        '.demo-subtitle { max-width: 680px; color: #b7c6df; font-size: 26px; line-height: 1.4; }' +
        '.demo-footer { position: fixed; left: 100px; bottom: 62px; color: #91a5c2; font-size: 16px; letter-spacing: .08em; }' +
        '.demo-accent { position: fixed; left: 100px; top: 126px; width: 72px; height: 4px; border-radius: 4px; background: #59aeff; box-shadow: 0 0 22px #59aeff88; }' +
        '.demo-progress { position: fixed; bottom: 0; left: 0; width: 0; height: 4px; background: #5caeff; box-shadow: 0 0 18px #5caeff; z-index: 5; }' +
        '.demo-index { position: fixed; right: 72px; bottom: 62px; color: #8da8c9; font: 600 17px Segoe UI,sans-serif; letter-spacing: .18em; }';
      document.head.append(style);
      const copy = document.createElement('div');
      copy.className = 'demo-copy';
      copy.innerHTML = '<div class="demo-kicker">DOT NOTIFIER</div><div class="demo-title"></div><div class="demo-subtitle"></div>';
      document.body.append(copy);
      const accent = document.createElement('div'); accent.className = 'demo-accent'; document.body.append(accent);
      const footer = document.createElement('div'); footer.className = 'demo-footer'; footer.textContent = 'INTERACTIVE MOCK DEMO  •  WINDOWS 10 / 11'; document.body.append(footer);
      const progress = document.createElement('div'); progress.className = 'demo-progress'; document.body.append(progress);
      const index = document.createElement('div'); index.className = 'demo-index'; document.body.append(index);
    })()`;
    await evaluate(decoration);
    const reloadDemo = async () => {
      await evaluate("localStorage.clear()");
      await cdp.send("Page.reload", { ignoreCache: true });
      for (let attempt = 0; attempt < 80; attempt += 1) {
        if (await evaluate("Boolean(document.querySelector('.hud') && document.querySelector('.controls') && !document.querySelector('.demo-copy'))")) break;
        await delay(100);
      }
      if (!await evaluate("Boolean(document.querySelector('.hud'))")) throw new Error("Mock UI did not render after reload");
      await evaluate(decoration);
    };

    const silentVideo = join(profile, "readme-demo-silent.mp4");
    const soundtrack = join(profile, "readme-demo-score.wav");
    const movie = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-vcodec", "png", "-i", "pipe:0",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      silentVideo,
    ], { stdio: ["pipe", "inherit", "inherit"] });

    const caption = (number, title, subtitle) => evaluate(`(() => {
      const copy = document.querySelector('.demo-copy');
      copy.classList.remove('reveal');
      void copy.offsetWidth;
      copy.querySelector('.demo-title').textContent = ${JSON.stringify(title)};
      copy.querySelector('.demo-subtitle').textContent = ${JSON.stringify(subtitle)};
      document.querySelector('.demo-index').textContent = ${JSON.stringify(String(number).padStart(2, "0") + " / 11")};
      document.querySelector('.demo-progress').style.width = ${JSON.stringify(`${Math.round(number / 11 * 100)}%`)};
      copy.classList.add('reveal');
    })()`);
    const click = (label) => evaluate(`(() => {
      const button = [...document.querySelectorAll('.controls button')].find((item) => item.textContent === ${JSON.stringify(label)});
      if (!button) throw new Error('Missing mock control');
      button.click();
    })()`);
    const move = (x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    const hoverHud = async () => { await move(width - 45, 38); await delay(500); };
    const pillMode = async (label) => {
      await hoverHud();
      await evaluate(`(() => {
        const button = document.querySelector('.pill-mode-shortcut[aria-label=${JSON.stringify(label)}]');
        if (!button) throw new Error('Missing pill mode: ' + ${JSON.stringify(label)});
        button.click();
      })()`);
      await delay(350);
    };
    let frameCount = 0;
    const frames = async (seconds) => {
      const count = Math.round(seconds * fps);
      for (let index = 0; index < count; index += 1) {
        const start = performance.now();
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        if (!movie.stdin.write(Buffer.from(shot.data, "base64"))) await once(movie.stdin, "drain");
        frameCount += 1;
        await delay(Math.max(0, 1000 / fps - (performance.now() - start)));
      }
    };

    await caption(1, "Stay in flow.", "Three quiet dots keep your work in view.");
    await frames(2);

    await click("Start Codex task");
    await click("Claude task");
    await click("Antigravity CLI task");
    await hoverHud();
    await caption(2, "Agents, in one place.", "Codex, Claude, and Antigravity update the live task panel.");
    await frames(4);

    await reloadDemo();
    await click("Codex permission request");
    await caption(3, "Decide in context.", "A permission request appears with explicit actions.");
    await frames(3);

    await reloadDemo();
    await click("Five notifications at once");
    await caption(4, "One signal. Ten updates.", "Bursts group into a single peek with an overflow count.");
    await frames(4);

    await reloadDemo();
    await click("WhatsApp call");
    await caption(5, "Catch what matters.", "Incoming calls get a distinct, glanceable card.");
    await frames(3);

    await reloadDemo();
    await click("System alert");
    await hoverHud();
    await caption(6, "See system pressure.", "Live CPU, GPU, memory, and temperature stay close.");
    await frames(3);

    await reloadDemo();
    await click("Reminder + timer + music");
    await pillMode("Music");
    await caption(7, "Music at a glance.", "Playback, track progress, and volume live in the pill.");
    await frames(4);

    await pillMode("Timer");
    await caption(8, "Time stays visible.", "Timers, reminders, and a calendar share one view.");
    await frames(4);

    await reloadDemo();
    await click("Reminder due (mock)");
    await caption(9, "A gentle nudge.", "Due reminders surface directly on the ambient pill.");
    await frames(3);

    await reloadDemo();
    await pillMode("Clipboard");
    await caption(10, "Keep recent copies.", "Clipboard history appears only when you choose its mode.");
    await frames(3);

    await reloadDemo();
    await caption(11, "Dot Notifier.", "Stay aware. Keep your focus.");
    await frames(3);

    movie.stdin.end();
    const [code] = await once(movie, "exit");
    if (code !== 0) throw new Error(`Video encode failed (${code})`);

    await writeFile(soundtrack, makeSoundtrack(frameCount / fps));
    const mix = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", silentVideo, "-i", soundtrack,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart",
      join(output, "dot-notifier-demo.mp4"),
    ], { stdio: "inherit" });
    const [mixCode] = await once(mix, "exit");
    if (mixCode !== 0) throw new Error(`Audio mix failed (${mixCode})`);

    const gif = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", join(output, "dot-notifier-demo.mp4"),
      "-filter_complex", "fps=9,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop", "0", join(output, "dot-notifier-demo.gif"),
    ], { stdio: "inherit" });
    const [gifCode] = await once(gif, "exit");
    if (gifCode !== 0) throw new Error(`GIF encode failed (${gifCode})`);
    console.log("Created assets/demo/dot-notifier-demo.mp4 and .gif");
  } finally {
    cdp?.close();
    browser?.kill();
    server.kill();
  }
}

await main();
