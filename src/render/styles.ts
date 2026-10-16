import type { Settings } from "../domain/activity";
export const visualStyles = [
  {
    id: "neon",
    name: "Neon Studio",
    description: "Mint route with a luminous halo on a dark studio.",
    background: "#090d14",
    color: "#73f5c4",
    ghost: "#2a3949",
    marker: "#ffffff",
    glow: 0.35,
    grid: false,
    lineWidth: 4,
  },
  {
    id: "technical",
    name: "Technical Grid",
    description: "Crisp cyan lines over an abstract measurement grid.",
    background: "#0b151e",
    color: "#8acde0",
    ghost: "#2c485b",
    marker: "#edfaff",
    glow: 0,
    grid: true,
    lineWidth: 2,
  },
  {
    id: "paper",
    name: "Paper",
    description: "Warm white background with a clean coral route.",
    background: "#f3efe6",
    color: "#cf503b",
    ghost: "#c9c5bb",
    marker: "#29353b",
    glow: 0,
    grid: false,
    lineWidth: 5,
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm amber light against a muted plum studio.",
    background: "#24172d",
    color: "#ffaf67",
    ghost: "#59465b",
    marker: "#fff2d4",
    glow: 0.25,
    grid: false,
    lineWidth: 4,
  },
] as const;
export type VisualStyle = (typeof visualStyles)[number]["id"];
export function getStyle(id: VisualStyle = "neon") {
  return visualStyles.find((s) => s.id === id) ?? visualStyles[0];
}
export function applyStyle(settings: Settings, id: VisualStyle): Settings {
  const style = getStyle(id);
  return {
    ...settings,
    style: style.id,
    backgroundColor: undefined,
    color: style.color,
    lineWidth: style.lineWidth,
  };
}
/** Width is defined at a 720-pixel short edge, keeping preview/export framing identical. */
export function scaledLineWidth(
  width: number = 4,
  viewportWidth: number,
  viewportHeight: number,
) {
  return (
    (Math.min(20, Math.max(1, Number.isFinite(width) ? width : 4)) *
      Math.min(viewportWidth, viewportHeight)) /
    720
  );
}
