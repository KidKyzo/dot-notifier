import type { DemoStatus, DemoTask } from "./mock";
import { isAgentActivityTitle } from "./settings-copy";

const statusOrder: Record<DemoTask["status"], number> = {
  running: 0,
  needs_input: 1,
  error: 2,
  done: 3,
  idle: 4,
};

export const aiStatusPriority: Record<DemoStatus, number> = {
  needs_input: 0,
  error: 1,
  running: 2,
  done: 3,
  idle: 4,
};

export const taskGroupName = (task: DemoTask, externalGroupName: string): string => {
  switch (task.source) {
    case "codex": return "Codex";
    case "claude": return "Claude";
    case "antigravity-app": return task.status === "idle" ? "Antigravity" : "Antigravity App";
    case "antigravity-cli": return task.status === "idle" ? "Antigravity" : "Antigravity CLI";
    case "antigravity-ide": return task.status === "idle" ? "Antigravity" : "Antigravity IDE";
    case "external": return externalGroupName;
  }
};

export function groupTasksByAgent(
  tasks: DemoTask[],
  externalGroupName: string,
): Array<{ name: string; rows: DemoTask[] }> {
  const groups = new Map<string, DemoTask[]>();
  for (const task of tasks) {
    const name = taskGroupName(task, externalGroupName);
    const rows = groups.get(name);
    if (rows) rows.push(task);
    else groups.set(name, [task]);
  }
  return Array.from(groups, ([name, rows]) => ({ name, rows }));
}

export function codexTaskRowsForPanel(
  tasks: DemoTask[],
  enabled: boolean,
  noActiveTaskTitle: string,
): DemoTask[] {
  if (!enabled) return [];
  const rows = primaryCodexTaskRows(tasks);
  if (rows.length > 0) return rows;
  return [{
    id: "codex-idle",
    source: "codex",
    name: "Codex",
    status: "idle",
    title: noActiveTaskTitle,
    progress: 0,
  }];
}

export function taskElapsedLabel(startedAt?: number, nowMs = Date.now()): string {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return "";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedAt) / 1_000));
  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor(elapsedSeconds % 3_600 / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

export function aggregateTaskStatus(tasks: DemoTask[]): DemoStatus {
  if (tasks.length === 0) return "idle";
  const nonIdle = tasks.filter((task) => task.status !== "idle");
  if (nonIdle.length === 0) return "idle";

  return nonIdle.reduce<DemoStatus>((highest, task) => {
    return aiStatusPriority[task.status] < aiStatusPriority[highest] ? task.status : highest;
  }, "idle");
}

export function aggregateTaskDotStatus(
  tasks: DemoTask[],
  doneUntil: number | null,
  nowMs = Date.now(),
): DemoStatus {
  const status = aggregateTaskStatus(tasks);
  return status === "done" && (doneUntil === null || nowMs >= doneUntil) ? "idle" : status;
}

export function hasNewlyCompletedTask(
  previousStatuses: ReadonlyMap<string, DemoStatus>,
  nextTasks: DemoTask[],
): boolean {
  return nextTasks.some((task) => task.status === "done"
    && previousStatuses.get(task.id) !== "done");
}

export function aggregateTaskProgress(tasks: DemoTask[]): number {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length === 0) return 0;
  const total = running.reduce((sum, task) => sum + Math.max(0, Math.min(1, task.progress || 0)), 0);
  return total / running.length;
}

export function taskCompletionPreview(body: string | undefined): string | undefined {
  const preview = body?.replace(/\s+/g, " ").trim().slice(0, 280);
  return preview || undefined;
}

export function upsertTask(tasks: DemoTask[], update: DemoTask, observedAt = Date.now()): DemoTask[] {
  const previous = tasks.find((task) => task.id === update.id);
  const startedAt = update.startedAt ?? previous?.startedAt
    ?? (update.status === "running" ? observedAt : undefined);
  const genericOutcomeTitle = (update.status === "done" && /\btask completed$/i.test(update.title.trim()))
    || (update.status === "error" && /\btask failed$/i.test(update.title.trim()));
  const title = genericOutcomeTitle && previous
    && (previous.status === "running" || previous.status === "needs_input")
    && !isAgentActivityTitle(previous.title)
    ? previous.title
    : update.title;
  const next = { ...previous, ...update, title, ...(startedAt === undefined ? {} : { startedAt }) };

  const ordered = [next, ...tasks.filter((task) => task.id !== update.id)]
    .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
  const active = ordered.filter((task) => task.status === "running" || task.status === "needs_input");
  const completed = ordered.filter((task) => task.status !== "running" && task.status !== "needs_input");
  const historyLimit = Math.max(0, 8 - active.length);
  const recentHistory = historyLimit === 0 ? [] : completed.slice(-historyLimit);

  return [...recentHistory, ...active]
    .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
}

export function primaryCodexTask(tasks: DemoTask[]): DemoTask | undefined {
  return tasks
    .filter((task) => task.source === "codex")
    .sort((left, right) => statusOrder[left.status] - statusOrder[right.status]
      || (right.startedAt ?? 0) - (left.startedAt ?? 0))[0];
}

export function primaryCodexTaskRows(tasks: DemoTask[]): DemoTask[] {
  const active = tasks
    .filter((task) => task.source === "codex" && (task.status === "running" || task.status === "needs_input"))
    .sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0));
  if (active.length > 0) return active;

  const primary = primaryCodexTask(tasks);
  return primary ? [primary] : [];
}

export function validTaskUsage(usage: DemoTask["usage"]): { tokens?: number; quotaLeft?: number } | undefined {
  if (!usage) return undefined;
  const valid: { tokens?: number; quotaLeft?: number } = {};
  if (typeof usage.tokens === "number" && Number.isFinite(usage.tokens) && usage.tokens >= 0) {
    valid.tokens = Math.floor(usage.tokens);
  }
  if (typeof usage.quotaLeft === "number" && Number.isFinite(usage.quotaLeft)
      && usage.quotaLeft >= 0 && usage.quotaLeft <= 1) {
    valid.quotaLeft = usage.quotaLeft;
  }
  return Object.keys(valid).length > 0 ? valid : undefined;
}
