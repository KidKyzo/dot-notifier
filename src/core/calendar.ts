export const localDayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const count = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  return Array.from({ length: count }, (_, index) =>
    new Date(month.getFullYear(), month.getMonth(), index - mondayOffset + 1));
}
