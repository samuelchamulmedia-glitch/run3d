import { it, expect } from "vitest";
import {
  indexActivity,
  synthetic,
  evaluate,
  project,
  distance,
  type Settings,
} from "../src/domain/activity";
const settings: Settings = {
  duration: 30,
  mode: "actual",
  color: "#fff",
  thickness: 1,
};
it("does not invent missing HR or elevation", () => {
  expect(
    synthetic().samples.every((s) => s.hr === null && s.elevation === null),
  ).toBe(true);
});
it("rejects invalid latitude", () => {
  const a = synthetic();
  a.samples[0].lat = 91;
  expect(() => indexActivity(a)).toThrow("coordinates");
});
it("does not interpret missing GPS as zero", () => {
  const a = synthetic();
  a.samples.forEach((s) => {
    s.lat = null;
    s.lon = null;
  });
  expect(() => indexActivity(a)).toThrow("No usable GPS");
});
it("disables Actual Timing for missing timestamps", () => {
  const a = synthetic();
  a.samples[3].time = null;
  const track = indexActivity(a);
  expect(track.timed).toBe(false);
  expect(() => evaluate(track, settings, 1)).toThrow("nondecreasing");
  expect(
    evaluate(track, { ...settings, mode: "uniform" }, 1).position,
  ).not.toBeNull();
});
it("rejects temporal regression for actual replay", () => {
  const a = synthetic();
  a.samples[3].time = a.samples[0].time;
  expect(indexActivity(a).timed).toBe(false);
});
it("allows same-time position changes as instantaneous jumps", () => {
  const a = synthetic();
  a.samples[1].time = a.samples[0].time;
  expect(indexActivity(a).timed).toBe(true);
});
it("clamps endpoints and closes completed route", () => {
  const track = indexActivity(synthetic());
  expect(evaluate(track, settings, -1).position).toEqual(track.fixes[0].p);
  expect(evaluate(track, settings, 30).position).toEqual(track.fixes.at(-1)!.p);
});
it("does not add distance through missing GPS", () => {
  const a = synthetic();
  const track = indexActivity(a);
  const before = track.fixes.find((f) => f.sourceIndex === 9)!,
    after = track.fixes.find((f) => f.sourceIndex === 11)!;
  expect(after.distance).toBe(before.distance);
});
it("uses variable recorded section speed", () => {
  const track = indexActivity(synthetic());
  const first = evaluate(track, { ...settings, duration: 80 }, 2.5),
    fast = evaluate(track, { ...settings, duration: 80 }, 6.5);
  expect(first.fraction).toBeCloseTo(0.5);
  expect(fast.fraction).toBeCloseTo(0.5);
  expect(first.index).not.toBe(fast.index);
});
it("handles antimeridian and high latitude in local coordinates", () => {
  const a = synthetic().samples[0];
  a.lat = 80;
  a.lon = 179.999;
  const p = project(80, -179.999, a);
  expect(Math.hypot(...p)).toBeLessThan(40);
  expect(distance(a, { ...a, lon: -179.999 })).toBeLessThan(40);
});
it("retains source measurements while deriving distance", () => {
  const a = synthetic();
  a.samples[0].distance = 999;
  const t = indexActivity(a);
  expect(t.fixes[0].distance).toBe(0);
  expect(a.samples[0].distance).toBe(999);
});
it("preserves stationary intervals beyond gap threshold", () => {
  const a = synthetic();
  a.samples = a.samples.slice(0, 2);
  a.samples[1] = { ...a.samples[0], time: a.samples[0].time! + 60000 };
  const t = indexActivity(a);
  expect(t.fixes[1].segment).toBe(0);
  expect(evaluate(t, settings, 15).position).toEqual(t.fixes[0].p);
});
it("honors explicit FIT timer pauses without interpolating across them", () => {
  const a = synthetic();
  a.events = [
    { time: a.samples[3].time, event: "timer", type: "stop_all" },
    { time: a.samples[5].time, event: "timer", type: "start" },
  ];
  const t = indexActivity(a),
    paused = evaluate(t, { ...settings, duration: 80 }, 18);
  expect(paused.position).toEqual(t.fixes[3].p);
  expect(paused.endpoint).toEqual(paused.position);
});
it("indexes 10,000 samples without truncation", () => {
  const a = synthetic();
  a.samples = Array.from({ length: 10000 }, (_, i) => ({
    ...a.samples[0],
    time: a.samples[0].time! + i * 1000,
    lat: 13.7 + i * 0.000001,
  }));
  const t = indexActivity(a);
  expect(t.fixes.length).toBe(10000);
  expect(evaluate(t, settings, 15).index).toBe(4999);
});
it("rejects geometry beyond the prototype limit explicitly", () => {
  const a = synthetic();
  a.samples = Array.from({ length: 20001 }, (_, i) => ({
    ...a.samples[0],
    time: a.samples[0].time! + i * 1000,
  }));
  expect(() => indexActivity(a)).toThrow("20,000");
});
it("rejects nonfinite timestamps and leaves raw input unchanged", () => {
  const a = synthetic();
  const before = JSON.stringify(a);
  indexActivity(a);
  expect(JSON.stringify(a)).toBe(before);
  a.samples[4].time = NaN;
  expect(() => indexActivity(a)).toThrow("Invalid timestamp");
});
it("maps a 60-minute activity into 30 seconds at 120x compression", () => {
  const a = synthetic(),
    base = a.samples[0].time!;
  a.samples.forEach((s) => {
    s.time = base + (s.time! - base) * 45;
  });
  const track = indexActivity(a);
  const f = evaluate(track, { ...settings, duration: 30 }, 15);
  expect((track.end - track.start) / 1000 / 30).toBe(120);
  expect(f.activityTime - base).toBe(1800000);
});
