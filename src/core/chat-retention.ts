import { CHAT_RETENTION_MS } from "./event-store";
import type { DemoMessage } from "./mock";

export function pruneExpiredMessages(messages: DemoMessage[], now = Date.now()): DemoMessage[] {
  return messages.filter((message) => now - message.receivedAt < CHAT_RETENTION_MS);
}

export function upsertChatMessage(messages: DemoMessage[], update: DemoMessage): DemoMessage[] {
  return [update, ...messages.filter((message) => message.id !== update.id)]
    .sort((left, right) => right.createdAt - left.createdAt || right.receivedAt - left.receivedAt)
    .slice(0, 10);
}
