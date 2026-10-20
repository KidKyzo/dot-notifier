export type UserSettings = {
  peekDurationSeconds: number;
  monitoredApps: string[];
  autoStart: boolean;
  codexEnabled: boolean;
  corner: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-right";
  monitorKey: string | null;
  pillMode: PillMode;
  nowPlayingEnabled: boolean;
  nowPlayingPeekEnabled: boolean;
  nowPlayingBrowserMediaEnabled: boolean;
  reminderTimerEnabled: boolean;
  whatsappCardEnabled: boolean;
  whatsappNotificationsEnabled: boolean;
  allowDuringFullscreen: boolean;
};

export type PillMode = "all" | "music" | "agents" | "timer" | "clipboard";
export const pillPresentation = (mode: PillMode, noticeActive: boolean): {
  mode: PillMode;
  showNotice: boolean;
  showAmbientActivity: boolean;
} => ({
  mode,
  showNotice: noticeActive && (mode === "music" || mode === "agents"),
  showAmbientActivity: mode === "timer",
});
export type AgentIntegration = "codex" | "claude" | "antigravity";

export type AgentIntegrationState = Record<AgentIntegration, boolean>;

export const getAgentIntegration = (agent: string | undefined): AgentIntegration | undefined => {
  if (agent === "codex" || agent === "claude") return agent;
  if (agent?.startsWith("antigravity-")) return "antigravity";
  return undefined;
};

export const isAgentIntegrationEnabled = (
  agent: string | undefined,
  integrations: AgentIntegrationState,
): boolean => {
  const integration = getAgentIntegration(agent);
  return integration === undefined || integrations[integration];
};

export const shouldExpandPillOnHover = (mode: PillMode): boolean =>
  mode === "all" || mode === "music" || mode === "agents" || mode === "timer"
  || mode === "clipboard";

export const isUtilityModeOpen = (mode: PillMode, expanded: boolean, settingsOpen: boolean): boolean =>
  mode === "clipboard" && expanded && !settingsOpen;

export const defaultSettings: UserSettings = {
  peekDurationSeconds: 4,
  monitoredApps: ["WhatsApp"],
  autoStart: false,
  codexEnabled: true,
  corner: "top-right",
  monitorKey: null,
  pillMode: "all",
  nowPlayingEnabled: false,
  nowPlayingPeekEnabled: false,
  nowPlayingBrowserMediaEnabled: false,
  reminderTimerEnabled: false,
  whatsappCardEnabled: false,
  whatsappNotificationsEnabled: true,
  allowDuringFullscreen: false,
};

export const parseMonitoredApps = (value: string): string[] => Array.from(
  new Set(value.split(",").map((app) => app.trim()).filter(Boolean)),
);

export const loadSettings = (storage: Pick<Storage, "getItem">): UserSettings => {
  try {
    const raw = storage.getItem("dot-notifier-settings");
    if (!raw) return defaultSettings;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultSettings;
    const record = parsed as Record<string, unknown>;
    const storedApps = Array.isArray(record.monitoredApps)
      ? parseMonitoredApps(record.monitoredApps.filter((app): app is string => typeof app === "string").join(","))
      : defaultSettings.monitoredApps;
    return {
      peekDurationSeconds: typeof record.peekDurationSeconds === "number"
        && record.peekDurationSeconds >= 2 && record.peekDurationSeconds <= 10
        ? record.peekDurationSeconds
        : defaultSettings.peekDurationSeconds,
      monitoredApps: storedApps.length > 0 ? storedApps : defaultSettings.monitoredApps,
      autoStart: typeof record.autoStart === "boolean" ? record.autoStart : defaultSettings.autoStart,
      codexEnabled: typeof record.codexEnabled === "boolean" ? record.codexEnabled : defaultSettings.codexEnabled,
      corner: record.corner === "top-left" || record.corner === "top-center" || record.corner === "top-right"
        || record.corner === "bottom-left" || record.corner === "bottom-right"
        ? record.corner
        : defaultSettings.corner,
      monitorKey: typeof record.monitorKey === "string" ? record.monitorKey : defaultSettings.monitorKey,
      pillMode: record.pillMode === "music" || record.pillMode === "agents"
        || record.pillMode === "timer" || record.pillMode === "clipboard"
        ? record.pillMode
        : defaultSettings.pillMode,
      nowPlayingEnabled: typeof record.nowPlayingEnabled === "boolean" ? record.nowPlayingEnabled : false,
      nowPlayingPeekEnabled: typeof record.nowPlayingPeekEnabled === "boolean" ? record.nowPlayingPeekEnabled : false,
      nowPlayingBrowserMediaEnabled: typeof record.nowPlayingBrowserMediaEnabled === "boolean"
        ? record.nowPlayingBrowserMediaEnabled
        : false,
      reminderTimerEnabled: typeof record.reminderTimerEnabled === "boolean"
        ? record.reminderTimerEnabled
        : false,
      whatsappCardEnabled: typeof record.whatsappCardEnabled === "boolean" ? record.whatsappCardEnabled : false,
      whatsappNotificationsEnabled: typeof record.whatsappNotificationsEnabled === "boolean"
        ? record.whatsappNotificationsEnabled
        : true,
      allowDuringFullscreen: typeof record.allowDuringFullscreen === "boolean"
        ? record.allowDuringFullscreen
        : false,
    };
  } catch {
    return defaultSettings;
  }
};
