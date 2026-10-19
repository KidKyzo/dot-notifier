import { describe, expect, it } from "vitest";
import type { AppEvent } from "./event-store";
import { presentPeekGroup } from "./peek-group";

describe("grouped notification peek", () => {
  it("shows at most three rows while accounting for every notification", () => {
    const events: AppEvent[] = Array.from({ length: 10 }, (_, index) => ({
      id: `chat-${index}`,
      source: "chat",
      kind: "message",
      status: "unread",
      title: `Message ${index}`,
    }));

    const presentation = presentPeekGroup(events);

    expect(presentation.visibleEvents.map(({ id }) => id)).toEqual(["chat-0", "chat-1", "chat-2"]);
    expect(presentation.allIds).toHaveLength(10);
    expect(presentation.overflowCount).toBe(7);
  });

  it("does not show an overflow label for three or fewer events", () => {
    const events: AppEvent[] = Array.from({ length: 3 }, (_, index) => ({
      id: `event-${index}`,
      source: "system",
      kind: "metric",
      status: "warn",
      title: `Warning ${index}`,
    }));

    expect(presentPeekGroup(events).overflowCount).toBe(0);
    expect(presentPeekGroup(events).visibleEvents).toHaveLength(3);
  });
});
