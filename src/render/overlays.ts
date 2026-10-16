import type { Track, Settings, Frame } from "../domain/activity";
import {
  normalizeOverlay,
  metricsAt,
  type MetricView,
  type TypographyStyle,
} from "../domain/metrics";
import { getStyle, type VisualStyle } from "./styles";
export const typographyChoices: {
  id: TypographyStyle;
  label: string;
  font: string;
  weight: number;
  italic: boolean;
  uppercase: boolean;
}[] = [
  {
    id: "modern",
    label: "Modern Sans",
    font: "Arial, Helvetica, sans-serif",
    weight: 700,
    italic: false,
    uppercase: true,
  },
  {
    id: "compact",
    label: "Compact Sans",
    font: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif',
    weight: 600,
    italic: false,
    uppercase: true,
  },
  {
    id: "rounded",
    label: "Soft Sans",
    font: '"Trebuchet MS", Verdana, sans-serif',
    weight: 600,
    italic: false,
    uppercase: false,
  },
  {
    id: "bold",
    label: "Bold Sans",
    font: '"Arial Black", Arial, sans-serif',
    weight: 900,
    italic: false,
    uppercase: true,
  },
];
export function typographyFor(settings: Settings) {
  return (
    typographyChoices.find(
      (type) => type.id === normalizeOverlay(settings.overlay).typography,
    ) ?? typographyChoices[0]
  );
}
// Legacy preset map retained for consumers; every preset is now sans-serif.
export const overlayTypography: Record<
  VisualStyle,
  (typeof typographyChoices)[number]
> = {
  neon: typographyChoices[0],
  technical: typographyChoices[1],
  paper: typographyChoices[2],
  sunset: typographyChoices[3],
};
export interface OverlayCell {
  metric: MetricView;
  x: number;
  y: number;
  width: number;
  height: number;
}
export function overlayLayout(
  track: Track,
  settings: Settings,
  frame: Frame,
  width: number,
  height: number,
) {
  const overlay = normalizeOverlay(settings.overlay),
    values = metricsAt(track, settings, frame);
  const metrics = overlay.enabled
    ? overlay.order
        .filter((id) => overlay.visible.includes(id))
        .map((id) => values.find((m) => m.id === id)!)
    : [];
  const base = Math.min(width, height) / 720;
  const factor = { small: 0.8, medium: 1, large: 1.25 }[
    overlay.size ?? "medium"
  ];
  // Keep all nine metrics inside the safe area, even in a square export.
  const scale = base * Math.min(factor, 1.2);
  const margin = 32 * base,
    padding = 22 * scale,
    gap = 16 * scale;
  const columns = Math.min(
    metrics.length,
    width / height < 0.8 ? 2 : width / height < 1.2 ? 3 : 4,
  );
  const rows = columns ? Math.ceil(metrics.length / columns) : 0;
  const cellHeight = 70 * scale;
  const header =
    track.activity.source === "synthetic" ? "SYNTHETIC TEST ACTIVITY" : null;
  const headerHeight = header ? 25 * scale : 0;
  const panelWidth = Math.min(
    width - 2 * margin,
    columns * 210 * scale + 2 * padding + Math.max(0, columns - 1) * gap,
  );
  const panelHeight =
    rows * cellHeight +
    Math.max(0, rows - 1) * gap +
    2 * padding +
    headerHeight;
  const alignment = overlay.alignment ?? "center";
  const position = overlay.position;
  const panel = {
    x:
      alignment === "left"
        ? margin
        : alignment === "right"
          ? width - margin - panelWidth
          : (width - panelWidth) / 2,
    y:
      position === "top"
        ? margin
        : position === "middle"
          ? (height - panelHeight) / 2
          : height - margin - panelHeight,
    width: panelWidth,
    height: panelHeight,
  };
  const cellWidth = columns
    ? (panel.width - 2 * padding - (columns - 1) * gap) / columns
    : 0;
  const cells: OverlayCell[] = metrics.map((metric, i) => ({
    metric,
    x: panel.x + padding + (i % columns) * (cellWidth + gap),
    y:
      panel.y +
      padding +
      headerHeight +
      Math.floor(i / columns) * (cellHeight + gap),
    width: cellWidth,
    height: cellHeight,
  }));
  return { panel, cells, scale, header, alignment };
}
/** Shared Canvas 2D composition for preview and video. No HTML screenshot capture. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  track: Track,
  settings: Settings,
  frame: Frame,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  const layout = overlayLayout(track, settings, frame, width, height);
  if (!layout.cells.length) return layout;
  const style = getStyle(settings.style),
    type = typographyFor(settings),
    { panel, scale } = layout;
  ctx.save();
  const overlay = normalizeOverlay(settings.overlay);
  const panelColor =
    overlay.panelColor ?? settings.backgroundColor ?? style.background;
  const rgb = panelColor
    .slice(1)
    .match(/../g)
    ?.map((v) => parseInt(v, 16)) ?? [0, 0, 0];
  const textColor =
    overlay.textColor ??
    (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 150
      ? "#202b32"
      : "#f5f7fa");
  ctx.fillStyle = panelColor;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 12 * scale);
  ctx.fill();
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = style.ghost;
  ctx.lineWidth = scale;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (layout.header) {
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.6;
    ctx.font = `500 ${9 * scale}px Arial, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(layout.header, panel.x + 18 * scale, panel.y + 10 * scale);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = layout.alignment;
  for (const cell of layout.cells) {
    const textX =
      layout.alignment === "center"
        ? cell.x + cell.width / 2
        : layout.alignment === "right"
          ? cell.x + cell.width
          : cell.x;
    const label = cell.metric.label + (cell.metric.partial ? " · partial" : "");
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.65;
    ctx.font = `500 ${(width / height < 0.8 ? 16 : 12) * scale}px ${type.font}`;
    ctx.textBaseline = "top";
    ctx.fillText(
      type.uppercase ? label.toUpperCase() : label,
      textX,
      cell.y,
      cell.width,
    );
    ctx.globalAlpha = 1;
    let size = (width / height < 0.8 ? 40 : 36) * scale;
    const font = () =>
      `${type.italic ? "italic " : ""}${type.weight} ${size}px ${type.font}`;
    ctx.font = font();
    const measured = ctx.measureText(cell.metric.value).width;
    if (measured > cell.width) {
      size *= cell.width / measured;
      ctx.font = font();
    }
    ctx.fillStyle = textColor;
    ctx.globalAlpha = cell.metric.unavailable ? 0.5 : 1;
    ctx.fillText(cell.metric.value, textX, cell.y + 24 * scale, cell.width);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  return layout;
}
