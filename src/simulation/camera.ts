import type { Point, Track, Settings, RouteFrame } from "../domain/activity";

export const cameraPresets = [
  ["orbit", "Orbit Reveal"],
  ["follow", "Runner Follow"],
  ["top-down", "Top-Down Journey"],
  ["flyover", "Cinematic Flyover"],
  ["showcase", "Final Route Showcase"],
] as const;
export type CameraPreset = (typeof cameraPresets)[number][0];
export interface CameraSettings {
  preset: CameraPreset;
  distance: number;
  elevation: number;
  orbit: number;
  rotation: number;
  fov: number;
  movement: number;
  followDistance: number;
  smoothing: number;
}
export const defaultCamera: Readonly<CameraSettings> = Object.freeze({
  preset: "orbit",
  distance: 1,
  elevation: 35,
  orbit: 0.6,
  rotation: 25,
  fov: 45,
  movement: 1,
  followDistance: 0.65,
  smoothing: 0.6,
});
export const cameraLimits = {
  distance: [1, 3, 0.05],
  elevation: [15, 89, 1],
  orbit: [0, 2, 0.05],
  rotation: [-180, 180, 1],
  fov: [25, 75, 1],
  movement: [0, 1, 0.05],
  followDistance: [0.15, 3, 0.05],
  smoothing: [0.35, 2, 0.05],
} as const;
export type CameraControl = keyof typeof cameraLimits;
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const add = (a: Point, b: Point): Point => a.map((v, i) => v + b[i]) as Point;
const sub = (a: Point, b: Point): Point => a.map((v, i) => v - b[i]) as Point;
const scale = (a: Point, s: number): Point => a.map((v) => v * s) as Point;
const lerp = (a: Point, b: Point, u: number): Point =>
  add(a, scale(sub(b, a), u));
const length = (a: Point) => Math.hypot(...a);
const smoothstep = (u: number) => {
  u = clamp(u, 0, 1);
  return u * u * (3 - 2 * u);
};
export function normalizeCamera(
  input: Partial<CameraSettings> = {},
): CameraSettings {
  const result = { ...defaultCamera, ...input };
  if (!cameraPresets.some(([id]) => id === result.preset))
    result.preset = "orbit";
  for (const key of Object.keys(cameraLimits) as CameraControl[]) {
    const [min, max] = cameraLimits[key],
      value = result[key];
    result[key] = Number.isFinite(value)
      ? clamp(value, min, max)
      : defaultCamera[key];
  }
  result.elevation = clamp(
    result.elevation,
    result.preset === "top-down" ? 80 : 15,
    result.preset === "top-down" ? 89 : 80,
  );
  return result;
}
export interface CameraPose {
  position: Point;
  target: Point;
  up: Point;
  fov: number;
  near: number;
  far: number;
}

