import { describe, expect, it } from "vitest";
import {
  advanceSpringAxis,
  createSpringAxis,
  isSpringAxisSettled,
  motionTokens,
  retargetSpringAxis,
} from "./motion";

describe("retargetable morph spring", () => {
  it("keeps position and velocity when the target changes", () => {
    const moving = advanceSpringAxis(
      retargetSpringAxis(createSpringAxis(64), 300),
      1 / 60,
      motionTokens.spring.morph,
    );
    const redirected = retargetSpringAxis(moving, 64);

    expect(redirected.position).toBe(moving.position);
    expect(redirected.velocity).toBe(moving.velocity);
    expect(redirected.target).toBe(64);
  });

  it("settles near the target at 60 Hz and 144 Hz", () => {
    const settleAt = (framesPerSecond: number) => {
      let axis = retargetSpringAxis(createSpringAxis(64), 300);
      for (let frame = 0; frame < framesPerSecond * 3 && !isSpringAxisSettled(axis); frame += 1) {
        axis = advanceSpringAxis(axis, 1 / framesPerSecond, motionTokens.spring.morph);
      }
      return axis;
    };
    const at60Hz = settleAt(60);
    const at144Hz = settleAt(144);

    expect(isSpringAxisSettled(at60Hz)).toBe(true);
    expect(isSpringAxisSettled(at144Hz)).toBe(true);
    expect(at60Hz.position).toBe(300);
    expect(at144Hz.position).toBe(300);
  });
});
