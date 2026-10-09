export type SystemSample = {
  capturedAt: number;
  cpuPercent: number | null;
  gpuPercent: number | null;
  memoryPercent: number | null;
  memoryUsedMb: number | null;
  memoryTotalMb: number | null;
  diskReadBytesPerSecond: number | null;
  networkBytesPerSecond: number | null;
  vramPercent: number | null;
  vramUsedMb: number | null;
  vramTotalMb: number | null;
  gpuTemperatureC: number | null;
};

export type SystemMetrics = {
  current: SystemSample;
  history: SystemSample[];
};

const isSample = (value: unknown): value is SystemSample => {
  if (typeof value !== "object" || value === null) return false;
  const sample = value as Record<string, unknown>;
  return typeof sample.capturedAt === "number"
    && ["cpuPercent", "gpuPercent", "memoryPercent", "memoryUsedMb", "memoryTotalMb", "diskReadBytesPerSecond", "networkBytesPerSecond", "vramPercent", "vramUsedMb", "vramTotalMb", "gpuTemperatureC"]
      .every((key) => sample[key] === null || typeof sample[key] === "number");
};

export const parseSystemMetrics = (value: unknown): SystemMetrics | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const meta = value as Record<string, unknown>;
  if (!isSample(meta.current) || !Array.isArray(meta.history)) return undefined;
  const history = meta.history.filter(isSample).slice(-60);
  return { current: meta.current, history };
};

export const initialSystemMetrics: SystemMetrics = {
  current: {
    capturedAt: Date.now(),
    cpuPercent: 34,
    gpuPercent: 18,
    memoryPercent: 62,
    memoryUsedMb: 9_920,
    memoryTotalMb: 16_000,
    diskReadBytesPerSecond: 65_536,
    networkBytesPerSecond: 131_072,
    vramPercent: 41,
    vramUsedMb: 2_624,
    vramTotalMb: 6_144,
    gpuTemperatureC: 58,
  },
  history: Array.from({ length: 60 }, (_, index) => {
    const offset = Math.sin(index / 7) * 8 + Math.cos(index / 11) * 5;
    return {
      capturedAt: Date.now() - (59 - index) * 1_000,
      cpuPercent: Math.max(0, Math.min(100, 34 + offset)),
      gpuPercent: Math.max(0, Math.min(100, 18 + offset / 2)),
      memoryPercent: 62,
      memoryUsedMb: 9_920,
      memoryTotalMb: 16_000,
      diskReadBytesPerSecond: 65_536 + offset * 1_024,
      networkBytesPerSecond: 131_072 + offset * 2_048,
      vramPercent: 41,
      vramUsedMb: 2_624,
      vramTotalMb: 6_144,
      gpuTemperatureC: 58,
    };
  }),
};

export const mockSystemAlert = (current: SystemSample): SystemSample => ({
  ...current,
  capturedAt: Date.now(),
  cpuPercent: 94,
  gpuTemperatureC: 93,
});
