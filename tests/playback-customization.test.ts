import { it, expect } from "vitest";
import {
  synthetic,
  indexActivity,
  evaluate,
  motionDuration,
  type Settings,
} from "../src/domain/activity";
import {
  metricsAt,
  normalizeOverlay,
  totalActivityTime,
} from "../src/domain/metrics";
import { typographyChoices, typographyFor } from "../src/render/overlays";
const s: Settings = {
  duration: 15,
  mode: "actual",
  color: "#fff",
  thickness: 1,
};
it("allows exact duplicate same-instant GPS records without changing source samples or replay", () => {
  const a = synthetic(),
    original = a.samples.length;
  a.samples.splice(2, 0, { ...a.samples[1], hr: 159 });
  const t = indexActivity(a);
  expect(t.timed).toBe(true);
  expect(t.fixes.length).toBe(original - 1);
  expect(t.activity.samples.length).toBe(original + 1);
  expect(t.timingIssues.ignoredDuplicates).toBe(1);
  expect(evaluate(t, s, 5).position).not.toBeNull();
});
it("keeps missing/regressing clocks unavailable with specific reasons", () => {
  for (const type of ["missing", "regressing"] as const) {
    const a = synthetic();
    a.samples[2].time = type === "missing" ? null : a.samples[0].time;
    const t = indexActivity(a);
    expect(t.timed).toBe(false);
    expect(t.timingIssues[type]).toBeGreaterThan(0);
  }
});
it.each([2, 4] as const)(
  "freezes route, camera and final metrics during a %is hold, including last encoded-frame time",
  (endHold) => {
    const t = indexActivity(synthetic()),
      settings = { ...s, endHold },
      finish = 15 - endHold;
    expect(motionDuration(settings)).toBe(finish);
    const final = evaluate(t, settings, finish);
    expect(final.position).toEqual(t.fixes.at(-1)!.p);
    expect(evaluate(t, settings, finish - 1).distance).toBeLessThan(t.length);
    for (const time of [finish + 0.5, 14, 15 - 1 / 30, 15]) {
      const frame = evaluate(t, settings, time);
      expect(frame).toEqual(final);
      expect(metricsAt(t, settings, frame)).toEqual(
        metricsAt(t, settings, final),
      );
    }
  },
);
it("keeps no-hold behavior and never divides by zero for a short clip", () => {
  expect(motionDuration(s)).toBe(15);
  expect(motionDuration({ ...s, duration: 2, endHold: 4 })).toBeGreaterThan(0);
});
it("shows source total elapsed time even when route timestamps prevent Actual Timing", () => {
  const a = synthetic();
  a.samples.forEach((p) => (p.time = null));
  a.summary = { elapsed: 3661, timer: 3550, distance: 9000 };
  const t = indexActivity(a),
    settings = { ...s, mode: "uniform" as const };
  const m = metricsAt(t, settings, evaluate(t, settings, 15));
  expect(m.find((v) => v.id === "totalTime")!.value).toBe("1:01:01");
  expect(m.find((v) => v.id === "elapsed")!.unavailable).toBe(true);
  expect(t.metrics.available.totalTime).toBe(true);
});
it("uses valid first/last source timestamps for total time despite an internal missing timestamp", () => {
  const a = synthetic();
  a.samples[3].time = null;
  expect(indexActivity(a).timed).toBe(false);
  expect(totalActivityTime(a)).toEqual({
    seconds: 80,
    kind: "elapsed",
    source: "first-to-last recorded timestamps",
  });
});
it("distinguishes recorded lap/timer duration from elapsed time", () => {
  const a = synthetic();
  a.samples.forEach((p) => (p.time = null));
  a.laps = [
    { start: null, duration: 120, distance: 500 },
    { start: null, duration: 180, distance: 700 },
  ];
  const t = indexActivity(a),
    settings = { ...s, mode: "uniform" as const },
    m = metricsAt(t, settings, evaluate(t, settings, 15)).find(
      (v) => v.id === "totalTime",
    )!;
  expect(m.value).toBe("5:00");
  expect(m.label).toBe("Total timer time");
});
it("does not fabricate total duration when all sources are missing", () => {
  const a = synthetic();
  a.samples.forEach((p) => (p.time = null));
  expect(totalActivityTime(a)).toBeNull();
});
it("offers only sans-serif choices, independent of the visual theme", () => {
  for (const type of typographyChoices) {
    expect(type.font).toContain("sans-serif");
    expect(type.font).not.toMatch(/Georgia|Times|monospace/);
    for (const style of ["neon", "technical", "paper", "sunset"] as const)
      expect(
        typographyFor({
          ...s,
          style,
          overlay: normalizeOverlay({ typography: type.id }),
        }).id,
      ).toBe(type.id);
  }
  expect(normalizeOverlay({ visible: [] }).visible).toEqual([]);
});
