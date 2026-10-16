import {
  cameraPresets,
  cameraLimits,
  defaultCamera,
  normalizeCamera,
  type CameraControl,
  type CameraSettings,
  type CameraPreset,
} from "./simulation/camera";
interface Props {
  value: CameraSettings | undefined;
  onChange: (camera: Partial<CameraSettings>) => void;
}
const labels: Record<CameraControl, string> = {
  distance: "Camera distance",
  elevation: "Elevation angle",
  orbit: "Orbit intensity",
  rotation: "Rotation",
  fov: "Field of view",
  movement: "Movement intensity",
  followDistance: "Follow distance",
  smoothing: "Camera smoothing",
};
export function CameraPanel({ value, onChange }: Props) {
  const camera = normalizeCamera(value);
  return (
    <section className="camera-panel">
      <h2>Camera Director</h2>
      <label>
        Camera preset
        <select
          value={camera.preset}
          onChange={(e) =>
            onChange({
              preset: e.target.value as CameraPreset,
              elevation:
                e.target.value === "top-down"
                  ? 85
                  : camera.preset === "top-down"
                    ? 35
                    : camera.elevation,
            })
          }
        >
          {cameraPresets.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {(Object.keys(cameraLimits) as CameraControl[])
        .filter(
          (key) =>
            !(key === "followDistance" || key === "smoothing") ||
            ["follow", "top-down", "showcase"].includes(camera.preset),
        )
        .filter(
          (key) =>
            key !== "orbit" || ["orbit", "flyover"].includes(camera.preset),
        )
        .map((key) => {
          const [baseMin, baseMax, step] = cameraLimits[key];
          const min =
            key === "elevation" && camera.preset === "top-down" ? 80 : baseMin;
          const max =
            key === "elevation" && camera.preset !== "top-down" ? 80 : baseMax;
          return (
            <label key={key}>
              {labels[key]}
              <span className="control-value" aria-hidden="true">
                {camera[key].toFixed(step < 1 ? 2 : 0)}
                {["elevation", "rotation", "fov"].includes(key)
                  ? "°"
                  : key === "smoothing"
                    ? " s"
                    : ""}
              </span>
              <input
                aria-label={labels[key]}
                type="range"
                min={min}
                max={max}
                step={step}
                value={camera[key]}
                onChange={(e) => onChange({ [key]: Number(e.target.value) })}
              />
            </label>
          );
        })}
      <button
        className="secondary"
        onClick={() => onChange({ ...defaultCamera })}
      >
        Reset camera
      </button>
      <p className="muted">
        Safety framing may increase distance to keep the subject visible. A
        stabilized camera path and fixed bearing keep GPS turns from shaking the
        view. Smoothing adjusts camera movement without changing runner timing.
        Minimum stabilization stays on.
      </p>
    </section>
  );
}
