import { describe, expect, it } from "vitest";
import {
  acknowledgeDueReminder,
  clearFinishedTimer,
  durationToMs,
  formatCountdown,
  formatDuration,
  loadReminderTimer,
  nextReminderDelayMs,
  nextDueActivity,
  saveReminderTimer,
  timerRemainingMs,
  type ReminderTimerState,
} from "./reminder-timer";

describe("reminder and timer state", () => {
  it("restores valid reminders and a running timer while discarding malformed entries", () => {
    const state: ReminderTimerState = {
      reminders: [
        { id: "later", title: "Submit report", dueAt: 20_000, notified: false, relative: false, repeatMs: null },
        { id: "first", title: "Call home", dueAt: 10_000, notified: true, relative: false, repeatMs: null },
      ],
      timer: { id: "timer", endsAt: 70_000, remainingMs: null, notified: false },
    };
    let stored = "";
    saveReminderTimer({ setItem: (_key, value) => { stored = value; } }, state);
    expect(loadReminderTimer({ getItem: () => stored })).toEqual({
      ...state,
      reminders: [state.reminders[1], state.reminders[0]],
    });

    expect(loadReminderTimer({ getItem: () => JSON.stringify({
      reminders: [
        { id: "bad", title: "", dueAt: 10_000 },
        { id: "good", title: "  Valid  ", dueAt: 30_000 },
        { id: "invalid-date", title: "Bad", dueAt: Number.MAX_VALUE },
      ],
      timer: { id: "bad-timer", endsAt: "tomorrow", remainingMs: null },
    }) })).toEqual({
      reminders: [{ id: "good", title: "Valid", dueAt: 30_000, notified: false, relative: false, repeatMs: null }],
      timer: null,
    });
  });

  it("keeps countdown time after restart and pauses without losing the remaining duration", () => {
    const timer = { id: "timer", endsAt: 65_000, remainingMs: null, notified: false };
    expect(timerRemainingMs(timer, 5_000)).toBe(60_000);
    expect(timerRemainingMs(timer, 35_000)).toBe(30_000);
    expect(timerRemainingMs({ ...timer, remainingMs: 30_000 }, 90_000)).toBe(30_000);
    expect(timerRemainingMs(timer, 70_000)).toBe(0);
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(3_665_000)).toBe("1:01:05");
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(300_000)).toBe("5m");
    expect(formatDuration(7_200_000)).toBe("2h");
  });

  it("converts seconds, minutes and hours into bounded durations", () => {
    expect(durationToMs(30, "seconds")).toBe(30_000);
    expect(durationToMs(5, "minutes")).toBe(300_000);
    expect(durationToMs(2, "hours")).toBe(7_200_000);
    expect(durationToMs(0, "seconds")).toBeNull();
    expect(durationToMs(25, "hours")).toBeNull();
  });

  it("ticks relative reminder countdowns every second and date reminders once a minute", () => {
    const reminders: ReminderTimerState["reminders"] = [
      { id: "water", title: "Drink water", dueAt: 600_000, notified: false, relative: true, repeatMs: 600_000 },
    ];
    expect(nextReminderDelayMs(reminders, 60_000)).toBe(1_000);
    expect(nextReminderDelayMs([{ ...reminders[0], relative: false, repeatMs: null }], 60_000)).toBe(60_000);
    expect(nextReminderDelayMs(reminders, 599_000)).toBe(1_000);
    expect(nextReminderDelayMs(reminders, 600_000)).toBeNull();
  });

  it("keeps legacy reminders and advances repeating reminders past missed intervals", () => {
    const legacy = loadReminderTimer({ getItem: () => JSON.stringify({
      reminders: [{ id: "legacy", title: "Old reminder", dueAt: 5_000 }],
      timer: null,
    }) });
    expect(legacy.reminders[0]).toMatchObject({ relative: false, repeatMs: null });

    const repeated: ReminderTimerState = {
      reminders: [{ id: "water", title: "Drink water", dueAt: 10_000, notified: false, relative: true, repeatMs: 60_000 }],
      timer: null,
    };
    expect(acknowledgeDueReminder(repeated, "water", 200_000).reminders[0])
      .toEqual({ id: "water", title: "Drink water", dueAt: 250_000, notified: false, relative: true, repeatMs: 60_000 });
  });

  it("alerts the earliest due item and ignores acknowledged or paused items", () => {
    const timer = { id: "timer", endsAt: 8_000, remainingMs: null, notified: false };
    const state: ReminderTimerState = {
      reminders: [
        { id: "first", title: "First", dueAt: 10_000, notified: false },
        { id: "acknowledged", title: "Done", dueAt: 5_000, notified: true },
      ],
      timer,
    };
    expect(nextDueActivity(state, 12_000)).toEqual({ kind: "reminder", id: "first", title: "First", dueAt: 10_000 });
    expect(nextDueActivity({ ...state, timer: { ...timer, remainingMs: 3_000 } }, 12_000))
      .toEqual({ kind: "reminder", id: "first", title: "First", dueAt: 10_000 });
    expect(nextDueActivity(state, 7_000)).toBeNull();
  });

  it("removes a finished timer without opening a timer alert", () => {
    const timer = { id: "timer", endsAt: 8_000, remainingMs: null, notified: false };
    const state: ReminderTimerState = { reminders: [], timer };
    expect(clearFinishedTimer(state, 7_999)).toBe(state);
    expect(clearFinishedTimer(state, 8_000)).toEqual({ reminders: [], timer: null });
    expect(nextDueActivity(state, 8_000)).toBeNull();
    expect(clearFinishedTimer({ ...state, timer: { ...timer, remainingMs: 5_000 } }, 10_000).timer)
      .toEqual({ ...timer, remainingMs: 5_000 });
  });
});
