export type AppEvent = {
  id: string;
  source: "codex" | "antigravity" | "chat" | "system";
  kind: "task" | "message" | "metric";
  status?: "running" | "done" | "error" | "needs_input" | "unread" | "warn" | "crit";
  title: string;
  body?: string;
  progress?: number;
  startedAt?: string;
  meta?: Record<string, unknown>;
};

export const CHAT_RETENTION_MS = 60 * 60 * 1000;

const priority = (event: AppEvent) => {
  if (event.status === "error" || event.status === "needs_input" || event.status === "crit") return 0;
  if (event.status === "unread") return 1;
  if (event.status === "done" || event.status === "warn") return 2;
  return 3;
};

const isUnreadChatMessage = (event: AppEvent) =>
  event.source === "chat" && event.kind === "message" && event.status === "unread";

export class EventStore {
  private readonly events = new Map<string, AppEvent>();
  private readonly pending = new Map<string, AppEvent>();
  private sequence = 0;
  private readonly order = new Map<string, number>();
  private readonly observedAt = new Map<string, number>();
  private readonly messageTimes = new Map<string, number>();

  upsert(event: AppEvent, receivedAt = Date.now()): void {
    this.events.set(event.id, event);
    if (event.source === "chat" && event.kind === "message") {
      this.observedAt.set(event.id, receivedAt);
      const createdAt = event.startedAt ? Date.parse(event.startedAt) : Number.NaN;
      this.messageTimes.set(event.id, Number.isFinite(createdAt) ? createdAt : receivedAt);
    }
    if (event.status === undefined || event.status === "running") {
      this.pending.delete(event.id);
      this.order.delete(event.id);
      return;
    }
    if (isUnreadChatMessage(event) || !this.order.has(event.id)) {
      this.order.set(event.id, this.sequence++);
    }
    this.pending.set(event.id, event);
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
    for (const id of ids) {
      this.pending.delete(id);
      this.order.delete(id);
    }
    return this.nextPeek();
  }

  nextPeek(): AppEvent | undefined {
    return [...this.pending.values()].sort((left, right) =>
      priority(left) - priority(right)
      || (isUnreadChatMessage(left) && isUnreadChatMessage(right)
        ? this.compareChatMessages(left, right)
        : (this.order.get(left.id) ?? 0) - (this.order.get(right.id) ?? 0)),
    )[0];
  }

  dismissPeek(): AppEvent | undefined {
    const current = this.nextPeek();
    if (current) {
      this.pending.delete(current.id);
      this.order.delete(current.id);
    }
    return this.nextPeek();
  }

  dismiss(id: string): void {
    this.events.delete(id);
    this.pending.delete(id);
    this.order.delete(id);
    this.observedAt.delete(id);
    this.messageTimes.delete(id);
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
    for (const [id, receivedAt] of this.observedAt) {
      if (now - receivedAt < CHAT_RETENTION_MS) continue;
      expired.push(id);
      this.observedAt.delete(id);
      this.events.delete(id);
      this.pending.delete(id);
      this.order.delete(id);
      this.messageTimes.delete(id);
    }
    return expired;
  }

  private compareChatMessages(left: AppEvent, right: AppEvent): number {
    return (this.messageTimes.get(right.id) ?? 0) - (this.messageTimes.get(left.id) ?? 0)
      || (this.order.get(right.id) ?? 0) - (this.order.get(left.id) ?? 0);
  }
}
