import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { islandReducer, shouldScheduleHoverCollapse } from "./core/island-state";
import { isHudToggleShortcut } from "./core/hud-keyboard";
import { CHAT_RETENTION_MS, EventStore, eventCreatedAtMs, type AppEvent } from "./core/event-store";
import { isWhatsAppApp, pruneExpiredMessages, removeWhatsAppMessages, upsertChatMessage } from "./core/chat-retention";
import {
  aiStatusPriority,
  aggregateTaskDotStatus,
  codexTaskRowsForPanel,
  groupTasksByAgent,
  hasNewlyCompletedTask,
  taskElapsedLabel,
  taskCompletionPreview,
  taskGroupName,
  upsertTask,
} from "./core/task-list";
import { clearTaskHistory, loadTaskHistory, saveTaskHistory, upsertTaskHistory, type TaskHistoryEntry } from "./core/task-history";
import { addClipboardEntry, loadClipboardHistory, saveClipboardHistory, type ClipboardEntry } from "./core/clipboard-history";
import { calendarDays, localDayKey } from "./core/calendar";
import { initialSystemMetrics, mockSystemAlert, parseSystemMetrics } from "./core/system-metrics";
import { systemCopy } from "./core/system-copy";
import { agentActivityLabel, isAgentActivityTitle, settingsCopy } from "./core/settings-copy";
import { afterNoticeMessage, type PillNotice } from "./core/pill-notice";
import { ActivityCountdown, ActivityDial } from "./ActivityVisuals";
import { MusicVolumeControl } from "./MusicVolumeControl";
import { ReminderDateField } from "./ReminderDateField";
import { mediaPositionSeconds, syncMediaPosition, type LiveMediaPosition } from "./core/media-position";
import { SONG_TITLE_GAP_PX, SONG_TITLE_REST_MS, songTitleMotion, type SongTitleMotion } from "./core/song-title-motion";
import {
  defaultSettings,
  pillPresentation,
  getAgentIntegration,
  isAgentIntegrationEnabled,
  loadSettings,
  parseMonitoredApps,
  shouldExpandPillOnHover,
  type AgentIntegration,
  type AgentIntegrationState,
  type PillMode,
  type UserSettings,
} from "./core/settings";
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
  reminderProgress,
  saveReminderTimer,
  timerRemainingMs,
  timerProgress,
  type DurationUnit,
  type Reminder,
  type ReminderTimerState,
} from "./core/reminder-timer";
import { isIncomingWhatsAppCall, isWhatsAppNotification } from "./core/whatsapp-calls";
import { presentPeekGroup } from "./core/peek-group";
import {
  advanceSpringAxis,
  cancelSpringFrame,
  createSpringAxis,
  isSpringAxisSettled,
  modePillSize,
  motionTokens,
  retargetSpringAxis,
  showsPillWave,
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
type NowPlayingSnapshot = { title: string; artist: string; playing: boolean; positionSeconds: number; positionUpdatedAtMs?: number | null; coverDataUrl: string | null };
type NowPlayingState = NowPlayingSnapshot & LiveMediaPosition;
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
const formatTaskStartedAt = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
}).format(timestamp);
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

function MusicBars({ playing }: { playing: boolean }) {
  return (
    <span aria-hidden="true" className={`music-bars${playing ? " is-playing" : ""}`}>
      <i /><i /><i /><i /><i />
    </span>
  );
}

function ClipboardModeIcon() {
  return (
    <svg aria-hidden="true" className="utility-mode-icon" viewBox="0 0 20 20">
      <path d="M7 4.5h-1.5A1.5 1.5 0 0 0 4 6v9.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H13" />
      <rect height="3" rx="1" width="6" x="7" y="3" />
      <path d="M7.5 9h5M7.5 12h5" />
    </svg>
  );
}

function PillModeShortcutIcon({ mode }: { mode: PillMode }) {
  if (mode === "clipboard") return <ClipboardModeIcon />;

  return (
    <svg aria-hidden="true" className="pill-mode-icon" viewBox="0 0 20 20">
      {mode === "all" ? (
        <>
          <rect height="5.5" rx="1" width="5.5" x="3" y="3" />
          <rect height="5.5" rx="1" width="5.5" x="11.5" y="3" />
          <rect height="5.5" rx="1" width="5.5" x="3" y="11.5" />
          <rect height="5.5" rx="1" width="5.5" x="11.5" y="11.5" />
        </>
      ) : mode === "music" ? (
        <>
          <path d="M10 13V5l6-1.5V12" />
          <ellipse cx="7.5" cy="14.5" rx="2.5" ry="1.7" />
          <ellipse cx="13.5" cy="13.5" rx="2.5" ry="1.7" />
        </>
      ) : mode === "agents" ? (
        <>
          <circle cx="4.5" cy="5" r="1" />
          <path d="M8 5h8M4.5 10a1 1 0 1 0 0 .01M8 10h8m-11.5 5h1m2.5 0h8" />
        </>
      ) : (
        <>
          <circle cx="10" cy="11" r="6.5" />
          <path d="M10 7.5V11l2.5 1.5M8 2.5h4m-2 0v2" />
        </>
      )}
    </svg>
  );
}

function TaskSummaryCopy({ signature, title, meta }: { signature: string; title: string; meta: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previousSignature = useRef(signature);

  useLayoutEffect(() => {
    if (previousSignature.current === signature) return;
    previousSignature.current = signature;
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = node.animate(
      [
        { opacity: 0.7, translate: "0px 2px" },
        { opacity: 1, translate: "0px 0px" },
      ],
      { duration: motionTokens.timing.contentInMs, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => animation.cancel();
  }, [signature]);

  return (
    <span className="task-summary-copy" ref={ref}>
      <span className="task-summary-title">{title}</span>
      {meta && <small className="task-summary-meta">{meta}</small>}
    </span>
  );
}

function ScrollingSongTitle({ title }: { title: string }) {
  const viewportRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLElement>(null);
  const [motion, setMotion] = useState<SongTitleMotion | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const text = titleRef.current;
    if (!viewport || !text) return;
    const measure = () => {
      const next = songTitleMotion(viewport.clientWidth, text.scrollWidth);
      setMotion((current) => current?.travelPx === next?.travelPx ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    measure();
    return () => observer.disconnect();
  }, [title]);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || !motion) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animation: Animation | null = null;
    const updateAnimation = () => {
      animation?.cancel();
      if (reducedMotion.matches) return;
      const duration = SONG_TITLE_REST_MS + motion.scrollDurationMs;
      animation = track.animate([
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: SONG_TITLE_REST_MS / duration },
        { transform: `translateX(-${motion.travelPx}px)`, offset: 1 },
      ], { duration, iterations: Infinity, easing: "linear" });
    };
    updateAnimation();
    reducedMotion.addEventListener("change", updateAnimation);
    return () => {
      reducedMotion.removeEventListener("change", updateAnimation);
      animation?.cancel();
    };
  }, [motion]);

  return (
    <b
      className={`scrolling-song-title${motion ? " is-overflowing" : ""}`}
      ref={viewportRef}
      title={title}
    >
      <i className="scrolling-song-track" ref={trackRef} style={{ columnGap: SONG_TITLE_GAP_PX }}>
        <em ref={titleRef}>{title}</em>
        {motion && <em aria-hidden="true">{title}</em>}
      </i>
    </b>
  );
}

function PillModeShortcuts({ mode, onSelect }: { mode: PillMode; onSelect: (mode: PillMode) => void }) {
  const modes: { value: PillMode; label: string; title: string }[] = [
    { value: "all", label: settingsCopy.pillModeAll, title: settingsCopy.pillModeAll },
    { value: "music", label: settingsCopy.pillModeMusic, title: settingsCopy.pillModeMusic },
    { value: "agents", label: settingsCopy.pillModeAgents, title: settingsCopy.pillModeAgents },
    { value: "timer", label: settingsCopy.pillModeTimerShortcut, title: settingsCopy.pillModeTimer },
    { value: "clipboard", label: settingsCopy.pillModeClipboard, title: settingsCopy.pillModeClipboard },
  ];

  return (
    <div aria-label={settingsCopy.pillModeShortcutsLabel} className="pill-mode-shortcuts" role="group">
      {modes.map((item) => (
        <button
          aria-pressed={mode === item.value}
          aria-label={item.label}
          className="pill-mode-shortcut"
          key={item.value}
          onClick={(event) => { event.stopPropagation(); onSelect(item.value); }}
          title={item.title}
          type="button"
        ><span className="pill-mode-icon-frame"><PillModeShortcutIcon mode={item.value} /></span></button>
      ))}
    </div>
  );
}

function PanelModeToolbar({ mode, onSelectMode, onOpenSettings }: {
  mode: PillMode;
  onSelectMode: (mode: PillMode) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="panel-heading panel-mode-toolbar">
      <PillModeShortcuts mode={mode} onSelect={onSelectMode} />
      <button onClick={(event) => { event.stopPropagation(); onOpenSettings(); }} type="button">
        {settingsCopy.open}
      </button>
    </div>
  );
}

