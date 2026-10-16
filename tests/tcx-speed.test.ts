import { it, expect } from "vitest";
import { calibrateCorosTcxSpeed } from "../src/import/tcx-speed";
import {
  synthetic,
  indexActivity,
  evaluate,
  type Sample,
  type Settings,
} from "../src/domain/activity";
import { metricsAt } from "../src/domain/metrics";
function samples(speed = 7.2): Sample[] {
  const base = synthetic().samples[0];
  return Array.from({ length: 121 }, (_, i) => ({
    ...base,
    time: base.time! + i * 1000,
    lat: base.lat! + (i * 2) / 111195,
    distance: i * 2,
    speed,
    raw: [{ field: "Speed", value: String(speed), unit: null }],
  }));
}
it("normalizes corroborated nonstandard COROS km/h speed and preserves raw source fields", () => {
  const a = samples(),
    core = a.map(() => true),
    raw = JSON.stringify(a.map((s) => s.raw)),
    result = calibrateCorosTcxSpeed(a, "COROS Wearables", core);
  expect(result.unit).toBe("km/h");
  expect(result.ratio).toBeCloseTo(3.6);
  expect(result.windows).toBe(6);
  expect(a.every((s) => s.speed === 2)).toBe(true);
  expect(JSON.stringify(a.map((s) => s.raw))).toBe(raw);
  const activity = synthetic();
  activity.samples = a;
  activity.events = [];
  const t = indexActivity(activity),
    settings: Settings = {
      duration: 120,
      mode: "actual",
      color: "#fff",
      thickness: 1,
    };
  expect(
    metricsAt(t, settings, evaluate(t, settings, 60)).find(
      (m) => m.id === "pace",
    )!.value,
  ).toBe("8:20 /km");
});
it("preserves COROS m/s values that agree with distance/time", () => {
  const a = samples(2),
    result = calibrateCorosTcxSpeed(
      a,
      "COROS Wearables",
      a.map(() => true),
    );
  expect(result.unit).toBe("m/s");
  expect(a.every((s) => s.speed === 2)).toBe(true);
});
it("never converts standard extension speeds or other producers", () => {
  for (const [producer, core] of [
    ["COROS Wearables", false],
    ["Garmin", true],
    ["", true],
  ] as const) {
    const a = samples();
    expect(
      calibrateCorosTcxSpeed(
        a,
        producer,
        a.map(() => core),
      ).unit,
    ).toBe("not-applicable");
    expect(a.every((s) => s.speed === 7.2)).toBe(true);
  }
});
it("withholds ambiguous nonstandard units instead of using an arbitrary conversion", () => {
  const a = samples(4.4);
  expect(
    calibrateCorosTcxSpeed(
      a,
      "COROS",
      a.map(() => true),
    ).unit,
  ).toBe("unverified");
  expect(a.every((s) => s.speed === null)).toBe(true);
  expect(a[0].raw![0].value).toBe("4.4");
});
it("requires sufficient evidence and does not infer speed units without recorded distance", () => {
  const short = samples().slice(0, 25);
  expect(
    calibrateCorosTcxSpeed(
      short,
      "COROS",
      short.map(() => true),
    ).unit,
  ).toBe("unverified");
  const a = samples();
  a.forEach((s) => (s.distance = null));
  expect(
    calibrateCorosTcxSpeed(
      a,
      "COROS",
      a.map(() => true),
    ).unit,
  ).toBe("unverified");
});
it("uses original sample intervals for irregular sampling and excludes clock gaps or distance resets", () => {
  const a = samples().filter((_, i) => i % 2 === 0);
  expect(
    calibrateCorosTcxSpeed(
      a,
      "COROS",
      a.map(() => true),
    ).unit,
  ).toBe("km/h");
  const b = samples();
  b.forEach((s, i) => {
    s.time! += i * 20000;
  });
  expect(
    calibrateCorosTcxSpeed(
      b,
      "COROS",
      b.map(() => true),
    ).unit,
  ).toBe("unverified");
  const c = samples();
  c.forEach((s, i) => (s.distance = 120 - i));
  expect(
    calibrateCorosTcxSpeed(
      c,
      "COROS",
      c.map(() => true),
    ).unit,
  ).toBe("unverified");
});
it("requires a consensus rather than converting inconsistent speed scales", () => {
  const a = samples();
  a.forEach((s, i) => (s.speed = i < 61 ? 2 : 7.2));
  expect(
    calibrateCorosTcxSpeed(
      a,
      "COROS",
      a.map(() => true),
    ).unit,
  ).toBe("unverified");
});
