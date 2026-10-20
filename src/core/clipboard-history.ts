export type ClipboardEntry = { id: string; sequence: number; text: string; copiedAt: number };

const storageKey = "dot-notifier-clipboard-history-v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function loadClipboardHistory(storage: Pick<Storage, "getItem">): ClipboardEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).filter((entry) =>
      typeof entry.id === "string" && typeof entry.text === "string"
      && typeof entry.sequence === "number" && Number.isSafeInteger(entry.sequence)
      && typeof entry.copiedAt === "number" && Number.isFinite(entry.copiedAt),
    ).map((entry) => ({
      id: entry.id as string,
      sequence: entry.sequence as number,
      text: (entry.text as string).slice(0, 8_192),
      copiedAt: entry.copiedAt as number,
    }));
  } catch {
    return [];
  }
}

export function addClipboardEntry(history: ClipboardEntry[], sequence: number, text: string | null, now = Date.now()): ClipboardEntry[] {
  if (text === null || text.length === 0 || !Number.isSafeInteger(sequence) || sequence < 1) return history;
  if (history[0]?.sequence === sequence && history[0].text === text) return history;
  return [{ id: `${now}-${sequence}`, sequence, text: text.slice(0, 8_192), copiedAt: now }, ...history];
}

export function saveClipboardHistory(storage: Pick<Storage, "setItem">, history: ClipboardEntry[]): boolean {
  try {
    storage.setItem(storageKey, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}
