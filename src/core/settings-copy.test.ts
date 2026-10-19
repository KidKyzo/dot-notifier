import { describe, expect, it } from "vitest";
import { agentActivityLabel, settingsCopy } from "./settings-copy";

describe("agent activity copy", () => {
  it("uses the copy catalog for known activity categories", () => {
    expect(agentActivityLabel("Reading files")).toBe(settingsCopy.agentActivity.reading);
    expect(agentActivityLabel("Editing code")).toBe(settingsCopy.agentActivity.editing);
  });

  it("preserves existing task titles from other integrations", () => {
    expect(agentActivityLabel("Custom task status")).toBe("Custom task status");
  });
});
