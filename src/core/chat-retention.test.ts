import { describe, expect, it } from "vitest";
import { CHAT_RETENTION_MS } from "./event-store";
import { isWhatsAppApp, pruneExpiredMessages, removeWhatsAppMessages, upsertChatMessage } from "./chat-retention";
import type { DemoMessage } from "./mock";

const message = (id: string, receivedAt: number): DemoMessage => ({
  id,
  receivedAt,
  createdAt: receivedAt,
  sender: "WhatsApp",
  body: "Message stays in memory only",
  unread: true,
});

describe("chat message retention", () => {
  it("clears WhatsApp messages while preserving other app notifications", () => {
    const messages = [
      { ...message("whatsapp", 1), app: "WhatsApp" },
      { ...message("whatsapp-business", 2), app: "WhatsApp Business" },
      { ...message("telegram", 3), app: "Telegram" },
      message("unknown-app", 4),
    ];
    expect(isWhatsAppApp("WhatsApp Business")).toBe(true);
    expect(removeWhatsAppMessages(messages).map(({ id }) => id)).toEqual(["telegram", "unknown-app"]);
  });

  it("keeps messages until one hour and removes them at expiry", () => {
    const receivedAt = 1_000;
    const messages = [message("old", receivedAt), message("new", receivedAt + 1)];

    expect(pruneExpiredMessages(messages, receivedAt + CHAT_RETENTION_MS - 1).map(({ id }) => id))
      .toEqual(["old", "new"]);
    expect(pruneExpiredMessages(messages, receivedAt + CHAT_RETENTION_MS).map(({ id }) => id))
      .toEqual(["new"]);
  });

  it("keeps a late delivered older message below the newest chat row", () => {
    const newest = { ...message("newest", 2_000), createdAt: 2_000 };
    const olderDeliveredLate = { ...message("older", 3_000), createdAt: 1_000 };

    expect(upsertChatMessage([newest], olderDeliveredLate).map(({ id }) => id))
      .toEqual(["newest", "older"]);
  });

  it("keeps every delivered notification available in the expanded panel", () => {
    const messages = Array.from({ length: 12 }, (_, index) => message(`toast-${index}`, index));
    const retained = messages.reduce<DemoMessage[]>((current, next) => upsertChatMessage(current, next), []);
    expect(retained).toHaveLength(12);
  });
});