/** Sphere fit uses the smaller horizontal/vertical field of view, including portrait. */
export function fitDistance(
  radius: number,
  fov: number,
  aspect: number,
): number {
  const vertical = radians(fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return (radius / Math.sin(Math.min(vertical, horizontal))) * 1.12;
}

interface StabilizedPath {
  points: Point[];
  spacing: number;
  radius: number;
}
const paths = new WeakMap<Track, Map<string, StabilizedPath>>();
function spline(path: StabilizedPath, t: number): Point {
  const value = Math.max(0, t) / path.spacing,
    k = Math.floor(value),
    u = value - k;
  const weights = [
    (1 - u) ** 3 / 6,
    (3 * u ** 3 - 6 * u * u + 4) / 6,
    (-3 * u ** 3 + 3 * u * u + 3 * u + 1) / 6,
    u ** 3 / 6,
  ];
  const point: Point = [0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const p = path.points[clamp(k + i - 1, 0, path.points.length - 1)];
    for (let j = 0; j < 3; j++) point[j] += p[j] * weights[i];
  }
  return point;
}
/** A fixed time-grid cubic B-spline provides C2 camera translation, independent of GPS sampling/fps. */
function stabilizedPath(
  track: Track,
  settings: Settings,
  c: CameraSettings,
  sample: (t: number) => RouteFrame,
): StabilizedPath {
  const key = JSON.stringify([
    settings.duration,
    settings.mode,
    c.smoothing,
    c.movement,
  ]);
  let cache = paths.get(track);
  if (!cache) {
    cache = new Map();
    paths.set(track, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  const spacing = Math.max(0.35, c.smoothing),
    count = Math.ceil(settings.duration / spacing) + 3,
    points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const f = sample(Math.min(settings.duration, i * spacing));
    // Camera-only transport through a GPS gap. The runner and route reveal remain unavailable.
    const a = track.fixes[f.index],
      b = track.fixes[Math.min(f.index + 1, track.fixes.length - 1)];
    points.push(scale(f.position ?? lerp(a.p, b.p, f.fraction), c.movement));
  }
  const path: StabilizedPath = { points, spacing, radius: 0 };
  const bound = (p: Point, k: number) => {
    for (let i = -1; i <= 2; i++)
      path.radius = Math.max(
        path.radius,
        length(sub(p, points[clamp(k + i, 0, count - 1)])),
      );
  };
  // The marker and camera positions are convex combinations of these interval endpoints.
  // Bounding all pairs gives one constant safe lens distance, eliminating per-frame zoom pumping.
  for (let k = 0; k < Math.ceil(settings.duration / spacing); k++)
    for (const t of [
      k * spacing,
      Math.min(settings.duration, (k + 1) * spacing),
    ]) {
      const f = sample(t);
      if (f.position) bound(f.position, k);
    }
  for (const fix of track.fixes) {
    const u =
      settings.mode === "actual"
        ? (fix.time! - track.start) / (track.end - track.start)
        : track.length
          ? fix.distance / track.length
          : 0;
    const k = Math.min(
      Math.ceil(settings.duration / spacing) - 1,
      Math.floor((clamp(u, 0, 1) * settings.duration) / spacing),
    );
    bound(fix.p, k);
  }
  cache.set(key, path);
  if (cache.size > 6) cache.delete(cache.keys().next().value!);
  return path;
}

/** Widen around GPS gaps using a fixed video-time window, including Uniform Speed jumps. */
function gapWeight(
  track: Track,
  settings: Settings,
  frame: RouteFrame,
): number {
  const actual = settings.mode === "actual",
    value = actual ? frame.activityTime : frame.distance;
  const window = actual
    ? (track.end - track.start) / settings.duration
    : track.length / settings.duration;
  if (window <= 0) return 0;
  const gaps = track.gaps;
  let lo = 0,
    hi = gaps.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((actual ? gaps[mid].end : gaps[mid].distance) < value) lo = mid + 1;
    else hi = mid;
  }
  let weight = 0;
  for (const gap of gaps.slice(Math.max(0, lo - 1), lo + 2)) {
    const start = actual ? gap.start : gap.distance,
      end = actual ? gap.end : gap.distance;
    const away = value < start ? start - value : value > end ? value - end : 0;
    weight = Math.max(weight, smoothstep(1 - away / window));
  }
  return weight;
}

/** Deterministic distance anchors steer the camera; they never add connecting route geometry. */
function flyoverAnchor(
  track: Track,
  u: number,
): { target: Point; phase: number } {
  const stage = Math.min(3, Math.floor(u * 4));
  const at = (fraction: number) => {
    const d = fraction * track.length;
    let low = 0,
      high = track.fixes.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (track.fixes[mid].distance <= d) low = mid;
      else high = mid - 1;
    }
    return track.fixes[low];
  };
  const a = at(stage / 4),
    b = at((stage + 1) / 4),
    phase = smoothstep(u * 4 - stage);
  return { target: lerp(a.p, b.p, phase), phase: stage + phase };
}

