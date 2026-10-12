import type { DemoStatus, DemoTask } from "./mock";

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

export function aggregateTaskStatus(tasks: DemoTask[]): DemoStatus {
  if (tasks.length === 0) return "idle";
  const nonIdle = tasks.filter((task) => task.status !== "idle");
  if (nonIdle.length === 0) return "idle";

  return nonIdle.reduce<DemoStatus>((highest, task) => {
    return aiStatusPriority[task.status] < aiStatusPriority[highest] ? task.status : highest;
  }, "idle");
}

export function aggregateTaskProgress(tasks: DemoTask[]): number {
  const running = tasks.filter((task) => task.status === "running");
  if (running.length === 0) return 0;
  const total = running.reduce((sum, task) => sum + Math.max(0, Math.min(1, task.progress || 0)), 0);
  return total / running.length;
}

export function upsertTask(tasks: DemoTask[], update: DemoTask, observedAt = Date.now()): DemoTask[] {
  const previous = tasks.find((task) => task.id === update.id);
  const startedAt = update.startedAt ?? previous?.startedAt
    ?? (update.status === "running" ? observedAt : undefined);
  const next = { ...previous, ...update, ...(startedAt === undefined ? {} : { startedAt }) };

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
