import { describe, expect, it } from "vitest";
import { mediaPositionSeconds, syncMediaPosition } from "./media-position";

const track = { title: "Midnight City", artist: "M83", playing: true, positionSeconds: 36 };

describe("live media position", () => {
  it("advances each second while playing and holds while paused", () => {
    const playing = syncMediaPosition(null, track, 1_000);
    expect(mediaPositionSeconds(playing, 3_100)).toBe(38);

    const paused = syncMediaPosition(playing, { ...track, playing: false, positionSeconds: 38 }, 3_100);
    expect(mediaPositionSeconds(paused, 10_000)).toBe(38);
  });

  it("keeps the elapsed time moving when Windows repeats an old timeline value", () => {
    const first = syncMediaPosition(null, track, 1_000);
    const repeated = syncMediaPosition(first, track, 3_500);
    expect(mediaPositionSeconds(repeated, 5_500)).toBe(40);
  });

  it("uses a new track or a backward seek immediately", () => {
    const first = syncMediaPosition(null, track, 1_000);
    const seek = syncMediaPosition(first, { ...track, positionSeconds: 12 }, 6_000);
    expect(mediaPositionSeconds(seek, 6_000)).toBe(12);

    const nextTrack = syncMediaPosition(first, { ...track, title: "New Song", positionSeconds: 0 }, 6_000);
    expect(mediaPositionSeconds(nextTrack, 6_000)).toBe(0);
  });
});
