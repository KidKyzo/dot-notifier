import { describe, expect, it } from "vitest";
import { islandReducer, shouldScheduleHoverCollapse } from "./island-state";

describe("island state transitions", () => {
  it("moves through idle, alert, peek, expanded, and back to idle", () => {
    const alert = islandReducer("idle", { type: "set", state: "alert" });
    const peek = islandReducer(alert, { type: "set", state: "peek" });
    const expanded = islandReducer(peek, { type: "hover", active: true });
    const idle = islandReducer(expanded, { type: "hover", active: false });

    expect([alert, peek, expanded, idle]).toEqual([
      "alert",
      "peek",
      "expanded",
      "idle",
    ]);
  });

  it("dismisses a peek after its timer without changing other states", () => {
    expect(islandReducer("peek", { type: "dismiss" })).toBe("idle");
    expect(islandReducer("alert", { type: "dismiss" })).toBe("alert");
  });

  it("collapses an unpinned expanded panel even if hover tracking desynchronizes during a chat burst", () => {
    expect(shouldScheduleHoverCollapse("expanded", false, false, false)).toBe(true);
    expect(shouldScheduleHoverCollapse("expanded", true, true, false)).toBe(false);
    expect(shouldScheduleHoverCollapse("expanded", false, false, true)).toBe(false);
    expect(shouldScheduleHoverCollapse("idle", false, false, false)).toBe(false);
  });
});