/** Pure camera evaluation. Safety limits can increase requested distance to retain the subject. */
export function cameraAt(
  track: Track,
  settings: Settings,
  t: number,
  aspect: number,
  frame: RouteFrame,
  sample: (t: number) => RouteFrame,
): CameraPose {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw Error("Camera aspect ratio must be positive.");
  const c = normalizeCamera(settings.camera),
    u = clamp(t / settings.duration, 0, 1);
  const radius = track.radius,
    margin = Math.max(
      radius * 0.025,
      radius * 0.018 * Math.max(1, settings.thickness),
    );
  const fullRadius = radius + margin;
  const fullDistance = fitDistance(fullRadius, c.fov, aspect) * c.distance;
  let target: Point = [0, 0, 0],
    distance = fullDistance,
    elevation = radians(c.elevation);
  let bearing = radians(c.rotation) + u * Math.PI * 2 * c.orbit * c.movement;
  let up: Point = [0, 1, 0];
  const subject = frame.position;
  if (
    c.preset === "follow" ||
    c.preset === "top-down" ||
    c.preset === "showcase"
  ) {
    const path = stabilizedPath(track, settings, c, sample);
    target = spline(path, clamp(t, 0, settings.duration));
    bearing = radians(c.rotation); // Stable bearing: GPS hairpins must not spin the camera.
    if (c.preset === "top-down") {
      elevation = radians(c.elevation);
      up = [0, 0, -1];
    }
    const clearance =
      (track.bounds.max[1] - track.bounds.min[1] * c.movement + margin * 2) /
      Math.sin(elevation);
    const closeDistance =
      Math.max(
        radius * c.followDistance,
        fitDistance(path.radius + margin, c.fov, aspect),
        clearance,
      ) * c.distance;
    distance = closeDistance;
    if (c.preset === "showcase") {
      const p = clamp((u - 0.65) / 0.35, 0, 1),
        pull = p * p * p * (p * (p * 6 - 15) + 10);
      target = lerp(target, [0, 0, 0], pull);
      distance =
        closeDistance +
        (Math.max(fullDistance, closeDistance * 1.2) - closeDistance) * pull;
    }
  } else if (c.preset === "flyover") {
    const anchor = flyoverAnchor(track, u);
    target = scale(anchor.target, c.movement);
    // Wide, safe flight between deterministic route anchors. The entire route remains visible.
    distance =
      fitDistance(fullRadius + length(target), c.fov, aspect) * c.distance;
    bearing =
      radians(c.rotation) +
      ((anchor.phase * Math.PI) / 2) * c.orbit * c.movement;
    elevation = radians(
      clamp(c.elevation + 12 * Math.sin(u * Math.PI * 2) * c.movement, 15, 80),
    );
  }
  if (c.preset === "flyover") {
    const gap = gapWeight(track, settings, frame);
    target = lerp(target, [0, 0, 0], gap);
    distance = distance + (Math.max(fullDistance, distance) - distance) * gap;
    if (!subject) {
      target = [0, 0, 0];
      distance = Math.max(distance, fullDistance);
    }
  }
  if (c.movement === 0) {
    target = [0, 0, 0];
    distance = fullDistance;
    bearing = radians(c.rotation);
  }
  const offset: Point = [
    Math.sin(bearing) * Math.cos(elevation) * distance,
    Math.sin(elevation) * distance,
    Math.cos(bearing) * Math.cos(elevation) * distance,
  ];
  const position = add(target, offset);
  // Stay above the complete route, including future elevation geometry and marker clearance.
  position[1] = Math.max(position[1], track.bounds.max[1] + margin * 2);
  const actualDistance = length(sub(position, target));
  return {
    position,
    target,
    up,
    fov: c.fov,
    near: Math.max(0.001, radius * 0.0001),
    far: actualDistance + fullRadius * 4 + 10,
  };
}