function ClipboardPanel({ history, loading, error, mockPreview, mode, onSelectMode, onOpenSettings, onDelete, onClear }: {
  history: ClipboardEntry[];
  loading: boolean;
  error: string;
  mockPreview: boolean;
  mode: PillMode;
  onSelectMode: (mode: PillMode) => void;
  onOpenSettings: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="utility-panel clipboard-panel" onClick={(event) => event.stopPropagation()}>
      <PanelModeToolbar mode={mode} onSelectMode={onSelectMode} onOpenSettings={onOpenSettings} />
      <div className="clipboard-panel-heading">
        <div className="clipboard-panel-heading-copy">
          <h4 className="panel-mode-title">{settingsCopy.clipboardTitle}</h4>
          <span>{settingsCopy.clipboardCount(history.length)}</span>
        </div>
        {history.length > 0 && <button className="clipboard-clear-button" onClick={(event) => { event.stopPropagation(); onClear(); }} type="button">{settingsCopy.clearHistory}</button>}
      </div>
      <p className="utility-hint">{settingsCopy.clipboardHint}</p>
      {mockPreview && <p className="utility-mock-note">{settingsCopy.mockPreview}</p>}
      {loading && <p className="utility-state" role="status">{settingsCopy.clipboardLoading}</p>}
      {error && <p className="utility-state utility-error" role="alert">{error}</p>}
      {history.length === 0 && !loading && <p className="clipboard-empty-state">{settingsCopy.clipboardEmpty}</p>}
      <ol className="clipboard-history-list">
        {history.map((entry) => <li className="clipboard-history-item" key={entry.id}>
          <div className="clipboard-item-heading">
            <time dateTime={new Date(entry.copiedAt).toISOString()}>{settingsCopy.reminderAt(new Date(entry.copiedAt))}</time>
            <button aria-label={`${settingsCopy.removeClipboardEntry}: ${settingsCopy.reminderAt(new Date(entry.copiedAt))}`} onClick={(event) => { event.stopPropagation(); onDelete(entry.id); }} title={settingsCopy.removeClipboardEntry} type="button">
              <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M4.5 6h11M7 6V4.5h6V6m-7 0 .6 9.5h6.8L14 6M8.5 8.5v4.5m3-4.5v4.5" /></svg>
            </button>
          </div>
          <pre className="clipboard-preview" tabIndex={0}>{entry.text}</pre>
        </li>)}
      </ol>
    </div>
  );
}

type AgentTaskGroup = { name: string; rows: DemoTask[] };

function LocalCalendar({ reminders, nowMs }: { reminders: Reminder[]; nowMs: number }) {
  const [month, setMonth] = useState(() => new Date(new Date(nowMs).getFullYear(), new Date(nowMs).getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(() => localDayKey(new Date(nowMs)));
  const days = calendarDays(month);
  const weekdayNames = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, index + 1)));
  const selectedDate = days.find((day) => localDayKey(day) === selectedDay) ?? new Date(nowMs);
  const selectedReminders = reminders.filter((reminder) => localDayKey(new Date(reminder.dueAt)) === selectedDay);
  const moveMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDay(localDayKey(next));
  };
  return (
    <section aria-label={settingsCopy.calendar} className="local-calendar">
      <div className="calendar-heading">
        <div className="calendar-heading-copy">
          <span>{settingsCopy.calendar}</span>
          <h4>{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month)}</h4>
        </div>
        <div className="calendar-navigation">
          <button aria-label={settingsCopy.previousMonth} onClick={(event) => { event.stopPropagation(); moveMonth(-1); }} type="button">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m9.5 3.5-4 4.5 4 4.5" /></svg>
          </button>
          <button aria-label={settingsCopy.nextMonth} onClick={(event) => { event.stopPropagation(); moveMonth(1); }} type="button">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6.5 3.5 4 4.5-4 4.5" /></svg>
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {weekdayNames.map((name) => <span className="calendar-weekday" key={name}>{name}</span>)}
        {days.map((day) => {
          const key = localDayKey(day);
          const count = reminders.filter((reminder) => localDayKey(new Date(reminder.dueAt)) === key).length;
          return <button
            aria-label={`${new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(day)}${count ? ` · ${settingsCopy.calendarReminderCount(count)}` : ""}`}
            aria-pressed={selectedDay === key}
            className={`${day.getMonth() !== month.getMonth() ? "outside-month " : ""}${key === localDayKey(new Date(nowMs)) ? "today" : ""}`}
            key={key}
            onClick={(event) => {
              event.stopPropagation();
              if (day.getMonth() !== month.getMonth()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
              setSelectedDay(key);
            }}
            type="button"
          ><span>{day.getDate()}</span>{count > 0 && <span aria-hidden="true" className="calendar-reminder-mark" />}</button>;
        })}
      </div>
      <div className="calendar-day-detail">
        <div className="calendar-day-heading">
          <b>{new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "short" }).format(selectedDate)}</b>
          {selectedReminders.length > 0 && <small>{settingsCopy.calendarReminderCount(selectedReminders.length)}</small>}
        </div>
        {selectedReminders.length > 0 ? selectedReminders.map((reminder) => <p key={reminder.id}><span aria-hidden="true" className="calendar-detail-mark" /><span><b>{reminder.title}</b><small>{settingsCopy.reminderAt(new Date(reminder.dueAt))}</small></span></p>)
          : <p>{settingsCopy.calendarNoReminders}</p>}
      </div>
    </section>
  );
}

function ChatNotificationRow({ message, index, exiting, onDismiss }: {
  message: DemoMessage;
  index: number;
  exiting: boolean;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className={`row message-row${exiting ? " row-exit" : ""}`} key={message.id} style={{ "--row-index": index } as CSSProperties}>
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
          onDismiss(message.id);
        }}
        title={settingsCopy.dismissNotification}
        type="button"
      >×</button>
    </div>
  );
}

function AgentPanel({ attentionGroups, runningGroups, recentTasks, nowMs, onClearHistory }: {
  attentionGroups: AgentTaskGroup[];
  runningGroups: AgentTaskGroup[];
  recentTasks: Array<TaskHistoryEntry & { detail?: string }>;
  nowMs: number;
  onClearHistory: () => void;
}) {
  const runningCount = runningGroups.reduce((count, group) => count + group.rows.length, 0);
  const attentionCount = attentionGroups.reduce((count, group) => count + group.rows.length, 0);

  const renderTaskGroups = (groups: AgentTaskGroup[], allowFocus: boolean) => groups.map((group) => (
    <div className="agent-panel-group" key={group.name}>
      <h5 className="agent-panel-group-title">{group.name}</h5>
      {group.rows.map((task) => {
        const elapsed = task.status === "running" ? taskElapsedLabel(task.startedAt, nowMs) : "";
        const status = task.status === "running" && elapsed
          ? settingsCopy.taskRunningFor(elapsed)
          : statusLabels[task.status];
        const session = group.rows.length > 1 ? settingsCopy.taskSession(task.id.slice(-8)) : "";
        const focusTask = (event: MouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          if (task.pid === undefined || !isTauri()) return;
          void invoke("focus_process", { pid: task.pid }).catch((error: unknown) => {
            console.warn("Could not focus task window", error);
          });
        };

        return (
          <div className="agent-panel-task" key={task.id}>
            <Dot status={task.status} />
            <div className="agent-panel-task-copy">
              <b title={task.title}>{task.title}</b>
              <span>{[status, session].filter(Boolean).join(" · ")}</span>
            </div>
            {allowFocus && task.pid !== undefined && isTauri() && (
              <button
                aria-label={`${settingsCopy.agentPanelFocusApp}: ${group.name}`}
                className="agent-panel-task-action"
                onClick={focusTask}
                type="button"
              >{settingsCopy.agentPanelFocusApp}</button>
            )}
          </div>
        );
      })}
    </div>
  ));

  return (
    <div className="agent-panel-content">
      <section aria-labelledby="agent-activity-heading" className="agent-panel-section">
        <div className="panel-heading agent-panel-heading">
          <h4 id="agent-activity-heading">{settingsCopy.agentPanelHeading}</h4>
          <span>{settingsCopy.agentPanelTaskSummary(runningCount, attentionCount)}</span>
        </div>
        {attentionGroups.length > 0 && (
          <div className="agent-panel-subsection">
            <h5 className="agent-panel-subheading">{settingsCopy.agentPanelNeedsAttention}</h5>
            {renderTaskGroups(attentionGroups, true)}
          </div>
        )}
        {runningGroups.length > 0 && (
          <div className="agent-panel-subsection">
            <h5 className="agent-panel-subheading">{settingsCopy.agentPanelRunning}</h5>
            {renderTaskGroups(runningGroups, true)}
          </div>
        )}
        {attentionCount + runningCount === 0 && <p className="agent-panel-empty">{settingsCopy.agentPanelNoActiveTasks}</p>}
      </section>

      <section aria-labelledby="agent-history-heading" className="agent-panel-section">
        <div className="panel-heading agent-panel-heading">
          <h4 id="agent-history-heading">{settingsCopy.agentPanelRecentTasks}</h4>
          {recentTasks.length > 0 && <button onClick={(event) => { event.stopPropagation(); onClearHistory(); }} type="button">{settingsCopy.clearHistory}</button>}
        </div>
        <p className="agent-panel-hint">{settingsCopy.agentPanelRecentTasksHint}</p>
        {recentTasks.length > 0 ? <div className="agent-panel-history-list">{recentTasks.map((task) => (
          <div className="agent-panel-task agent-panel-history-task" key={`${task.source}:${task.id}`}>
            <Dot status={task.status} />
            <div className="agent-panel-task-copy">
              <small>{[
                taskGroupName({ ...task, name: "", progress: 0 }, settingsCopy.externalAgents),
                statusLabels[task.status],
                settingsCopy.agentPanelTaskUpdatedAt(formatTaskStartedAt(task.updatedAt)),
              ].join(" · ")}</small>
              <b>{task.status === "done" && isAgentActivityTitle(task.title)
                ? settingsCopy.agentPanelCompletedTask : task.title}</b>
              {task.detail && <p className="agent-panel-task-detail">{task.detail}</p>}
            </div>
          </div>
        ))}</div> : <p className="agent-panel-empty">{settingsCopy.agentPanelNoRecentTasks}</p>}
      </section>

    </div>
  );
}

