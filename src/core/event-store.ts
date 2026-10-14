export type AppEvent = {
  id: string;
  source: "ai" | "chat" | "system";
  agent?: "codex" | "antigravity-app" | "antigravity-cli" | "antigravity-ide" | "omp";
  sessionId?: string;
  kind: "task" | "message" | "metric";
  status?: "running" | "done" | "error" | "needs_input" | "unread" | "warn" | "crit";
  title: string;
  body?: string;
  progress?: number;
  startedAt?: string;
  cwd?: string;
  pid?: number;
  usage?: { tokens?: number; quotaLeft?: number };
  actions?: Array<"approve" | "reject">;
  actionNonce?: string;
  meta?: Record<string, unknown>;
};

export const CHAT_RETENTION_MS = 60 * 60 * 1000;
export const AGENT_PEEK_WINDOW_MS = 1_500;
const WINDOWS_EPOCH_MS = 11_644_473_600_000;

export const eventCreatedAtMs = (event: AppEvent, fallback: number): number => {
  const isoTime = event.startedAt ? Date.parse(event.startedAt) : Number.NaN;
  if (Number.isFinite(isoTime)) return isoTime;
  const ticks = event.meta?.createdAtTicks;
  if (typeof ticks === "number" && Number.isFinite(ticks)) {
    return Math.trunc(ticks / 10_000) - WINDOWS_EPOCH_MS;
  }
  return fallback;
};

const priority = (event: AppEvent) => {
  if (event.status === "error" || event.status === "needs_input" || event.status === "crit") return 0;
  if (event.status === "unread") return 1;
  if (event.status === "done" || event.status === "warn") return 2;
  return 3;
};

const isUnreadChatMessage = (event: AppEvent) =>
  event.source === "chat" && event.kind === "message" && event.status === "unread";

const eventKey = (event: AppEvent) => event.source === "ai" && event.agent && event.sessionId
  ? `${event.agent}:${event.sessionId}`
  : event.id;

export class EventStore {
  private readonly events = new Map<string, AppEvent>();
  private readonly pending = new Map<string, AppEvent>();
  private sequence = 0;
  private readonly order = new Map<string, number>();
  private readonly observedAt = new Map<string, number>();
  private readonly queuedAt = new Map<string, number>();
  private readonly messageTimes = new Map<string, number>();

  upsert(event: AppEvent, receivedAt = Date.now()): void {
    const key = eventKey(event);
    this.events.set(key, event);
    if (event.source === "chat" && event.kind === "message") {
      this.observedAt.set(key, receivedAt);
      this.messageTimes.set(key, eventCreatedAtMs(event, receivedAt));
    }
    if (event.status === undefined || event.status === "running") {
      this.pending.delete(key);
      this.order.delete(key);
      this.queuedAt.delete(key);
      return;
    }
    this.queuedAt.set(key, receivedAt);
    if (isUnreadChatMessage(event) || !this.order.has(key)) {
      this.order.set(key, this.sequence++);
    }
    this.pending.set(key, event);
  }

  all(): AppEvent[] {
    return [...this.events.values()];
  }

  pendingChatMessages(limit = 3): AppEvent[] {
    return [...this.pending.values()]
      .filter(isUnreadChatMessage)
      .sort((left, right) => this.compareChatMessages(left, right))
      .slice(0, limit);
  }

  dismissPeekGroup(ids: string[]): AppEvent | undefined {
    for (const [key, event] of this.pending) {
      if (!ids.includes(event.id)) continue;
      this.pending.delete(key);
      this.order.delete(key);
      this.queuedAt.delete(key);
    }
    return this.nextPeek();
  }

  nextPeek(): AppEvent | undefined {
    return [...this.pending.values()].sort((left, right) =>
      priority(left) - priority(right)
      || (isUnreadChatMessage(left) && isUnreadChatMessage(right)
        ? this.compareChatMessages(left, right)
        : (this.order.get(eventKey(left)) ?? 0) - (this.order.get(eventKey(right)) ?? 0)),
    )[0];
  }

  nextPeekGroup(windowMs = AGENT_PEEK_WINDOW_MS, activeIds: string[] = [], arrivingId?: string): AppEvent[] {
    const first = this.nextPeek();
    if (!first) return [];
    if (first.actions?.length || activeIds.some((id) =>
      [...this.pending.values()].some((event) => event.id === id && event.actions?.length))) return [first];

    const pending = [...this.pending.values()];
    const sortGroup = (events: AppEvent[]) => events.sort((left, right) =>
      priority(left) - priority(right)
      || (isUnreadChatMessage(left) && isUnreadChatMessage(right)
        ? this.compareChatMessages(left, right)
        : (this.order.get(eventKey(left)) ?? 0) - (this.order.get(eventKey(right)) ?? 0)));

    if (activeIds.length > 0 && arrivingId) {
      if (!pending.some((event) => event.id === arrivingId)) return [];
      const active = new Set([...activeIds, arrivingId]);
      return sortGroup(pending.filter((event) => active.has(event.id) && !event.actions?.length));
    }

    const firstTime = this.queuedAt.get(eventKey(first));
    if (firstTime === undefined) return [first];

    return sortGroup(pending
      .filter((event) => {
        if (event.actions?.length) return false;
        const observedAt = this.queuedAt.get(eventKey(event));
        return observedAt !== undefined && Math.abs(observedAt - firstTime) <= windowMs;
      }));
  }

  dismissPeek(): AppEvent | undefined {
    const current = this.nextPeek();
    if (current) {
      const key = eventKey(current);
      this.pending.delete(key);
      this.order.delete(key);
      this.queuedAt.delete(key);
    }
    return this.nextPeek();
  }

  dismiss(id: string): void {
    for (const [key, event] of this.events) {
      if (event.id !== id) continue;
      this.events.delete(key);
      this.pending.delete(key);
      this.order.delete(key);
      this.observedAt.delete(key);
      this.queuedAt.delete(key);
      this.messageTimes.delete(key);
    }
  }

  nextChatExpiry(): number | undefined {
    let next: number | undefined;
    for (const receivedAt of this.observedAt.values()) {
      const expiresAt = receivedAt + CHAT_RETENTION_MS;
      if (next === undefined || expiresAt < next) next = expiresAt;
    }
    return next;
  }

  expireChats(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const [key, receivedAt] of this.observedAt) {
      if (now - receivedAt < CHAT_RETENTION_MS) continue;
      const event = this.events.get(key);
      if (event) expired.push(event.id);
      this.observedAt.delete(key);
      this.events.delete(key);
      this.pending.delete(key);
      this.order.delete(key);
      this.messageTimes.delete(key);
    }
    return expired;
  }

  private compareChatMessages(left: AppEvent, right: AppEvent): number {
    return (this.messageTimes.get(eventKey(right)) ?? 0) - (this.messageTimes.get(eventKey(left)) ?? 0)
      || (this.order.get(eventKey(right)) ?? 0) - (this.order.get(eventKey(left)) ?? 0);
  }
}
