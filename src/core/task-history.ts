import type { DemoStatus, DemoTask } from "./mock";

export type TaskHistoryEntry = Pick<DemoTask, "id" | "source" | "title" | "status" | "startedAt"> & {
  updatedAt: number;
};

const storageKey = "dot-notifier-task-history-v1";
const sources = new Set<DemoTask["source"]>([
  "codex", "claude", "antigravity-app", "antigravity-cli", "antigravity-ide", "external",
]);
const statuses = new Set<DemoStatus>(["running", "needs_input", "error", "done"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function loadTaskHistory(storage: Pick<Storage, "getItem">): TaskHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).filter((entry) =>
      typeof entry.id === "string" && entry.id.length > 0
      && typeof entry.source === "string" && sources.has(entry.source as DemoTask["source"])
      && typeof entry.title === "string" && typeof entry.status === "string"
      && statuses.has(entry.status as DemoStatus)
      && typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt),
    ).map((entry) => ({
      id: entry.id as string,
      source: entry.source as DemoTask["source"],
      title: (entry.title as string).slice(0, 500),
      status: entry.status as DemoStatus,
      updatedAt: entry.updatedAt as number,
      ...(typeof entry.startedAt === "number" && Number.isFinite(entry.startedAt)
        ? { startedAt: entry.startedAt } : {}),
    }));
  } catch {
    return [];
  }
}

export function upsertTaskHistory(
  history: TaskHistoryEntry[],
  task: DemoTask,
  observedAt = Date.now(),
): TaskHistoryEntry[] {
  if (!statuses.has(task.status)) return history;
  const existing = history.find((entry) => entry.id === task.id && entry.source === task.source);
  if (existing?.status === task.status && existing.title === task.title
      && existing.startedAt === task.startedAt) return history;
  const entry: TaskHistoryEntry = {
    id: task.id,
    source: task.source,
    title: task.title.slice(0, 500),
    status: task.status,
    updatedAt: observedAt,
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
  };
  return [entry, ...history.filter((item) => item.id !== task.id || item.source !== task.source)];
}

export function saveTaskHistory(storage: Pick<Storage, "setItem">, history: TaskHistoryEntry[]): boolean {
  try {
    storage.setItem(storageKey, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

export function clearTaskHistory(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(storageKey);
}
