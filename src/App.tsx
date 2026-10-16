import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { islandReducer } from "./core/island-state";
import { isHudToggleShortcut } from "./core/hud-keyboard";
import { CHAT_RETENTION_MS, EventStore, eventCreatedAtMs, type AppEvent } from "./core/event-store";
import { isWhatsAppApp, pruneExpiredMessages, removeWhatsAppMessages, upsertChatMessage } from "./core/chat-retention";
import {
  aggregateTaskStatus,
  primaryCodexTaskRows,
  upsertTask,
} from "./core/task-list";
import { initialSystemMetrics, mockSystemAlert, parseSystemMetrics } from "./core/system-metrics";
import { systemCopy } from "./core/system-copy";
import { settingsCopy } from "./core/settings-copy";
import { defaultSettings, loadSettings, parseMonitoredApps, type UserSettings } from "./core/settings";
import {
  clearFinishedTimer,
  acknowledgeDueReminder,
  durationToMs,
  formatCountdown,
  formatDuration,
  loadReminderTimer,
  maxReminders,
  nextDueActivity,
  nextReminderDelayMs,
  saveReminderTimer,
  timerRemainingMs,
  type DurationUnit,
  type Reminder,
  type ReminderTimerState,
} from "./core/reminder-timer";
import { isIncomingWhatsAppCall, isWhatsAppNotification } from "./core/whatsapp-calls";
import {
  advanceSpringAxis,
  createSpringAxis,
  isSpringAxisSettled,
  motionTokens,
  retargetSpringAxis,
} from "./core/motion";
import type { SpringAxis } from "./core/motion";
import {
  incomingMessages,
  emptyTasks,
  initialMessages,
  initialTasks,
  type DemoMessage,
  type DemoStatus,
  type DemoTask,
} from "./core/mock";
import "./App.css";

type PulseSource = "ai" | "codex" | "chat" | "system";
type DotStatus = DemoStatus | "warn" | "crit";
type PeekInfo = { source: string; message: string; dotStatus: DotStatus; chatMessages: AppEvent[]; groupEvents?: AppEvent[]; groupEventIds?: string[]; overflowCount?: number; actionEvent?: AppEvent; chatSender?: string; chatApp?: string; incomingCall?: boolean };
type MonitorOption = { key: string; label: string; width: number; height: number };
type ReminderSchedule = "after" | "at";
type NowPlayingSnapshot = { title: string; artist: string; playing: boolean; coverDataUrl: string | null };
type HudShape = { width: SpringAxis; height: SpringAxis; radius: SpringAxis; frame: number | null; lastFrame: number | null };

const colors: Record<DotStatus, string> = {
  idle: "#8e8e93",
  running: "#4c9aff",
  done: "#34c759",
  error: "#ff453a",
  needs_input: "#ff9f0a",
  warn: "#e6b84a",
  crit: "#ff453a",
};

const statusLabels: Record<DemoStatus, string> = {
  idle: "Idle",
  running: "Running",
  done: "Completed",
  error: "Failed",
  needs_input: "Needs input",
};

const percent = (value: number | null) => value === null ? systemCopy.unavailable : `${Math.round(value)}%`;

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toUpperCase() || "?";

const avatarHue = (name: string) => Array.from(name).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0);
const agentDisplayName = (agent?: AppEvent["agent"], meta?: AppEvent["meta"]): string => {
  if (agent === "external" && typeof meta?.product === "string") return meta.product;
  switch (agent) {
    case "codex": return "Codex";
    case "claude": return "Claude";
    case "antigravity-app": return "Antigravity App";
    case "antigravity-cli": return "Antigravity CLI";
    case "antigravity-ide": return "Antigravity IDE";
    default: return agent ?? "AI";
  }
};

const eventDotStatus = (event: AppEvent): DotStatus => {
  if (event.status === "unread") return "done";
  return event.status ?? "running";
};

const reminderTimingLabel = (reminder: Reminder, now: number): string => {
  if (!reminder.relative) return settingsCopy.reminderAt(new Date(reminder.dueAt));
  if (reminder.dueAt <= now) return settingsCopy.reminderDue;
  const next = formatCountdown(reminder.dueAt - now);
  return reminder.repeatMs
    ? settingsCopy.reminderRepeats(formatDuration(reminder.repeatMs), next)
    : settingsCopy.reminderAfter(next);
};

const metricUsage = (used: number | null, total: number | null, value: number | null) => {
  if (value === null) return systemCopy.unavailable;
  if (used === null || total === null) return percent(value);
  return `${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB · ${percent(value)}`;
};

function SettingsSwitch({ label, checked, disabled = false, className = "", onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className={`setting-toggle${className ? ` ${className}` : ""}`}>
      <span className="setting-toggle-label">{label}</span>
      <span className="setting-toggle-control">
        <span aria-hidden="true" className={`setting-toggle-state${checked ? " is-enabled" : ""}`}>
          {checked ? settingsCopy.enabled : settingsCopy.disabled}
        </span>
        <input
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          role="switch"
          type="checkbox"
        />
      </span>
    </label>
  );
}

