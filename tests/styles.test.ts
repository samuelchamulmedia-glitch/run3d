import { it, expect } from "vitest";
import {
  applyStyle,
  visualStyles,
  scaledLineWidth,
} from "../src/render/styles";
import {
  evaluate,
  indexActivity,
  synthetic,
  type Settings,
} from "../src/domain/activity";
const s: Settings = {
    duration: 30,
    mode: "actual",
    color: "#fff",
    thickness: 1,
  },
  track = indexActivity(synthetic());
it.each(visualStyles)(
  "$name keeps activity timing, marker position and camera intact",
  (style) => {
    const after = applyStyle(s, style.id);
    expect(after.color).toBe(style.color);
    expect(after.lineWidth).toBe(style.lineWidth);
    expect(evaluate(track, after, 12)).toEqual(evaluate(track, s, 12));
    expect(s.color).toBe("#fff");
  },
);
it("width scales consistently between preview, 720p, 1080p and portrait", () => {
  expect(scaledLineWidth(6, 1280, 720)).toBe(6);
  expect(scaledLineWidth(6, 1920, 1080)).toBe(9);
  expect(scaledLineWidth(6, 360, 640)).toBe(3);
  expect(scaledLineWidth(6, 720, 1280)).toBe(6);
  expect(scaledLineWidth(NaN, 720, 720)).toBe(4);
  expect(scaledLineWidth(100, 720, 720)).toBe(20);
});
