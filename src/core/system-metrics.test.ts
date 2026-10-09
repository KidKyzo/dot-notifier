import { describe, expect, it } from "vitest";
import { initialSystemMetrics, parseSystemMetrics } from "./system-metrics";

describe("system metrics payloads", () => {
  it("accepts metric snapshots and ignores unknown fields", () => {
    const parsed = parseSystemMetrics({
      ...initialSystemMetrics,
      futureField: "ignored",
    });

    expect(parsed?.current.cpuPercent).toBe(34);
    expect(parsed?.history).toHaveLength(60);
  });

  it("drops malformed snapshots", () => {
    expect(parseSystemMetrics({ current: { cpuPercent: "high" }, history: [] })).toBeUndefined();
    expect(parseSystemMetrics(null)).toBeUndefined();
  });
});
