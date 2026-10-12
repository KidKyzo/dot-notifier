// Capture the real mock UI into README-friendly media without extra packages.
// Run `pnpm dev:mock --host 127.0.0.1` before this script.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "assets", "demo");
const profile = join(root, "node_modules", ".cache", "readme-demo-edge");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 19273;
const fps = 12;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

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
  const browser = spawn(edge, [
    "--headless=new",
    "--no-first-run",
    "--disable-gpu",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--window-size=1280,720",
    "http://127.0.0.1:1420/",
  ], { stdio: "ignore" });

  let cdp;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${port}/json`);
    const page = pages.find((item) => item.type === "page" && item.url.includes("127.0.0.1:1420"));
    if (!page) throw new Error("Mock UI page was not found in the local browser");
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

    const evaluate = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("Boolean(document.querySelector('.hud') && document.querySelector('.controls'))")) break;
      await delay(100);
    }
    if (!await evaluate("Boolean(document.querySelector('.hud'))")) throw new Error("Mock UI did not render");

    await evaluate(`(() => {
      document.querySelector('.controls').style.display = 'none';
      document.querySelector('.hint').style.display = 'none';
      const style = document.createElement('style');
      style.textContent = \
        '.overlay-stage.preview-background { background: radial-gradient(620px 470px at 83% 15%, #304a7270, transparent 70%), radial-gradient(800px 600px at 8% 94%, #40386e65, transparent 70%), #0c111d; }' +
        '.overlay-stage.preview-background::after { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .22; background-image: linear-gradient(#a8b8d412 1px, transparent 1px), linear-gradient(90deg, #a8b8d412 1px, transparent 1px); background-size: 44px 44px; }' +
        '.hud { transform: scale(1.08); transform-origin: top right; }' +
        '.demo-copy { position: fixed; left: 74px; top: 130px; width: 680px; z-index: 2; color: #f3f6ff; font-family: Segoe UI Variable Text, Segoe UI, sans-serif; }' +
        '.demo-kicker { color: #77c2ff; font-size: 15px; font-weight: 700; letter-spacing: .2em; }' +
        '.demo-title { margin: 18px 0 14px; font-size: 58px; line-height: 1.04; letter-spacing: -.055em; font-weight: 750; text-wrap: balance; }' +
        '.demo-subtitle { max-width: 570px; color: #b7c6df; font-size: 21px; line-height: 1.42; }' +
        '.demo-footer { position: fixed; left: 76px; bottom: 55px; color: #8ba0bd; font-size: 14px; letter-spacing: .04em; }' +
        '.demo-accent { position: fixed; left: 75px; top: 92px; width: 48px; height: 4px; border-radius: 4px; background: #59aeff; box-shadow: 0 0 20px #59aeff88; }';
      document.head.append(style);
      const copy = document.createElement('div');
      copy.className = 'demo-copy';
      copy.innerHTML = '<div class="demo-kicker">DOT NOTIFIER</div><div class="demo-title"></div><div class="demo-subtitle"></div>';
      document.body.append(copy);
      const accent = document.createElement('div'); accent.className = 'demo-accent'; document.body.append(accent);
      const footer = document.createElement('div'); footer.className = 'demo-footer'; footer.textContent = 'WINDOWS 10 / 11  •  LOCAL-FIRST'; document.body.append(footer);
    })()`);

    const movie = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "image2pipe", "-framerate", String(fps), "-vcodec", "png", "-i", "pipe:0",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", join(output, "dot-notifier-demo.mp4"),
    ], { stdio: ["pipe", "inherit", "inherit"] });

    const caption = (title, subtitle) => evaluate(`(() => {
      document.querySelector('.demo-title').textContent = ${JSON.stringify(title)};
      document.querySelector('.demo-subtitle').textContent = ${JSON.stringify(subtitle)};
    })()`);
    const click = (label) => evaluate(`(() => {
      const button = [...document.querySelectorAll('.controls button')].find((item) => item.textContent === ${JSON.stringify(label)});
      if (!button) throw new Error('Missing mock control');
      button.click();
    })()`);
    const move = (x, y) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    const frames = async (count) => {
      for (let index = 0; index < count; index += 1) {
        const start = performance.now();
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        if (!movie.stdin.write(Buffer.from(shot.data, "base64"))) await once(movie.stdin, "drain");
        await delay(Math.max(0, 1000 / fps - (performance.now() - start)));
      }
    };

    await caption("Stay in flow.", "Three quiet signals for AI tasks, notifications, and system health.");
    await frames(24);
    await caption("Agents, together.", "Codex and Antigravity updates arrive in one focused peek.");
    await click("Codex + Antigravity at once");
    await frames(36);
    await caption("See the whole picture.", "Hover to expand live tasks, messages, and performance.");
    await move(1230, 32);
    await frames(36);
    await move(700, 600);
    await delay(400);
    await caption("Messages at a glance.", "Stay aware without leaving your work.");
    await click("Incoming chat");
    await frames(30);
    await caption("Light on your desktop.", "Local-first, ambient, and there when you need it.");
    await click("System alert");
    await frames(30);

    movie.stdin.end();
    const [code] = await once(movie, "exit");
    if (code !== 0) throw new Error(`MP4 encode failed (${code})`);

    const gif = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", join(output, "dot-notifier-demo.mp4"),
      "-filter_complex", "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop", "0", join(output, "dot-notifier-demo.gif"),
    ], { stdio: "inherit" });
    const [gifCode] = await once(gif, "exit");
    if (gifCode !== 0) throw new Error(`GIF encode failed (${gifCode})`);
    console.log("Created assets/demo/dot-notifier-demo.mp4 and .gif");
  } finally {
    cdp?.close();
    browser.kill();
  }
}

await main();
