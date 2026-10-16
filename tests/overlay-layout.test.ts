import { it, expect } from "vitest";
import {
  indexActivity,
  synthetic,
  evaluate,
  type Settings,
} from "../src/domain/activity";
import { normalizeOverlay, metricDefinitions } from "../src/domain/metrics";
import { overlayLayout } from "../src/render/overlays";
const track = indexActivity(synthetic());
const base: Settings = {
  duration: 15,
  endHold: 4,
  mode: "actual",
  color: "#ffffff",
  thickness: 1,
};
it("keeps every metric inside social export safe margins at all sizes and positions", () => {
  for (const [w, h] of [
    [720, 1280],
    [720, 900],
    [720, 720],
    [1280, 720],
  ])
    for (const size of ["small", "medium", "large"] as const)
      for (const position of ["top", "middle", "bottom"] as const)
        for (const alignment of ["left", "center", "right"] as const) {
          const s = {
            ...base,
            overlay: normalizeOverlay({
              size,
              position,
              alignment,
              visible: metricDefinitions.map((m) => m.id),
            }),
          };
          const layout = overlayLayout(track, s, evaluate(track, s, 5), w, h);
          expect(layout.panel.x).toBeGreaterThanOrEqual(0);
          expect(layout.panel.y).toBeGreaterThanOrEqual(0);
          expect(layout.panel.x + layout.panel.width).toBeLessThanOrEqual(w);
          expect(layout.panel.y + layout.panel.height).toBeLessThanOrEqual(h);
          for (const cell of layout.cells)
            expect(cell.y + cell.height).toBeLessThanOrEqual(
              layout.panel.y + layout.panel.height,
            );
        }
});
it("preserves data geometry throughout the ending hold", () => {
  for (const source of ["synthetic", "tcx"] as const)
    for (const position of ["top", "middle", "bottom"] as const)
      for (const alignment of ["left", "center", "right"] as const) {
        const t = indexActivity({ ...synthetic(), source });
        const s = {
          ...base,
          overlay: normalizeOverlay({ position, alignment, size: "large" }),
        };
        const before = overlayLayout(t, s, evaluate(t, s, 10.9), 720, 1280);
        for (const time of [11, 12, 14.99, 15]) {
          const after = overlayLayout(t, s, evaluate(t, s, time), 720, 1280);
          expect(after.panel).toEqual(before.panel);
          expect(after.scale).toEqual(before.scale);
          expect(after.header).toEqual(before.header);
          expect(after.alignment).toEqual(before.alignment);
          expect(
            after.cells.map(({ metric, ...geometry }) => geometry),
          ).toEqual(before.cells.map(({ metric, ...geometry }) => geometry));
        }
      }
});