function App() {
  const isMockMode = import.meta.env.MODE === "mock";
  const [state, dispatch] = useReducer(islandReducer, "idle");
  const [tasks, setTasks] = useState(() => isMockMode ? initialTasks : emptyTasks);
  const [taskHistory, setTaskHistory] = useState(() => loadTaskHistory(window.localStorage));
  const [completionDetails, setCompletionDetails] = useState<Record<string, string>>({});
  const [taskHistoryError, setTaskHistoryError] = useState(false);
  const [taskDoneUntil, setTaskDoneUntil] = useState<number | null>(null);
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
  const selectPillMode = (pillMode: PillMode) => {
    setSettings((current) => ({
      ...current,
      pillMode,
      ...(pillMode === "music" ? { nowPlayingEnabled: true, nowPlayingPeekEnabled: true } : {}),
      ...(pillMode === "timer" ? { reminderTimerEnabled: true } : {}),
    }));
    if (pillMode === "timer") setClockMs(Date.now());
  };
  const [reminderTimer, setReminderTimer] = useState<ReminderTimerState>(() =>
    clearFinishedTimer(loadReminderTimer(window.localStorage), Date.now()));
  const [pillNotice, setPillNotice] = useState<PillNotice | null>(null);
  const [clipboardHistory, setClipboardHistory] = useState(() => loadClipboardHistory(window.localStorage));
  const [clipboardLoading, setClipboardLoading] = useState(false);
  const [clipboardError, setClipboardError] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDateTime, setReminderDateTime] = useState("");
  const [reminderDateSelected, setReminderDateSelected] = useState(false);
  const [reminderSuccess, setReminderSuccess] = useState("");
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
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState | null>(null);
  const [musicVolume, setMusicVolume] = useState<number | null>(null);
  const [mediaTickMs, setMediaTickMs] = useState(Date.now());
  const volumeCommitTimer = useRef<number | null>(null);
  const eventStore = useRef(new EventStore());
  const taskStatuses = useRef(new Map<string, DemoStatus>(
    (isMockMode ? initialTasks : emptyTasks).map((task) => [task.id, task.status]),
  ));
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
  const peekRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastAlertedActivityId = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const peekInfoRef = useRef(peekInfo);
  peekInfoRef.current = peekInfo;
  const lastFinishedTimerId = useRef<string | null>(null);
  const visibleTimer = settings.reminderTimerEnabled ? reminderTimer.timer : null;
  const visibleTimerMs = visibleTimer ? timerRemainingMs(visibleTimer, clockMs) : 0;
  const nextPillReminder = settings.reminderTimerEnabled
    ? reminderTimer.reminders.filter((reminder) => !reminder.notified).sort((left, right) => left.dueAt - right.dueAt)[0]
    : undefined;
  const visiblePillNotice = settings.reminderTimerEnabled ? pillNotice : null;
  const { mode: pillContentMode, showNotice: showModeNotice, showAmbientActivity } = pillPresentation(settings.pillMode, visiblePillNotice !== null);
  const timerEndedMessageVisible = visiblePillNotice?.kind === "timer-ended" && visiblePillNotice.phase !== "filling";
  const pillNoticeCollapsing = visiblePillNotice?.phase === "collapsing";
  const defaultModeNoticeTakeover = settings.pillMode === "all" && visiblePillNotice !== null && !pillNoticeCollapsing;
  const reminderMessageVisible = visiblePillNotice?.kind === "reminder" && visiblePillNotice.phase !== "filling";
  const hasPillActivity = visibleTimer !== null || visiblePillNotice !== null
    || (nextPillReminder !== undefined && visibleTimer === null && visiblePillNotice === null);
  const hasPillLayoutActivity = visiblePillNotice !== null && !pillNoticeCollapsing;
  const visiblePillReminder = !visibleTimer && !visiblePillNotice ? nextPillReminder : undefined;
  const hasReminderActivity = visiblePillReminder !== undefined || visiblePillNotice?.kind === "reminder";
  const showPillProgress = (settings.pillMode === "all" && visiblePillNotice !== null)
    || (showAmbientActivity && hasPillActivity);
  const pillProgress = showPillProgress
    ? visiblePillNotice ? 1 : visibleTimer ? timerProgress(visibleTimer, clockMs)
      : nextPillReminder ? reminderProgress(nextPillReminder, clockMs) : 0
    : 0;
  const agentIntegrationState: AgentIntegrationState = {
    codex: settings.codexEnabled,
    claude: isMockMode || claudeHooksEnabled,
    antigravity: isMockMode || antigravityHooksEnabled,
  };
  const agentIntegrationStateRef = useRef(agentIntegrationState);
  agentIntegrationStateRef.current = agentIntegrationState;
  const visibleTasks = tasks.filter((task) => isAgentIntegrationEnabled(task.source, agentIntegrationState));
  const activeAgentPillTasks = visibleTasks
    .filter((task) => task.status === "needs_input" || task.status === "error" || task.status === "running")
    .sort((left, right) => {
      return aiStatusPriority[left.status] - aiStatusPriority[right.status]
        || (right.startedAt ?? 0) - (left.startedAt ?? 0);
    });
  const agentPillTasks = activeAgentPillTasks.length > 0
    ? activeAgentPillTasks
    : taskDoneUntil !== null && clockMs < taskDoneUntil
      ? visibleTasks.filter((task) => task.status === "done").sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0)).slice(0, 1)
      : [];
  const showNowPlayingStrip = settings.pillMode === "all"
    && settings.nowPlayingEnabled && settings.nowPlayingPeekEnabled && nowPlaying?.playing === true;
  const liveMediaPosition = nowPlaying ? mediaPositionSeconds(nowPlaying, mediaTickMs) : 0;
  const hudShapeRef = useRef<HudShape>({
    width: createSpringAxis(motionTokens.geometry.idle.width),
    height: createSpringAxis(motionTokens.geometry.idle.height),
    radius: createSpringAxis(motionTokens.geometry.idle.radius),
    frame: null,
    lastFrame: null,
  });
  const taskMotionNodes = useRef(new Map<string, HTMLElement>());
  const taskMotionCallbacks = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const taskMotionPositions = useRef(new Map<string, number>());
  const taskMotionRef = (key: string) => {
    let callback = taskMotionCallbacks.current.get(key);
    if (!callback) {
      callback = (node: HTMLElement | null) => {
        if (node) taskMotionNodes.current.set(key, node);
        else {
          taskMotionNodes.current.delete(key);
          taskMotionCallbacks.current.delete(key);
        }
      };
      taskMotionCallbacks.current.set(key, callback);
    }
    return callback;
  };

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    if (settings.pillMode !== "clipboard") return;
    if (isMockMode) {
      setClipboardHistory((current) => current.length > 0 ? current : addClipboardEntry([], 1, "Mock clipboard item", Date.now()));
      setClipboardError("");
      return;
    }
    if (!isTauri()) {
      setClipboardError(settingsCopy.clipboardUnavailable);
      return;
    }

    let active = true;
    let busy = false;
    let lastSequence: number | null = null;
    setClipboardLoading(true);
    setClipboardError("");
    const refresh = () => {
      if (busy) return;
      busy = true;
      void invoke<{ sequence: number; text: string | null } | null>("read_clipboard_snapshot", { lastSequence })
        .then((snapshot) => {
          if (!active) return;
          if (snapshot) {
            lastSequence = snapshot.sequence;
            setClipboardHistory((current) => addClipboardEntry(current, snapshot.sequence, snapshot.text));
          }
          setClipboardError("");
        })
        .catch(() => { if (active) setClipboardError(settingsCopy.clipboardReadFailed); })
        .finally(() => { busy = false; if (active) setClipboardLoading(false); });
    };
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => { active = false; window.clearInterval(timer); setClipboardLoading(false); };
  }, [settings.pillMode, isMockMode]);

  useEffect(() => {
    if (!saveClipboardHistory(window.localStorage, clipboardHistory)) {
      setClipboardError(settingsCopy.clipboardSaveFailed);
    }
  }, [clipboardHistory]);

  useLayoutEffect(() => {
    if (hasNewlyCompletedTask(taskStatuses.current, tasks)) {
      setTaskDoneUntil(Date.now() + motionTokens.timing.taskDoneMs);
    }
    taskStatuses.current = new Map(tasks.map((task) => [task.id, task.status]));
  }, [tasks]);

  useEffect(() => {
    setTaskHistory((current) => tasks.reduce((history, task) => upsertTaskHistory(history, task), current));
  }, [tasks]);

  useEffect(() => {
    setTaskHistoryError(!saveTaskHistory(window.localStorage, taskHistory));
  }, [taskHistory]);

  useEffect(() => {
    if (taskDoneUntil === null) return;
    const remainingMs = taskDoneUntil - Date.now();
    if (remainingMs <= 0) {
      setTaskDoneUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setTaskDoneUntil(null), remainingMs);
    return () => window.clearTimeout(timer);
  }, [taskDoneUntil]);

  const reportHitArea = useCallback(() => {
    if (!isTauri()) return;
    const hud = hudRef.current;
    if (!hud) return;
    const bounds = hud.getBoundingClientRect();
    void invoke("update_hit_area", {
      area: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    }).catch((error: unknown) => console.warn("Could not update overlay hit area", error));
  }, []);

  const updateHoverRegion = useCallback((active: boolean) => {
    if (active) {
      if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
      hoverLeaveTimer.current = null;
      if (clickPinned.current || !shouldExpandPillOnHover(settingsRef.current.pillMode)) return;
      hoverExpanded.current = true;
      dispatch({ type: "hover", active: true });
      return;
    }

    if (!shouldScheduleHoverCollapse(stateRef.current, hoverExpanded.current, clickPinned.current, settingsOpenRef.current)) return;
    if (hoverLeaveTimer.current !== null) return;
    hoverLeaveTimer.current = window.setTimeout(() => {
      hoverExpanded.current = false;
      hoverLeaveTimer.current = null;
      if (peekInfoRef.current.actionEvent || peekInfoRef.current.groupEvents?.some((event) => event.status === "needs_input")) {
        dispatch({ type: "set", state: "peek" });
      } else {
        dispatch({ type: "hover", active: false });
      }
    }, motionTokens.timing.hoverLeaveDelayMs);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<boolean>("overlay-hover-region", ({ payload }) => updateHoverRegion(payload)).then((stopListening) => {
      if (disposed) stopListening();
      else unlisten = stopListening;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [updateHoverRegion]);

  const showEventPeek = (next: AppEvent, groupedEvents: AppEvent[] = [next]) => {
    const group = presentPeekGroup(groupedEvents);
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
        groupEvents: group.visibleEvents,
        groupEventIds: group.allIds,
        overflowCount: group.overflowCount,
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

  const clearTrackedIntegration = (integration: AgentIntegration) => {
    const trackedEvents = eventStore.current.all().filter((event) =>
      event.source === "ai" && getAgentIntegration(event.agent) === integration);
    const trackedIds = new Set(trackedEvents.map((event) => event.id));
    const currentPeek = peekInfoRef.current;
    const currentPeekWasRemoved = activePeekIds.current.some((id) => trackedIds.has(id))
      || getAgentIntegration(currentPeek.actionEvent?.agent) === integration
      || currentPeek.groupEvents?.some((event) => getAgentIntegration(event.agent) === integration) === true;

    trackedEvents.forEach((event) => eventStore.current.dismiss(event.id));
    activePeekIds.current = activePeekIds.current.filter((id) => !trackedIds.has(id));
    setTasks((current) => current.filter((task) => getAgentIntegration(task.source) !== integration));

    if (currentPeekWasRemoved && (stateRef.current === "alert" || stateRef.current === "peek")) {
      clickPinned.current = false;
      hoverExpanded.current = false;
      dispatch({ type: "dismiss" });
      setPulseSource(null);
      showNextQueuedPeek();
    } else if (stateRef.current === "idle") {
      showNextQueuedPeek();
    }
  };

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void invoke<boolean>("get_antigravity_hooks_enabled")
      .then((enabled) => {
        if (disposed) return;
        agentIntegrationStateRef.current = { ...agentIntegrationStateRef.current, antigravity: enabled };
        setAntigravityHooksEnabled(enabled);
      })
      .catch((error: unknown) => console.warn("Could not read Antigravity hook state", error));
    void invoke<boolean>("get_claude_hooks_enabled")
      .then((enabled) => {
        if (disposed) return;
        agentIntegrationStateRef.current = { ...agentIntegrationStateRef.current, claude: enabled };
        setClaudeHooksEnabled(enabled);
      })
      .catch((error: unknown) => console.warn("Could not read Claude hook state", error));
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<boolean>("check_notification_permission")
      .then((granted) => setNotificationPermission(granted))
      .catch((error: unknown) => console.warn("Could not check notification permission", error));
  }, []);

  useEffect(() => () => {
    cancelSpringFrame(hudShapeRef.current, window.cancelAnimationFrame.bind(window));
    if (hoverLeaveTimer.current !== null) window.clearTimeout(hoverLeaveTimer.current);
    hoverLeaveTimer.current = null;
    if (collapseDelayTimer.current !== null) window.clearTimeout(collapseDelayTimer.current);
    collapseDelayTimer.current = null;
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
    const running = visibleTasks.filter((task) => task.status === "running").length;
    const waiting = visibleTasks.filter((task) => task.status === "needs_input").length;
    void invoke("update_tray_status", { running, waiting }).catch((error: unknown) => {
      console.warn("Could not update tray status", error);
    });
  }, [tasks, settings.codexEnabled, claudeHooksEnabled, antigravityHooksEnabled]);

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
    clearTrackedIntegration("codex");
  }, [settings.codexEnabled]);

  useEffect(() => {
    if (isMockMode || antigravityHooksEnabled) return;
    clearTrackedIntegration("antigravity");
  }, [antigravityHooksEnabled, isMockMode]);

  useEffect(() => {
    if (isMockMode || claudeHooksEnabled) return;
    clearTrackedIntegration("claude");
  }, [claudeHooksEnabled, isMockMode]);

  useEffect(() => {
    try {
      saveReminderTimer(window.localStorage, reminderTimer);
    } catch (error) {
      console.warn("Could not save reminder and timer settings", error);
    }
  }, [reminderTimer]);

  useEffect(() => {
    const finishedTimer = reminderTimer.timer;
    if (finishedTimer && finishedTimer.remainingMs === null && finishedTimer.endsAt <= clockMs) {
      setReminderTimer((current) => clearFinishedTimer(current, clockMs));
      if (settings.reminderTimerEnabled && lastFinishedTimerId.current !== finishedTimer.id) {
        lastFinishedTimerId.current = finishedTimer.id;
        setPillNotice({ id: `timer:${finishedTimer.id}`, phase: "filling", kind: "timer-ended" });
      }
      return;
    }
    setReminderTimer((current) => clearFinishedTimer(current, clockMs));
  }, [clockMs, reminderTimer.timer, settings.reminderTimerEnabled]);

  useEffect(() => {
    if (!pillNotice) return;
    if (pillNotice.phase === "filling") {
      const timeout = window.setTimeout(() => {
        setPillNotice((current) => current?.id === pillNotice.id
          ? { ...current, phase: "message" }
          : current);
        if (pillNotice.kind === "reminder" && settings.pillMode !== "all" && stateRef.current === "idle") {
          dispatch({ type: "set", state: "alert" });
        }
      }, 950);
      return () => window.clearTimeout(timeout);
    }
    if (pillNotice.phase === "collapsing") {
      const timeout = window.setTimeout(() => {
        setPillNotice((current) => current?.id === pillNotice.id ? null : current);
      }, motionTokens.timing.timerCollapseMs);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(() => {
      setPillNotice((current) => current?.id === pillNotice.id
        ? afterNoticeMessage(current)
        : current);
    }, settings.peekDurationSeconds * 1_000 + 500);
    return () => window.clearTimeout(timeout);
  }, [pillNotice, settings.peekDurationSeconds, settings.pillMode]);

  useEffect(() => {
    if (settings.pillMode !== "timer") return;
    const delay = 60_000 - (clockMs % 60_000);
    const timeout = window.setTimeout(() => setClockMs(Date.now()), delay);
    return () => window.clearTimeout(timeout);
  }, [settings.pillMode, clockMs]);

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
    setPillNotice({ id: `reminder:${dueKey}`, phase: "filling", kind: "reminder", title: due.title });
    if (settings.pillMode !== "all") {
      setPeekInfo({
        source: settingsCopy.reminder,
        message: due.title,
        dotStatus: "done",
        chatMessages: [],
      });
      setPulseSource(null);
    }
  }, [settings.reminderTimerEnabled, settings.pillMode, reminderTimer, clockMs, state, paused, quietMode, quietEnvironment]);

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
      setNowPlaying((current) => syncMediaPosition(current, {
        title: "Midnight City", artist: "M83", playing: true, positionSeconds: 36, coverDataUrl: null,
      }, Date.now()));
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
        .then((snapshot) => {
          if (!disposed) setNowPlaying((current) => snapshot ? syncMediaPosition(current, snapshot, Date.now()) : null);
        })
        .catch((error: unknown) => console.warn("Could not read Windows media session", error))
        .finally(() => { pending = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [settings.nowPlayingEnabled, settings.nowPlayingPeekEnabled, settings.nowPlayingBrowserMediaEnabled, settings.pillMode, settingsOpen, state]);

  useEffect(() => {
    if (!nowPlaying?.playing) return;
    const timer = window.setInterval(() => setMediaTickMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [nowPlaying?.playing]);

  useEffect(() => {
    if (settings.pillMode !== "music" || state !== "expanded" || settingsOpen || !nowPlaying) {
      setMusicVolume(null);
      return;
    }
    if (isMockMode) {
      setMusicVolume(64);
      return;
    }
    if (!isTauri()) return;
    let active = true;
    const refresh = () => {
      if (volumeCommitTimer.current !== null) return;
      void invoke<number | null>("music_session_volume", { allowBrowserMedia: settings.nowPlayingBrowserMediaEnabled })
        .then((level) => { if (active) setMusicVolume(level); })
        .catch(() => { if (active) setMusicVolume(null); });
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [settings.pillMode, settings.nowPlayingBrowserMediaEnabled, settingsOpen, state, nowPlaying?.title, isMockMode]);

  useEffect(() => () => {
    if (volumeCommitTimer.current !== null) window.clearTimeout(volumeCommitTimer.current);
  }, []);

  const changeMusicVolume = (level: number) => {
    setMusicVolume(level);
    if (isMockMode || !isTauri()) return;
    if (volumeCommitTimer.current !== null) window.clearTimeout(volumeCommitTimer.current);
    volumeCommitTimer.current = window.setTimeout(() => {
      volumeCommitTimer.current = null;
      void invoke<number | null>("set_music_session_volume", {
        level,
        allowBrowserMedia: settings.nowPlayingBrowserMediaEnabled,
      }).then(setMusicVolume).catch(() => setMusicVolume(null));
    }, 150);
  };

  const controlNowPlaying = (action: "play" | "pause" | "previous" | "next") => {
    const updatePlaybackState = () => {
      setNowPlaying((current) => {
        if (!current) return current;
        const nowMs = Date.now();
        return {
          ...current,
          positionSeconds: mediaPositionSeconds(current, nowMs),
          sampledAtMs: nowMs,
          playing: action === "play",
        };
      });
    };
    if (!isTauri()) {
      if (action === "play" || action === "pause") updatePlaybackState();
      return;
    }
    void invoke("control_now_playing", {
      action,
      allowBrowserMedia: settingsRef.current.nowPlayingBrowserMediaEnabled,
    }).then(() => {
      if (action === "play" || action === "pause") updatePlaybackState();
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
      if (payload.source === "ai"
          && !isAgentIntegrationEnabled(payload.agent, agentIntegrationStateRef.current)) return;
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
          title: payload.status === "running" ? agentActivityLabel(payload.title) : payload.title,
          progress: payload.progress ?? (payload.status === "done" ? 1 : 0),
          ...(payload.startedAt && Number.isFinite(Date.parse(payload.startedAt))
            ? { startedAt: Date.parse(payload.startedAt) }
            : {}),
          ...(payload.pid !== undefined ? { pid: payload.pid } : {}),
          ...(payload.cwd ? { cwd: payload.cwd } : {}),
          ...(payload.usage ? { usage: payload.usage } : {}),
        };
        const detailKey = `${task.source}:${task.id}`;
        if (task.status === "running") {
          setCompletionDetails((current) => {
            if (!(detailKey in current)) return current;
            const next = { ...current };
            delete next[detailKey];
            return next;
          });
        } else if (task.status === "done" && task.source === "codex") {
          const detail = taskCompletionPreview(payload.body);
          if (detail) setCompletionDetails((current) => ({ ...current, [detailKey]: detail }));
        }
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
        ? peekRef.current?.scrollHeight || motionTokens.geometry.tallPeek.multiMessageBase
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
    } else if (settings.pillMode !== "all") {
      ({ width, height } = modePillSize(settings.pillMode));
      radius = motionTokens.geometry.peek.radius;
    } else {
      width = showNowPlayingStrip
        ? motionTokens.geometry.activityWidth.withNowPlaying
        : motionTokens.geometry.idle.width;
      const hasActivity = showNowPlayingStrip || hasPillLayoutActivity;
      height = defaultModeNoticeTakeover || hasActivity ? motionTokens.geometry.peek.height : motionTokens.geometry.idle.height;
      radius = defaultModeNoticeTakeover || hasActivity ? motionTokens.geometry.peek.radius : motionTokens.geometry.idle.radius;
      if (defaultModeNoticeTakeover) width = motionTokens.geometry.peek.width;
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
          const geometrySpring = pillNoticeCollapsing && settings.pillMode === "all"
            ? motionTokens.spring.timerCollapse
            : motionTokens.spring.morph;
          const noticeHeightSpring = defaultModeNoticeTakeover && previousState === "expanded"
            ? motionTokens.spring.noticeTakeover
            : geometrySpring;
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
          shape.width = advanceSpringAxis(shape.width, deltaSeconds, geometrySpring);
          shape.height = advanceSpringAxis(shape.height, deltaSeconds, noticeHeightSpring);
          shape.radius = advanceSpringAxis(shape.radius, deltaSeconds, geometrySpring);
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
    const noticeTakesOverExpandedPanel = defaultModeNoticeTakeover && previousState === "expanded";
    if (isLeavingContent && !noticeTakesOverExpandedPanel) {
      collapseDelayTimer.current = window.setTimeout(() => {
        collapseDelayTimer.current = null;
        startAnimation();
      }, motionTokens.timing.contentOutMs);
      return;
    }
    startAnimation();
  }, [state, tasks, messages, peekInfo, systemMetrics, settingsOpen, settings.reminderTimerEnabled, settings.pillMode, reminderTimer, pillNotice, activityError, showNowPlayingStrip, nowPlaying, visibleTimer, hasPillActivity, hasReminderActivity, clockMs, reportHitArea]);

  const codexRows = codexTaskRowsForPanel(visibleTasks, settings.codexEnabled, settingsCopy.noActiveTask);
  const codex = codexRows[0] ?? emptyTasks[0];
  const claudeTasks = visibleTasks.filter((task) => task.source === "claude");
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
  const antigravityTasks = visibleTasks.filter((task) => task.source === "antigravity-app" || task.source === "antigravity-cli" || task.source === "antigravity-ide");
  const externalTasks = visibleTasks.filter((task) => task.source === "external");
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
  const taskGroups = groupTasksByAgent(
    [...codexRows, ...claudeRows, ...antigravityRows, ...externalTasks],
    settingsCopy.externalAgents,
  );
  const agentNeedsAttentionTasks = visibleTasks
    .filter((task) => task.status === "needs_input" || task.status === "error")
    .sort((left, right) => {
      return aiStatusPriority[left.status] - aiStatusPriority[right.status]
        || (right.startedAt ?? 0) - (left.startedAt ?? 0);
    });
  const agentRunningTasks = visibleTasks
    .filter((task) => task.status === "running")
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0));
  const recentAgentTasks = taskHistory
    .filter((task) => isAgentIntegrationEnabled(task.source, agentIntegrationState))
    .map((task) => ({ ...task, detail: task.status === "done" ? completionDetails[`${task.source}:${task.id}`] : undefined }));
  const agentNeedsAttentionGroups = groupTasksByAgent(agentNeedsAttentionTasks, settingsCopy.externalAgents);
  const agentRunningGroups = groupTasksByAgent(agentRunningTasks, settingsCopy.externalAgents);
  const taskMotionLayoutKey = taskGroups
    .map((group) => `${group.name}:${group.rows.map((task) => task.id).join(",")}`)
    .join("|");
  useLayoutEffect(() => {
    const activeKeys = new Set(taskGroups.flatMap((group) => group.rows.map((task) => `task:${task.id}`)));
    if (state !== "expanded" || settingsOpen) {
      taskMotionPositions.current.clear();
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nextPositions = new Map<string, number>();
    for (const [key, node] of taskMotionNodes.current) {
      if (!node.isConnected || !activeKeys.has(key)) continue;
      const top = node.getBoundingClientRect().top;
      const previousTop = taskMotionPositions.current.get(key);
      if (!reducedMotion && previousTop !== undefined && Math.abs(previousTop - top) > 1) {
        node.animate(
          [
            { translate: `0px ${previousTop - top}px` },
            { translate: "0px 0px" },
          ],
          { duration: motionTokens.timing.rowExitMs, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
      }
      nextPositions.set(key, top);
    }
    taskMotionPositions.current = nextPositions;
  }, [taskMotionLayoutKey, state, settingsOpen]);
  const aiDotStatus = aggregateTaskDotStatus(visibleTasks, taskDoneUntil);
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
      setReminderSuccess("");
      return;
    }
    if (reminderTimer.reminders.length >= maxReminders) {
      setActivityError(settingsCopy.reminderLimit);
      setReminderSuccess("");
      return;
    }
    setReminderTimer((current) => ({
      ...current,
      reminders: [...current.reminders, {
        id: crypto.randomUUID(),
        title: title.slice(0, 80),
        dueAt,
        notified: false,
        startsAt: now,
        relative: reminderSchedule === "after",
        repeatMs: reminderSchedule === "after" && repeatReminder ? durationMs : null,
      }].sort((left, right) => left.dueAt - right.dueAt),
    }));
    setReminderTitle("");
    setReminderDateTime("");
    setReminderDateSelected(false);
    setRepeatReminder(false);
    setActivityError("");
    setReminderSuccess(settingsCopy.reminderAdded(new Date(dueAt)));
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
      timer: { id: crypto.randomUUID(), endsAt: now + durationMs, durationMs, remainingMs: null, notified: false },
    }));
    setPillNotice(null);
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
    setCompletionDetails((current) => {
      const next = { ...current };
      delete next[`codex:${codex.id}`];
      return next;
    });
    setTasks((current) => current.map((task) => task.source === "codex"
      ? { ...task, status: "running", title: "database migration", progress: 0.42, startedAt }
      : task));
    showPeek("codex", "Codex", "Starting: database migration", "running");
  };

  const finishTask = () => {
    if (!settingsRef.current.codexEnabled) return;
    setCompletionDetails((current) => ({
      ...current,
      [`codex:${codex.id}`]: "Completed the database migration and checked the updated schema and queries.",
    }));
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
    const taskTitle = `${agentName} task`;
    const activity = `${taskTitle} ${status === "running" ? "running" : "completed"}`;
    setTasks((current) => upsertTask(current, {
      id,
      source,
      name: `${agentName} · ${id.slice(0, 8)}`,
      status,
      title: taskTitle,
      progress: status === "done" ? 1 : 0.6,
      startedAt: previous?.startedAt ?? Date.now(),
    }));
    showPeek("ai", agentName, activity, status);
  };

  const showMockClaudeTask = () => {
    const id = "mock-claude-session";
    const previous = tasks.find((task) => task.id === id);
    const status = previous?.status === "running" ? "needs_input"
      : previous?.status === "needs_input" ? "done" : "running";
    const title = "Review a code change";
    const activity = status === "running" ? "Claude is working"
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
    showPeek("ai", "Claude", activity, status);
  };

  const showMockExternalTask = () => {
    const id = "mock-external-session";
    const previous = tasks.find((task) => task.id === id);
    const status = previous?.status === "running" ? "needs_input"
      : previous?.status === "needs_input" ? "done" : "running";
    const title = "Prepare a task summary";
    const activity = status === "running" ? "Example Agent task running"
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
    showPeek("ai", "Example Agent", activity, status);
  };

  const showMockReminderTimer = () => {
    const now = Date.now();
    setSettings((current) => ({ ...current, nowPlayingEnabled: true, nowPlayingPeekEnabled: true, reminderTimerEnabled: true }));
    setReminderTimer({
      reminders: [{ id: crypto.randomUUID(), title: "Drink water", dueAt: now + 15 * 60_000, notified: false, startsAt: now, relative: true, repeatMs: 15 * 60_000 }],
      timer: { id: crypto.randomUUID(), endsAt: now + 5 * 60_000, durationMs: 5 * 60_000, remainingMs: null, notified: false },
    });
    setClockMs(now);
    dispatch({ type: "set", state: "idle" });
  };

  const showMockActivityDue = (kind: "timer" | "reminder") => {
    const now = Date.now();
    setSettings((current) => ({ ...current, reminderTimerEnabled: true }));
    setReminderTimer(kind === "timer"
      ? { reminders: [], timer: { id: crypto.randomUUID(), endsAt: now, durationMs: 60_000, remainingMs: null, notified: false } }
      : { reminders: [{ id: crypto.randomUUID(), title: "Drink water", startsAt: now - 60_000, dueAt: now, notified: false, relative: true, repeatMs: null }], timer: null });
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

  const showMockNotificationBurst = () => {
    const receivedAt = Date.now();
    const names = ["Rina", "Budi", "Sari", "Dimas", "Nina"];
    Array.from({ length: 10 }, (_, index) => names[index % names.length]).forEach((sender, index) => {
      const id = `mock-notification-burst-${receivedAt}-${index}`;
      const app = index === 9 ? "Teams" : "WhatsApp";
      const body = `Mock message ${index + 1}`;
      eventStore.current.upsert({
        id,
        source: "chat",
        kind: "message",
        status: "unread",
        title: sender,
        body,
        meta: { app, sender },
      }, receivedAt + index);
      setMessages((current) => upsertChatMessage(current, {
        id, sender, body, receivedAt, createdAt: receivedAt + index, unread: true, app,
      }));
    });
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
            const title = task.title;
            const elapsed = taskElapsedLabel(task.startedAt, clockMs);
            const status = task.status === "running"
              ? elapsed ? settingsCopy.taskRunningFor(elapsed) : statusLabels.running
              : task.status === "idle" ? "" : statusLabels[task.status];
            const session = group.rows.length > 1 ? settingsCopy.taskSession(task.id.slice(-8)) : "";
            const subtitle = [status, session].filter(Boolean).join(" · ");
            const summary = <TaskSummaryCopy signature={`${task.status}:${title}`} title={title} meta={subtitle} />;
            const focusTask = () => {
              if (!isTauri() || task.pid === undefined) return;
              void invoke("focus_process", { pid: task.pid }).catch((error: unknown) => {
                console.warn("Could not focus task window", error);
              });
            };

            return task.pid !== undefined && isTauri() ? (
              <button className="task-summary" key={task.id} onClick={(event) => {
                event.stopPropagation();
                focusTask();
              }} ref={taskMotionRef(`task:${task.id}`)} type="button">
                {summary}
              </button>
            ) : (
              <div className="task-summary task-summary-static" key={task.id} ref={taskMotionRef(`task:${task.id}`)}>
                {summary}
              </div>
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
        data-progress-active={showPillProgress ? "true" : undefined}
        data-progress-paused={visibleTimer && visibleTimer.remainingMs !== null ? "true" : undefined}
        data-progress-notice={visiblePillNotice?.phase}
        data-activity-kind={hasReminderActivity ? "reminder" : "timer"}
        style={{ "--pill-progress": `${pillProgress * 100}%` } as CSSProperties}
        onClick={onHudClick}
        onKeyDown={onHudKeyDown}
        onMouseEnter={() => updateHoverRegion(true)}
        onMouseLeave={() => updateHoverRegion(false)}
        ref={hudRef}
        role="button"
        tabIndex={0}
      >
        {showPillProgress && (
          <span
            aria-hidden="true"
            className="pill-progress-fill"
            data-wave={showAmbientActivity && showsPillWave(pillProgress, visiblePillNotice?.phase) ? "true" : undefined}
          />
        )}
        <div className="hud-content">
        <div className={`layer dots${settings.pillMode === "all" && (showNowPlayingStrip || hasPillLayoutActivity) ? " dots-with-activity" : ""}${defaultModeNoticeTakeover ? " dots-notice-takeover" : ""}${pillNoticeCollapsing && settings.pillMode === "all" ? " dots-notice-returning" : ""}${settings.pillMode !== "all" ? ` mode-pill mode-pill-${settings.pillMode}` : ""}`}>
          {defaultModeNoticeTakeover ? (
            visiblePillNotice?.phase === "message" && (
              <div className="pill-notice-takeover" aria-atomic="true">
                <ActivityDial progress={1} kind={visiblePillNotice.kind === "reminder" ? "reminder" : "timer"} complete />
                <span className="pill-notice-copy">
                  <b>{visiblePillNotice.kind === "timer-ended" ? settingsCopy.timerEnded : settingsCopy.reminder}</b>
                  {visiblePillNotice.kind === "reminder" && <span title={visiblePillNotice.title}>{visiblePillNotice.title}</span>}
                </span>
              </div>
            )
          ) : pillContentMode === "all" ? (
            <>
              {showNowPlayingStrip && nowPlaying && (
                <span className="now-playing-peek" title={`${settingsCopy.nowPlaying}: ${nowPlaying.title}`}>
                  <MusicBars playing={nowPlaying.playing} />
                  <span className="now-playing-copy">
                    <ScrollingSongTitle key={nowPlaying.title} title={nowPlaying.title} />
                    <small><span>{nowPlaying.artist}</span><time aria-live="off" className="now-playing-position">{settingsCopy.musicPosition(liveMediaPosition)}</time></small>
                  </span>
                </span>
              )}
              <Dot
                status={aiHasRunning ? "running" : aiDotStatus}
                pulse={pulseSource === "ai" || pulseSource === "codex"}
                className={aiHasRunning ? "active" : ""}
              />
              <Dot status={unreadCount > 0 ? "done" : "idle"} badge={unreadCount > 0} pulse={pulseSource === "chat"} />
              <Dot status={systemStatus} progress={systemLoad / 100} ring={systemLoad > 0} pulse={pulseSource === "system"} />
            </>
          ) : pillContentMode === "music" ? (
            <div className="pill-mode-content music-mode">
              <MusicBars playing={nowPlaying?.playing === true} />
              {nowPlaying ? (
                <>
                  <div className="music-mode-copy">
                    <ScrollingSongTitle key={nowPlaying.title} title={nowPlaying.title} />
                    <span title={nowPlaying.artist}>{nowPlaying.artist}</span>
                  </div>
                  <time aria-live="off" className="music-mode-position">{settingsCopy.musicPosition(liveMediaPosition)}</time>
                </>
              ) : <span className="mode-pill-empty">{settingsCopy.noMedia}</span>}
            </div>
          ) : pillContentMode === "agents" ? (
            <div className="agent-mode-list">
              {agentPillTasks.slice(0, 1).map((task) => (
                <button
                  aria-label={`${task.name.split(" · ")[0]} · ${statusLabels[task.status]} · ${task.title}`}
                  className="agent-mode-row"
                  disabled={task.pid === undefined || !isTauri()}
                  key={task.id}
                  title={`${statusLabels[task.status]}: ${task.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (task.pid !== undefined && isTauri()) {
                      void invoke("focus_process", { pid: task.pid }).catch((error: unknown) => console.warn("Could not focus task window", error));
                    }
                  }}
                  type="button"
                >
                  <Dot status={task.status} />
                  <b>{task.name.split(" · ")[0]}</b>
                  <span title={task.title}>{task.title}</span>
                </button>
              ))}
              {agentPillTasks.length === 0 && <span className="mode-pill-empty">{settingsCopy.agentPanelNoActiveTasks}</span>}
              {agentPillTasks.length > 1 && (
                <span className="agent-mode-overflow">{settingsCopy.moreUpdates(agentPillTasks.length - 1)}</span>
              )}
            </div>
          ) : pillContentMode === "clipboard" ? (
            <div className="pill-mode-content utility-mode">
              <ClipboardModeIcon />
              <div className="utility-mode-copy">
                <b>{settingsCopy.pillModeClipboard}</b>
                <span>{settingsCopy.clipboardCount(clipboardHistory.length)}</span>
              </div>
            </div>
          ) : (
            <div className="pill-mode-content timer-mode">
              <ActivityDial progress={pillProgress} kind={hasReminderActivity ? "reminder" : "timer"} paused={visibleTimer?.remainingMs !== null && visibleTimer !== null} complete={visiblePillNotice?.phase === "message"} />
              <div className="timer-mode-copy" key={visiblePillNotice ? `${visiblePillNotice.id}:${visiblePillNotice.phase}` : "activity"}>
                <b title={visiblePillNotice?.kind === "reminder" ? visiblePillNotice.title : nextPillReminder?.title}>{timerEndedMessageVisible ? settingsCopy.timerEnded
                  : visiblePillNotice?.kind === "timer-ended" ? settingsCopy.timer
                    : visiblePillNotice?.kind === "reminder" && reminderMessageVisible ? visiblePillNotice.title
                      : visiblePillNotice?.kind === "reminder" ? settingsCopy.reminder
                    : visibleTimer ? settingsCopy.timer : nextPillReminder?.title ?? settingsCopy.reminderTimer}</b>
                <div className="timer-mode-detail">{timerEndedMessageVisible ? ""
                  : visiblePillNotice?.kind === "timer-ended" ? "0:00"
                    : visiblePillNotice?.kind === "reminder" && reminderMessageVisible ? settingsCopy.reminderDue
                      : visiblePillNotice?.kind === "reminder" ? ""
                    : visibleTimer
                  ? <><ActivityCountdown milliseconds={visibleTimerMs} />{visibleTimer.remainingMs !== null && <span className="activity-paused-label">{settingsCopy.timerPaused}</span>}</>
                  : nextPillReminder ? <span title={reminderTimingLabel(nextPillReminder, clockMs)}>{nextPillReminder.relative
                    ? <ActivityCountdown milliseconds={nextPillReminder.dueAt - clockMs} />
                    : reminderTimingLabel(nextPillReminder, clockMs)}</span> : settingsCopy.timerNone}</div>
              </div>
              <time className="timer-local-time">{settingsCopy.currentTime(new Date(clockMs))}</time>
            </div>
          )}
          {showModeNotice && visiblePillNotice && (
            <div className="mode-activity-notice" role="status" aria-live="polite" title={visiblePillNotice.kind === "reminder" ? visiblePillNotice.title : settingsCopy.timerEnded}>
              <ActivityDial progress={1} kind={visiblePillNotice.kind === "reminder" ? "reminder" : "timer"} complete={visiblePillNotice.phase === "message"} />
              <span>{visiblePillNotice.kind === "reminder" ? visiblePillNotice.title : settingsCopy.timerEnded}</span>
            </div>
          )}
        </div>

        <div ref={peekRef} className={`layer peek${(peekInfo.groupEvents?.length ?? 0) > 1 ? " peek-multi" : ""}${peekInfo.actionEvent ? " peek-approval" : ""}`}>
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
          onPointerLeave={() => updateHoverRegion(false)}
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
                    <option value="top-center">{settingsCopy.topCenter}</option>
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
                  agentIntegrationStateRef.current = { ...agentIntegrationStateRef.current, codex: enabled };
                  setSettings((current) => ({ ...current, codexEnabled: enabled }));
                }} />
                <SettingsSwitch label={settingsCopy.antigravityHooks} checked={antigravityHooksEnabled} disabled={!isTauri()} onChange={(enabled) => {
                  void invoke<boolean>("set_antigravity_hooks_enabled", { enabled })
                    .then((nextEnabled) => {
                      agentIntegrationStateRef.current = { ...agentIntegrationStateRef.current, antigravity: nextEnabled };
                      setAntigravityHooksEnabled(nextEnabled);
                    })
                    .catch((error: unknown) => console.warn("Could not update Antigravity hooks", error));
                }} />
                <SettingsSwitch label={settingsCopy.claudeHooks} checked={claudeHooksEnabled} disabled={!isTauri()} onChange={(enabled) => {
                  void invoke<boolean>("set_claude_hooks_enabled", { enabled })
                    .then((nextEnabled) => {
                      agentIntegrationStateRef.current = { ...agentIntegrationStateRef.current, claude: nextEnabled };
                      setClaudeHooksEnabled(nextEnabled);
                    })
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
          ) : settings.pillMode === "clipboard" && state === "expanded" ? (
            <ClipboardPanel
              history={clipboardHistory}
              error={clipboardError}
              loading={clipboardLoading}
              mockPreview={isMockMode}
              mode={settings.pillMode}
              onSelectMode={selectPillMode}
              onOpenSettings={() => setSettingsOpen(true)}
              onDelete={(id) => setClipboardHistory((current) => current.filter((entry) => entry.id !== id))}
              onClear={() => setClipboardHistory([])}
            />
          ) : (
            <>
              <PanelModeToolbar mode={settings.pillMode} onSelectMode={selectPillMode} onOpenSettings={() => setSettingsOpen(true)} />
              {settings.pillMode === "agents" ? (
                <>
                <AgentPanel
                  attentionGroups={agentNeedsAttentionGroups}
                  runningGroups={agentRunningGroups}
                  recentTasks={recentAgentTasks}
                  nowMs={clockMs}
                  onClearHistory={() => { clearTaskHistory(window.localStorage); setTaskHistory([]); setCompletionDetails({}); }}
                />
                {taskHistoryError && <p className="utility-state utility-error" role="alert">{settingsCopy.historySaveFailed}</p>}
                </>
              ) : (
                <>
              {settings.pillMode === "all" && <>
                <h4 className="panel-mode-title">AI Tasks</h4>
                {taskGroups.map(taskGroupRow)}
              </>}
              {(settings.pillMode === "all" || settings.pillMode === "music") && settings.nowPlayingEnabled && (
                <section aria-label={settingsCopy.nowPlaying} className={`now-playing${settings.pillMode === "music" ? " music-panel" : ""}`} data-playing={nowPlaying?.playing ?? false}>
                  <h4>{settingsCopy.nowPlaying}</h4>
                  {nowPlaying ? (
                    <div className="now-playing-card">
                      {nowPlaying.coverDataUrl
                        ? <img alt="" className="now-playing-cover" src={nowPlaying.coverDataUrl} />
                        : <div aria-hidden="true" className="now-playing-cover now-playing-placeholder">♫</div>}
                      <div className="now-playing-info">
                        <ScrollingSongTitle key={nowPlaying.title} title={nowPlaying.title} />
                        <span title={nowPlaying.artist}>{nowPlaying.artist}</span>
                        {settings.pillMode === "music" ? (
                          <div className="music-card-meta">
                            <small>{nowPlaying.playing ? settingsCopy.playing : settingsCopy.paused}</small>
                            <time aria-live="off">{settingsCopy.musicPosition(liveMediaPosition)}</time>
                          </div>
                        ) : <small>{nowPlaying.playing ? settingsCopy.playing : settingsCopy.paused}</small>}
                      </div>
                      <div className="now-playing-actions">
                        <button aria-label={settingsCopy.previousTrack} onClick={(event) => { event.stopPropagation(); controlNowPlaying("previous"); }} type="button">
                          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M13.5 4.5 6.5 10l7 5.5M4.5 5v10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>
                        </button>
                        <button aria-label={nowPlaying.playing ? settingsCopy.pause : settingsCopy.play} className="now-playing-primary" onClick={(event) => { event.stopPropagation(); controlNowPlaying(nowPlaying.playing ? "pause" : "play"); }} type="button">
                          <svg aria-hidden="true" viewBox="0 0 20 20">
                            {nowPlaying.playing
                              ? <path d="M5.5 4.5h3v11h-3zM11.5 4.5h3v11h-3z" />
                              : <path d="M6 4.5v11l9-5.5z" />}
                          </svg>
                        </button>
                        <button aria-label={settingsCopy.nextTrack} onClick={(event) => { event.stopPropagation(); controlNowPlaying("next"); }} type="button">
                          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6.5 4.5 7 5.5-7 5.5M15.5 5v10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>
                        </button>
                      </div>
                    </div>
                  ) : <p className="now-playing-empty">{settingsCopy.noMedia}</p>}
                </section>
              )}
              {settings.pillMode === "music" && (
                <MusicVolumeControl volume={musicVolume} onChange={changeMusicVolume} />
              )}
              {(settings.pillMode === "all" || settings.pillMode === "timer") && settings.reminderTimerEnabled
                && (settings.pillMode === "timer" || reminderTimer.reminders.length > 0 || reminderTimer.timer) && (
                <section className="activity-panel" aria-label={settingsCopy.reminderTimer}>
                  <h4>{settingsCopy.reminderTimer}</h4>
                  {settings.pillMode === "timer" && reminderTimer.reminders.length === 0 && !visibleTimer && (
                    <p className="activity-empty">{settingsCopy.noActiveRemindersOrTimer}</p>
                  )}
                  {reminderTimer.reminders.map((reminder) => (
                    <div className="activity-panel-row reminder-panel-row" key={reminder.id}>
                      <ActivityDial progress={reminderProgress(reminder, clockMs)} kind="reminder" complete={reminder.notified} />
                      <span title={reminder.title}><b>{reminder.title}</b><small>{reminderTimingLabel(reminder, clockMs)}</small></span>
                      <button type="button" aria-label={`${settingsCopy.removeReminder}: ${reminder.title}`} onClick={(event) => {
                        event.stopPropagation();
                        setReminderTimer((current) => ({ ...current, reminders: current.reminders.filter((item) => item.id !== reminder.id) }));
                      }}>×</button>
                    </div>
                  ))}
                  {visibleTimer && (
                    <div className="activity-panel-row timer-panel-row">
                      <ActivityDial progress={timerProgress(visibleTimer, clockMs)} paused={visibleTimer.remainingMs !== null} />
                      <span className="timer-panel-value"><b>{visibleTimer.remainingMs !== null ? settingsCopy.timerPaused : settingsCopy.timer}</b><ActivityCountdown milliseconds={visibleTimerMs} /></span>
                      <div className="timer-panel-actions">
                        {visibleTimerMs > 0 && <button type="button" onClick={(event) => { event.stopPropagation(); toggleTimerPause(); }}>{visibleTimer.remainingMs === null ? settingsCopy.pauseTimer : settingsCopy.resumeTimer}</button>}
                        <button type="button" onClick={(event) => { event.stopPropagation(); setReminderTimer((current) => ({ ...current, timer: null })); }}>{settingsCopy.cancelTimer}</button>
                      </div>
                    </div>
                  )}
                </section>
              )}
              {settings.pillMode === "timer" && <LocalCalendar reminders={reminderTimer.reminders} nowMs={clockMs} />}
              {settings.pillMode === "timer" && settings.reminderTimerEnabled && (
                <section aria-label={settingsCopy.createReminderOrTimer} className="reminder-timer-create" onClick={(event) => event.stopPropagation()}>
                  <h4>{settingsCopy.createReminderOrTimer}</h4>
                  <h5>{settingsCopy.reminder}</h5>
                  <form onSubmit={(event) => { event.preventDefault(); addReminder(); }}>
                    <input
                      aria-label={settingsCopy.reminderTitle}
                      maxLength={80}
                      placeholder={settingsCopy.reminderTitle}
                      value={reminderTitle}
                      onChange={(event) => { setReminderTitle(event.target.value); setReminderSuccess(""); }}
                    />
                    <label className="reminder-schedule-mode">
                      <span>{settingsCopy.reminderSchedule}</span>
                      <select value={reminderSchedule} onChange={(event) => { setReminderSchedule(event.target.value as ReminderSchedule); setReminderSuccess(""); }}>
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
                      <ReminderDateField
                        value={reminderDateTime}
                        selected={reminderDateSelected}
                        onChange={(value) => { setReminderDateTime(value); setReminderDateSelected(false); setReminderSuccess(""); }}
                        onDone={() => setReminderDateSelected(Boolean(reminderDateTime))}
                      />
                    )}
                    <button type="submit">{settingsCopy.addReminder}</button>
                  </form>
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
                  {activityError && <p className="setting-error" role="alert">{activityError}</p>}
                  {reminderSuccess && <p className="reminder-success" role="status">{reminderSuccess}</p>}
                </section>
              )}
              {settings.pillMode === "timer" && !settings.reminderTimerEnabled && (
                <section aria-label={settingsCopy.createReminderOrTimer} className="reminder-timer-create" onClick={(event) => event.stopPropagation()}>
                  <button onClick={(event) => {
                    event.stopPropagation();
                    setSettings((current) => ({ ...current, reminderTimerEnabled: true }));
                    setClockMs(Date.now());
                  }} type="button">{settingsCopy.enableReminderTimer}</button>
                </section>
              )}
              {settings.pillMode === "all" && <>
              <div className="panel-heading chat-panel-heading">
                <h4>Chat{unreadCount > 0 ? ` · ${unreadCount} unread` : ""}</h4>
                {whatsappMessageCount > 0 && (
                  <button aria-label={settingsCopy.clearAllWhatsAppAccessible} onClick={clearAllWhatsAppMessages} type="button">
                    {settingsCopy.clearAllWhatsApp}
                  </button>
                )}
              </div>
              {messages.map((message, index) => (
                <ChatNotificationRow
                  exiting={exitingMessages.includes(message.id)}
                  index={index}
                  key={message.id}
                  message={message}
                  onDismiss={dismissMessage}
                />
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
              </>}
                </>
              )}
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
          <button onClick={showMockNotificationBurst}>{settingsCopy.mockNotificationBurst}</button>
          <button onClick={() => showMockAntigravityTask("antigravity-cli")}>Antigravity CLI task</button>
          <button onClick={() => showMockAntigravityTask("antigravity-ide")}>Antigravity IDE task</button>
          <button onClick={() => showMockAntigravityTask("antigravity-app")}>Antigravity App task</button>
          <button onClick={showMockClaudeTask}>Claude task</button>
          <button onClick={showMockExternalTask}>{settingsCopy.mockExternalTask}</button>
          <button onClick={showMockReminderTimer}>{settingsCopy.mockReminderTimer}</button>
          <button onClick={() => showMockActivityDue("timer")}>{settingsCopy.mockTimerEnded}</button>
          <button onClick={() => showMockActivityDue("reminder")}>{settingsCopy.mockReminderDue}</button>
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
