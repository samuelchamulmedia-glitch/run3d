import { it, expect } from "vitest";
import {
  indexActivity,
  synthetic,
  evaluate,
  type Settings,
} from "../src/domain/activity";
import { defaultCamera } from "../src/simulation/camera";
import { exportDimensions, socialFormats } from "../src/export/formats";
const track = indexActivity(synthetic());
it.each(["follow", "top-down", "showcase"] as const)(
  "%s has fixed orientation, no zoom pumping and continuous acceleration at pauses/gaps",
  (preset) => {
    const settings: Settings = {
      duration: 15,
      mode: "actual",
      color: "#fff",
      thickness: 1,
      camera: { ...defaultCamera, preset },
    };
    const direction = (f: ReturnType<typeof evaluate>) => {
      const v = f.camera.map((p, i) => p - f.target[i]),
        n = Math.hypot(...v);
      return v.map((p) => p / n);
    };
    const expected = direction(evaluate(track, settings, 0));
    const distances: number[] = [];
    for (let i = 0; i <= 450; i++) {
      const f = evaluate(track, settings, i / 30);
      expect(
        direction(f)
          .map((v, k) => Math.abs(v - expected[k]))
          .every((e) => e < 1e-12),
      ).toBe(true);
      distances.push(Math.hypot(...f.camera.map((v, k) => v - f.target[k])));
    }
    const close = distances.slice(
      0,
      preset === "showcase" ? 292 : distances.length,
    );
    expect(Math.max(...close) - Math.min(...close)).toBeLessThan(1e-10);
    // Cubic spline knot boundaries have matching acceleration from both sides.
    for (let t = 0.6; t < 14.4; t += 0.6) {
      const h = 1e-4;
      const p = (s: number) => evaluate(track, settings, s).camera;
      const derivative = (s: number) => {
        const a = p(s - h),
          b = p(s),
          c = p(s + h);
        return b.map((v, i) => (a[i] - 2 * v + c[i]) / (h * h));
      };
      const a = derivative(t - h * 2),
        b = derivative(t + h * 2);
      expect(Math.hypot(...a.map((v, i) => v - b[i]))).toBeLessThan(1);
    }
  },
);
it("format dimensions are exact, even and use the requested aspect", () => {
  for (const f of socialFormats) {
    for (const resolution of [720, 1080] as const) {
      const d = exportDimensions(f.id, resolution);
      expect(d.width % 2).toBe(0);
      expect(d.height % 2).toBe(0);
      const [a, b] = f.id.split(":").map(Number);
      expect(d.width / d.height).toBeCloseTo(a / b, 10);
      expect(Math.min(d.width, d.height)).toBe(resolution);
    }
  }
  expect(() => exportDimensions("bad" as "9:16")).toThrow();
});
