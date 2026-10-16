export const socialFormats = [
  { id: "9:16", label: "Vertical · Reels / Stories", width: 720, height: 1280 },
  { id: "4:5", label: "Portrait · Feed", width: 720, height: 900 },
  { id: "1:1", label: "Square", width: 720, height: 720 },
  { id: "16:9", label: "Landscape", width: 1280, height: 720 },
] as const;
export type ExportAspect = (typeof socialFormats)[number]["id"];
export function exportDimensions(
  aspect: ExportAspect = "16:9",
  resolution: 720 | 1080 = 720,
) {
  const format = socialFormats.find((f) => f.id === aspect);
  if (!format) throw Error("Unsupported export aspect ratio.");
  if (resolution !== 720 && resolution !== 1080)
    throw Error("Unsupported export resolution.");
  const scale = resolution / 720;
  return { width: format.width * scale, height: format.height * scale };
}
