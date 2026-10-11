import type { DemoTask } from "./mock";

const statusOrder: Record<DemoTask["status"], number> = {
  running: 0,
  needs_input: 1,
  error: 2,
  done: 3,
  idle: 4,
};

export function upsertTask(tasks: DemoTask[], update: DemoTask, observedAt = Date.now()): DemoTask[] {
  const previous = tasks.find((task) => task.id === update.id);
  const startedAt = update.startedAt ?? previous?.startedAt
    ?? (update.status === "running" ? observedAt : undefined);
  const next = { ...previous, ...update, ...(startedAt === undefined ? {} : { startedAt }) };

  return [next, ...tasks.filter((task) => task.id !== update.id)]
    .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
    .slice(-8);
}

export function primaryCodexTask(tasks: DemoTask[]): DemoTask | undefined {
  return tasks
    .filter((task) => task.source === "codex")
    .sort((left, right) => statusOrder[left.status] - statusOrder[right.status]
      || (right.startedAt ?? 0) - (left.startedAt ?? 0))[0];
}

export function primaryCodexTaskRows(tasks: DemoTask[]): DemoTask[] {
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
