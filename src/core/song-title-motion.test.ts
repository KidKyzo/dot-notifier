import { describe, expect, it } from "vitest";
import { SONG_TITLE_GAP_PX, SONG_TITLE_REST_MS, songTitleMotion } from "./song-title-motion";

describe("song title motion", () => {
  it("keeps titles still when they fit or overflow only by rounding", () => {
    expect(songTitleMotion(200, 180)).toBeNull();
    expect(songTitleMotion(200, 200)).toBeNull();
    expect(songTitleMotion(200, 201)).toBeNull();
    expect(songTitleMotion(0, 300)).toBeNull();
  });

  it("travels past one full title and gap before restarting after a rest", () => {
    const motion = songTitleMotion(160, 260);
    expect(motion?.travelPx).toBe(260 + SONG_TITLE_GAP_PX);
    expect(motion?.scrollDurationMs).toBeGreaterThan(SONG_TITLE_REST_MS);
    expect(songTitleMotion(160, 500)?.scrollDurationMs).toBeGreaterThan(motion?.scrollDurationMs ?? 0);
  });
});
