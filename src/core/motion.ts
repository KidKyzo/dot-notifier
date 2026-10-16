export const motionTokens = {
  spring: {
    morph: { stiffness: 340, damping: 28, mass: 1 },
    dot: { stiffness: 500, damping: 30, mass: 1 },
  },
  geometry: {
    idle: { width: 64, height: 24, radius: 12 },
    peek: { width: 300, height: 44, radius: 22 },
    expanded: { width: 320, radius: 22 },
    activityWidth: {
      timer: 155,
      reminder: 225,
      reminderAndTimer: 275,
      withNowPlaying: 200,
      withNowPlayingAndTimer: 250,
    },
    tallPeek: { multiMessageBase: 56, rowHeight: 32, approval: 72, chat: 76, call: 92 },
  },
  timing: {
    contentInMs: 180,
    contentOutMs: 100,
    contentDelayMs: 100,
    colorMs: 300,
    dotScaleMs: 120,
    dotSettleMs: 420,
    badgePopMs: 180,
    rowStaggerMs: 30,
    rowExitMs: 180,
    hoverLeaveDelayMs: 350,
    ringProgressMs: 800,
  },
} as const;

export type SpringAxis = { position: number; velocity: number; target: number };
export type SpringConfig = { stiffness: number; damping: number; mass: number };

export function createSpringAxis(value: number): SpringAxis {
  return { position: value, velocity: 0, target: value };
}

export function retargetSpringAxis(axis: SpringAxis, target: number): SpringAxis {
  return { ...axis, target };
}

export function advanceSpringAxis(
  axis: SpringAxis,
  deltaSeconds: number,
  config: SpringConfig,
): SpringAxis {
  const elapsed = Math.max(0, Math.min(deltaSeconds, 0.05));
  const stepCount = Math.max(1, Math.ceil(elapsed / (1 / 120)));
  const step = elapsed / stepCount;
  let { position, velocity } = axis;

  for (let index = 0; index < stepCount; index += 1) {
    const acceleration = (config.stiffness * (axis.target - position) - config.damping * velocity) / config.mass;
    velocity += acceleration * step;
    position += velocity * step;
  }

  if (Math.abs(axis.target - position) < 0.1 && Math.abs(velocity) < 0.1) {
    return { position: axis.target, velocity: 0, target: axis.target };
  }
  return { position, velocity, target: axis.target };
}

export function isSpringAxisSettled(axis: SpringAxis): boolean {
  return axis.position === axis.target && axis.velocity === 0;
}
