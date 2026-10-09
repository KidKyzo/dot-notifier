export type UserSettings = {
  peekDurationSeconds: number;
  monitoredApps: string[];
  autoStart: boolean;
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  monitorKey: string | null;
};

export const defaultSettings: UserSettings = {
  peekDurationSeconds: 4,
  monitoredApps: ["WhatsApp"],
  autoStart: false,
  corner: "top-right",
  monitorKey: null,
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
      corner: record.corner === "top-left" || record.corner === "top-right"
        || record.corner === "bottom-left" || record.corner === "bottom-right"
        ? record.corner
        : defaultSettings.corner,
      monitorKey: typeof record.monitorKey === "string" ? record.monitorKey : defaultSettings.monitorKey,
    };
  } catch {
    return defaultSettings;
  }
};
