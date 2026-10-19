export type Reminder = {
  id: string;
  title: string;
  dueAt: number;
  notified: boolean;
  startsAt?: number;
  relative?: boolean;
  repeatMs?: number | null;
};

export type CountdownTimer = {
  id: string;
  endsAt: number;
  durationMs: number;
  remainingMs: number | null;
  notified: boolean;
};

export type ReminderTimerState = {
  reminders: Reminder[];
  timer: CountdownTimer | null;
};

export type DueActivity = { kind: "reminder"; id: string; title: string; dueAt: number };

const storageKey = "dot-notifier-reminder-timer";
export const maxReminders = 20;
export const maxDurationMs = 24 * 60 * 60 * 1_000;
export const emptyReminderTimer: ReminderTimerState = { reminders: [], timer: null };

export type DurationUnit = "seconds" | "minutes" | "hours";

export const durationToMs = (value: number, unit: DurationUnit): number | null => {
  if (!Number.isSafeInteger(value) || value < 1) return null;
  const multiplier = unit === "hours" ? 3_600_000 : unit === "minutes" ? 60_000 : 1_000;
  const duration = value * multiplier;
  return duration <= maxDurationMs ? duration : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const loadReminderTimer = (storage: Pick<Storage, "getItem">, now = Date.now()): ReminderTimerState => {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return emptyReminderTimer;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyReminderTimer;

    const reminders = (Array.isArray(parsed.reminders) ? parsed.reminders : [])
      .filter(isRecord)
      .filter((item) => typeof item.id === "string" && typeof item.title === "string"
        && typeof item.dueAt === "number" && Number.isFinite(item.dueAt)
        && item.dueAt > 0 && item.dueAt <= 8.64e15)
      .map((item) => ({
        id: item.id as string,
        title: (item.title as string).trim().slice(0, 80),
        dueAt: item.dueAt as number,
        notified: item.notified === true,
        ...(typeof item.startsAt === "number" && Number.isFinite(item.startsAt)
          && item.startsAt >= 0 && item.startsAt < (item.dueAt as number)
          ? { startsAt: item.startsAt }
          : {}),
        relative: item.relative === true,
        repeatMs: typeof item.repeatMs === "number" && Number.isSafeInteger(item.repeatMs)
          && item.repeatMs > 0 && item.repeatMs <= maxDurationMs ? item.repeatMs : null,
      }))
      .filter((item) => item.title.length > 0)
      .slice(0, maxReminders)
      .sort((left, right) => left.dueAt - right.dueAt);

    const storedTimer = parsed.timer;
    const timer = isRecord(storedTimer)
      && typeof storedTimer.id === "string"
      && typeof storedTimer.endsAt === "number" && Number.isFinite(storedTimer.endsAt)
      && storedTimer.endsAt > 0 && storedTimer.endsAt <= 8.64e15
      && (storedTimer.remainingMs === null || typeof storedTimer.remainingMs === "number"
        && Number.isFinite(storedTimer.remainingMs) && storedTimer.remainingMs >= 0)
      ? {
        id: storedTimer.id,
        endsAt: storedTimer.endsAt,
        durationMs: typeof storedTimer.durationMs === "number" && Number.isSafeInteger(storedTimer.durationMs)
          && storedTimer.durationMs > 0 && storedTimer.durationMs <= maxDurationMs
          ? storedTimer.durationMs
          : Math.min(maxDurationMs, Math.max(1, (storedTimer.remainingMs as number | null) ?? storedTimer.endsAt - now)),
        remainingMs: storedTimer.remainingMs as number | null,
        notified: storedTimer.notified === true,
      }
      : null;

    return { reminders, timer };
  } catch {
    return emptyReminderTimer;
  }
};

export const saveReminderTimer = (storage: Pick<Storage, "setItem">, value: ReminderTimerState): void => {
  storage.setItem(storageKey, JSON.stringify(value));
};

export const timerRemainingMs = (timer: CountdownTimer, now: number): number =>
  Math.max(0, timer.remainingMs ?? timer.endsAt - now);

export const timerProgress = (timer: CountdownTimer, now: number): number => {
  if (timer.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - timerRemainingMs(timer, now) / timer.durationMs));
};

export const reminderProgress = (reminder: Reminder, now: number): number => {
  const startsAt = reminder.startsAt;
  if (startsAt === undefined) return 0;
  const durationMs = reminder.dueAt - startsAt;
  if (durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, (now - startsAt) / durationMs));
};

export const clearFinishedTimer = (state: ReminderTimerState, now: number): ReminderTimerState =>
  state.timer?.remainingMs === null && state.timer.endsAt <= now
    ? { ...state, timer: null }
    : state;

export const acknowledgeDueReminder = (state: ReminderTimerState, id: string, now: number): ReminderTimerState => ({
  ...state,
  reminders: state.reminders.map((reminder) => {
    if (reminder.id !== id) return reminder;
    const repeatMs = reminder.repeatMs;
    if (!repeatMs) return { ...reminder, notified: true };
    const elapsedIntervals = Math.floor(Math.max(0, now - reminder.dueAt) / repeatMs) + 1;
    const dueAt = reminder.dueAt + elapsedIntervals * repeatMs;
    return { ...reminder, startsAt: dueAt - repeatMs, dueAt, notified: false };
  }),
});

export const nextDueActivity = (state: ReminderTimerState, now: number): DueActivity | null => {
  const reminder = state.reminders
    .filter((item) => !item.notified && item.dueAt <= now)
    .sort((left, right) => left.dueAt - right.dueAt)[0];
  return reminder ? { kind: "reminder", id: reminder.id, title: reminder.title, dueAt: reminder.dueAt } : null;
};

export const nextReminderDelayMs = (reminders: Reminder[], now: number): number | null => {
  const upcoming = reminders.filter((reminder) => !reminder.notified && reminder.dueAt > now);
  if (upcoming.length === 0) return null;
  const nextDueAt = upcoming.reduce((next, reminder) => Math.min(next, reminder.dueAt), Number.POSITIVE_INFINITY);
  const hasRelativeReminder = upcoming.some((reminder) => reminder.relative);
  return Math.min(hasRelativeReminder ? 1_000 : 60_000, nextDueAt - now);
};

export const formatDuration = (durationMs: number): string => {
  const seconds = Math.ceil(Math.max(0, durationMs) / 1_000);
  if (seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
};

export const formatCountdown = (remainingMs: number): string => {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
};
