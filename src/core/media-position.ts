type MediaSnapshot = {
  title: string;
  artist: string;
  playing: boolean;
  positionSeconds: number;
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
  const keepEstimate = previous !== null
    && previous.title === snapshot.title
    && previous.artist === snapshot.artist
    && previous.playing
    && snapshot.playing
    && snapshot.positionSeconds >= previous.reportedPositionSeconds
    && snapshot.positionSeconds <= estimated
    && (snapshot.positionSeconds === previous.reportedPositionSeconds || estimated - snapshot.positionSeconds <= 3);

  return {
    ...snapshot,
    positionSeconds: keepEstimate ? estimated : snapshot.positionSeconds,
    reportedPositionSeconds: snapshot.positionSeconds,
    sampledAtMs: nowMs,
  };
};
