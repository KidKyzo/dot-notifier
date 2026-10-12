import { useRef, useState } from "react";
import { advanceSpringAxis, createSpringAxis, motionTokens, retargetSpringAxis } from "./core/motion";
import "./MotionLab.css";

type DemoState = "idle" | "alert" | "peek" | "expanded" | "burst" | "row-exit";
type MotionCase = { name: string; from: DemoState; to: DemoState; detail: string };
type Geometry = { width: number; height: number; radius: number };
type Sample = { p50: number; p95: number; p99: number; dropped: number; frames: number };

const geometry: Record<DemoState, Geometry> = {
  idle: motionTokens.geometry.idle,
  alert: motionTokens.geometry.idle,
  peek: motionTokens.geometry.peek,
  expanded: { width: motionTokens.geometry.expanded.width, height: 168, radius: motionTokens.geometry.expanded.radius },
  burst: { width: motionTokens.geometry.expanded.width, height: 168, radius: motionTokens.geometry.expanded.radius },
  "row-exit": { width: motionTokens.geometry.expanded.width, height: 168, radius: motionTokens.geometry.expanded.radius },
};

const cases: MotionCase[] = [
  { name: "Idle → alert", from: "idle", to: "alert", detail: "Dot scale and status color" },
  { name: "Alert → peek", from: "alert", to: "peek", detail: "Dot shell morphs into a pill" },
  { name: "Peek → idle", from: "peek", to: "idle", detail: "Content fades before shell collapse" },
  { name: "Idle → expanded", from: "idle", to: "expanded", detail: "Dot shell morphs into a panel" },
  { name: "Peek → expanded", from: "peek", to: "expanded", detail: "Pill continues into a panel" },
  { name: "Expanded → idle", from: "expanded", to: "idle", detail: "Panel fades and collapses" },
  { name: "Burst → panel", from: "peek", to: "burst", detail: "Grouped rows enter with a highlighted item" },
  { name: "Row enter / exit", from: "expanded", to: "row-exit", detail: "Row height and opacity change" },
  { name: "Status change", from: "idle", to: "alert", detail: "Dot color and progress ring change" },
  { name: "Interruption", from: "peek", to: "expanded", detail: "Rapid retarget while the shell is moving" },
];

const measureDurationMs = 900;

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)] ?? 0;
}

function summarize(deltas: number[], targetHz: number): Sample {
  return {
    p50: percentile(deltas, 0.5),
    p95: percentile(deltas, 0.95),
    p99: percentile(deltas, 0.99),
    dropped: deltas.filter((delta) => delta > 1000 / targetHz).length,
    frames: deltas.length,
  };
}

