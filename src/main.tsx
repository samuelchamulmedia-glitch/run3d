import { OverlayPanel } from "./ui-overlays";
import { drawOverlay } from "./render/overlays";
import { visualStyles, getStyle, type VisualStyle } from "./render/styles";
import {
  socialFormats,
  exportDimensions,
  type ExportAspect,
} from "./export/formats";
import { CameraPanel } from "./ui-camera";
import React from "react";
import { createRoot } from "react-dom/client";
import {
  indexActivity,
  synthetic,
  motionDuration,
  type Settings,
} from "./domain/activity";
import { createScene } from "./render/scene";
import { exportVideo } from "./export/video";
import { saveVideoFile, type VideoExtension } from "./export/save";
import { importActivity, SportConfirmationRequired } from "./import/activity";
import { useEditor } from "./state/editor";
import "./style.css";
const controlPanels = [
  ["activity", "Activity"],
  ["timing", "Timing"],
  ["style", "Style"],
  ["data", "Data"],
  ["camera", "Camera"],
  ["export", "Export"],
] as const;
type ControlPanel = (typeof controlPanels)[number][0];
function App() {
  const [previewExpanded, setPreviewExpanded] = React.useState(false);
  const [activePanel, setActivePanel] =
    React.useState<ControlPanel>("activity");
  const {
    track,
    settings,
    playing,
    inspect,
    setSettings,
    setCamera,
    setStyle,
    setVisual,
    setOverlay,
    setTrack,
    setPlaying,
    setInspect,
    setTime,
  } = useEditor();
  const time = useEditor((s) => s.time),
    canvas = React.useRef<HTMLCanvasElement>(null),
    surface = React.useRef<ReturnType<typeof createScene> | null>(null),
    overlayCanvas = React.useRef<HTMLCanvasElement>(null);
  const [sceneRevision, setSceneRevision] = React.useState(0);
  const [error, setError] = React.useState(""),
    [pending, setPending] = React.useState<File | null>(null),
    [busy, setBusy] = React.useState(false),
    [progress, setProgress] = React.useState<number | null>(null),
    [saving, setSaving] = React.useState(false),
    [saveStatus, setSaveStatus] = React.useState(""),
    [result, setResult] = React.useState<{
      url: string;
      extension: VideoExtension;
      blob: Blob;
    } | null>(null);
  const abort = React.useRef<AbortController | null>(null),
    url = React.useRef<string | null>(null);
  React.useEffect(
    () => () => {
      abort.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  React.useEffect(() => {
    let scene: ReturnType<typeof createScene>;
    try {
      scene = createScene(canvas.current!, track, 960, 540);
      surface.current = scene;
    } catch (e) {
      setError(String(e));
      return;
    }
    const resize = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const dimensions = exportDimensions(
        useEditor.getState().settings.exportAspect,
      );
      scene.resize(w, (w * dimensions.height) / dimensions.width);
    });
    resize.observe(canvas.current!.parentElement!);
    const overlayCtx = overlayCanvas.current!.getContext("2d")!;
    let id = 0;
    let wasPlaying = false,
      anchor = 0,
      offset = 0;
    const tick = (now: number) => {
      const state = useEditor.getState();
      if (state.playing && !wasPlaying) {
        anchor = now;
        offset = state.time;
      }
      wasPlaying = state.playing;
      const t = state.playing
        ? Math.min(state.settings.duration, offset + (now - anchor) / 1000)
        : state.time;
      if (state.playing) {
        state.setTime(t);
        if (t >= state.settings.duration) state.setPlaying(false);
      }
      try {
        scene.setInspection(state.inspect);
        if (state.settings.mode === "actual" && !state.track.timed) {
          const frame = scene.render(t, { ...state.settings, mode: "uniform" });
          renderData(frame);
          if (state.time !== 0) state.setTime(0);
        } else {
          const frame = scene.render(t, state.settings);
          renderData(frame);
        }
        function renderData(frame: import("./domain/activity").Frame) {
          const c = overlayCanvas.current!;
          if (c.width !== canvas.current!.width)
            c.width = canvas.current!.width;
          if (c.height !== canvas.current!.height)
            c.height = canvas.current!.height;
          const layout = drawOverlay(
            overlayCtx,
            state.track,
            state.settings,
            frame,
            c.width,
            c.height,
          );
          c.setAttribute(
            "aria-label",
            layout.cells.length
              ? layout.cells
                  .map((cell) => `${cell.metric.label}: ${cell.metric.value}`)
                  .join(", ")
              : "Activity data hidden",
          );
        }
      } catch (e) {
        setError(String(e));
        useEditor.getState().setPlaying(false);
        return;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      resize.disconnect();
      surface.current = null;
      scene.dispose();
    };
  }, [track, sceneRevision]);
  async function load(file: File, confirmed = false) {
    setError("");
    setBusy(true);
    try {
      const a = await importActivity(file, confirmed);
      const indexed = indexActivity(a);
      setTrack(indexed);
      setPending(null);
    } catch (e) {
      if (e instanceof SportConfirmationRequired) {
        setPending(file);
        setError(e.message);
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  React.useEffect(() => {
    setResult(null);
    setSaveStatus("");
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = null;
    }
    abort.current?.abort();
  }, [track, settings]);
  async function saveResult() {
    if (!result || saving) return;
    setSaving(true);
    setSaveStatus("");
    try {
      const status = await saveVideoFile(result.blob, result.extension);
      setSaveStatus(
        status === "saved"
          ? "Video saved."
          : status === "cancelled"
            ? "Save cancelled. Your video is still ready; you can try again."
            : "Save picker unavailable. Use the download link below.",
      );
    } catch (e) {
      setSaveStatus(
        "Could not save video: " +
          (e instanceof Error ? e.message : String(e)) +
          ". Retry Save video or use the download link below.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function downloadVideo() {
    setError("");
    setPlaying(false);
    setProgress(0);
    setSaveStatus("");
    setResult(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const out = await exportVideo(
        track,
        { ...settings },
        controller.signal,
        setProgress,
      );
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(out.blob);
      setResult({
        url: url.current,
        blob: out.blob,
        extension: out.codec === "avc" ? "mp4" : "webm",
      });
    } catch (e) {
      setError(
        controller.signal.aborted
          ? "Export cancelled."
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }
  const actualUnavailable = settings.mode === "actual" && !track.timed;
  return (
    <main>
      <header inert={previewExpanded}>
        <div>
          <span className="brand">
            R<span>↗</span>M
          </span>
          <h1>
            RunMotion <span>3D</span>
          </h1>
        </div>
        <p>Turn your run into a cinematic story.</p>
        <div className="header-actions">
          <button
            className="secondary"
            onClick={() => setActivePanel("activity")}
          >
            Import a run
          </button>
          <button onClick={() => setActivePanel("export")}>
            Export options
          </button>
        </div>
      </header>
      <div className="workspace">
        <section
          className={`editor${previewExpanded ? " preview-expanded" : ""}`}
          aria-label="Run preview"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPreviewExpanded(false);
          }}
        >
          <div className="preview-heading">
            <span className="run-name">{track.activity.name}</span>
            <span className="local-badge">ON-DEVICE ONLY</span>
            <button
              className="secondary expand-preview"
              aria-expanded={previewExpanded}
              onClick={() => setPreviewExpanded((value) => !value)}
            >
              {previewExpanded ? "Back to controls" : "Enlarge preview"}
            </button>
          </div>
          <div
            className="viewport"
            style={{
              aspectRatio: `${exportDimensions(settings.exportAspect, settings.exportResolution).width}/${exportDimensions(settings.exportAspect, settings.exportResolution).height}`,
              width: `min(100%, calc(var(--preview-height) * ${exportDimensions(settings.exportAspect, settings.exportResolution).width / exportDimensions(settings.exportAspect, settings.exportResolution).height}))`,
              marginInline: "auto",
            }}
          >
            <canvas
              key={sceneRevision}
              aria-label="3D running route"
              ref={canvas}
            />
            <canvas
              ref={overlayCanvas}
              className="overlay-canvas"
              aria-label="Activity data overlays"
            />
            <div className="viewport-label">
              {track.activity.source === "synthetic"
                ? "SYNTHETIC TEST ROUTE"
                : "IMPORTED RUN"}
              <span>{inspect ? "ORBIT INSPECTION" : "DIRECTED PREVIEW"}</span>
            </div>
          </div>
          <div className="timeline">
            <div className="transport">
              <button
                title={
                  actualUnavailable
                    ? "This file has unreliable timestamps. Choose Uniform Speed."
                    : undefined
                }
                disabled={actualUnavailable}
                onClick={() => {
                  if (time >= settings.duration) setTime(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button
                onClick={() => {
                  setPlaying(false);
                  setTime(0);
                }}
              >
                Restart
              </button>
              <button
                aria-pressed={inspect}
                onClick={() => setInspect(!inspect)}
              >
                {inspect ? "Exit inspection" : "Orbit inspection"}
              </button>
              <output>
                {time.toFixed(1)} / {settings.duration}s
              </output>
            </div>
            <input
              aria-label="Timeline"
              type="range"
              min="0"
              max={settings.duration}
              step="0.01"
              value={time}
              disabled={actualUnavailable}
              onChange={(e) => {
                setPlaying(false);
                setTime(Number(e.target.value));
              }}
            />
            <p className="muted">
              {time >= motionDuration(settings) && (settings.endHold ?? 0) > 0
                ? "Final data hold - route and camera frozen"
                : actualUnavailable
                  ? "Recorded timing unavailable - choose Use Uniform Speed above"
                  : settings.mode === "uniform"
                    ? "Uniform Speed - recorded speed and pauses are not reproduced"
                    : inspect
                      ? "Drag to orbit · scroll to zoom. Play restores the deterministic camera."
                      : track.timed
                        ? `${((track.end - track.start) / 1000 / motionDuration(settings)).toFixed(1)}× elapsed-time compression · stops preserved`
                        : "Recorded timing unavailable"}
            </p>
          </div>
          {track.activity.warnings.length > 0 && (
            <details className="activity-warnings">
              <summary>
                Activity notes ({track.activity.warnings.length})
              </summary>
              {track.activity.warnings.map((w, i) => (
                <p className="warning" key={i}>
                  {w}
                </p>
              ))}
            </details>
          )}
          {error && !pending && (
            <div role="alert" className="notice">
              {error}
              {/WebGL|precision|context/i.test(error) && (
                <button
                  onClick={() => {
                    setError("");
                    setSceneRevision((v) => v + 1);
                  }}
                >
                  Rebuild viewport
                </button>
              )}
            </div>
          )}
        </section>
        <aside
          className="controls"
          aria-label="Run controls"
          inert={previewExpanded}
        >
          <nav
            className="control-tabs"
            role="tablist"
            aria-label="Control sections"
          >
            {controlPanels.map(([id, label]) => (
              <button
                key={id}
                id={`tab-${id}`}
                data-panel-tab={id}
                role="tab"
                aria-selected={activePanel === id}
                aria-controls={`panel-${id}`}
                tabIndex={activePanel === id ? 0 : -1}
                onClick={() => setActivePanel(id)}
                onKeyDown={(e) => {
                  const current = controlPanels.findIndex(
                    ([key]) => key === id,
                  );
                  const next =
                    e.key === "ArrowRight"
                      ? (current + 1) % controlPanels.length
                      : e.key === "ArrowLeft"
                        ? (current + controlPanels.length - 1) %
                          controlPanels.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? controlPanels.length - 1
                            : -1;
                  if (next < 0) return;
                  e.preventDefault();
                  const target = controlPanels[next][0];
                  setActivePanel(target);
                  e.currentTarget.parentElement
                    ?.querySelector<HTMLButtonElement>(
                      `[data-panel-tab="${target}"]`,
                    )
                    ?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="control-content">
            <div
              id="panel-activity"
              className="control-panel"
              role="tabpanel"
              aria-labelledby="tab-activity"
              hidden={activePanel !== "activity"}
              tabIndex={0}
            >
              <h2>Activity</h2>
              <label className="file">
                {busy ? "Reading…" : "Import GPX / TCX / FIT"}
                <input
                  aria-label="Import activity"
                  type="file"
                  accept=".gpx,.tcx,.fit"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void load(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {pending && (
                <div className="notice">
                  <p>{error}</p>
                  <button onClick={() => void load(pending, true)}>
                    Confirm this is a run
                  </button>
                  <button
                    onClick={() => {
                      setPending(null);
                      setError("");
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
              <button
                className="secondary"
                onClick={() => {
                  setTrack(indexActivity(synthetic()));
                  setError("");
                }}
              >
                Load synthetic test route
              </button>
              <h3>{track.activity.name}</h3>
              <dl>
                <dt>GPS fixes</dt>
                <dd>{track.fixes.length.toLocaleString()}</dd>
                <dt>Known GPS distance</dt>
                <dd>{(track.length / 1000).toFixed(2)} km</dd>
                <dt>Recorded span</dt>
                <dd>
                  {track.timed
                    ? `${((track.end - track.start) / 1000).toFixed(0)} s`
                    : "Unavailable"}
                </dd>
              </dl>
            </div>
            <div
              id="panel-timing"
              className="control-panel"
              role="tabpanel"
              aria-labelledby="tab-timing"
              hidden={activePanel !== "timing"}
              tabIndex={0}
            >
              <h2>Playback</h2>
              <label>
                Timing mode
                <select
                  value={settings.mode}
                  onChange={(e) =>
                    setSettings({ mode: e.target.value as Settings["mode"] })
                  }
                >
                  <option value="actual">Actual Timing</option>
                  <option value="uniform">Uniform Speed</option>
                </select>
              </label>
              {actualUnavailable && (
                <div className="notice" role="status">
                  Actual Timing unavailable for this file:{" "}
                  {track.timingIssues.missing} missing timestamps,{" "}
                  {track.timingIssues.duplicates} same-time GPS jumps
                  (supported), {track.timingIssues.regressing} out-of-order
                  timestamps.{" "}
                  {track.end <= track.start
                    ? "No positive recorded time span."
                    : ""}
                  <button onClick={() => setSettings({ mode: "uniform" })}>
                    Use Uniform Speed
                  </button>
                  <p>
                    Recorded timing is never invented. Import a FIT file with
                    reliable timestamps for Actual Timing.
                  </p>
                </div>
              )}
              <label>
                Video duration
                <select
                  value={settings.duration}
                  onChange={(e) =>
                    setSettings({ duration: Number(e.target.value) })
                  }
                >
                  {[10, 15, 20, 30, 45, 60].map((d) => (
                    <option key={d} value={d}>
                      {d} seconds
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Final data hold
                <select
                  value={settings.endHold ?? 0}
                  onChange={(e) =>
                    setSettings({
                      endHold: Number(e.target.value) as 0 | 2 | 4,
                    })
                  }
                >
                  <option value={0}>No hold</option>
                  <option value={2}>2 seconds</option>
                  <option value={4}>4 seconds</option>
                </select>
              </label>
              <p className="muted">
                Included in video length: {motionDuration(settings).toFixed(0)}{" "}
                seconds of animation, then {settings.endHold ?? 0} seconds on
                the final frame.
              </p>
            </div>
            <div
              id="panel-style"
              className="control-panel"
              role="tabpanel"
              aria-labelledby="tab-style"
              hidden={activePanel !== "style"}
              tabIndex={0}
            >
              <h2>Route style</h2>
              <label>
                Visual style
                <select
                  value={settings.style ?? "neon"}
                  onChange={(e) => setStyle(e.target.value as VisualStyle)}
                >
                  {visualStyles.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{getStyle(settings.style).description}</p>
              <label>
                Line width{" "}
                <span aria-hidden="true" className="width-value">
                  {settings.lineWidth ?? 4}
                </span>
                <input
                  type="range"
                  aria-label="Line width"
                  min="1"
                  max="20"
                  step="1"
                  value={settings.lineWidth ?? 4}
                  onChange={(e) =>
                    setVisual({ lineWidth: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Scene background
                <input
                  type="color"
                  aria-label="Scene background"
                  value={
                    settings.backgroundColor ??
                    getStyle(settings.style).background
                  }
                  onChange={(e) =>
                    setVisual({ backgroundColor: e.target.value })
                  }
                />
              </label>
              <label>
                Route color
                <input
                  type="color"
                  value={settings.color}
                  onChange={(e) => setVisual({ color: e.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.reveal !== false}
                  onChange={(e) => setSettings({ reveal: e.target.checked })}
                />{" "}
                Reveal route progressively
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.marker !== false}
                  onChange={(e) => setSettings({ marker: e.target.checked })}
                />{" "}
                Show runner marker
              </label>
              <label>
                Marker size{" "}
                <span className="width-value">
                  {(settings.markerSize ?? 1).toFixed(2)}×
                </span>
                <input
                  type="range"
                  aria-label="Marker size"
                  min="0.25"
                  max="4"
                  step="0.05"
                  value={settings.markerSize ?? 1}
                  onChange={(e) =>
                    setVisual({ markerSize: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Marker color
                <input
                  type="color"
                  aria-label="Marker color"
                  value={
                    settings.markerColor ?? getStyle(settings.style).marker
                  }
                  onChange={(e) => setVisual({ markerColor: e.target.value })}
                />
              </label>
              <button
                className="secondary"
                onClick={() =>
                  setVisual({ markerSize: 1, markerColor: undefined })
                }
              >
                Reset marker appearance
              </button>
              <p className="muted">
                Size scales the runner marker from 0.25× to 4×. Custom color
                stays when changing themes. Reset restores the theme color.
                Preview and video use the same marker.
              </p>
              <p className="muted">
                Flat metric route · recorded horizontal geometry. GPS gaps are
                never connected.
              </p>
            </div>
            <div
              id="panel-data"
              className="control-panel"
              role="tabpanel"
              aria-labelledby="tab-data"
              hidden={activePanel !== "data"}
              tabIndex={0}
            >
              <OverlayPanel
                track={track}
                themeBackground={
                  settings.backgroundColor ??
                  getStyle(settings.style).background
                }
                value={settings.overlay}
                onChange={setOverlay}
              />
            </div>
            <div
              id="panel-camera"
              className="control-panel"
              role="tabpanel"
              aria-labelledby="tab-camera"
              hidden={activePanel !== "camera"}
              tabIndex={0}
            >
              <CameraPanel value={settings.camera} onChange={setCamera} />
            </div>
            <div
              id="panel-export"
              className="control-panel export"
              role="tabpanel"
              aria-labelledby="tab-export"
              hidden={activePanel !== "export"}
              tabIndex={0}
            >
              <h2>Video export</h2>
              <label>
                Export format
                <select
                  value={settings.exportAspect ?? "16:9"}
                  onChange={(e) =>
                    setSettings({
                      exportAspect: e.target.value as ExportAspect,
                    })
                  }
                >
                  {socialFormats.map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.id} · {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Export resolution
                <select
                  value={settings.exportResolution ?? 720}
                  onChange={(e) =>
                    setSettings({
                      exportResolution: Number(e.target.value) as 720 | 1080,
                    })
                  }
                >
                  <option value={720}>720p · Faster export</option>
                  <option value={1080}>1080p · Higher quality</option>
                </select>
              </label>
              <p>
                {
                  exportDimensions(
                    settings.exportAspect,
                    settings.exportResolution,
                  ).width
                }{" "}
                ×{" "}
                {
                  exportDimensions(
                    settings.exportAspect,
                    settings.exportResolution,
                  ).height
                }{" "}
                · 30 fps
              </p>
              <p className="muted">
                MP4 / H.264 when available. WebM fallback. Fixed simulation time
                for every frame.
              </p>
              <button
                disabled={progress !== null || saving || actualUnavailable}
                onClick={() => void downloadVideo()}
              >
                {progress === null
                  ? "Export video"
                  : `Rendering ${Math.round(progress * 100)}%`}
              </button>
              {progress !== null && (
                <>
                  <progress value={progress} max="1" />
                  <button
                    className="secondary"
                    onClick={() => abort.current?.abort()}
                  >
                    Cancel export
                  </button>
                </>
              )}
              {result && (
                <>
                  <button disabled={saving} onClick={() => void saveResult()}>
                    {saving ? "Saving..." : "Save video..."}
                  </button>
                  <a
                    className="download"
                    href={result.url}
                    download={`runmotion.${result.extension}`}
                  >
                    Download .{result.extension}
                  </a>
                  <p className="muted">
                    Save video lets you choose a folder in supported browsers.
                    The download link uses your browser's Downloads folder.
                  </p>
                </>
              )}
              {saveStatus && <p role="status">{saveStatus}</p>}
              <p className="muted">
                Your activity stays on this device. No account or upload
                required.
              </p>
              <p className="muted">
                Prototype limits: 25 MiB input, 20,000 GPS fixes, 60-second
                export.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
// The minimal, isolated export gate remains available for repeatable browser verification.
const gateTrack = indexActivity(synthetic()),
  gateSettings: Settings = {
    duration: 5,
    mode: "actual",
    color: "#73f5c4",
    thickness: 1,
  };
Object.assign(window, {
  gate: {
    track: gateTrack,
    settings: gateSettings,
    exportVideo: async () => {
      const result = await exportVideo(
        gateTrack,
        gateSettings,
        new AbortController().signal,
        () => {},
      );
      return {
        ...result,
        bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
      };
    },
  },
});
