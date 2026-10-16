import { it, expect, vi } from "vitest";
import { synthetic, indexActivity } from "../src/domain/activity";
vi.mock("mediabunny", () => ({
  canEncodeVideo: vi.fn(async () => false),
  Output: class {},
  BufferTarget: class {},
  CanvasSource: class {},
  Mp4OutputFormat: class {},
  WebMOutputFormat: class {},
}));
import { exportVideo, frameTime } from "../src/export/video";
const t = indexActivity(synthetic()),
  s = { duration: 5, mode: "actual" as const, color: "#fff", thickness: 1 };
it("reports unsupported encoders before creating GPU resources", async () => {
  await expect(
    exportVideo(t, s, new AbortController().signal, () => {}),
  ).rejects.toThrow("No supported video encoder");
});
it("rejects pre-cancelled exports before probing or rendering", async () => {
  const c = new AbortController();
  c.abort();
  await expect(exportVideo(t, s, c.signal, () => {})).rejects.toThrow();
});
it("rejects excessive and fractional durations", async () => {
  for (const duration of [0, 61, 1.5, NaN])
    await expect(
      exportVideo(
        t,
        { ...s, duration },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("duration");
});
it("does not accumulate microsecond rounding errors at any planned fps", () => {
  for (const fps of [24, 30, 60]) {
    let accumulated = 0;
    for (let i = 0; i < fps * 60; i++) {
      const d = frameTime(i + 1, fps) - frameTime(i, fps);
      expect(d).toBeGreaterThan(0);
      accumulated += d;
    }
    expect(accumulated).toBeCloseTo(60, 10);
  }
});
