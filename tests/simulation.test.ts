import { describe, it, expect } from "vitest";
import {
  synthetic,
  indexActivity,
  evaluate,
  project,
  distance,
} from "../src/domain/activity";
import { frameTime } from "../src/export/video";
const track = indexActivity(synthetic()),
  s = { duration: 5, mode: "actual" as const, color: "#fff", thickness: 1 };
describe("deterministic simulation", () => {
  it("preserves tight turns, pauses and gaps", () => {
    expect(track.fixes.length).toBe(15);
    expect(track.fixes.at(-1)!.segment).toBe(1);
    expect(evaluate(track, s, 1.8).position).toEqual(
      evaluate(track, s, 2).position,
    );
    expect(evaluate(track, s, 3).position).toBeNull();
  });
  it("aligns marker and reveal at every frame", () => {
    for (let i = 0; i <= 150; i++) {
      const f = evaluate(track, s, i / 30);
      expect(f.position).toEqual(f.endpoint);
    }
  });
  it("is independent of evaluation order", () => {
    const first = evaluate(track, s, 2.37);
    for (let i = 100; i >= 0; i--) evaluate(track, s, i / 20);
    expect(evaluate(track, s, 2.37)).toEqual(first);
  });
  it("projects in metres and computes distance", () => {
    const a = synthetic().samples[0];
    expect(project(a.lat!, a.lon!, a)).toEqual([0, 0, 0]);
    expect(distance(a, synthetic().samples[1])).toBeCloseTo(30, 0);
  });
  it("compresses elapsed time and uses rational timestamps", () => {
    expect(evaluate(track, s, 2.5).activityTime - track.start).toBe(40000);
    expect(frameTime(150, 30)).toBe(5);
    expect(frameTime(1, 30)).toBe(0.033333);
  });
});
