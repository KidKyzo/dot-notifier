import { describe, expect, it } from "vitest";
import { loadTaskHistory, upsertTaskHistory } from "./task-history";

describe("task history", () => {
  it("keeps every task until removed and updates one agent session", () => {
    const task = { id: "one", source: "codex" as const, name: "Codex", title: "Build", status: "running" as const, progress: 0 };
    const first = upsertTaskHistory([], task, 10);
    const second = upsertTaskHistory(first, { ...task, status: "done" }, 20);
    const third = upsertTaskHistory(second, { ...task, id: "two", source: "claude" }, 30);
    expect(third).toHaveLength(2);
    expect(third[1]).toMatchObject({ id: "one", source: "codex", status: "done", updatedAt: 20 });
    expect(upsertTaskHistory(third, { ...task, id: "two", source: "claude" }, 40)).toBe(third);
  });

  it("drops malformed persisted entries", () => {
    const entries = loadTaskHistory({ getItem: () => JSON.stringify([
      { id: "good", source: "codex", title: "Build", status: "done", updatedAt: 20 },
      { id: "bad", source: "unknown", title: "Bad", status: "done", updatedAt: 30 },
    ]) });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("good");
  });
});
