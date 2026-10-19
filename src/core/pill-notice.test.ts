import { describe, expect, it } from "vitest";
import { afterNoticeMessage, type PillNotice } from "./pill-notice";

describe("pill notice lifecycle", () => {
  it("moves a completed timer message into its collapse phase", () => {
    const notice: PillNotice = { id: "timer-1", kind: "timer-ended", phase: "message" };

    expect(afterNoticeMessage(notice)).toEqual({ ...notice, phase: "collapsing" });
  });

  it("moves a reminder message into its collapse phase", () => {
    const notice: PillNotice = { id: "reminder-1", kind: "reminder", title: "Water", phase: "message" };

    expect(afterNoticeMessage(notice)).toEqual({ ...notice, phase: "collapsing" });
  });
});
