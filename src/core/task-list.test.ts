import { describe, expect, it } from "vitest";
import type { DemoStatus, DemoTask } from "./mock";
import {
  aggregateTaskDotStatus,
  aggregateTaskProgress,
  aggregateTaskStatus,
  codexTaskRowsForPanel,
  hasNewlyCompletedTask,
  groupTasksByAgent,
  primaryCodexTask,
  primaryCodexTaskRows,
  taskElapsedLabel,
  taskCompletionPreview,
  upsertTask,
  validTaskUsage,
} from "./task-list";

const task = (id: string, status: DemoTask["status"], startedAt?: number): DemoTask => ({
  id,
  source: "codex",
  name: `Codex · ${id.slice(0, 8)}`,
  status,
  title: `Task ${id}`,
  progress: status === "done" ? 1 : 0,
  ...(startedAt === undefined ? {} : { startedAt }),
});

describe("Codex task list", () => {
  it("keeps updates from separate threads separate", () => {
    const tasks = upsertTask(
      [task("older-thread", "done", 100)],
      task("newer-thread", "running", 200),
      200,
    );

    expect(tasks.map(({ id }) => id)).toEqual(["older-thread", "newer-thread"]);
    expect(primaryCodexTask(tasks)?.id).toBe("newer-thread");
  });

  it("does not let a late completion from an older thread hide the running thread", () => {
    const tasks = upsertTask(
      [task("older-thread", "running", 100), task("newer-thread", "running", 200)],
      task("older-thread", "done"),
      300,
    );

    expect(primaryCodexTask(tasks)?.id).toBe("newer-thread");
    expect(tasks.find(({ id }) => id === "older-thread")?.startedAt).toBe(100);
  });

  it("shows one primary Codex task instead of completed thread history", () => {
    const tasks = [
      task("older-completion", "done", 100),
      task("middle-completion", "done", 200),
      task("newest-completion", "done", 300),
    ];

    expect(primaryCodexTaskRows(tasks).map(({ id }) => id)).toEqual(["newest-completion"]);
  });

  it("keeps focus and usage metadata when a later lifecycle event omits it", () => {
    const initial = {
      ...task("thread", "running", 100),
      pid: 4321,
      usage: { tokens: 18200, quotaLeft: 0.63 },
    };
    const updated = upsertTask([initial], task("thread", "done"), 200)[0];

    expect(updated.pid).toBe(4321);
    expect(updated.usage).toEqual({ tokens: 18200, quotaLeft: 0.63 });
  });

  it("does not present a transient activity as the completed task", () => {
    const running = { ...task("thread", "running", 100), title: "Editing code" };
    const completed = upsertTask([running], {
      ...task("thread", "done"),
      title: "Codex task completed",
    }, 200)[0];

    expect(completed.title).toBe("Codex task completed");
    expect(completed.status).toBe("done");
  });

  it("keeps a descriptive task name when a generic completion arrives", () => {
    const running = { ...task("thread", "running", 100), title: "Migrate customer database" };
    const completed = upsertTask([running], {
      ...task("thread", "done"),
      title: "Codex task completed",
    }, 200)[0];

    expect(completed.title).toBe("Migrate customer database");
  });

  it("shows a bounded final-answer preview without line breaks", () => {
    expect(taskCompletionPreview("  Fixed volume\n and reminder  ")).toBe("Fixed volume and reminder");
    expect(taskCompletionPreview(" ")).toBeUndefined();
    expect(taskCompletionPreview("x".repeat(300))).toHaveLength(280);
  });

  it("does not invent a running Codex task when the integration has no session", () => {
    expect(codexTaskRowsForPanel([], true, "No active task")).toEqual([{
      id: "codex-idle",
      source: "codex",
      name: "Codex",
      status: "idle",
      title: "No active task",
      progress: 0,
    }]);
    expect(codexTaskRowsForPanel([], false, "No active task")).toEqual([]);
  });

  it("keeps Antigravity app, CLI, and IDE sessions under distinct headings", () => {
    const tasks: DemoTask[] = [
      { ...task("app", "running"), source: "antigravity-app" },
      { ...task("cli", "running"), source: "antigravity-cli" },
      { ...task("ide", "running"), source: "antigravity-ide" },
    ];

    expect(groupTasksByAgent(tasks, "Other agents").map(({ name }) => name)).toEqual([
      "Antigravity App",
      "Antigravity CLI",
      "Antigravity IDE",
    ]);
  });

  it("keeps concurrent sessions visible together under one agent heading", () => {
    const tasks = [task("session-one", "running"), task("session-two", "running")];

    expect(groupTasksByAgent(tasks, "Other agents")).toEqual([
      { name: "Codex", rows: tasks },
    ]);
  });

  it("formats running time as hours, minutes, and seconds after an hour", () => {
    expect(taskElapsedLabel(0, 3_723_000)).toBe("1:02:03");
  });
});

