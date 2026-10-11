import { describe, expect, it } from "vitest";
import { isIncomingWhatsAppCall } from "./whatsapp-calls";

describe("WhatsApp incoming call notifications", () => {
  it("recognizes call notices without matching ordinary messages", () => {
    expect(isIncomingWhatsAppCall({
      id: "call", source: "chat", kind: "message", status: "unread", title: "Rina", body: "Incoming voice call", meta: { app: "WhatsApp" },
    })).toBe(true);
    expect(isIncomingWhatsAppCall({
      id: "chat", source: "chat", kind: "message", status: "unread", title: "Rina", body: "Call me later", meta: { app: "WhatsApp" },
    })).toBe(false);
    expect(isIncomingWhatsAppCall({
      id: "other", source: "chat", kind: "message", status: "unread", title: "Incoming voice call", meta: { app: "Telegram" },
    })).toBe(false);
  });
});
