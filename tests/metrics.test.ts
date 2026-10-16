import { it, expect } from "vitest";
import {
  indexActivity,
  synthetic,
  evaluate,
  type Settings,
} from "../src/domain/activity";
import {
  metricsAt,
  normalizeOverlay,
  moveMetric,
  metricDefinitions,
} from "../src/domain/metrics";
import { overlayLayout, overlayTypography } from "../src/render/overlays";
const settings: Settings = {
  duration: 80,
  mode: "actual",
  color: "#73f5c4",
  thickness: 1,
};
const track = indexActivity(synthetic());
const at = (t: number) =>
  metricsAt(track, settings, evaluate(track, settings, t));
const value = (id: string, t: number) => at(t).find((m) => m.id === id)!;
it("formats recorded elapsed time and GPS distance at the same activity instant", () => {
  expect(value("elapsed", 40).value).toBe("0:40");
  expect(value("distance", 40).value).toMatch(/ km$/);
  expect(value("distance", 0).value).toBe("0.00 km");
});
it("derives current pace from measured positions and timestamps", () => {
  expect(value("pace", 5).value).toBe("2:47 /km");
  expect(value("pace", 0).unavailable).toBe(true);
});
it("preserves stops without infinity or fabricated pace", () => {
  expect(value("pace", 32).value).toBe("Stopped");
});
it("does not invent HR, cadence or elevation", () => {
  for (const id of ["heartRate", "cadence", "elevation", "gain"])
    expect(value(id, 20).value).toBe("—");
});
it("labels partial GPS distance and withholds misleading average pace after a gap", () => {
  expect(value("distance", 48).partial).toBe(true);
  expect(value("pace", 48).unavailable).toBe(true);
  expect(value("averagePace", 48).unavailable).toBe(true);
  expect(value("distance", 60).partial).toBe(true);
});
it("uses a numerical recorded BPM value, including sensor records without GPS", () => {
  const a = synthetic();
  a.samples[10].hr = 153;
  const t = indexActivity(a);
  expect(
    metricsAt(t, settings, evaluate(t, settings, 48)).find(
      (m) => m.id === "heartRate",
    )!.value,
  ).toBe("153 BPM");
});
it("expires stale HR measurements rather than holding them forever", () => {
  const a = synthetic();
  a.samples[6].hr = 147;
  const t = indexActivity(a);
  expect(
    metricsAt(t, settings, evaluate(t, settings, 32)).find(
      (m) => m.id === "heartRate",
    )!.value,
  ).toBe("147 BPM");
  expect(
    metricsAt(t, settings, evaluate(t, settings, 40)).find(
      (m) => m.id === "heartRate",
    )!.value,
  ).toBe("—");
});
it("prefers a fresh recorded speed measurement to GPS-derived pace", () => {
  const a = synthetic();
  a.samples[1].speed = 4;
  const t = indexActivity(a);
  expect(
    metricsAt(t, settings, evaluate(t, settings, 5)).find(
      (m) => m.id === "pace",
    )!.value,
  ).toBe("4:10 /km");
});
it("interpolates known elevation and sums positive gain only", () => {
  const a = synthetic();
  a.samples = a.samples.slice(0, 3);
  a.samples[0].elevation = 100;
  a.samples[1].elevation = 110;
  a.samples[2].elevation = 105;
  const t = indexActivity(a),
    s = { ...settings, duration: 8 };
  const metrics = metricsAt(t, s, evaluate(t, s, 6.5));
  expect(metrics.find((m) => m.id === "elevation")!.value).toBe("108 m");
  expect(metrics.find((m) => m.id === "gain")!.value).toBe("10 m");
  expect(metrics.find((m) => m.id === "gain")!.partial).toBe(false);
});
it("marks incomplete elevation gain and does not bridge missing heights", () => {
  const a = synthetic();
  a.samples[0].elevation = 100;
  a.samples[2].elevation = 130;
  const t = indexActivity(a);
  const gain = metricsAt(t, settings, evaluate(t, settings, 8)).find(
    (m) => m.id === "gain",
  )!;
  expect(gain.value).toBe("0 m");
  expect(gain.partial).toBe(true);
});
it("synchronizes uniform-mode time to the marker GPS timestamp", () => {
  const a = synthetic();
  a.samples = a.samples.slice(0, 3);
  const t = indexActivity(a),
    s = { ...settings, duration: 8, mode: "uniform" as const };
  expect(
    metricsAt(t, s, evaluate(t, s, 4)).find((m) => m.id === "elapsed")!.value,
  ).toBe("0:02");
});
it("keeps elapsed/average pace unavailable when timestamps are missing", () => {
  const a = synthetic();
  a.samples.forEach((s) => (s.time = null));
  const t = indexActivity(a),
    s = { ...settings, mode: "uniform" as const };
  const values = metricsAt(t, s, evaluate(t, s, 10));
  expect(values.find((m) => m.id === "elapsed")!.unavailable).toBe(true);
  expect(values.find((m) => m.id === "averagePace")!.unavailable).toBe(true);
});
it("normalizes duplicates, preserves intentional all-off state, and keeps all nine reorderable", () => {
  const o = normalizeOverlay({
    visible: [],
    order: ["pace", "pace", "distance"],
  });
  expect(o.visible).toEqual([]);
  expect(o.order[0]).toBe("pace");
  expect(new Set(o.order).size).toBe(9);
  expect(moveMetric(o, "distance", 0).order[0]).toBe("distance");
  expect(o.order[0]).toBe("pace");
});
it("supports independent toggles and exact layout order", () => {
  const overlay = normalizeOverlay({
    order: ["pace", "distance", "elapsed"],
    visible: ["pace", "elapsed"],
  });
  const cells = overlayLayout(
    track,
    { ...settings, overlay },
    evaluate(track, settings, 20),
    720,
    1280,
  ).cells;
  expect(cells.map((c) => c.metric.id)).toEqual(["pace", "elapsed"]);
  expect(
    overlayLayout(
      track,
      { ...settings, overlay: { ...overlay, enabled: false } },
      evaluate(track, settings, 20),
      720,
      1280,
    ).cells,
  ).toEqual([]);
});
it.each([
  [720, 1280],
  [720, 900],
  [720, 720],
  [1280, 720],
  [1080, 1920],
])("fits all metrics within %i×%i", (width, height) => {
  const layout = overlayLayout(
    track,
    {
      ...settings,
      overlay: normalizeOverlay({
        visible: metricDefinitions.map((m) => m.id),
      }),
    },
    evaluate(track, settings, 20),
    width,
    height,
  );
  expect(layout.cells.length).toBe(9);
  for (const c of layout.cells) {
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThan(0);
    expect(c.x + c.width).toBeLessThan(width);
    expect(c.y + c.height).toBeLessThan(height);
  }
});
it("provides typography matched to all four presets without remote fonts", () => {
  expect(overlayTypography.technical.font).toContain("sans-serif");
  expect(overlayTypography.paper.font).toContain("sans-serif");
  expect(overlayTypography.sunset.italic).toBe(false);
  expect(overlayTypography.neon.font).toContain("Arial");
});