describe("task usage validation", () => {
  it("keeps valid values and omits missing fields", () => {
    expect(validTaskUsage({ tokens: 18200, quotaLeft: 0.63 })).toEqual({ tokens: 18200, quotaLeft: 0.63 });
    expect(validTaskUsage({ tokens: 1200 })).toEqual({ tokens: 1200 });
    expect(validTaskUsage(undefined)).toBeUndefined();
  });

  it("ignores invalid usage values", () => {
    expect(validTaskUsage({ tokens: -1, quotaLeft: 2 })).toBeUndefined();
    expect(validTaskUsage({ tokens: Number.NaN, quotaLeft: Number.POSITIVE_INFINITY })).toBeUndefined();
  });
});

describe("aggregate dot color / status (F30)", () => {
  const agentTask = (id: string, source: DemoTask["source"], status: DemoTask["status"], progress = 0): DemoTask => ({
    id,
    source,
    name: `${source} · ${id}`,
    status,
    title: `Task ${id}`,
    progress,
  });

  it("returns idle when there are no tasks or only idle tasks", () => {
    expect(aggregateTaskStatus([])).toBe("idle");
    expect(aggregateTaskStatus([agentTask("1", "codex", "idle")])).toBe("idle");
    expect(aggregateTaskStatus([
      agentTask("1", "codex", "idle"),
      agentTask("2", "antigravity-ide", "idle"),
    ])).toBe("idle");
  });

  it("prioritizes needs_input above error, running, and done", () => {
    const tasks = [
      agentTask("1", "codex", "running", 0.5),
      agentTask("2", "antigravity-cli", "needs_input"),
      agentTask("3", "antigravity-ide", "error"),
    ];
    expect(aggregateTaskStatus(tasks)).toBe("needs_input");
  });

  it("prioritizes error above running and done", () => {
    const tasks = [
      agentTask("1", "codex", "running", 0.5),
      agentTask("2", "antigravity-ide", "error"),
      agentTask("3", "antigravity-cli", "done", 1),
    ];
    expect(aggregateTaskStatus(tasks)).toBe("error");
  });

  it("prioritizes running above done", () => {
    const tasks = [
      agentTask("1", "codex", "done", 1),
      agentTask("2", "antigravity-ide", "running", 0.7),
    ];
    expect(aggregateTaskStatus(tasks)).toBe("running");
  });

  it("returns done when an agent is done and no other agent is active", () => {
    const tasks = [
      agentTask("1", "codex", "idle"),
      agentTask("2", "antigravity-ide", "done", 1),
    ];
    expect(aggregateTaskStatus(tasks)).toBe("done");
  });

  it("shows done only during the completion grace period, then returns to idle", () => {
    const tasks = [agentTask("1", "codex", "done", 1)];

    expect(aggregateTaskDotStatus(tasks, 5_000, 4_999)).toBe("done");
    expect(aggregateTaskDotStatus(tasks, 5_000, 5_000)).toBe("idle");
  });

  it("keeps higher priority task states above a recent completion", () => {
    const tasks = [
      agentTask("1", "codex", "done", 1),
      agentTask("2", "claude", "running", 0.5),
    ];

    expect(aggregateTaskDotStatus(tasks, 5_000, 1_000)).toBe("running");
  });

  it("starts a completion notice only on a transition into done", () => {
    const previous = new Map<string, DemoStatus>([["1", "running"]]);
    const completed = [agentTask("1", "codex", "done", 1)];
    const alreadyCompleted = new Map<string, DemoStatus>([["1", "done"]]);

    expect(hasNewlyCompletedTask(previous, completed)).toBe(true);
    expect(hasNewlyCompletedTask(alreadyCompleted, completed)).toBe(false);
  });

  it("calculates average progress of running tasks and 0 when none running", () => {
    expect(aggregateTaskProgress([])).toBe(0);
    expect(aggregateTaskProgress([agentTask("1", "codex", "idle")])).toBe(0);
    expect(aggregateTaskProgress([agentTask("1", "codex", "running", 0.4)])).toBe(0.4);
    expect(aggregateTaskProgress([
      agentTask("1", "codex", "running", 0.2),
      agentTask("2", "antigravity-ide", "running", 0.6),
      agentTask("3", "antigravity-cli", "done", 1),
    ])).toBe(0.4);
  });
});
