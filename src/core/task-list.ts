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
  const next = { ...update, ...(startedAt === undefined ? {} : { startedAt }) };

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
