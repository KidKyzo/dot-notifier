import type { AppEvent } from "./event-store";

const MAX_VISIBLE_EVENTS = 3;

export function presentPeekGroup(events: AppEvent[]): {
  visibleEvents: AppEvent[];
  allIds: string[];
  overflowCount: number;
} {
  return {
    visibleEvents: events.slice(0, MAX_VISIBLE_EVENTS),
    allIds: events.map((event) => event.id),
    overflowCount: Math.max(0, events.length - MAX_VISIBLE_EVENTS),
  };
}