function SystemMetric({ label, value, samples }: {
  label: string;
  value: string;
  samples: Array<{ capturedAt: number; value: number | null }>;
}) {
  const startTime = Date.now() - 60_000;
  const recent = samples.filter((sample): sample is { capturedAt: number; value: number } =>
    sample.capturedAt >= startTime && sample.value !== null);
  const values = recent.map((sample) => sample.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const path = values.length > 1
    ? recent.map((sample, index) => {
      const x = ((sample.capturedAt - startTime) / 60_000) * 116;
      const range = maximum - minimum || 1;
      const y = 24 - (((sample.value ?? minimum) - minimum) / range) * 20;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ")
    : "";

  return (
    <div className="system-metric">
      <div className="system-metric-label"><span>{label}</span><b>{value}</b></div>
      {path ? (
        <svg aria-label={systemCopy.history(label)} className="sparkline" role="img" viewBox="0 0 116 28">
          <path d={path} />
        </svg>
      ) : <span className="system-empty">{systemCopy.noSamples}</span>}
    </div>
  );
}

const durationLabel = (startedAt?: number) => {
  if (startedAt === undefined) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
};

function Dot({
  status,
  progress = 0,
  ring = false,
  badge = false,
  pulse = false,
  className = "",
}: {
  status: DotStatus;
  progress?: number;
  ring?: boolean;
  badge?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  const style = {
    "--dot-color": colors[status],
    "--dot-progress": `${Math.round(progress * 100)}%`,
  } as CSSProperties;

  return (
    <i
      aria-hidden="true"
      className={`dot${ring ? " ring" : ""}${badge ? " badge" : ""}${pulse ? " pulse" : ""} ${className}`}
      style={style}
    />
  );
}

function App() {
  const isMockMode = import.meta.env.MODE === "mock";
  const [state, dispatch] = useReducer(islandReducer, "idle");
  const [tasks, setTasks] = useState(() => isMockMode ? initialTasks : emptyTasks);
  const [messages, setMessages] = useState<DemoMessage[]>(() => isMockMode ? initialMessages : []);
  const [exitingMessages, setExitingMessages] = useState<string[]>([]);
  const [systemMetrics, setSystemMetrics] = useState(initialSystemMetrics);
  const unreadCount = messages.filter((message) => message.unread).length;
  const whatsappMessageCount = messages.filter((message) => isWhatsAppApp(message.app)).length;
  const [messageIndex, setMessageIndex] = useState(0);
  const [peekInfo, setPeekInfo] = useState<PeekInfo>({ source: "Codex", message: "", dotStatus: "idle", chatMessages: [] });
  const [pulseSource, setPulseSource] = useState<PulseSource | null>(null);
  const [paused, setPaused] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [quietEnvironment, setQuietEnvironment] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings(window.localStorage));
  const [reminderTimer, setReminderTimer] = useState<ReminderTimerState>(() =>
    clearFinishedTimer(loadReminderTimer(window.localStorage), Date.now()));
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDateTime, setReminderDateTime] = useState("");
  const [reminderSchedule, setReminderSchedule] = useState<ReminderSchedule>("after");
  const [reminderDuration, setReminderDuration] = useState("5");
  const [reminderDurationUnit, setReminderDurationUnit] = useState<DurationUnit>("minutes");
  const [repeatReminder, setRepeatReminder] = useState(false);
  const [timerDuration, setTimerDuration] = useState("5");
  const [timerDurationUnit, setTimerDurationUnit] = useState<DurationUnit>("minutes");
  const [activityError, setActivityError] = useState("");
  const [clockMs, setClockMs] = useState(Date.now());
  const [autoStartReady, setAutoStartReady] = useState(!isTauri());
  const [antigravityHooksEnabled, setAntigravityHooksEnabled] = useState(false);
  const [claudeHooksEnabled, setClaudeHooksEnabled] = useState(false);
  const [monitoredAppsText, setMonitoredAppsText] = useState(settings.monitoredApps.join(", "));
  const [notificationPermission, setNotificationPermission] = useState<boolean | null>(null);
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingSnapshot | null>(null);
  const [nowPlayingTitleOverflows, setNowPlayingTitleOverflows] = useState(false);
  const eventStore = useRef(new EventStore());
  const activePeekIds = useRef<string[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;
  const hoverExpanded = useRef(false);
  const hoverLeaveTimer = useRef<number | null>(null);
  const collapseDelayTimer = useRef<number | null>(null);
  const previousShellState = useRef(state);
  const exitingMessageTimers = useRef(new Map<string, number>());
  const clickPinned = useRef(false);
  const quietEnvironmentRef = useRef(false);
  const pausedRef = useRef(paused);
  const quietModeRef = useRef(quietMode);
  const hudRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nowPlayingTitleRef = useRef<HTMLSpanElement>(null);
  const nowPlayingTitleTextRef = useRef<HTMLSpanElement>(null);
  const lastAlertedActivityId = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const peekInfoRef = useRef(peekInfo);
  peekInfoRef.current = peekInfo;
  const visibleTimer = settings.reminderTimerEnabled ? reminderTimer.timer : null;
  const visibleTimerMs = visibleTimer ? timerRemainingMs(visibleTimer, clockMs) : 0;
  const showNowPlayingStrip = settings.nowPlayingEnabled && settings.nowPlayingPeekEnabled && nowPlaying?.playing === true;
  const hudShapeRef = useRef<HudShape>({
    width: createSpringAxis(motionTokens.geometry.idle.width),
    height: createSpringAxis(motionTokens.geometry.idle.height),
    radius: createSpringAxis(motionTokens.geometry.idle.radius),
    frame: null,
    lastFrame: null,
  });

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const reportHitArea = useCallback(() => {
    if (!isTauri()) return;
    const hud = hudRef.current;
    if (!hud) return;
    const bounds = hud.getBoundingClientRect();
    void invoke("update_hit_area", {
      area: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    }).catch((error: unknown) => console.warn("Could not update overlay hit area", error));
  }, []);

  const showEventPeek = (next: AppEvent, groupedEvents: AppEvent[] = [next]) => {
    const chatSource = (typeof next.meta?.sender === "string" && next.meta.sender)
      || (typeof next.meta?.app === "string" && next.meta.app)
      || "Notification";
    const chatMessages = groupedEvents.filter((event) => event.source === "chat");
    const chatApp = chatMessages.find((event) => typeof event.meta?.app === "string")?.meta?.app;
    const sender = (typeof next.meta?.sender === "string" && next.meta.sender)
      || (typeof next.meta?.app === "string" && next.meta.app)
      || next.title;
    const cardEnabled = settingsRef.current.whatsappCardEnabled;
    const incomingCall = cardEnabled && isIncomingWhatsAppCall(next);
    setPeekInfo({
      source: next.source === "ai"
        ? agentDisplayName(next.agent, next.meta)
      : next.source === "system"
        ? systemCopy.system
        : chatSource,
      message: next.source === "system"
        ? next.status === "crit" ? systemCopy.criticalAlert : systemCopy.warningAlert
        : (next.body || next.title),
      dotStatus: eventDotStatus(next),
      chatMessages,
      ...(groupedEvents.length > 1 ? {
        groupEvents: groupedEvents.slice(0, 5),
        groupEventIds: groupedEvents.map((event) => event.id),
        overflowCount: Math.max(0, groupedEvents.length - 5),
      } : {}),
      ...(typeof chatApp === "string" ? { chatApp } : {}),
      ...(cardEnabled && next.source === "chat" ? { chatSender: sender } : {}),
      ...(incomingCall ? { incomingCall: true } : {}),
      ...(next.actions && next.actionNonce ? { actionEvent: next } : {}),
    });
    activePeekIds.current = groupedEvents.map((event) => event.id);
    setPulseSource(next.source === "ai" ? "ai" : next.source);
    dispatch({ type: "set", state: "alert" });
  };

  const showNextQueuedPeek = (arrivingId?: string) => {
    if (quietEnvironmentRef.current || pausedRef.current || quietModeRef.current) return;
    if (stateRef.current === "expanded") return;
    if (!settingsRef.current.whatsappNotificationsEnabled) {
      const disabledIds = eventStore.current.pendingChatMessages(Number.POSITIVE_INFINITY)
        .filter(isWhatsAppNotification)
        .map((event) => event.id);
      if (disabledIds.length > 0) eventStore.current.dismissPeekGroup(disabledIds);
    }
    const next = eventStore.current.nextPeek();
    if (next) {
      const groupedEvents = eventStore.current.nextPeekGroup(
        undefined,
        activePeekIds.current,
        arrivingId,
      );
      if (groupedEvents.length === 0) return;
      showEventPeek(groupedEvents[0], groupedEvents);
    }
  };

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("check_notification_permission")
      .then((granted) => setNotificationPermission(granted))
      .catch((error: unknown) => console.warn("Could not check notification permission", error));
  }, []);

  useEffect(() => () => {
    const frame = hudShapeRef.current.frame;
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
    if (collapseDelayTimer.current !== null) window.clearTimeout(collapseDelayTimer.current);
    exitingMessageTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const snapToCurrentTarget = () => {
      if (!reducedMotion.matches) return;
      const hud = hudRef.current;
      const shape = hudShapeRef.current;
      if (!hud) return;
      if (shape.frame !== null) window.cancelAnimationFrame(shape.frame);
      shape.frame = null;
      shape.lastFrame = null;
      shape.width = createSpringAxis(shape.width.target);
      shape.height = createSpringAxis(shape.height.target);
      shape.radius = createSpringAxis(shape.radius.target);
      hud.style.setProperty("--hud-width", `${shape.width.position}px`);
      hud.style.setProperty("--hud-height", `${shape.height.position}px`);
      hud.style.setProperty("--hud-radius", `${shape.radius.position}px`);
      reportHitArea();
    };
    reducedMotion.addEventListener("change", snapToCurrentTarget);
    return () => reducedMotion.removeEventListener("change", snapToCurrentTarget);
  }, [reportHitArea]);

  useEffect(() => {
    if (!isTauri()) return;
    const visibleTasks = settings.codexEnabled ? tasks : tasks.filter((task) => task.source !== "codex");
    const running = visibleTasks.filter((task) => task.status === "running").length;
    const waiting = visibleTasks.filter((task) => task.status === "needs_input").length;
    void invoke("update_tray_status", { running, waiting }).catch((error: unknown) => {
      console.warn("Could not update tray status", error);
    });
  }, [tasks, settings.codexEnabled]);

  useEffect(() => {
    const oldestMessageExpiry = messages.reduce<number | undefined>((next, message) => {
      const expiresAt = message.receivedAt + CHAT_RETENTION_MS;
      return next === undefined || expiresAt < next ? expiresAt : next;
    }, undefined);
    const storeExpiry = eventStore.current.nextChatExpiry();
    const expiresAt = oldestMessageExpiry === undefined
      ? storeExpiry
      : storeExpiry === undefined ? oldestMessageExpiry : Math.min(oldestMessageExpiry, storeExpiry);
    if (expiresAt === undefined) return;

    const timer = window.setTimeout(() => {
      const now = Date.now();
      eventStore.current.expireChats(now);
      setMessages((current) => pruneExpiredMessages(current, now));
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [messages]);

  const requestNotificationPermission = () => {
    if (!isTauri()) return;
    void invoke<boolean>("request_notification_permission")
      .then((granted) => setNotificationPermission(granted))
      .catch((error: unknown) => console.warn("Could not request notification permission", error));
  };

  useEffect(() => {
    quietEnvironmentRef.current = quietEnvironment;
  }, [quietEnvironment]);

  useEffect(() => {
    if (settings.whatsappNotificationsEnabled || !/whatsapp/i.test(peekInfo.chatApp ?? "")
        || (state !== "alert" && state !== "peek")) return;
    if (peekInfo.chatMessages.length > 0) {
      eventStore.current.dismissPeekGroup(peekInfo.chatMessages.map((message) => message.id));
      activePeekIds.current = activePeekIds.current.filter((id) =>
        !peekInfo.chatMessages.some((message) => message.id === id));
    }
    dispatch({ type: "dismiss" });
    setPulseSource(null);
    showNextQueuedPeek();
  }, [settings.whatsappNotificationsEnabled, state, peekInfo]);

  useEffect(() => {
    pausedRef.current = paused;
    quietModeRef.current = quietMode;
    if (!paused && !quietMode) showNextQueuedPeek();
  }, [paused, quietMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("dot-notifier-settings", JSON.stringify(settings));
    } catch (error) {
      console.warn("Could not save Dot Notifier settings", error);
    }
  }, [settings]);

  useEffect(() => {
    if (isTauri()) {
      void invoke("set_codex_enabled", { enabled: settings.codexEnabled })
        .catch((error: unknown) => console.warn("Could not update Codex integration", error));
    }
    if (settings.codexEnabled) return;

    const codexEvents = eventStore.current.all().filter((event) => event.source === "ai" && event.agent === "codex");
    const codexIds = new Set(codexEvents.map((event) => event.id));
    const activePeek = peekInfoRef.current;
    const activeCodexPeek = activePeekIds.current.some((id) => codexIds.has(id))
      || activePeek.source === "Codex"
      || activePeek.actionEvent?.agent === "codex"
      || activePeek.groupEvents?.some((event) => event.agent === "codex") === true;
    codexEvents.forEach((event) => eventStore.current.dismiss(event.id));
    activePeekIds.current = activePeekIds.current.filter((id) => !codexIds.has(id));
    setTasks((current) => current.filter((task) => task.source !== "codex"));
    if (activeCodexPeek) {
      dispatch({ type: "dismiss" });
      setPulseSource(null);
      showNextQueuedPeek();
    }
  }, [settings.codexEnabled]);

  useEffect(() => {
    try {
      saveReminderTimer(window.localStorage, reminderTimer);
    } catch (error) {
      console.warn("Could not save reminder and timer settings", error);
    }
  }, [reminderTimer]);

  useEffect(() => {
    setReminderTimer((current) => clearFinishedTimer(current, clockMs));
  }, [clockMs]);

  useEffect(() => {
    if (!settings.reminderTimerEnabled) return;
    const timer = reminderTimer.timer;
    const runningTimerRemaining = timer?.remainingMs === null
      ? timer.endsAt - clockMs : null;
    const reminderDelay = nextReminderDelayMs(reminderTimer.reminders, clockMs);
    const delay = runningTimerRemaining !== null && runningTimerRemaining > 0
      ? Math.min(1_000, runningTimerRemaining)
      : reminderDelay;
    if (delay === null) return;
    const timeout = window.setTimeout(() => setClockMs(Date.now()), Math.max(1, delay));
    return () => window.clearTimeout(timeout);
  }, [settings.reminderTimerEnabled, reminderTimer, clockMs]);

  useEffect(() => {
    if (!settings.reminderTimerEnabled || state !== "idle" || paused || quietMode || quietEnvironment) return;
    const due = nextDueActivity(reminderTimer, clockMs);
    const dueKey = due ? `${due.id}:${due.dueAt}` : null;
    if (!due || lastAlertedActivityId.current === dueKey) return;
    lastAlertedActivityId.current = dueKey;
    setReminderTimer((current) => acknowledgeDueReminder(current, due.id, clockMs));
    setPeekInfo({
      source: settingsCopy.reminder,
      message: due.title,
      dotStatus: "done",
      chatMessages: [],
    });
    setPulseSource(null);
    dispatch({ type: "set", state: "alert" });
  }, [settings.reminderTimerEnabled, reminderTimer, clockMs, state, paused, quietMode, quietEnvironment]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void invoke<boolean>("get_auto_start")
      .then((enabled) => {
        if (active) setSettings((current) => ({ ...current, autoStart: enabled }));
      })
      .catch((error: unknown) => {
        console.warn("Could not read auto-start status", error);
        if (active) setSettings((current) => ({ ...current, autoStart: false }));
      })
      .finally(() => {
        if (active) setAutoStartReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("get_antigravity_hooks_enabled")
      .then(setAntigravityHooksEnabled)
      .catch((error: unknown) => console.warn("Could not read Antigravity hook status", error));
    void invoke<boolean>("get_claude_hooks_enabled")
      .then(setClaudeHooksEnabled)
      .catch((error: unknown) => console.warn("Could not read Claude hook status", error));
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setMonitors([{ key: "mock-display", label: "Mock display", width: 1920, height: 1080 }]);
      return;
    }
    void invoke<MonitorOption[]>("list_monitors").then((available) => {
      setMonitors(available);
      const monitorKey = available.some((monitor) => monitor.key === settings.monitorKey)
        ? settings.monitorKey
        : available[0]?.key ?? null;
      setSettings((current) => ({ ...current, monitorKey }));
    }).catch((error: unknown) => console.warn("Could not list displays", error));
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_placement", {
      corner: settings.corner,
      monitorKey: settings.monitorKey,
    }).catch((error: unknown) => console.warn("Could not update overlay placement", error));
  }, [settings.corner, settings.monitorKey]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_allow_during_fullscreen", { enabled: settings.allowDuringFullscreen })
      .catch((error: unknown) => console.warn("Could not update fullscreen overlay setting", error));
  }, [settings.allowDuringFullscreen]);

  useEffect(() => {
    if (!isTauri()) return;
    const timer = window.setTimeout(() => {
      void invoke("set_monitored_apps", { apps: settings.monitoredApps })
        .catch((error: unknown) => console.warn("Could not update notification app filter", error));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settings.monitoredApps]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("is_quiet_environment", {
      allowDuringFullscreen: settings.allowDuringFullscreen,
    })
      .then((quiet) => {
        quietEnvironmentRef.current = quiet;
        setQuietEnvironment(quiet);
        if (quiet) dispatch({ type: "set", state: "idle" });
      })
      .catch((error: unknown) => console.warn("Could not read Windows notification state", error));
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<boolean>("quiet-environment", ({ payload }) => {
      quietEnvironmentRef.current = payload;
      setQuietEnvironment(payload);
      if (payload && (state === "alert" || state === "peek")) {
        clickPinned.current = false;
        hoverExpanded.current = false;
        dispatch({ type: "set", state: "idle" });
      } else if (!payload) {
        quietEnvironmentRef.current = false;
        showNextQueuedPeek();
      }
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [state, settings.allowDuringFullscreen]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_system_panel_open", { open: state === "expanded" })
      .catch((error: unknown) => console.warn("Could not update system monitor polling", error));
  }, [state]);

  useEffect(() => {
    const peekCanShow = settings.nowPlayingPeekEnabled && state !== "expanded";
    if (!settings.nowPlayingEnabled || (state !== "expanded" && !peekCanShow) || settingsOpen) {
      setNowPlaying(null);
      return;
    }
    if (!isTauri()) {
      setNowPlaying({ title: "Midnight City", artist: "M83", playing: true, coverDataUrl: null });
      return;
    }
    let disposed = false;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      void invoke<NowPlayingSnapshot | null>("get_now_playing", {
        allowBrowserMedia: settings.nowPlayingBrowserMediaEnabled,
      })
        .then((snapshot) => { if (!disposed) setNowPlaying(snapshot); })
        .catch((error: unknown) => console.warn("Could not read Windows media session", error))
        .finally(() => { pending = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings.nowPlayingEnabled, settings.nowPlayingPeekEnabled, settings.nowPlayingBrowserMediaEnabled, settingsOpen, state]);

  const controlNowPlaying = (action: "play" | "pause" | "next") => {
    if (!isTauri()) {
      setNowPlaying((current) => current ? { ...current, playing: action === "play" } : current);
      return;
    }
    void invoke("control_now_playing", {
      action,
      allowBrowserMedia: settingsRef.current.nowPlayingBrowserMediaEnabled,
    }).then(() => {
      if (action !== "next") setNowPlaying((current) => current ? { ...current, playing: action === "play" } : current);
    }).catch((error: unknown) => console.warn("Could not control Windows media session", error));
  };

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ paused?: boolean; quietMode?: boolean; openSettings?: boolean }>("tray-controls", ({ payload }) => {
      if (payload.paused !== undefined) setPaused(payload.paused);
      if (payload.quietMode !== undefined) setQuietMode(payload.quietMode);
      if (payload.openSettings) {
        setSettingsOpen(true);
        clickPinned.current = false;
        hoverExpanded.current = false;
        dispatch({ type: "set", state: "expanded" });
      }
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<AppEvent>("bus-event", ({ payload }) => {
      if (payload.source === "ai" && payload.agent === "codex" && !settingsRef.current.codexEnabled) return;
      if (payload.source !== "chat" || payload.kind !== "message") eventStore.current.upsert(payload);
      if (payload.source === "system" && payload.kind === "metric") {
        const nextMetrics = parseSystemMetrics(payload.meta);
        if (nextMetrics) setSystemMetrics(nextMetrics);
        if (payload.status === undefined) return;
      }
      if (payload.source === "ai"
          && (payload.agent === "codex" || payload.agent === "claude" || payload.agent === "antigravity-app" || payload.agent === "antigravity-cli" || payload.agent === "antigravity-ide" || payload.agent === "external")
          && payload.kind === "task"
          && (payload.status === "running" || payload.status === "done"
            || payload.status === "error" || payload.status === "needs_input")) {
        const task: DemoTask = {
          id: payload.id,
          source: payload.agent,
          name: payload.agent === "external"
            ? agentDisplayName(payload.agent, payload.meta)
            : `${agentDisplayName(payload.agent)} · ${payload.id.slice(0, 8)}`,
          status: payload.status,
          title: payload.title,
          ...(payload.body ? { detail: payload.body } : {}),
          progress: payload.progress ?? (payload.status === "done" ? 1 : 0),
          ...(payload.startedAt && Number.isFinite(Date.parse(payload.startedAt))
            ? { startedAt: Date.parse(payload.startedAt) }
            : {}),
          ...(payload.pid !== undefined ? { pid: payload.pid } : {}),
          ...(payload.cwd ? { cwd: payload.cwd } : {}),
          ...(payload.usage ? { usage: payload.usage } : {}),
        };
        setTasks((current) => upsertTask(current, task));
      }
      if (payload.source === "chat" && payload.kind === "message") {
        const receivedAt = Date.now();
        eventStore.current.upsert(payload, receivedAt);
        const sender = (typeof payload.meta?.sender === "string" && payload.meta.sender)
          || (typeof payload.meta?.app === "string" && payload.meta.app)
          || payload.title;
        const body = payload.body || payload.title;
        setMessages((current) => upsertChatMessage(current, {
          id: payload.id,
          receivedAt,
          createdAt: eventCreatedAtMs(payload, receivedAt),
          sender,
          body,
          unread: true,
          ...(typeof payload.meta?.app === "string" ? { app: payload.meta.app } : {}),
        }));
      }

      showNextQueuedPeek(payload.id);
    }).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const hud = hudRef.current;
    if (!hud) return;
    const observer = new ResizeObserver(() => {
      if (hudShapeRef.current.frame === null) reportHitArea();
    });
    observer.observe(hud);
    reportHitArea();
    return () => observer.disconnect();
  }, [reportHitArea]);

  useEffect(() => {
    if (state === "expanded" && activePeekIds.current.length > 0
        && !peekInfo.actionEvent && !peekInfo.groupEvents?.some((event) => event.status === "needs_input")) {
      eventStore.current.dismissPeekGroup(activePeekIds.current);
      activePeekIds.current = [];
    } else if (state === "idle") {
      activePeekIds.current = [];
    }
  }, [state, peekInfo]);

  useEffect(() => {
    if (state === "alert") {
      const timer = window.setTimeout(() => dispatch({ type: "set", state: "peek" }), 240);
      return () => window.clearTimeout(timer);
    }

    if (state === "peek" && (peekInfo.actionEvent
        || peekInfo.groupEvents?.some((event) => event.status === "needs_input"))) return;

    if (state === "peek") {
      const timer = window.setTimeout(() => {
        const groupedIds = peekInfo.groupEventIds ?? activePeekIds.current;
        if (groupedIds.length > 0) eventStore.current.dismissPeekGroup(groupedIds);
        else eventStore.current.dismissPeek();
        activePeekIds.current = [];
        if (eventStore.current.nextPeek()) {
          showNextQueuedPeek();
        } else {
          dispatch({ type: "dismiss" });
          setPulseSource(null);
        }
      }, peekInfo.groupEvents ? Math.max(6_000, settings.peekDurationSeconds * 1000)
        : settings.peekDurationSeconds * 1000);
      return () => window.clearTimeout(timer);
    }
  }, [state, settings.peekDurationSeconds, peekInfo]);

  useEffect(() => {
    const updateProximity = (event: globalThis.MouseEvent) => {
      const hud = hudRef.current;
      if (!hud) return;
      const bounds = hud.getBoundingClientRect();
      const dx = Math.max(bounds.left - event.clientX, 0, event.clientX - bounds.right);
      const dy = Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom);
      const opacity = 0.5 + 0.5 * Math.max(0, 1 - Math.hypot(dx, dy) / 100);
      hud.style.setProperty("--hud-opacity", opacity.toFixed(2));
    };

    window.addEventListener("mousemove", updateProximity);
    return () => window.removeEventListener("mousemove", updateProximity);
  }, []);

  useLayoutEffect(() => {
    const hud = hudRef.current;
    if (!hud) return;
    const previousState = previousShellState.current;
    previousShellState.current = state;
    if (state !== "idle" && collapseDelayTimer.current !== null) {
      window.clearTimeout(collapseDelayTimer.current);
      collapseDelayTimer.current = null;
    }

    let width: number;
    let height: number = motionTokens.geometry.idle.height;
    let radius: number = motionTokens.geometry.idle.radius;
    if (state === "peek") {
      width = motionTokens.geometry.peek.width;
      height = (peekInfo.groupEvents?.length ?? 0) > 1
        ? motionTokens.geometry.tallPeek.multiMessageBase
          + (peekInfo.groupEvents?.length ?? 0) * motionTokens.geometry.tallPeek.rowHeight
          + ((peekInfo.overflowCount ?? 0) > 0 ? 24 : 0)
        : peekInfo.incomingCall ? motionTokens.geometry.tallPeek.call
          : peekInfo.chatSender ? motionTokens.geometry.tallPeek.chat
            : peekInfo.actionEvent ? motionTokens.geometry.tallPeek.approval
              : motionTokens.geometry.peek.height;
      radius = motionTokens.geometry.peek.radius;
    } else if (state === "expanded" && panelRef.current) {
      width = motionTokens.geometry.expanded.width;
      height = panelRef.current.clientHeight;
      radius = motionTokens.geometry.expanded.radius;
    } else {
      width = showNowPlayingStrip
        ? visibleTimer ? motionTokens.geometry.activityWidth.withNowPlayingAndTimer
          : motionTokens.geometry.activityWidth.withNowPlaying
        : visibleTimer ? motionTokens.geometry.activityWidth.timer
          : motionTokens.geometry.idle.width;
    }

    const shape = hudShapeRef.current;
    if (state === "idle" && collapseDelayTimer.current !== null) return;
    if (
      shape.frame === null
      && shape.width.target === width
      && shape.height.target === height
      && shape.radius.target === radius
      && isSpringAxisSettled(shape.width)
      && isSpringAxisSettled(shape.height)
      && isSpringAxisSettled(shape.radius)
    ) return;

    const startAnimation = () => {
      shape.width = retargetSpringAxis(shape.width, width);
      shape.height = retargetSpringAxis(shape.height, height);
      shape.radius = retargetSpringAxis(shape.radius, radius);

      const applyShape = () => {
        hud.style.setProperty("--hud-width", `${shape.width.position}px`);
        hud.style.setProperty("--hud-height", `${shape.height.position}px`);
        hud.style.setProperty("--hud-radius", `${shape.radius.position}px`);
        reportHitArea();
      };

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        if (shape.frame !== null) window.cancelAnimationFrame(shape.frame);
        shape.frame = null;
        shape.lastFrame = null;
        shape.width = createSpringAxis(width);
        shape.height = createSpringAxis(height);
        shape.radius = createSpringAxis(radius);
        applyShape();
        return;
      }

      if (shape.frame === null) {
        const animate = (now: number) => {
          const deltaSeconds = shape.lastFrame === null ? 1 / 60 : (now - shape.lastFrame) / 1000;
          shape.lastFrame = now;
          shape.width = advanceSpringAxis(shape.width, deltaSeconds, motionTokens.spring.morph);
          shape.height = advanceSpringAxis(shape.height, deltaSeconds, motionTokens.spring.morph);
          shape.radius = advanceSpringAxis(shape.radius, deltaSeconds, motionTokens.spring.morph);
          applyShape();

          if (isSpringAxisSettled(shape.width) && isSpringAxisSettled(shape.height) && isSpringAxisSettled(shape.radius)) {
            shape.frame = null;
            shape.lastFrame = null;
            return;
          }
          shape.frame = window.requestAnimationFrame(animate);
        };
        shape.frame = window.requestAnimationFrame(animate);
      }
    };

    const isLeavingContent = state === "idle" && (previousState === "peek" || previousState === "expanded");
    if (isLeavingContent) {
      collapseDelayTimer.current = window.setTimeout(() => {
        collapseDelayTimer.current = null;
        startAnimation();
      }, motionTokens.timing.contentOutMs);
      return;
    }
    startAnimation();
  }, [state, tasks, messages, peekInfo, systemMetrics, settingsOpen, settings.reminderTimerEnabled, reminderTimer, activityError, showNowPlayingStrip, nowPlaying, visibleTimer, clockMs, reportHitArea]);

  useLayoutEffect(() => {
    const viewport = nowPlayingTitleRef.current;
    const title = nowPlayingTitleTextRef.current;
    if (!viewport || !title) {
      setNowPlayingTitleOverflows(false);
      return;
    }
    const updateOverflow = () => setNowPlayingTitleOverflows(title.scrollWidth > viewport.clientWidth + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(title);
    return () => observer.disconnect();
  }, [nowPlaying?.title, settings.nowPlayingEnabled, settings.nowPlayingPeekEnabled]);

  const visibleTasks = settings.codexEnabled ? tasks : tasks.filter((task) => task.source !== "codex");
  const codexRows = settings.codexEnabled ? primaryCodexTaskRows(visibleTasks) : [];
  const codex = codexRows[0] ?? initialTasks[0];
  const claudeTasks = tasks.filter((task) => task.source === "claude");
  const activeClaudeTasks = claudeTasks
    .filter((task) => task.status === "running" || task.status === "needs_input")
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0));
  const claudeRows = activeClaudeTasks.length > 0
    ? activeClaudeTasks
    : [...claudeTasks].sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0)).slice(0, 1);
  if (claudeRows.length === 0 && claudeHooksEnabled) {
    claudeRows.push({
      id: "claude-idle",
      source: "claude",
      name: "Claude",
      status: "idle",
      title: settingsCopy.noActiveTask,
      progress: 0,
    });
  }
  const antigravityTasks = tasks.filter((task) => task.source === "antigravity-app" || task.source === "antigravity-cli" || task.source === "antigravity-ide");
  const externalTasks = tasks.filter((task) => task.source === "external");
  const activeAntigravityTasks = antigravityTasks
    .filter((task) => task.status === "running" || task.status === "needs_input")
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0));
  const antigravityRows = activeAntigravityTasks.length > 0
    ? activeAntigravityTasks
    : [...antigravityTasks].sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0)).slice(0, 1);
  if (antigravityRows.length === 0 && antigravityHooksEnabled) {
    antigravityRows.push({
      id: "antigravity-idle",
      source: "antigravity-ide",
      name: "Antigravity",
      status: "idle",
      title: settingsCopy.noActiveTask,
      progress: 0,
    });
  }
  const taskGroups = [
    ...(settings.codexEnabled ? [{ name: "Codex", rows: codexRows.length > 0 ? codexRows : [codex] }] : []),
    ...(claudeRows.length > 0 ? [{ name: "Claude", rows: claudeRows }] : []),
    ...(antigravityRows.length > 0 ? [{ name: "Antigravity", rows: antigravityRows }] : []),
    ...(externalTasks.length > 0 ? [{ name: settingsCopy.externalAgents, rows: externalTasks }] : []),
  ];
  const aiStatus = aggregateTaskStatus(visibleTasks);
  const aiHasRunning = visibleTasks.some((task) => task.status === "running");
  const isOpen = state === "expanded";
  const systemLoad = [systemMetrics.current.cpuPercent, systemMetrics.current.gpuPercent]
    .filter((value): value is number => value !== null)
    .reduce((highest, value) => Math.max(highest, value), 0);
  const systemStatus: DotStatus = systemMetrics.current.gpuTemperatureC !== null && systemMetrics.current.gpuTemperatureC > 90
    || systemLoad > 90 ? "crit"
    : systemMetrics.current.gpuTemperatureC !== null && systemMetrics.current.gpuTemperatureC > 80
      || (systemMetrics.current.memoryPercent ?? 0) > 90 ? "warn"
      : systemLoad > 0 ? "running" : "idle";

  const showPeek = (source: PulseSource, sourceName: string, message: string, dotStatus: DotStatus) => {
    if (paused || quietMode || quietEnvironment) return;
    setPeekInfo({ source: sourceName, message, dotStatus, chatMessages: [] });
    setPulseSource(source);
    dispatch({ type: "set", state: "alert" });
  };

  const addReminder = () => {
    const title = reminderTitle.trim();
    const now = Date.now();
    const durationMs = durationToMs(Number(reminderDuration), reminderDurationUnit);
    const dueAt = reminderSchedule === "after"
      ? durationMs === null ? Number.NaN : now + durationMs
      : new Date(reminderDateTime).getTime();
    if (!title || !Number.isFinite(dueAt) || dueAt <= now
      || (reminderSchedule === "after" && durationMs === null)) {
      setActivityError(settingsCopy.reminderInvalid);
      return;
    }
    if (reminderTimer.reminders.length >= maxReminders) {
      setActivityError(settingsCopy.reminderLimit);
      return;
    }
    setReminderTimer((current) => ({
      ...current,
      reminders: [...current.reminders, {
        id: crypto.randomUUID(),
        title: title.slice(0, 80),
        dueAt,
        notified: false,
        relative: reminderSchedule === "after",
        repeatMs: reminderSchedule === "after" && repeatReminder ? durationMs : null,
      }].sort((left, right) => left.dueAt - right.dueAt),
    }));
    setReminderTitle("");
    setReminderDateTime("");
    setRepeatReminder(false);
    setActivityError("");
    setClockMs(now);
  };

  const startTimer = () => {
    const durationMs = durationToMs(Number(timerDuration), timerDurationUnit);
    if (durationMs === null) {
      setActivityError(settingsCopy.timerInvalid);
      return;
    }
    const now = Date.now();
    setReminderTimer((current) => ({
      ...current,
      timer: { id: crypto.randomUUID(), endsAt: now + durationMs, remainingMs: null, notified: false },
    }));
    setActivityError("");
    setClockMs(now);
  };

  const toggleTimerPause = () => {
    const now = Date.now();
    setReminderTimer((current) => {
      const timer = current.timer;
      if (!timer || timerRemainingMs(timer, now) === 0) return current;
      return {
        ...current,
        timer: timer.remainingMs === null
          ? { ...timer, remainingMs: timerRemainingMs(timer, now) }
          : { ...timer, endsAt: now + timer.remainingMs, remainingMs: null },
      };
    });
    setClockMs(now);
  };

  const startTask = () => {
    if (!settingsRef.current.codexEnabled) return;
    const startedAt = Date.now();
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "running", title: "database migration", progress: 0.42, startedAt }
      : task));
    showPeek("codex", "Codex", "Starting: database migration", "running");
  };

  const finishTask = () => {
    if (!settingsRef.current.codexEnabled) return;
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "done", progress: 1 }
      : task));
    showPeek("codex", "Codex", `${codex.title} completed`, "done");
  };

  const failTask = () => {
    if (!settingsRef.current.codexEnabled) return;
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "error" }
      : task));
    showPeek("codex", "Codex", `${codex.title} failed: 2 tests failed`, "error");
  };

  const receiveMessage = () => {
    const template = incomingMessages[messageIndex % incomingMessages.length];
    setMessageIndex((index) => index + 1);
    const message: DemoMessage = {
      ...template,
      id: `mock-chat-${Date.now()}-${messageIndex}`,
      receivedAt: Date.now(),
      createdAt: Date.now(),
      unread: true,
      app: "WhatsApp",
    };
    setMessages((current) => upsertChatMessage(current, message));
    eventStore.current.upsert({
      id: message.id,
      source: "chat",
      kind: "message",
      status: "unread",
      title: message.sender,
      body: message.body,
      startedAt: new Date(message.createdAt).toISOString(),
      meta: { app: "WhatsApp", sender: message.sender },
    }, message.receivedAt);
    showNextQueuedPeek();
  };

  const receiveMockCall = () => {
    const id = `mock-call-${Date.now()}`;
    const event: AppEvent = {
      id,
      source: "chat",
      kind: "message",
      status: "unread",
      title: "Rina",
      body: "Incoming voice call",
      meta: { app: "WhatsApp", sender: "Rina" },
    };
    eventStore.current.upsert(event);
    showNextQueuedPeek(event.id);
  };

  const showMockAntigravityTask = (source: "antigravity-app" | "antigravity-cli" | "antigravity-ide") => {
    const id = source === "antigravity-cli"
      ? "a0a0a0a0-0000-4000-8000-000000000044"
      : source === "antigravity-app"
      ? "a0a0a0a0-0000-4000-8000-000000000046"
      : "a0a0a0a0-0000-4000-8000-000000000045";
    const agentName = agentDisplayName(source);
    const previous = tasks.find((task) => task.id === id);
    const status = previous?.status === "running" ? "done" : "running";
    setTasks((current) => {
      return upsertTask(current, {
        id,
        source,
        name: `${agentName} · ${id.slice(0, 8)}`,
        status,
        title: `${agentName} task ${status === "running" ? "running" : "completed"}`,
        progress: status === "done" ? 1 : 0.6,
        startedAt: previous?.startedAt ?? Date.now(),
      });
    });
    showPeek("ai", agentName, `${agentName} task ${status === "running" ? "running" : "completed"}`, status);
  };

  const showMockClaudeTask = () => {
    const id = "mock-claude-session";
    const previous = tasks.find((task) => task.id === id);
    const status = previous?.status === "running" ? "needs_input"
      : previous?.status === "needs_input" ? "done" : "running";
    const title = status === "running" ? "Claude is working"
      : status === "done" ? "Claude task completed" : "Claude is waiting for you";
    setTasks((current) => upsertTask(current, {
      id,
      source: "claude",
      name: "Claude · mock-claude",
      status,
      title,
      progress: status === "done" ? 1 : 0.6,
      startedAt: previous?.startedAt ?? Date.now(),
    }));
    showPeek("ai", "Claude", title, status);
  };

  const showMockExternalTask = () => {
    const id = "mock-external-session";
    const previous = tasks.find((task) => task.id === id);
    const status = previous?.status === "running" ? "needs_input"
      : previous?.status === "needs_input" ? "done" : "running";
    const title = status === "running" ? "Example Agent task running"
      : status === "done" ? "Example Agent task completed" : "Example Agent needs your input";
    setTasks((current) => upsertTask(current, {
      id,
      source: "external",
      name: "Example Agent · mock-external",
      status,
      title,
      progress: status === "done" ? 1 : 0,
      startedAt: previous?.startedAt ?? Date.now(),
    }));
    showPeek("ai", "Example Agent", title, status);
  };

  const showMockReminderTimer = () => {
    const now = Date.now();
    setSettings((current) => ({ ...current, nowPlayingEnabled: true, nowPlayingPeekEnabled: true, reminderTimerEnabled: true }));
    setReminderTimer({
      reminders: [{ id: crypto.randomUUID(), title: "Drink water", dueAt: now + 15 * 60_000, notified: false, relative: true, repeatMs: 15 * 60_000 }],
      timer: { id: crypto.randomUUID(), endsAt: now + 5 * 60_000, remainingMs: null, notified: false },
    });
    setClockMs(now);
    dispatch({ type: "set", state: "idle" });
  };

  const showMockAgentBurst = () => {
    const receivedAt = Date.now();
    const sessionId = `mock-agent-burst-${receivedAt}`;
    eventStore.current.upsert({
      id: `mock-codex-${receivedAt}`,
      source: "ai",
      agent: "codex",
      sessionId: `${sessionId}-codex`,
      kind: "task",
      status: "done",
      title: "Database migration completed",
    }, receivedAt);
    eventStore.current.upsert({
      id: `mock-antigravity-${receivedAt}`,
      source: "ai",
      agent: "antigravity-cli",
      sessionId: `${sessionId}-antigravity`,
      kind: "task",
      status: "needs_input",
      title: "Package installation needs permission",
    }, receivedAt);
    showNextQueuedPeek();
  };

  const showMockMixedBurst = () => {
    const receivedAt = Date.now();
    const chatId = `mock-mixed-chat-${receivedAt}`;
    const taskId = `mock-mixed-ai-${receivedAt}`;
    eventStore.current.upsert({
      id: taskId,
      source: "ai",
      agent: "antigravity-app",
      sessionId: `mock-mixed-session-${receivedAt}`,
      kind: "task",
      status: "done",
      title: "Antigravity App task completed",
    }, receivedAt);
    eventStore.current.upsert({
      id: chatId,
      source: "chat",
      kind: "message",
      status: "unread",
      title: "Rina",
      body: "Can you check the latest draft?",
      meta: { app: "WhatsApp", sender: "Rina" },
    }, receivedAt + 100);
    setTasks((current) => upsertTask(current, {
      id: taskId,
      source: "antigravity-app",
      name: "Antigravity App",
      status: "done",
      title: "Antigravity App task completed",
      progress: 1,
      startedAt: receivedAt,
    }));
    setMessages((current) => upsertChatMessage(current, {
      id: chatId,
      sender: "Rina",
      body: "Can you check the latest draft?",
      receivedAt,
      createdAt: receivedAt,
      unread: true,
      app: "WhatsApp",
    }));
    showNextQueuedPeek();
  };

  const showMockSystemAlert = () => {
    const current = mockSystemAlert(systemMetrics.current);
    const history = [...systemMetrics.history, current].slice(-60);
    setSystemMetrics({ current, history });
    const event: AppEvent = {
      id: `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`,
      source: "system",
      kind: "metric",
      status: "crit",
      title: "High system load",
      meta: { current },
    };
    eventStore.current.upsert(event);
    setPeekInfo({ source: systemCopy.system, message: systemCopy.criticalAlert, dotStatus: "crit", chatMessages: [] });
    setPulseSource("system");
    dispatch({ type: "set", state: "alert" });
  };

  const showMockPermissionRequest = () => {
    const id = "550e8400-e29b-41d4-a716-446655440099";
    const event: AppEvent = {
      id,
      source: "ai",
      agent: "codex",
      sessionId: id,
      kind: "task",
      status: "needs_input",
      title: "Codex is waiting for permission",
      actions: ["approve", "reject"],
      actionNonce: "mock-nonce",
    };
    eventStore.current.upsert(event);
    setPeekInfo({ source: "Codex", message: event.title, dotStatus: "needs_input", chatMessages: [], actionEvent: event });
    setPulseSource("codex");
    dispatch({ type: "set", state: "alert" });
  };

  const clearUnread = () => {
    setMessages((current) => current.map((message) => ({ ...message, unread: false })));
    setPulseSource(null);
    dispatch({ type: "set", state: "idle" });
  };

  const clearAllWhatsAppMessages = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const ids = new Set(messages.filter((message) => isWhatsAppApp(message.app)).map((message) => message.id));
    if (ids.size === 0) return;
    ids.forEach((id) => {
      eventStore.current.dismiss(id);
      const timer = exitingMessageTimers.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      exitingMessageTimers.current.delete(id);
    });
    activePeekIds.current = activePeekIds.current.filter((id) => !ids.has(id));
    setMessages((current) => removeWhatsAppMessages(current));
    setExitingMessages((current) => current.filter((id) => !ids.has(id)));
    const otherUnreadRemains = messages.some((message) => !ids.has(message.id) && message.unread);
    if (!otherUnreadRemains) setPulseSource((current) => current === "chat" ? null : current);
  };

  const dismissMessage = (id: string) => {
    eventStore.current.dismiss(id);
    if (exitingMessageTimers.current.has(id)) return;
    setExitingMessages((current) => [...current, id]);
    const timer = window.setTimeout(() => {
      setMessages((current) => current.filter((message) => message.id !== id));
      setExitingMessages((current) => current.filter((messageId) => messageId !== id));
      exitingMessageTimers.current.delete(id);
    }, motionTokens.timing.rowExitMs);
    exitingMessageTimers.current.set(id, timer);
    if (unreadCount <= 1) {
      setPulseSource((current) => current === "chat" ? null : current);
      if (pulseSource === "chat") dispatch({ type: "dismiss" });
    }
  };

  const onHudClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
    hoverLeaveTimer.current = null;
    if (isOpen) {
      clickPinned.current = false;
      hoverExpanded.current = false;
      dispatch({ type: "set", state: "idle" });
      return;
    }
    hoverExpanded.current = false;
    clickPinned.current = true;
    dispatch({ type: "set", state: "expanded" });
  };

  const onHudKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
      hoverLeaveTimer.current = null;
      clickPinned.current = false;
      hoverExpanded.current = false;
      dispatch({ type: "set", state: "idle" });
      return;
    }
    if (isHudToggleShortcut(event.key, event.target === event.currentTarget)) {
      event.preventDefault();
      if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
      hoverLeaveTimer.current = null;
      clickPinned.current = !isOpen;
      hoverExpanded.current = false;
      dispatch({ type: "set", state: isOpen ? "idle" : "expanded" });
    }
  };

  const taskGroupRow = (group: { name: string; rows: DemoTask[] }, index: number) => {
    const indicatorOrder: Record<DemoStatus, number> = {
      needs_input: 0,
      error: 1,
      running: 2,
      done: 3,
      idle: 4,
    };
    const indicator = [...group.rows].sort((left, right) => indicatorOrder[left.status] - indicatorOrder[right.status])[0];
    return (
      <div className="row task-agent-row" key={group.name} style={{ "--row-index": index } as CSSProperties}>
        <Dot status={indicator?.status ?? "idle"} />
        <div className="tx">
          <b>{group.name}</b>
          {group.rows.map((task) => {
            const title = task.detail ?? task.title;
            const subtitle = task.status === "running"
              ? `${title} · ${durationLabel(task.startedAt)}`
              : task.status === "idle"
                ? title
                : `${title} · ${statusLabels[task.status]}`;
            const focusTask = () => {
              if (!isTauri() || task.pid === undefined) return;
              void invoke("focus_process", { pid: task.pid }).catch((error: unknown) => {
                console.warn("Could not focus task window", error);
              });
            };

            return (
              <button className="task-summary" disabled={task.pid === undefined || !isTauri()} key={task.id} onClick={(event) => {
                event.stopPropagation();
                focusTask();
              }} type="button">
                <span>{subtitle}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <main className={`overlay-stage${isMockMode ? " preview-background" : ""}`}>
      {isMockMode && (
        <p className="hint">
          <b>Dot Notifier</b>
          Hover over a dot or trigger an event with the buttons below. On touch screens, tap a dot.
          {(paused || quietMode) && <span className="tray-status">{paused ? "Notifications paused" : "Quiet mode"}</span>}
        </p>
      )}

      <section
        aria-label={`Dot Notifier ${state} view`}
        aria-live="polite"
        className={`hud corner-${settings.corner}`}
        data-s={state === "expanded" ? "open" : state}
        onClick={onHudClick}
        onKeyDown={onHudKeyDown}
        onMouseEnter={() => {
          if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
          hoverLeaveTimer.current = null;
          if (clickPinned.current) return;
          hoverExpanded.current = true;
          dispatch({ type: "hover", active: true });
        }}
        onMouseLeave={() => {
          if (!hoverExpanded.current || clickPinned.current) return;
          if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
          hoverLeaveTimer.current = window.setTimeout(() => {
            hoverExpanded.current = false;
            hoverLeaveTimer.current = null;
            if (peekInfo.actionEvent || peekInfo.groupEvents?.some((event) => event.status === "needs_input")) {
              dispatch({ type: "set", state: "peek" });
            } else {
              dispatch({ type: "hover", active: false });
            }
          }, motionTokens.timing.hoverLeaveDelayMs);
        }}
        ref={hudRef}
        role="button"
        tabIndex={0}
      >
        <div className="hud-content">
        <div className={`layer dots${showNowPlayingStrip || visibleTimer ? " dots-with-activity" : ""}`}>
          {showNowPlayingStrip && nowPlaying && (
            <span className="now-playing-peek" title={`${settingsCopy.nowPlaying} — ${nowPlaying.title}`}>
              <span className="now-playing-peek-prefix">{visibleTimer ? settingsCopy.nowPlayingShort : settingsCopy.nowPlaying} —</span>
              <span aria-label={nowPlaying.title} className="now-playing-title-viewport" ref={nowPlayingTitleRef}>
                <span className={`now-playing-title-track${nowPlayingTitleOverflows ? " is-scrolling" : ""}`}>
                  <span ref={nowPlayingTitleTextRef}>{nowPlaying.title}</span>
                  {nowPlayingTitleOverflows && <span aria-hidden="true">{nowPlaying.title}</span>}
                </span>
              </span>
            </span>
          )}
          {visibleTimer && (
            <span
              className={`activity-peek timer-peek${visibleTimerMs === 0 ? " is-due" : ""}`}
              title={`${settingsCopy.timer}: ${visibleTimer.remainingMs !== null ? settingsCopy.timerPaused : formatCountdown(visibleTimerMs)}`}
              aria-label={`${settingsCopy.timer}: ${visibleTimer.remainingMs !== null ? settingsCopy.timerPaused : formatCountdown(visibleTimerMs)}`}
              aria-live="off"
            >
              <b>{settingsCopy.timer}</b>
              <span>{formatCountdown(visibleTimerMs)}</span>
            </span>
          )}
          <Dot
            status={aiHasRunning ? "running" : aiStatus}
            pulse={pulseSource === "ai" || pulseSource === "codex"}
            className={aiHasRunning ? "active" : ""}
          />
          <Dot status={unreadCount > 0 ? "done" : "idle"} badge={unreadCount > 0} pulse={pulseSource === "chat"} />
          <Dot status={systemStatus} progress={systemLoad / 100} ring={systemLoad > 0} pulse={pulseSource === "system"} />
        </div>

        <div className={`layer peek${(peekInfo.groupEvents?.length ?? 0) > 1 ? " peek-multi" : ""}${peekInfo.actionEvent ? " peek-approval" : ""}`}>
          {(peekInfo.groupEvents?.length ?? 0) > 1 ? (
            <>
              <div className="peek-group-heading"><b>{settingsCopy.groupedUpdates((peekInfo.groupEventIds ?? []).length)}</b></div>
              <div className="peek-agent-list">
              {peekInfo.groupEvents?.map((event) => {
                const label = event.source === "ai" ? agentDisplayName(event.agent, event.meta)
                  : event.source === "system" ? systemCopy.system
                    : `${typeof event.meta?.app === "string" ? event.meta.app : "Chat"} · ${typeof event.meta?.sender === "string" ? event.meta.sender : event.title}`;
                const status: DotStatus = event.status === "error" || event.status === "needs_input"
                  || event.status === "done" || event.status === "warn" || event.status === "crit"
                  ? event.status
                  : event.status === "unread" ? "done" : "running";
                return (
                  <div className="peek-agent-item" key={`${event.source}:${event.agent ?? ""}:${event.sessionId ?? event.id}`}>
                    <Dot status={status} />
                    <div className="peek-agent-copy"><b>{label}</b><span>{event.body || event.title}</span></div>
                  </div>
                );
              })}
              {(peekInfo.overflowCount ?? 0) > 0 && <span className="peek-agent-overflow">{settingsCopy.moreUpdates(peekInfo.overflowCount ?? 0)}</span>}
              </div>
            </>
          ) : (
            <>
              {peekInfo.chatSender ? (
                <div className={`whatsapp-peek${peekInfo.incomingCall ? " whatsapp-call" : ""}`}>
                  <div className="avatar whatsapp-avatar" style={{ "--avatar-hue": avatarHue(peekInfo.chatSender) } as CSSProperties}>{initials(peekInfo.chatSender)}</div>
                  <div className="whatsapp-peek-copy"><b>{peekInfo.chatSender}</b><span>{peekInfo.incomingCall ? settingsCopy.incomingCall : peekInfo.message}</span></div>
                  {peekInfo.incomingCall && <button className="open-whatsapp" onClick={(event) => {
                    event.stopPropagation();
                    if (isTauri()) void invoke("open_whatsapp").catch((error: unknown) => console.warn("Could not open WhatsApp", error));
                  }} type="button">{settingsCopy.openWhatsApp}</button>}
                </div>
              ) : <><Dot status={peekInfo.dotStatus} /><b>{peekInfo.source}</b><span>{peekInfo.message}</span></>}
            </>
          )}
          {peekInfo.actionEvent?.actionNonce && (
            <div className="approval-actions" onClick={(event) => event.stopPropagation()}>
              {peekInfo.actionEvent.actions?.includes("approve") && (
                <button type="button" onClick={() => {
                  const request = peekInfo.actionEvent;
                  if (!request?.actionNonce) return;
                  setPeekInfo((current) => ({ ...current, actionEvent: undefined }));
                  if (!isTauri()) return;
                  void invoke("respond_permission", {
                    eventId: request.id,
                    action: "approve",
                    nonce: request.actionNonce,
                  }).catch((error: unknown) => console.warn("Could not approve Codex request", error));
                }}>{settingsCopy.approvePermission}</button>
              )}
              {peekInfo.actionEvent.actions?.includes("reject") && (
                <button type="button" onClick={() => {
                  const request = peekInfo.actionEvent;
                  if (!request?.actionNonce) return;
                  setPeekInfo((current) => ({ ...current, actionEvent: undefined }));
                  if (!isTauri()) return;
                  void invoke("respond_permission", {
                    eventId: request.id,
                    action: "reject",
                    nonce: request.actionNonce,
                  }).catch((error: unknown) => console.warn("Could not reject Codex request", error));
                }}>{settingsCopy.rejectPermission}</button>
              )}
              <button type="button" onClick={() => {
                const request = peekInfo.actionEvent;
                if (!request?.actionNonce) return;
                setPeekInfo((current) => ({ ...current, actionEvent: undefined }));
                if (!isTauri()) return;
                void invoke("dismiss_permission", {
                  eventId: request.id,
                  nonce: request.actionNonce,
                }).catch((error: unknown) => console.warn("Could not dismiss Codex request", error));
              }}>{settingsCopy.dismissPermission}</button>
            </div>
          )}
        </div>

        <div
          className="layer panel"
          onClick={settingsOpen ? (event) => event.stopPropagation() : undefined}
          ref={panelRef}
        >
          {settingsOpen ? (
            <>
              <div className="settings-heading">
                <div className="settings-heading-copy">
                  <h4>{settingsCopy.title}</h4>
                  <p>{settingsCopy.subtitle}</p>
                </div>
                <button aria-label={settingsCopy.close} onClick={(event) => { event.stopPropagation(); setSettingsOpen(false); }} type="button">{settingsCopy.done}</button>
              </div>
              <section aria-labelledby="settings-overlay-heading" className="settings-section">
                <h5 className="settings-section-title" id="settings-overlay-heading">{settingsCopy.overlaySection}</h5>
                <label className="setting-field">
                  <span>{settingsCopy.position}</span>
                  <select value={settings.corner} onChange={(event) => setSettings((current) => ({ ...current, corner: event.target.value as UserSettings["corner"] }))}>
                    <option value="top-left">{settingsCopy.topLeft}</option>
                    <option value="top-right">{settingsCopy.topRight}</option>
                    <option value="bottom-left">{settingsCopy.bottomLeft}</option>
                    <option value="bottom-right">{settingsCopy.bottomRight}</option>
                  </select>
                </label>
                <label className="setting-field">
                  <span>{settingsCopy.screen}</span>
                  <select value={settings.monitorKey ?? ""} onChange={(event) => setSettings((current) => ({ ...current, monitorKey: event.target.value || null }))}>
                    {monitors.map((monitor) => <option key={monitor.key} value={monitor.key}>{monitor.label} · {monitor.width}×{monitor.height}</option>)}
                  </select>
                </label>
                <label className="setting-field">
                  <span>{settingsCopy.peekDuration}</span>
                  <select value={settings.peekDurationSeconds} onChange={(event) => setSettings((current) => ({ ...current, peekDurationSeconds: Number(event.target.value) }))}>
                    {[2, 3, 4, 5, 6, 8, 10].map((seconds) => <option key={seconds} value={seconds}>{settingsCopy.seconds(seconds)}</option>)}
                  </select>
                </label>
              </section>
              <section aria-labelledby="settings-notifications-heading" className="settings-section">
                <h5 className="settings-section-title" id="settings-notifications-heading">{settingsCopy.notificationsSection}</h5>
                <label className="setting-field">
                  <span>{settingsCopy.monitoredApps}</span>
                  <input aria-label={settingsCopy.monitoredApps} value={monitoredAppsText} onChange={(event) => {
                    const apps = parseMonitoredApps(event.target.value);
                    const monitoredApps = apps.length > 0 ? apps : defaultSettings.monitoredApps;
                    setMonitoredAppsText(apps.length > 0 ? event.target.value : monitoredApps.join(", "));
                    setSettings((current) => ({ ...current, monitoredApps }));
                  }} placeholder={settingsCopy.monitoredAppsPlaceholder} />
                  <small className="setting-field-hint">{settingsCopy.monitoredAppsHint}</small>
                </label>
                {isTauri() && (
                  <div className="setting-inline-status">
                    <span>{settingsCopy.notificationPermission}</span>
                    {notificationPermission === true ? (
                      <span className="setting-permission-granted">{settingsCopy.permissionGranted}</span>
                    ) : (
                      <button className="settings-action-btn" onClick={(event) => {
                        event.stopPropagation();
                        requestNotificationPermission();
                      }} type="button">{settingsCopy.grantPermission}</button>
                    )}
                  </div>
                )}
                <SettingsSwitch label={settingsCopy.whatsappNotifications} checked={settings.whatsappNotificationsEnabled} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, whatsappNotificationsEnabled: enabled }));
                }} />
                <SettingsSwitch label={settingsCopy.whatsappCard} checked={settings.whatsappCardEnabled} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, whatsappCardEnabled: enabled }));
                }} />
                <SettingsSwitch label={settingsCopy.allowDuringFullscreen} checked={settings.allowDuringFullscreen} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, allowDuringFullscreen: enabled }));
                }} />
              </section>
              <section aria-labelledby="settings-integrations-heading" className="settings-section">
                <h5 className="settings-section-title" id="settings-integrations-heading">{settingsCopy.integrationsSection}</h5>
                <SettingsSwitch label={settingsCopy.codexIntegration} checked={settings.codexEnabled} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, codexEnabled: enabled }));
                }} />
                <SettingsSwitch label={settingsCopy.antigravityHooks} checked={antigravityHooksEnabled} disabled={!isTauri()} onChange={(enabled) => {
                  void invoke<boolean>("set_antigravity_hooks_enabled", { enabled })
                    .then(setAntigravityHooksEnabled)
                    .catch((error: unknown) => console.warn("Could not update Antigravity hooks", error));
                }} />
                <SettingsSwitch label={settingsCopy.claudeHooks} checked={claudeHooksEnabled} disabled={!isTauri()} onChange={(enabled) => {
                  void invoke<boolean>("set_claude_hooks_enabled", { enabled })
                    .then(setClaudeHooksEnabled)
                    .catch((error: unknown) => console.warn("Could not update Claude hooks", error));
                }} />
              </section>
              <section aria-labelledby="settings-features-heading" className="settings-section">
                <h5 className="settings-section-title" id="settings-features-heading">{settingsCopy.featuresSection}</h5>
                <SettingsSwitch label={settingsCopy.nowPlaying} checked={settings.nowPlayingEnabled} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, nowPlayingEnabled: enabled, nowPlayingPeekEnabled: enabled ? current.nowPlayingPeekEnabled : false }));
                }} />
                {settings.nowPlayingEnabled && (
                  <SettingsSwitch label={settingsCopy.nowPlayingBrowserMedia} checked={settings.nowPlayingBrowserMediaEnabled} onChange={(enabled) => {
                    setSettings((current) => ({ ...current, nowPlayingBrowserMediaEnabled: enabled }));
                  }} />
                )}
                {settings.nowPlayingEnabled && (
                  <SettingsSwitch label={settingsCopy.nowPlayingPeek} checked={settings.nowPlayingPeekEnabled} onChange={(enabled) => {
                    setSettings((current) => ({ ...current, nowPlayingPeekEnabled: enabled }));
                  }} />
                )}
                <SettingsSwitch label={settingsCopy.reminderTimer} checked={settings.reminderTimerEnabled} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, reminderTimerEnabled: enabled }));
                  setActivityError("");
                  setClockMs(Date.now());
                }} />
                {settings.reminderTimerEnabled && (
                  <div className="reminder-timer-settings">
                    <h5>{settingsCopy.reminder}</h5>
                    <form onSubmit={(event) => { event.preventDefault(); addReminder(); }}>
                      <input
                        aria-label={settingsCopy.reminderTitle}
                        maxLength={80}
                        placeholder={settingsCopy.reminderTitle}
                        value={reminderTitle}
                        onChange={(event) => setReminderTitle(event.target.value)}
                      />
                      <label className="reminder-schedule-mode">
                        <span>{settingsCopy.reminderSchedule}</span>
                        <select value={reminderSchedule} onChange={(event) => setReminderSchedule(event.target.value as ReminderSchedule)}>
                          <option value="after">{settingsCopy.reminderDurationMode}</option>
                          <option value="at">{settingsCopy.reminderDateMode}</option>
                        </select>
                      </label>
                      {reminderSchedule === "after" ? (
                        <>
                          <label>
                            <span>{settingsCopy.duration}</span>
                            <div className="duration-field">
                              <input aria-label={settingsCopy.durationAmount} type="number" min="1" max={reminderDurationUnit === "seconds" ? 86_400 : reminderDurationUnit === "minutes" ? 1_440 : 24} step="1" value={reminderDuration} onChange={(event) => setReminderDuration(event.target.value)} />
                              <select aria-label={settingsCopy.durationUnit} value={reminderDurationUnit} onChange={(event) => setReminderDurationUnit(event.target.value as DurationUnit)}>
                                <option value="seconds">{settingsCopy.durationSeconds}</option>
                                <option value="minutes">{settingsCopy.durationMinutes}</option>
                                <option value="hours">{settingsCopy.durationHours}</option>
                              </select>
                            </div>
                          </label>
                          <SettingsSwitch className="reminder-repeat-toggle" label={settingsCopy.repeatReminder} checked={repeatReminder} onChange={setRepeatReminder} />
                        </>
                      ) : (
                        <label className="reminder-date-field">
                          <span>{settingsCopy.reminderDateTime}</span>
                          <input type="datetime-local" value={reminderDateTime} onChange={(event) => setReminderDateTime(event.target.value)} />
                        </label>
                      )}
                      <button type="submit">{settingsCopy.addReminder}</button>
                    </form>
                    {reminderTimer.reminders.length === 0
                      ? <p className="activity-empty">{settingsCopy.noReminders}</p>
                      : <ul className="activity-items">{reminderTimer.reminders.map((reminder) => (
                        <li key={reminder.id}>
                          <span><b>{reminder.title}</b><small>{reminderTimingLabel(reminder, clockMs)}</small></span>
                          <button type="button" aria-label={`${settingsCopy.removeReminder}: ${reminder.title}`} onClick={() => {
                            setReminderTimer((current) => ({ ...current, reminders: current.reminders.filter((item) => item.id !== reminder.id) }));
                          }}>×</button>
                        </li>
                      ))}</ul>}
                    <h5>{settingsCopy.timer}</h5>
                    <form className="timer-form" onSubmit={(event) => { event.preventDefault(); startTimer(); }}>
                      <label>
                        <span>{settingsCopy.timerDuration}</span>
                        <div className="duration-field">
                          <input aria-label={settingsCopy.durationAmount} type="number" min="1" max={timerDurationUnit === "seconds" ? 86_400 : timerDurationUnit === "minutes" ? 1_440 : 24} step="1" value={timerDuration} onChange={(event) => setTimerDuration(event.target.value)} />
                          <select aria-label={settingsCopy.durationUnit} value={timerDurationUnit} onChange={(event) => setTimerDurationUnit(event.target.value as DurationUnit)}>
                            <option value="seconds">{settingsCopy.durationSeconds}</option>
                            <option value="minutes">{settingsCopy.durationMinutes}</option>
                            <option value="hours">{settingsCopy.durationHours}</option>
                          </select>
                        </div>
                      </label>
                      <button type="submit">{settingsCopy.startTimer}</button>
                    </form>
                    {visibleTimer ? (
                      <div className="timer-controls">
                        <span>{formatCountdown(visibleTimerMs)}{visibleTimer.remainingMs !== null ? ` · ${settingsCopy.timerPaused}` : ""}</span>
                        {visibleTimerMs > 0 && <button type="button" onClick={toggleTimerPause}>{visibleTimer.remainingMs === null ? settingsCopy.pauseTimer : settingsCopy.resumeTimer}</button>}
                        <button type="button" onClick={() => setReminderTimer((current) => ({ ...current, timer: null }))}>{settingsCopy.cancelTimer}</button>
                      </div>
                    ) : <p className="activity-empty">{settingsCopy.timerNone}</p>}
                    {activityError && <p className="setting-error" role="alert">{activityError}</p>}
                  </div>
                )}
              </section>
              <section aria-labelledby="settings-startup-heading" className="settings-section settings-section-last">
                <h5 className="settings-section-title" id="settings-startup-heading">{settingsCopy.startupSection}</h5>
                <SettingsSwitch label={settingsCopy.autoStart} checked={settings.autoStart} disabled={!autoStartReady || !isTauri()} onChange={(enabled) => {
                  setSettings((current) => ({ ...current, autoStart: enabled }));
                  if (isTauri()) void invoke("set_auto_start", { enabled }).catch((error: unknown) => {
                    console.warn("Could not update auto-start", error);
                    setSettings((current) => ({ ...current, autoStart: !enabled }));
                  });
                }} />
              </section>
            </>
          ) : (
            <>
              <div className="panel-heading">
              <h4>AI Tasks</h4>
                <button onClick={(event) => { event.stopPropagation(); setSettingsOpen(true); }}>{settingsCopy.open}</button>
              </div>
              {taskGroups.map(taskGroupRow)}
              {settings.nowPlayingEnabled && (
                <section aria-label={settingsCopy.nowPlaying} className="now-playing">
                  <h4>{settingsCopy.nowPlaying}</h4>
                  {nowPlaying ? (
                    <div className="now-playing-card">
                      {nowPlaying.coverDataUrl
                        ? <img alt="" className="now-playing-cover" src={nowPlaying.coverDataUrl} />
                        : <div aria-hidden="true" className="now-playing-cover now-playing-placeholder">♫</div>}
                      <div className="now-playing-info"><b>{nowPlaying.title}</b><span>{nowPlaying.artist}</span><small>{nowPlaying.playing ? settingsCopy.playing : settingsCopy.paused}</small></div>
                      <div className="now-playing-actions">
                        <button aria-label={nowPlaying.playing ? settingsCopy.pause : settingsCopy.play} onClick={(event) => { event.stopPropagation(); controlNowPlaying(nowPlaying.playing ? "pause" : "play"); }} type="button">{nowPlaying.playing ? "Ⅱ" : "▶"}</button>
                        <button aria-label={settingsCopy.nextTrack} onClick={(event) => { event.stopPropagation(); controlNowPlaying("next"); }} type="button">»</button>
                      </div>
                    </div>
                  ) : <p className="now-playing-empty">{settingsCopy.noMedia}</p>}
                </section>
              )}
              {settings.reminderTimerEnabled && (reminderTimer.reminders.length > 0 || reminderTimer.timer) && (
                <section className="activity-panel" aria-label={settingsCopy.reminderTimer}>
                  <h4>{settingsCopy.reminderTimer}</h4>
                  {reminderTimer.reminders.map((reminder) => (
                    <div className="activity-panel-row" key={reminder.id}>
                      <span><b>{reminder.title}</b><small>{reminderTimingLabel(reminder, clockMs)}</small></span>
                      <button type="button" aria-label={`${settingsCopy.removeReminder}: ${reminder.title}`} onClick={(event) => {
                        event.stopPropagation();
                        setReminderTimer((current) => ({ ...current, reminders: current.reminders.filter((item) => item.id !== reminder.id) }));
                      }}>×</button>
                    </div>
                  ))}
                  {visibleTimer && (
                    <div className="activity-panel-row">
                      <span><b>{settingsCopy.timer}</b><small>{formatCountdown(visibleTimerMs)}{visibleTimer.remainingMs !== null ? ` · ${settingsCopy.timerPaused}` : ""}</small></span>
                      {visibleTimerMs > 0 && <button type="button" onClick={(event) => { event.stopPropagation(); toggleTimerPause(); }}>{visibleTimer.remainingMs === null ? settingsCopy.pauseTimer : settingsCopy.resumeTimer}</button>}
                      <button type="button" onClick={(event) => { event.stopPropagation(); setReminderTimer((current) => ({ ...current, timer: null })); }}>{settingsCopy.cancelTimer}</button>
                    </div>
                  )}
                </section>
              )}
              <div className="panel-heading chat-panel-heading">
                <h4>Chat{unreadCount > 0 ? ` · ${unreadCount} unread` : ""}</h4>
                {whatsappMessageCount > 0 && (
                  <button aria-label={settingsCopy.clearAllWhatsAppAccessible} onClick={clearAllWhatsAppMessages} type="button">
                    {settingsCopy.clearAllWhatsApp}
                  </button>
                )}
              </div>
              {messages.map((message, index) => (
                <div className={`row message-row${exitingMessages.includes(message.id) ? " row-exit" : ""}`} key={message.id} style={{ "--row-index": index } as CSSProperties}>
                  <div className="avatar whatsapp-avatar" style={{ "--avatar-hue": avatarHue(message.sender) } as CSSProperties}>{initials(message.sender)}</div>
                  <div className="tx">
                    <b>{message.sender}</b>
                    <span>{message.body}</span>
                  </div>
                  <button
                    aria-label={settingsCopy.dismissNotification}
                    className="message-dismiss"
                    onClick={(event) => {
                      event.stopPropagation();
                      dismissMessage(message.id);
                    }}
                    title={settingsCopy.dismissNotification}
                  >×</button>
                </div>
              ))}
              <h4>{systemCopy.heading}</h4>
              <div className="system-metrics">
                <SystemMetric label={systemCopy.cpu} value={percent(systemMetrics.current.cpuPercent)} samples={systemMetrics.history.map((sample) => ({ capturedAt: sample.capturedAt, value: sample.cpuPercent }))} />
                <SystemMetric label={systemCopy.gpu} value={percent(systemMetrics.current.gpuPercent)} samples={systemMetrics.history.map((sample) => ({ capturedAt: sample.capturedAt, value: sample.gpuPercent }))} />
                <SystemMetric label={systemCopy.memory} value={metricUsage(systemMetrics.current.memoryUsedMb, systemMetrics.current.memoryTotalMb, systemMetrics.current.memoryPercent)} samples={systemMetrics.history.map((sample) => ({ capturedAt: sample.capturedAt, value: sample.memoryPercent }))} />
                <SystemMetric label={systemCopy.vram} value={metricUsage(systemMetrics.current.vramUsedMb, systemMetrics.current.vramTotalMb, systemMetrics.current.vramPercent)} samples={systemMetrics.history.map((sample) => ({ capturedAt: sample.capturedAt, value: sample.vramPercent }))} />
                <SystemMetric label={systemCopy.temperature} value={systemMetrics.current.gpuTemperatureC === null ? systemCopy.unavailable : `${systemMetrics.current.gpuTemperatureC}°C`} samples={systemMetrics.history.map((sample) => ({ capturedAt: sample.capturedAt, value: sample.gpuTemperatureC }))} />
                {systemMetrics.history.length === 0 && <span className="system-empty">{systemCopy.noSamples}</span>}
              </div>
            </>
          )}
        </div>
        </div>
      </section>

      {import.meta.env.DEV && (
        <nav aria-label="Mock event controls" className="controls">
          <button onClick={startTask}>Start Codex task</button>
          <button onClick={showMockAgentBurst}>Codex + Antigravity at once</button>
          <button onClick={showMockMixedBurst}>Antigravity + WhatsApp at once</button>
          <button onClick={() => showMockAntigravityTask("antigravity-cli")}>Antigravity CLI task</button>
          <button onClick={() => showMockAntigravityTask("antigravity-ide")}>Antigravity IDE task</button>
          <button onClick={() => showMockAntigravityTask("antigravity-app")}>Antigravity App task</button>
          <button onClick={showMockClaudeTask}>Claude task</button>
          <button onClick={showMockExternalTask}>{settingsCopy.mockExternalTask}</button>
          <button onClick={showMockReminderTimer}>{settingsCopy.mockReminderTimer}</button>
          <button onClick={finishTask}>Task completed</button>
          <button onClick={failTask}>Error</button>
          <button onClick={receiveMessage}>Incoming chat</button>
          <button onClick={receiveMockCall}>WhatsApp call</button>
          <button onClick={showMockSystemAlert}>{systemCopy.demoAlert}</button>
          <button onClick={showMockPermissionRequest}>{settingsCopy.mockPermissionRequest}</button>
          <button onClick={clearUnread}>Mark as read</button>
        </nav>
      )}
    </main>
  );
}

export default App;
