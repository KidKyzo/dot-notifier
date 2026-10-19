import { describe, expect, it } from "vitest";
import {
  advanceSpringAxis,
  cancelSpringFrame,
  createSpringAxis,
  isSpringAxisSettled,
  modePillSize,
  motionTokens,
  retargetSpringAxis,
  showsPillWave,
} from "./motion";

describe("pill view geometry", () => {
  it("keeps the Agents pill the same size as Music", () => {
    expect(modePillSize("agents")).toEqual(modePillSize("music"));
  });
});

describe("pill fill motion", () => {
  it("shows the wave from the first timer frame until the fill is complete", () => {
    expect(showsPillWave(0)).toBe(true);
    expect(showsPillWave(0.01)).toBe(true);
    expect(showsPillWave(0.99)).toBe(true);
    expect(showsPillWave(1)).toBe(false);
    expect(showsPillWave(1, "filling")).toBe(true);
  });
});

describe("retargetable morph spring", () => {
  it("clears a canceled frame so a remounted shell can schedule animation again", () => {
    const shape = { frame: 42, lastFrame: 120, width: retargetSpringAxis(createSpringAxis(64), 300) };
    const canceled: number[] = [];

    cancelSpringFrame(shape, (frame) => canceled.push(frame));

    expect(canceled).toEqual([42]);
    expect(shape.frame).toBeNull();
    expect(shape.lastFrame).toBeNull();
    expect(shape.width.target).toBe(300);
  });

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
