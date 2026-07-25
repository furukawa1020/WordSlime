import { describe, expect, it } from "vitest";
import {
  AUTO_PERFORMANCE_DURATION_MS,
  performanceEvents,
  performanceFrameAt,
  performanceMovements,
} from "./autoPerformance";

describe("auto performance timeline", () => {
  it("covers exactly three minutes without gaps", () => {
    expect(performanceMovements[0].startMs).toBe(0);
    expect(performanceMovements.at(-1)?.endMs).toBe(
      AUTO_PERFORMANCE_DURATION_MS,
    );

    for (let index = 1; index < performanceMovements.length; index += 1) {
      expect(performanceMovements[index].startMs).toBe(
        performanceMovements[index - 1].endMs,
      );
    }
  });

  it("selects the expected movement at boundaries", () => {
    expect(performanceFrameAt(0).movement.id).toBe("germination");
    expect(performanceFrameAt(24_000).movement.id).toBe("liquefaction");
    expect(performanceFrameAt(82_000).movement.id).toBe("hypercube");
    expect(performanceFrameAt(180_000).movement.id).toBe("dissolution");
  });

  it("keeps frame values normalized", () => {
    for (let elapsed = 0; elapsed <= 180_000; elapsed += 997) {
      const frame = performanceFrameAt(elapsed);
      expect(frame.progress).toBeGreaterThanOrEqual(0);
      expect(frame.progress).toBeLessThanOrEqual(1);
      expect(frame.movementProgress).toBeGreaterThanOrEqual(0);
      expect(frame.movementProgress).toBeLessThanOrEqual(1);
      expect(frame.intensity).toBeGreaterThanOrEqual(0);
      expect(frame.intensity).toBeLessThanOrEqual(1);
      expect(frame.phase).toBeGreaterThanOrEqual(0);
      expect(frame.phase).toBeLessThan(1);
    }
  });

  it("builds a deterministic playable score", () => {
    const beats = performanceEvents.filter((event) => event.kind === "beat");
    const seeds = performanceEvents.filter((event) => event.kind === "seed");

    expect(beats.length).toBeGreaterThan(180);
    expect(seeds.length).toBeGreaterThan(20);
    expect(
      beats.every(
        (event) =>
          Number.isFinite(event.frequency) &&
          event.frequency >= 40 &&
          event.frequency <= 1000,
      ),
    ).toBe(true);
    expect(seeds.some((event) => event.text.includes("4D"))).toBe(true);
  });
});
