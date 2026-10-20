type MediaSnapshot = {
  title: string;
  artist: string;
  playing: boolean;
  positionSeconds: number;
  positionUpdatedAtMs?: number | null;
};

export type LiveMediaPosition = MediaSnapshot & {
  reportedPositionSeconds: number;
  sampledAtMs: number;
};

export const mediaPositionSeconds = (media: LiveMediaPosition, nowMs: number): number =>
  media.positionSeconds + (media.playing ? Math.floor(Math.max(0, nowMs - media.sampledAtMs) / 1_000) : 0);

export const syncMediaPosition = <T extends MediaSnapshot>(
  previous: LiveMediaPosition | null,
  snapshot: T,
  nowMs: number,
): T & LiveMediaPosition => {
  const estimated = previous ? mediaPositionSeconds(previous, nowMs) : snapshot.positionSeconds;
  const positionUpdatedAtMs = snapshot.positionUpdatedAtMs;
  const timelineAgeSeconds = snapshot.playing
    && typeof positionUpdatedAtMs === "number"
    && Number.isFinite(positionUpdatedAtMs)
    ? Math.floor(Math.max(0, nowMs - positionUpdatedAtMs) / 1_000)
    : 0;
  const currentSnapshotPosition = snapshot.positionSeconds + timelineAgeSeconds;
  const keepEstimate = previous !== null
    && previous.title === snapshot.title
    && previous.artist === snapshot.artist
    && previous.playing
    && snapshot.playing
    && currentSnapshotPosition >= previous.reportedPositionSeconds
    && currentSnapshotPosition <= estimated
    && (currentSnapshotPosition === previous.reportedPositionSeconds || estimated - currentSnapshotPosition <= 3);

  return {
    ...snapshot,
    positionSeconds: keepEstimate ? estimated : currentSnapshotPosition,
    reportedPositionSeconds: currentSnapshotPosition,
    sampledAtMs: nowMs,
  };
};
