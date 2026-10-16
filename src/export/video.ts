import { drawOverlay } from "../render/overlays";
import { exportDimensions } from "./formats";
import {
  Output,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  canEncodeVideo,
} from "mediabunny";
import { createScene } from "../render/scene";
import type { Track, Settings, Frame } from "../domain/activity";
export function frameTime(i: number, fps: number) {
  return Math.round((i * 1e6) / fps) / 1e6;
}
export async function exportVideo(
  track: Track,
  settings: Settings,
  signal: AbortSignal,
  onProgress: (p: number) => void,
  preferred: "mp4" | "webm" = "mp4",
  observeFrame?: (time: number, frame: Readonly<Frame>) => void,
) {
  if (
    !Number.isInteger(settings.duration) ||
    settings.duration <= 0 ||
    settings.duration > 60
  )
    throw Error("Video duration must be between 0 and 60 seconds.");
  settings = {
    ...settings,
    camera: settings.camera ? { ...settings.camera } : undefined,
    overlay: settings.overlay
      ? {
          ...settings.overlay,
          order: [...settings.overlay.order],
          visible: [...settings.overlay.visible],
        }
      : undefined,
  };
  signal.throwIfAborted();
  const { width, height } = exportDimensions(
    settings.exportAspect,
    settings.exportResolution,
  );
  const fps = 30,
    bitrate = settings.exportResolution === 1080 ? 12_000_000 : 6_000_000;
  const codec =
    preferred === "mp4" &&
    (await canEncodeVideo("avc", {
      width,
      height,
      bitrate,
      frameRate: fps,
      latencyMode: "quality",
    }))
      ? "avc"
      : (await canEncodeVideo("vp9", {
            width,
            height,
            bitrate,
            frameRate: fps,
            latencyMode: "quality",
          }))
        ? "vp9"
        : (await canEncodeVideo("vp8", {
              width,
              height,
              bitrate,
              frameRate: fps,
              latencyMode: "quality",
            }))
          ? "vp8"
          : null;
  if (!codec)
    throw Error(
      "No supported video encoder. Try a current desktop Chrome or Edge browser.",
    );
  const canvas = document.createElement("canvas"),
    composite = document.createElement("canvas");
  composite.width = width;
  composite.height = height;
  const ctx = composite.getContext("2d")!;
  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = width;
  overlayCanvas.height = height;
  const overlayCtx = overlayCanvas.getContext("2d")!;
  await document.fonts.ready;
  const scene = createScene(canvas, track, width, height),
    target = new BufferTarget();
  const output = new Output({
    target,
    format:
      codec === "avc"
        ? new Mp4OutputFormat({ fastStart: "in-memory" })
        : new WebMOutputFormat(),
  });
  let encoderConfig: VideoEncoderConfig | undefined;
  const source = new CanvasSource(composite, {
    codec,
    bitrate,
    latencyMode: "quality",
    onEncoderConfig: (config) => {
      encoderConfig = config;
    },
  });
  output.addVideoTrack(source, { frameRate: fps });
  const frames = Math.round(settings.duration * fps);
  let complete = false;
  try {
    // A finalized one-frame trial checks that the selected encoder really works,
    // rather than trusting an API/configuration probe alone.
    scene.render(0, settings);
    ctx.drawImage(canvas, 0, 0);
    const probe = new Output({
      target: new BufferTarget(),
      format: codec === "avc" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    });
    const probeSource = new CanvasSource(composite, {
      codec,
      bitrate,
      latencyMode: "quality",
    });
    probe.addVideoTrack(probeSource, { frameRate: fps });
    try {
      await probe.start();
      signal.throwIfAborted();
      await probeSource.add(0, 1 / fps);
      await probe.finalize();
    } catch (e) {
      await probe.cancel().catch(() => {});
      throw e;
    } finally {
      probeSource.close();
    }
    signal.throwIfAborted();
    await output.start();
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted();
      const t = frameTime(i, fps);
      const frame = scene.render(t, settings);
      observeFrame?.(t, frame);
      ctx.drawImage(canvas, 0, 0);
      drawOverlay(overlayCtx, track, settings, frame, width, height);
      ctx.drawImage(overlayCanvas, 0, 0);
      await source.add(t, frameTime(i + 1, fps) - t, {
        keyFrame: i % (fps * 2) === 0,
      });
      signal.throwIfAborted();
      onProgress((i + 1) / frames);
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    await output.finalize();
    complete = true;
    const buffer = target.buffer;
    if (!buffer) throw Error("No finalized output.");
    if (buffer.byteLength > 128 * 1024 * 1024)
      throw Error("Encoded file exceeds 128 MiB limit.");
    const extension = codec === "avc" ? "mp4" : "webm";
    return {
      blob: new Blob([buffer], { type: `video/${extension}` }),
      codec,
      frames,
      fps,
      width,
      height,
      duration: settings.duration,
      encoderConfig,
    };
  } finally {
    if (!complete) await output.cancel().catch(() => {});
    source.close();
    scene.dispose(true);
  }
}
