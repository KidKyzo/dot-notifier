import { describe, expect, it } from "vitest";
import { addClipboardEntry, loadClipboardHistory } from "./clipboard-history";

describe("clipboard history", () => {
  it("records distinct copy operations and ignores a repeated sample", () => {
    const first = addClipboardEntry([], 1, "hello", 100);
    expect(addClipboardEntry(first, 1, "hello", 200)).toBe(first);
    const second = addClipboardEntry(first, 2, "hello", 300);
    expect(second).toHaveLength(2);
    expect(second.map((entry) => entry.sequence)).toEqual([2, 1]);
  });

  it("ignores non-text copies and invalid persisted entries", () => {
    expect(addClipboardEntry([], 1, null)).toEqual([]);
    const entries = loadClipboardHistory({ getItem: () => JSON.stringify([
      { id: "good", sequence: 1, text: "hello", copiedAt: 100 },
      { id: "bad", sequence: "2", text: "bad", copiedAt: 200 },
    ]) });
    expect(entries).toHaveLength(1);
  });
});
