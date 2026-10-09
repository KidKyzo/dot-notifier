import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { islandReducer } from "./core/island-state";
import { CHAT_RETENTION_MS, EventStore, type AppEvent } from "./core/event-store";
import { pruneExpiredMessages, upsertChatMessage } from "./core/chat-retention";
import { primaryCodexTaskRows, upsertTask } from "./core/task-list";
import { initialSystemMetrics, mockSystemAlert, parseSystemMetrics } from "./core/system-metrics";
import { systemCopy } from "./core/system-copy";
import { settingsCopy } from "./core/settings-copy";
import { defaultSettings, loadSettings, parseMonitoredApps, type UserSettings } from "./core/settings";
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

type PulseSource = "codex" | "chat" | "system";
type DotStatus = DemoStatus | "warn" | "crit";
type PeekInfo = { source: string; message: string; chatMessages: AppEvent[] };
type MonitorOption = { key: string; label: string; width: number; height: number };

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
  running: "Berjalan",
  done: "Selesai",
  error: "Gagal",
  needs_input: "Butuh izin",
};

const percent = (value: number | null) => value === null ? systemCopy.unavailable : `${Math.round(value)}%`;

const metricUsage = (used: number | null, total: number | null, value: number | null) => {
  if (value === null) return systemCopy.unavailable;
  if (used === null || total === null) return percent(value);
  return `${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)} GB · ${percent(value)}`;
};

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
  const [systemMetrics, setSystemMetrics] = useState(initialSystemMetrics);
  const unreadCount = messages.filter((message) => message.unread).length;
  const [messageIndex, setMessageIndex] = useState(0);
  const [peekInfo, setPeekInfo] = useState<PeekInfo>({ source: "Codex", message: "", chatMessages: [] });
  const [pulseSource, setPulseSource] = useState<PulseSource | null>(null);
  const [paused, setPaused] = useState(false);
  const [quietMode, setQuietMode] = useState(false);
  const [quietEnvironment, setQuietEnvironment] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings(window.localStorage));
  const [monitoredAppsText, setMonitoredAppsText] = useState(settings.monitoredApps.join(", "));
  const [notificationPermission, setNotificationPermission] = useState<boolean | null>(null);
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const eventStore = useRef(new EventStore());
  const hoverExpanded = useRef(false);
  const clickPinned = useRef(false);
  const quietEnvironmentRef = useRef(false);
  const pausedRef = useRef(paused);
  const quietModeRef = useRef(quietMode);
  const hudRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const showEventPeek = (next: AppEvent) => {
    const chatSource = (typeof next.meta?.sender === "string" && next.meta.sender)
      || (typeof next.meta?.app === "string" && next.meta.app)
      || "Notification";
    const chatMessages = next.source === "chat" ? eventStore.current.pendingChatMessages(3) : [];
    setPeekInfo({
      source: next.source === "codex"
        ? "Codex"
      : next.source === "system"
        ? systemCopy.system
        : chatSource,
      message: next.source === "system"
        ? next.status === "crit" ? systemCopy.criticalAlert : systemCopy.warningAlert
        : (next.body || next.title),
      chatMessages,
    });
    setPulseSource(next.source === "codex" || next.source === "chat" || next.source === "system"
      ? next.source
      : null);
    dispatch({ type: "set", state: "alert" });
  };

  const showNextQueuedPeek = () => {
    if (quietEnvironmentRef.current || pausedRef.current || quietModeRef.current) return;
    const next = eventStore.current.nextPeek();
    if (next) showEventPeek(next);
  };

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("check_notification_permission")
      .then((granted) => setNotificationPermission(granted))
      .catch((error: unknown) => console.warn("Could not check notification permission", error));
  }, []);

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
    const timer = window.setTimeout(() => {
      void invoke("set_monitored_apps", { apps: settings.monitoredApps })
        .catch((error: unknown) => console.warn("Could not update notification app filter", error));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settings.monitoredApps]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("is_quiet_environment")
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
  }, [state]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_system_panel_open", { open: state === "expanded" })
      .catch((error: unknown) => console.warn("Could not update system monitor polling", error));
  }, [state]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ paused?: boolean; quietMode?: boolean; openSettings?: boolean }>("tray-controls", ({ payload }) => {
      if (payload.paused !== undefined) setPaused(payload.paused);
      if (payload.quietMode !== undefined) setQuietMode(payload.quietMode);
      if (payload.openSettings) {
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
      if (payload.source === "antigravity") return;
      if (payload.source !== "chat" || payload.kind !== "message") eventStore.current.upsert(payload);
      if (payload.source === "system" && payload.kind === "metric") {
        const nextMetrics = parseSystemMetrics(payload.meta);
        if (nextMetrics) setSystemMetrics(nextMetrics);
        if (payload.status === undefined) return;
      }
      if (payload.source === "codex"
          && payload.kind === "task"
          && (payload.status === "running" || payload.status === "done"
            || payload.status === "error" || payload.status === "needs_input")) {
        const task: DemoTask = {
          id: payload.id,
          source: "codex",
          name: `Codex · ${payload.id.slice(0, 8)}`,
          status: payload.status,
          title: payload.title,
          ...(payload.body ? { detail: payload.body } : {}),
          progress: payload.progress ?? (payload.status === "done" ? 1 : 0),
          ...(payload.startedAt && Number.isFinite(Date.parse(payload.startedAt))
            ? { startedAt: Date.parse(payload.startedAt) }
            : {}),
        };
        setTasks((current) => upsertTask(current, task));
      }
      if (payload.source === "chat" && payload.kind === "message") {
        const receivedAt = Date.now();
        eventStore.current.upsert(payload, receivedAt);
        const createdAt = payload.startedAt ? Date.parse(payload.startedAt) : Number.NaN;
        const sender = (typeof payload.meta?.sender === "string" && payload.meta.sender)
          || (typeof payload.meta?.app === "string" && payload.meta.app)
          || payload.title;
        const body = payload.body || payload.title;
        setMessages((current) => upsertChatMessage(current, {
          id: payload.id,
          receivedAt,
          createdAt: Number.isFinite(createdAt) ? createdAt : receivedAt,
          sender,
          body,
          unread: true,
        }));
      }

      showNextQueuedPeek();
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
    const updateHitArea = () => {
      const bounds = hud.getBoundingClientRect();
      void invoke("update_hit_area", {
        area: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      }).catch((error: unknown) => console.warn("Could not update overlay hit area", error));
    };
    const observer = new ResizeObserver(updateHitArea);
    observer.observe(hud);
    updateHitArea();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (state === "alert") {
      const timer = window.setTimeout(() => dispatch({ type: "set", state: "peek" }), 240);
      return () => window.clearTimeout(timer);
    }

    if (state === "peek") {
      const timer = window.setTimeout(() => {
        const groupedChatIds = peekInfo.chatMessages.length > 1
          ? peekInfo.chatMessages.map((event) => event.id)
          : [];
        const next = groupedChatIds.length > 0
          ? eventStore.current.dismissPeekGroup(groupedChatIds)
          : eventStore.current.dismissPeek();
        if (next) {
          showEventPeek(next);
        } else {
          dispatch({ type: "dismiss" });
          setPulseSource(null);
        }
      }, settings.peekDurationSeconds * 1000);
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

    if (state === "peek") {
      hud.style.width = "300px";
      hud.style.height = peekInfo.chatMessages.length > 1
        ? `${56 + peekInfo.chatMessages.length * 32}px`
        : "44px";
    } else if (state === "expanded" && panelRef.current) {
      hud.style.width = "320px";
      hud.style.height = `${panelRef.current.clientHeight}px`;
    } else {
      hud.style.width = "64px";
      hud.style.height = "24px";
    }
  }, [state, tasks, messages, peekInfo, systemMetrics, settingsOpen]);

  const codexRows = primaryCodexTaskRows(tasks);
  const codex = codexRows[0] ?? initialTasks[0];
  const activeTask = codex;
  const isOpen = state === "expanded";
  const systemLoad = [systemMetrics.current.cpuPercent, systemMetrics.current.gpuPercent]
    .filter((value): value is number => value !== null)
    .reduce((highest, value) => Math.max(highest, value), 0);
  const systemStatus: DotStatus = systemMetrics.current.gpuTemperatureC !== null && systemMetrics.current.gpuTemperatureC > 90
    || systemLoad > 90 ? "crit"
    : systemMetrics.current.gpuTemperatureC !== null && systemMetrics.current.gpuTemperatureC > 80
      || (systemMetrics.current.memoryPercent ?? 0) > 90 ? "warn"
      : systemLoad > 0 ? "running" : "idle";

  const showPeek = (source: PulseSource, sourceName: string, message: string) => {
    if (paused || quietMode || quietEnvironment) return;
    setPeekInfo({ source: sourceName, message, chatMessages: [] });
    setPulseSource(source);
    dispatch({ type: "set", state: "alert" });
  };

  const startTask = () => {
    const startedAt = Date.now();
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "running", title: "migrasi database", progress: 0.42, startedAt }
      : task));
    showPeek("codex", "Codex", "mulai: migrasi database");
  };

  const finishTask = () => {
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "done", progress: 1 }
      : task));
    showPeek("codex", "Codex", `${codex.title} selesai`);
  };

  const failTask = () => {
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "error" }
      : task));
    showPeek("codex", "Codex", `${codex.title} gagal: 2 tes tidak lulus`);
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
    setPeekInfo({ source: systemCopy.system, message: systemCopy.criticalAlert, chatMessages: [] });
    setPulseSource("system");
    dispatch({ type: "set", state: "alert" });
  };

  const clearUnread = () => {
    setMessages((current) => current.map((message) => ({ ...message, unread: false })));
    setPulseSource(null);
    dispatch({ type: "set", state: "idle" });
  };

  const dismissMessage = (id: string) => {
    eventStore.current.dismiss(id);
    setMessages((current) => current.filter((message) => message.id !== id));
    if (unreadCount <= 1) {
      setPulseSource((current) => current === "chat" ? null : current);
      if (pulseSource === "chat") dispatch({ type: "dismiss" });
    }
  };

  const onHudClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      clickPinned.current = !isOpen;
      hoverExpanded.current = false;
      dispatch({ type: "set", state: isOpen ? "idle" : "expanded" });
    } else if (event.key === "Escape") {
      clickPinned.current = false;
      hoverExpanded.current = false;
      dispatch({ type: "set", state: "idle" });
    }
  };

  const taskRow = (task: DemoTask) => {
    const subtitle = task.status === "running"
      ? `${task.title} · ${durationLabel(task.startedAt)}`
      : task.status === "idle"
        ? task.title
        : `${task.title} · ${statusLabels[task.status]}`;

    return (
      <div className="row" key={task.id}>
        <Dot status={task.status} />
        <div className="tx">
          <b>{task.name}</b>
          <span>{subtitle}</span>
          {task.detail && <span className="task-detail">{task.detail}</span>}
          {task.status === "running" && (
            <div className="bar" style={{ "--bar-color": colors.running } as CSSProperties}>
              <u style={{ width: `${Math.round(task.progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className={`overlay-stage${isMockMode ? " preview-background" : ""}`}>
      {isMockMode && (
        <p className="hint">
          <b>Dot Notifier</b>
          Arahkan kursor ke dot, atau picu event dari tombol di bawah. Di layar sentuh, ketuk dot.
          {(paused || quietMode) && <span className="tray-status">{paused ? "Notifikasi dijeda" : "Mode senyap"}</span>}
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
          if (clickPinned.current) return;
          hoverExpanded.current = true;
          dispatch({ type: "hover", active: true });
        }}
        onMouseLeave={() => {
          if (!hoverExpanded.current || clickPinned.current) return;
          hoverExpanded.current = false;
          dispatch({ type: "hover", active: false });
        }}
        ref={hudRef}
        role="button"
        tabIndex={0}
      >
        <div className="layer dots">
          <Dot status={activeTask.status} progress={activeTask.progress} ring={activeTask.status === "running"} pulse={pulseSource === "codex"} />
          <Dot status={unreadCount > 0 ? "done" : "idle"} badge={unreadCount > 0} pulse={pulseSource === "chat"} />
          <Dot status={systemStatus} progress={systemLoad / 100} ring={systemLoad > 0} pulse={pulseSource === "system"} />
        </div>

        <div className={`layer peek${peekInfo.chatMessages.length > 1 ? " peek-multi" : ""}`}>
          {peekInfo.chatMessages.length > 1 ? (
            <>
              <div className="peek-group-heading">
                <Dot status="done" />
                <b>
                  {(typeof peekInfo.chatMessages[0]?.meta?.app === "string" && peekInfo.chatMessages[0].meta.app)
                    || "Chat"} · {settingsCopy.chatMessages(peekInfo.chatMessages.length)}
                </b>
              </div>
              <div className="peek-chat-list">
                {peekInfo.chatMessages.map((message) => (
                  <div className="peek-chat-item" key={message.id}>
                    <b>{(typeof message.meta?.sender === "string" && message.meta.sender) || message.title}</b>
                    <span>{message.body || message.title}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <Dot status={pulseSource === "system" ? systemStatus : pulseSource === "chat" ? "done" : codex.status} />
              <b>{peekInfo.source}</b>
              <span>{peekInfo.message}</span>
            </>
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
                <h4>{settingsCopy.title}</h4>
                <button aria-label={settingsCopy.close} onClick={(event) => { event.stopPropagation(); setSettingsOpen(false); }}>×</button>
              </div>
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
              <label className="setting-field">
                <span>{settingsCopy.monitoredApps}</span>
                <input value={monitoredAppsText} onChange={(event) => {
                  const apps = parseMonitoredApps(event.target.value);
                  const monitoredApps = apps.length > 0 ? apps : defaultSettings.monitoredApps;
                  setMonitoredAppsText(apps.length > 0 ? event.target.value : monitoredApps.join(", "));
                  setSettings((current) => ({ ...current, monitoredApps }));
                }} placeholder={settingsCopy.monitoredAppsPlaceholder} />
              </label>
              {isTauri() && (
                <div className="setting-field" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{settingsCopy.notificationPermission}</span>
                  {notificationPermission === true ? (
                    <span style={{ fontSize: "12px", opacity: 0.8, color: "#4ade80" }}>{settingsCopy.permissionGranted}</span>
                  ) : (
                    <button
                      className="settings-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestNotificationPermission();
                      }}
                      style={{
                        padding: "3px 8px",
                        fontSize: "12px",
                        borderRadius: "4px",
                        background: "rgba(255,255,255,0.12)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        color: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {settingsCopy.grantPermission}
                    </button>
                  )}
                </div>
              )}
              <label className="setting-toggle">
                <span>{settingsCopy.autoStart}</span>
                <input type="checkbox" checked={settings.autoStart} disabled={!isTauri()} onChange={(event) => {
                  const enabled = event.target.checked;
                  setSettings((current) => ({ ...current, autoStart: enabled }));
                  if (isTauri()) void invoke("set_auto_start", { enabled }).catch((error: unknown) => {
                    console.warn("Could not update auto-start", error);
                    setSettings((current) => ({ ...current, autoStart: !enabled }));
                  });
                }} />
              </label>
              <button className="settings-done" onClick={(event) => { event.stopPropagation(); setSettingsOpen(false); }}>{settingsCopy.done}</button>
            </>
          ) : (
            <>
              <div className="panel-heading">
                <h4>Task AI</h4>
                <button onClick={(event) => { event.stopPropagation(); setSettingsOpen(true); }}>{settingsCopy.open}</button>
              </div>
              {(codexRows.length > 0 ? codexRows : [codex]).map(taskRow)}
              <h4>Chat{unreadCount > 0 ? ` · ${unreadCount} belum dibaca` : ""}</h4>
              {messages.slice(0, 3).map((message) => (
                <div className="row" key={message.id}>
                  <div className="avatar">{message.sender[0]}</div>
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
      </section>

      {import.meta.env.DEV && (
        <nav aria-label="Mock event controls" className="controls">
          <button onClick={startTask}>Mulai task Codex</button>
          <button onClick={finishTask}>Task selesai</button>
          <button onClick={failTask}>Error</button>
          <button onClick={receiveMessage}>Chat masuk</button>
          <button onClick={showMockSystemAlert}>{systemCopy.demoAlert}</button>
          <button onClick={clearUnread}>Tandai dibaca</button>
        </nav>
      )}
    </main>
  );
}

export default App;
