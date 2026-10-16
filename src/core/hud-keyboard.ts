export const isHudToggleShortcut = (key: string, targetIsHud: boolean): boolean =>
  targetIsHud && (key === "Enter" || key === " ");
