import { describe, expect, it } from "vitest";
import { isHudToggleShortcut } from "./hud-keyboard";

describe("HUD keyboard shortcuts", () => {
  it("does not consume Space or Enter from a focused form control", () => {
    expect(isHudToggleShortcut(" ", false)).toBe(false);
    expect(isHudToggleShortcut("Enter", false)).toBe(false);
  });

  it("toggles only when the HUD itself has focus", () => {
    expect(isHudToggleShortcut(" ", true)).toBe(true);
    expect(isHudToggleShortcut("Enter", true)).toBe(true);
    expect(isHudToggleShortcut("Escape", true)).toBe(false);
  });
});
