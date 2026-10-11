import { describe, expect, it } from "vitest";
import { EventStore, type AppEvent } from "./event-store";

const event = (id: string, status: AppEvent["status"], title = id): AppEvent => ({
  id,
  source: "ai",
  agent: "codex",
  sessionId: id,
  kind: "task",
  status,
  title,
});

describe("event store", () => {
  it("falls back to id when an AI snapshot has no session identity", () => {
    const store = new EventStore();
    store.upsert({ id: "fallback-id", source: "ai", kind: "task", status: "running", title: "Old" });
    store.upsert({ id: "fallback-id", source: "ai", kind: "task", status: "done", title: "Updated" });

    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]?.title).toBe("Updated");
  });

  it("upserts AI task snapshots by agent and session", () => {
    const store = new EventStore();
    store.upsert({ ...event("first-id", "running", "Old snapshot"), sessionId: "same-session" });
    store.upsert({ ...event("second-id", "needs_input", "Latest snapshot"), sessionId: "same-session" });
    store.upsert({ ...event("other-agent", "running"), agent: "antigravity-cli", sessionId: "same-session" });

    expect(store.all()).toHaveLength(2);
    expect(store.all().find(({ agent }) => agent === "codex")).toMatchObject({
      id: "second-id",
      title: "Latest snapshot",
    });
    expect(store.nextPeek()?.id).toBe("second-id");
  });

  it("updates a session snapshot and prioritizes errors and needs-input peeks", () => {
    const store = new EventStore();
    store.upsert(event("task-1", "running", "old title"));
    store.upsert(event("task-1", "done", "updated title"));
    store.upsert(event("task-2", "needs_input"));
    store.upsert(event("task-3", "error"));
    store.upsert(event("task-4", "unread"));

    expect(store.all()).toHaveLength(4);
    expect(store.all()[0]?.title).toBe("updated title");
    expect(store.nextPeek()?.id).toBe("task-2");
    expect(store.dismissPeek()?.id).toBe("task-3");
    expect(store.dismissPeek()?.id).toBe("task-4");
    expect(store.dismissPeek()?.id).toBe("task-1");
  });

  it("shows an unread WhatsApp message before queued Codex completion peeks", () => {
    const store = new EventStore();
    store.upsert(event("codex-done", "done", "Codex task completed"));
    store.upsert({
      id: "whatsapp-message",
      source: "chat",
      kind: "message",
      status: "unread",
      title: "Dimas",
      body: "A new message",
    });

    expect(store.nextPeek()?.id).toBe("whatsapp-message");
  });

  it("peeks the newest unread chat notification first", () => {
    const store = new EventStore();
    for (const id of ["oldest", "middle", "newest"]) {
      store.upsert({ id, source: "chat", kind: "message", status: "unread", title: id });
    }

    expect(store.nextPeek()?.id).toBe("newest");
    expect(store.dismissPeek()?.id).toBe("middle");
    expect(store.dismissPeek()?.id).toBe("oldest");
  });

  it("uses the notification timestamp when older events arrive late", () => {
    const store = new EventStore();
    store.upsert({
      id: "newer",
      source: "chat",
      kind: "message",
      status: "unread",
      title: "Newest message",
      startedAt: "2026-10-10T01:02:00.000Z",
    }, 2_000);
    store.upsert({
      id: "older",
      source: "chat",
      kind: "message",
      status: "unread",
      title: "Older message delivered late",
      startedAt: "2026-10-10T01:01:00.000Z",
    }, 3_000);

    expect(store.nextPeek()?.id).toBe("newer");
  });

  it("groups the newest queued chat notifications into one peek", () => {
    const store = new EventStore();
    for (const id of ["first", "second", "third", "fourth"]) {
      store.upsert({ id, source: "chat", kind: "message", status: "unread", title: id });
    }

    expect(store.pendingChatMessages(3).map(({ id }) => id)).toEqual(["fourth", "third", "second"]);
    expect(store.dismissPeekGroup(["fourth", "third", "second"])?.id).toBe("first");
    expect(store.all()).toHaveLength(4);
  });

  it("expires chat events after one hour and removes them from the peek queue", () => {
    const store = new EventStore();
    const receivedAt = 10_000;
    store.upsert({
      id: "old-message",
      source: "chat",
      kind: "message",
      status: "unread",
      title: "WhatsApp",
    }, receivedAt);
    store.upsert(event("task", "done"), receivedAt);

    expect(store.expireChats(receivedAt + 3_599_999)).toEqual([]);
    expect(store.expireChats(receivedAt + 3_600_000)).toEqual(["old-message"]);
    expect(store.all().map(({ id }) => id)).toEqual(["task"]);
    expect(store.nextPeek()?.id).toBe("task");
  });

  it("resets the one-hour lifetime when the same chat event is updated", () => {
    const store = new EventStore();
    store.upsert({ id: "message", source: "chat", kind: "message", status: "unread", title: "First" }, 1_000);
    store.upsert({ id: "message", source: "chat", kind: "message", status: "unread", title: "Updated" }, 2_000);

    expect(store.expireChats(3_601_999)).toEqual([]);
    expect(store.all()[0]?.title).toBe("Updated");
    expect(store.expireChats(3_602_000)).toEqual(["message"]);
  });

  it("removes a dismissed chat event from the event list and peek queue", () => {
    const store = new EventStore();
    store.upsert({ id: "message", source: "chat", kind: "message", status: "unread", title: "WhatsApp" });
    store.upsert(event("task", "done"));

    store.dismiss("message");

    expect(store.all().map(({ id }) => id)).toEqual(["task"]);
    expect(store.nextPeek()?.id).toBe("task");
  });
});
