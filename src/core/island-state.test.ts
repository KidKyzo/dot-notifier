import { describe, expect, it } from "vitest";
import { islandReducer } from "./island-state";

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
});
