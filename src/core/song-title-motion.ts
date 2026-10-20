export const SONG_TITLE_GAP_PX = 32;
export const SONG_TITLE_REST_MS = 1_800;

export type SongTitleMotion = { travelPx: number; scrollDurationMs: number };

export function songTitleMotion(viewportWidth: number, titleWidth: number): SongTitleMotion | null {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(titleWidth) || viewportWidth <= 0) return null;
  if (Math.ceil(titleWidth - viewportWidth) <= 2) return null;
  const travelPx = Math.ceil(titleWidth) + SONG_TITLE_GAP_PX;
  return { travelPx, scrollDurationMs: Math.max(6_000, Math.round(travelPx / 34 * 1_000)) };
}
