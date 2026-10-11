import type { AppEvent } from "./event-store";

export const isWhatsAppNotification = (event: AppEvent): boolean =>
  event.source === "chat" && typeof event.meta?.app === "string" && /whatsapp/i.test(event.meta.app);

export const isIncomingWhatsAppCall = (event: AppEvent): boolean => {
  if (!isWhatsAppNotification(event)) return false;
  return /incoming\s+(?:(?:voice|video)\s+)?call|(?:voice|video)\s+call(?:\s+incoming)?|whatsapp\s+call|panggilan\s+(?:masuk|suara|video)/i
    .test(`${event.title} ${event.body ?? ""}`);
};
