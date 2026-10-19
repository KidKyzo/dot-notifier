import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  pillPresentation,
  getAgentIntegration,
  isAgentIntegrationEnabled,
  loadSettings,
  parseMonitoredApps,
  shouldExpandPillOnHover,
} from "./settings";

describe("user settings", () => {
  it("normalizes monitored apps and removes duplicates", () => {
    expect(parseMonitoredApps(" WhatsApp, Telegram, WhatsApp ,, ")).toEqual(["WhatsApp", "Telegram"]);
  });

  it("uses safe defaults for malformed stored settings", () => {
    expect(loadSettings({ getItem: () => "{" })).toEqual(defaultSettings);
    expect(loadSettings({ getItem: () => JSON.stringify({ peekDurationSeconds: 30 }) })).toEqual(defaultSettings);
  });

  it("defaults empty notification filters to WhatsApp only", () => {
    expect(loadSettings({
      getItem: () => JSON.stringify({ monitoredApps: [] }),
    }).monitoredApps).toEqual(["WhatsApp"]);
  });

  it("restores the top-center overlay position", () => {
    expect(loadSettings({ getItem: () => JSON.stringify({ corner: "top-center" }) }).corner).toBe("top-center");
  });

  it("keeps the optional extended modules off by default", () => {
    expect(defaultSettings.pillMode).toBe("all");
    expect(defaultSettings.nowPlayingEnabled).toBe(false);
    expect(defaultSettings.reminderTimerEnabled).toBe(false);
    expect(defaultSettings.whatsappCardEnabled).toBe(false);
    expect(loadSettings({ getItem: () => "{}" })).toEqual(defaultSettings);
  });

  it("persists supported pill views and falls back to All for unknown values", () => {
    const modes = ["all", "music", "agents", "timer"] as const;
    for (const pillMode of modes) {
      expect(loadSettings({
        getItem: () => JSON.stringify({ pillMode }),
      }).pillMode).toBe(pillMode);
    }
    for (const pillMode of ["unsupported", "notifications"]) {
      expect(loadSettings({
        getItem: () => JSON.stringify({ pillMode }),
      }).pillMode).toBe("all");
    }
  });

  it("keeps Music and Agents visible while due activity is shown", () => {
    for (const mode of ["music", "agents"] as const) {
      expect(pillPresentation(mode, true)).toEqual({ mode, showNotice: true });
      expect(pillPresentation(mode, false)).toEqual({ mode, showNotice: false });
    }
    expect(pillPresentation("all", true)).toEqual({ mode: "all", showNotice: false });
    expect(pillPresentation("timer", true)).toEqual({ mode: "timer", showNotice: false });
  });

  it("lets every pill view expand on hover", () => {
    const modes = ["all", "music", "agents", "timer"] as const;
    for (const mode of modes) expect(shouldExpandPillOnHover(mode)).toBe(true);
  });

  it("stops tracking disabled agent integrations while preserving the others", () => {
    const integrations = { codex: false, claude: true, antigravity: true };
    expect(isAgentIntegrationEnabled("codex", integrations)).toBe(false);
    expect(isAgentIntegrationEnabled("claude", integrations)).toBe(true);
    expect(isAgentIntegrationEnabled("antigravity-app", integrations)).toBe(true);
    expect(isAgentIntegrationEnabled("antigravity-cli", { ...integrations, antigravity: false })).toBe(false);
    expect(getAgentIntegration("antigravity-ide")).toBe("antigravity");
    expect(isAgentIntegrationEnabled("external", integrations)).toBe(true);
  });

  it("keeps Codex enabled by default and persists an explicit disabled choice", () => {
    expect(defaultSettings.codexEnabled).toBe(true);
    expect(loadSettings({ getItem: () => JSON.stringify({ codexEnabled: false }) }).codexEnabled).toBe(false);
  });
});
