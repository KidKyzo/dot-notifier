import { describe, expect, it } from "vitest";
import { calendarDays, localDayKey } from "./calendar";

describe("local calendar", () => {
  it("starts on Monday and covers the displayed month", () => {
    const days = calendarDays(new Date(2026, 9, 1));
    expect(days[0].getDay()).toBe(1);
    expect(days.some((day) => localDayKey(day) === "2026-10-01")).toBe(true);
    expect(days.length % 7).toBe(0);
    expect(days[days.length - 1]?.getMonth()).toBeGreaterThanOrEqual(9);
  });
});
