export type PillNotice =
  | { id: string; phase: "filling" | "message" | "collapsing"; kind: "timer-ended" }
  | { id: string; phase: "filling" | "message" | "collapsing"; kind: "reminder"; title: string };

export function afterNoticeMessage(notice: PillNotice): PillNotice | null {
  return { ...notice, phase: "collapsing" };
}