export default function MotionLab() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<DemoState>("idle");
  const [selected, setSelected] = useState(0);
  const [refreshTarget, setRefreshTarget] = useState(60);
  const [background, setBackground] = useState("busy");
  const [results, setResults] = useState<Record<string, Sample>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const cancelRef = useRef(false);

  const play = async (motionCase: MotionCase, targetHz: number): Promise<Sample> => {
    const shell = shellRef.current;
    if (!shell) return summarize([], targetHz);

    shell.classList.add("motion-lab-reset");
    shell.dataset.state = motionCase.from;
    setActive(motionCase.from);
    const start = geometry[motionCase.from];
    const end = geometry[motionCase.to];
    const setShape = (shape: Geometry) => {
      shell.style.setProperty("--lab-shell-width", `${shape.width}px`);
      shell.style.setProperty("--lab-shell-height", `${shape.height}px`);
      shell.style.setProperty("--lab-shell-radius", `${shape.radius}px`);
    };
    setShape(start);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    shell.classList.remove("motion-lab-reset");

    const deltas: number[] = [];
    const startedAt = performance.now();
    shell.dataset.state = motionCase.to;
    setActive(motionCase.to);
    let width = retargetSpringAxis(createSpringAxis(start.width), end.width);
    let height = retargetSpringAxis(createSpringAxis(start.height), end.height);
    let radius = retargetSpringAxis(createSpringAxis(start.radius), end.radius);
    let interruptionStage = 0;

    return await new Promise<Sample>((resolve) => {
      let previous = startedAt;
      const sampleFrame = (now: number) => {
        if (cancelRef.current) {
          resolve(summarize(deltas, targetHz));
          return;
        }
        if (now - startedAt >= measureDurationMs) {
          resolve(summarize(deltas, targetHz));
          return;
        }
        const elapsed = now - startedAt;
        if (motionCase.name === "Interruption" && interruptionStage === 0 && elapsed >= 180) {
          const retarget = geometry.peek;
          width = retargetSpringAxis(width, retarget.width);
          height = retargetSpringAxis(height, retarget.height);
          radius = retargetSpringAxis(radius, retarget.radius);
          shell.dataset.state = "peek";
          setActive("peek");
          interruptionStage = 1;
        } else if (motionCase.name === "Interruption" && interruptionStage === 1 && elapsed >= 300) {
          const retarget = geometry.expanded;
          width = retargetSpringAxis(width, retarget.width);
          height = retargetSpringAxis(height, retarget.height);
          radius = retargetSpringAxis(radius, retarget.radius);
          shell.dataset.state = "expanded";
          setActive("expanded");
          interruptionStage = 2;
        }
        const deltaSeconds = (now - previous) / 1000;
        width = advanceSpringAxis(width, deltaSeconds, motionTokens.spring.morph);
        height = advanceSpringAxis(height, deltaSeconds, motionTokens.spring.morph);
        radius = advanceSpringAxis(radius, deltaSeconds, motionTokens.spring.morph);
        setShape({ width: width.position, height: height.position, radius: radius.position });
        deltas.push(now - previous);
        previous = now;
        requestAnimationFrame(sampleFrame);
      };
      requestAnimationFrame(sampleFrame);
    });
  };

  const run = async (indices: number[]) => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setResults({});
    const nextResults: Record<string, Sample> = {};
    for (let index = 0; index < indices.length; index += 1) {
      if (cancelRef.current) break;
      const motionCase = cases[indices[index] ?? 0];
      if (!motionCase) continue;
      setProgress(`${index + 1} / ${indices.length}: ${motionCase.name}`);
      nextResults[motionCase.name] = await play(motionCase, refreshTarget);
      setResults({ ...nextResults });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 180));
    }
    setProgress(cancelRef.current ? "Stopped" : "Run complete");
    setRunning(false);
  };

  const stop = () => { cancelRef.current = true; };

  const format = (value: number) => `${value.toFixed(1)} ms`;

  return (
    <main className={`motion-lab motion-lab-bg-${background}`}>
      <header className="motion-lab-header">
        <div>
          <p className="motion-lab-eyebrow">Dot Notifier · Phase M4</p>
          <h1>Motion lab</h1>
          <p>Measure spring motion against the reference display refresh rate.</p>
        </div>
        <label>Backdrop
          <select disabled={running} onChange={(event) => setBackground(event.currentTarget.value)} value={background}>
            <option value="bright">Bright</option><option value="dark">Dark</option><option value="busy">Busy</option>
          </select>
        </label>
      </header>

      <section className="motion-lab-preview" aria-label="Transition preview">
        <div className="motion-lab-wallpaper" />
        <div className="motion-lab-shell-wrap">
          <div className="motion-lab-shell" data-state={active} ref={shellRef}>
            <div className="motion-lab-dots"><i /><i /><i /></div>
            <div className="motion-lab-content">
              <b>{active === "alert" ? "Waiting for input" : active === "burst" ? "3 updates" : "Codex · refactor"}</b>
              <span>Polish the animation and visual material</span>
              <div className="motion-lab-rows"><i /><i /><i /></div>
            </div>
          </div>
        </div>
        <span className="motion-lab-state">{active}</span>
      </section>

      <section className="motion-lab-controls">
        <label>Transition
          <select disabled={running} onChange={(event) => setSelected(Number(event.currentTarget.value))} value={selected}>
            {cases.map((motionCase, index) => <option key={motionCase.name} value={index}>{motionCase.name}</option>)}
          </select>
        </label>
        <label>Display refresh target
          <select disabled={running} onChange={(event) => {
            setRefreshTarget(Number(event.currentTarget.value));
            setResults({});
          }} value={refreshTarget}>
            <option value={60}>60 Hz</option><option value={120}>120 Hz</option><option value={144}>144 Hz</option>
          </select>
        </label>
        <div className="motion-lab-actions">
          {running ? <button onClick={stop} type="button">Stop run</button> : <>
            <button onClick={() => void run([selected])} type="button">Run selected</button>
            <button className="primary" onClick={() => void run(cases.map((_, index) => index))} type="button">Run all transitions</button>
          </>}
        </div>
        <p aria-live="polite">{progress || "Each transition samples frame deltas for 900 ms."}</p>
      </section>

      <section className="motion-lab-results">
        <h2>Frame timing</h2>
        <p className="motion-lab-note">Dropped frame count means a sampled delta above {(1000 / refreshTarget).toFixed(1)} ms at the selected target. Match it to the display under test.</p>
        <div className="motion-lab-table-wrap">
          <table><thead><tr><th>Transition</th><th>p50</th><th>p95</th><th>p99</th><th>&gt;{(1000 / refreshTarget).toFixed(1)} ms</th><th>Frames</th></tr></thead>
            <tbody>{cases.map((motionCase) => {
              const sample = results[motionCase.name];
              return <tr key={motionCase.name}><th title={motionCase.detail}>{motionCase.name}</th>
                <td>{sample ? format(sample.p50) : "—"}</td><td>{sample ? format(sample.p95) : "—"}</td>
                <td>{sample ? format(sample.p99) : "—"}</td><td>{sample?.dropped ?? "—"}</td><td>{sample?.frames ?? "—"}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>
      <footer>Dev-only · Open with <code>pnpm dev:mock -- --host 127.0.0.1</code> and <code>?motion-lab</code></footer>
    </main>
  );
}
