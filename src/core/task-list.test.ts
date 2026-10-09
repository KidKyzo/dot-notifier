import { describe, expect, it } from "vitest";
import type { DemoTask } from "./mock";
import { primaryCodexTask, primaryCodexTaskRows, upsertTask } from "./task-list";

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
});
