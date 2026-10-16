import { it, expect } from "vitest";
import {
  synthetic,
  indexActivity,
  evaluate,
  type Settings,
} from "../src/domain/activity";
import { metricsAt } from "../src/domain/metrics";
const settings: Settings = {
  duration: 15,
  mode: "actual",
  color: "#fff",
  thickness: 1,
};
function fixture() {
  const a = synthetic(),
    base = a.samples[0],
    stamp = base.time!;
  a.samples = [
    [0, 0],
    [5, 5],
    [5, 500],
    [10, 505],
    [15, 510],
  ].map(([t, x]) => ({
    ...base,
    time: stamp + t * 1000,
    lat: 13.7,
    lon: -89.2 + x / (111195 * Math.cos((13.7 * Math.PI) / 180)),
    speed: 3,
  }));
  a.events = [];
  a.warnings = [];
  return a;
}
it("keeps original timestamps and jumps to the last same-time source fix exactly at its recorded instant", () => {
  const a = fixture(),
    original = a.samples.map((p) => p.time),
    t = indexActivity(a);
  expect(t.timed).toBe(true);
  expect(t.activity.samples.map((p) => p.time)).toEqual(original);
  expect(t.fixes.map((p) => p.time)).toEqual(original);
  expect(evaluate(t, settings, 4.999).position![0]).toBeLessThan(
    t.fixes[1].p[0],
  );
  expect(evaluate(t, settings, 5).position).toEqual(t.fixes[2].p);
  expect(evaluate(t, settings, 5.001).position![0]).toBeGreaterThan(
    t.fixes[2].p[0],
  );
  expect(evaluate(t, settings, 4.999).index).toBe(0);
  expect(evaluate(t, settings, 5).index).toBe(2);
});
it("never adds distance or interpolating geometry across the zero-duration jump", () => {
  const t = indexActivity(fixture());
  expect(t.fixes[1].segment).not.toBe(t.fixes[2].segment);
  expect(t.fixes[2].distance).toBe(t.fixes[1].distance);
  expect(t.length).toBeCloseTo(15, 1);
  expect(t.gaps.some((g) => g.start === g.end)).toBe(true);
});
it("suppresses even recorded speed across the ambiguous five-second pace window, then resumes reliable pace", () => {
  const t = indexActivity(fixture()),
    pace = (time: number) =>
      metricsAt(t, settings, evaluate(t, settings, time)).find(
        (m) => m.id === "pace",
      )!;
  expect(pace(4).unavailable).toBe(false);
  for (const time of [5, 5.001, 8, 10])
    expect(pace(time).unavailable).toBe(true);
  expect(pace(10.001).unavailable).toBe(false);
  expect(
    metricsAt(t, settings, evaluate(t, settings, 5)).find(
      (m) => m.id === "elapsed",
    )!.value,
  ).toBe("0:05");
});
it("handles 21 conflicting same-time records, finite camera poses, reverse scrubbing and final hold", () => {
  const a = fixture();
  a.samples.splice(
    2,
    1,
    ...Array.from({ length: 21 }, (_, i) => ({
      ...a.samples[2],
      lon: a.samples[2].lon! + i * 0.00001,
    })),
  );
  const t = indexActivity(a);
  expect(t.timingIssues.duplicates).toBe(21);
  expect(t.timed).toBe(true);
  expect(t.timingJumps).toHaveLength(1);
  const first = evaluate(t, settings, 5);
  evaluate(t, settings, 13);
  expect(evaluate(t, settings, 5)).toEqual(first);
  for (const time of [0, 4.99, 5, 5.01, 15]) {
    const f = evaluate(t, settings, time);
    expect(
      [...f.camera, ...f.target, ...f.position!].every(Number.isFinite),
    ).toBe(true);
  }
  const held = { ...settings, endHold: 4 as const };
  expect(evaluate(t, held, 11)).toEqual(evaluate(t, held, 14.99));
});
it("does not enable missing, regressing or zero-span clocks", () => {
  const a = fixture();
  a.samples[2].time = null;
  expect(indexActivity(a).timed).toBe(false);
  const b = fixture();
  b.samples[3].time = b.samples[0].time;
  expect(indexActivity(b).timed).toBe(false);
  const c = fixture();
  c.samples.forEach((p) => (p.time = c.samples[0].time));
  expect(indexActivity(c).timed).toBe(false);
});
