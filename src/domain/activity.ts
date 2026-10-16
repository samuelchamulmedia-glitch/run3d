import {
  buildMetrics,
  type MetricsIndex,
  type OverlaySettings,
} from "./metrics";
import type { VisualStyle } from "../render/styles";
import type { ExportAspect } from "../export/formats";
import { cameraAt, type CameraSettings } from "../simulation/camera";
export interface Sample {
  time: number | null;
  lat: number | null;
  lon: number | null;
  elevation: number | null;
  hr: number | null;
  cadence: number | null;
  distance: number | null;
  speed: number | null;
  segment: number;
  raw?: { field: string; value: string | number; unit: string | null }[];
}
export interface Activity {
  sport: "running";
  sportEvidence: "recorded" | "user-confirmed" | "synthetic";
  summary?: {
    elapsed: number | null;
    timer: number | null;
    distance: number | null;
  };
  name: string;
  source: "synthetic" | "gpx" | "tcx" | "fit";
  samples: Sample[];
  laps: {
    start: number | null;
    duration: number | null;
    distance: number | null;
  }[];
  events: { time: number | null; event: string; type: string }[];
  warnings: string[];
}
export type Point = [number, number, number];
export interface Fix {
  p: Point;
  time: number | null;
  distance: number;
  segment: number;
  sourceIndex: number;
}
export interface Track {
  timingJumps: number[];
  timingIssues: {
    missing: number;
    duplicates: number;
    regressing: number;
    ignoredDuplicates: number;
  };
  activity: Activity;
  fixes: Fix[];
  start: number;
  end: number;
  length: number;
  timed: boolean;
  radius: number;
  center: Point;
  pauses: { start: number; end: number; index: number }[];
  bounds: { min: Point; max: Point };
  headings: number[];
  metrics: MetricsIndex;
  gaps: { start: number; end: number; distance: number }[];
}
const rad = Math.PI / 180;
export function distance(a: Sample, b: Sample): number {
  const dLat = (b.lat! - a.lat!) * rad,
    dLon = (b.lon! - a.lon!) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat! * rad) * Math.cos(b.lat! * rad) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function ecef(lat: number, lon: number): Point {
  const phi = lat * rad,
    lam = lon * rad,
    n = 6378137 / Math.sqrt(1 - 0.00669437999014 * Math.sin(phi) ** 2);
  return [
    n * Math.cos(phi) * Math.cos(lam),
    n * Math.cos(phi) * Math.sin(lam),
    n * (1 - 0.00669437999014) * Math.sin(phi),
  ];
}
export function project(lat: number, lon: number, origin: Sample): Point {
  const a = ecef(lat, lon),
    b = ecef(origin.lat!, origin.lon!),
    d = a.map((v, i) => v - b[i]),
    p = origin.lat! * rad,
    l = origin.lon! * rad;
  return [
    -Math.sin(l) * d[0] + Math.cos(l) * d[1],
    0,
    Math.sin(p) * Math.cos(l) * d[0] +
      Math.sin(p) * Math.sin(l) * d[1] -
      Math.cos(p) * d[2],
  ];
}
export function indexActivity(activity: Activity): Track {
  if (activity.samples.length > 200000) throw Error("Maximum 200,000 samples.");
  const origin = activity.samples.find((s) => s.lat !== null && s.lon !== null);
  if (!origin) throw Error("No usable GPS route.");
  const warnings = [...activity.warnings];
  const fixes: Fix[] = [];
  const timingJumps: number[] = [];
  const timingIssues = {
    missing: 0,
    duplicates: 0,
    regressing: 0,
    ignoredDuplicates: 0,
  };
  let length = 0,
    segment = 0,
    prev: Sample | null = null,
    missing = false,
    timed = true;
  activity.samples.forEach((s, sourceIndex) => {
    if (s.time !== null && !Number.isFinite(s.time))
      throw Error("Invalid timestamp.");
    if (s.lat === null || s.lon === null) {
      missing = true;
      return;
    }
    if (
      !Number.isFinite(s.lat) ||
      !Number.isFinite(s.lon) ||
      Math.abs(s.lat) > 90 ||
      Math.abs(s.lon) > 180
    )
      throw Error("Invalid GPS coordinates.");
    // Identical same-instant GPS fixes are redundant, not a broken clock.
    // Keep all original source/sensor samples, only skip redundant route fixes.
    if (
      prev &&
      s.time !== null &&
      s.time === prev.time &&
      s.lat === prev.lat &&
      s.lon === prev.lon &&
      s.segment === prev.segment &&
      !missing
    ) {
      timingIssues.ignoredDuplicates++;
      return;
    }
    if (s.time === null) timingIssues.missing++;
    else if (prev?.time != null) {
      if (s.time < prev.time) timingIssues.regressing++;
      else if (s.time === prev.time) {
        timingIssues.duplicates++;
        timingJumps.push(s.time);
      }
    }
    const delta =
      prev && s.time !== null && prev.time !== null
        ? (s.time - prev.time) / 1000
        : null;
    const dist = prev ? distance(prev, s) : 0;
    const broken =
      !!prev &&
      (missing ||
        s.segment !== prev.segment ||
        (delta !== null &&
          ((delta > 30 && dist > 0.1) ||
            delta <= 0 ||
            dist / Math.max(delta, 0.001) > 15)));
    if (broken) segment++;
    if (prev && !broken) length += dist;
    if (s.time === null || (prev?.time !== null && prev && s.time < prev.time!))
      timed = false;
    const p = project(s.lat, s.lon, origin);
    if (Math.hypot(p[0], p[2]) > 100000)
      throw Error("Route exceeds supported 100 km extent.");
    fixes.push({ p, time: s.time, distance: length, segment, sourceIndex });
    prev = s;
    missing = false;
  });
  if (fixes.length < 2) throw Error("At least two GPS fixes required.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const f of fixes)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], f.p[k]);
      max[k] = Math.max(max[k], f.p[k]);
    }
  const center = min.map((v, i) => (v + max[i]) / 2) as Point;
  fixes.forEach((f) => {
    f.p = f.p.map((v, i) => v - center[i]) as Point;
  });
  let radius = 10;
  for (const f of fixes) radius = Math.max(radius, Math.hypot(...f.p));
  if (fixes.length > 20000)
    throw Error(
      "Milestone 1 supports up to 20,000 GPS fixes; display simplification is pending.",
    );
  if (segment)
    warnings.push(
      `${segment} route discontinuity/discontinuities detected; no bridging geometry.`,
    );
  if (timingIssues.ignoredDuplicates)
    warnings.push(
      `${timingIssues.ignoredDuplicates} identical same-time GPS records ignored for replay; original sensor samples retained.`,
    );
  if (timingIssues.duplicates)
    warnings.push(
      `${timingIssues.duplicates} same-time GPS position changes replay as instantaneous jumps. No distance is added across jumps; pace is unavailable for the following 5 recorded seconds.`,
    );
  if (!timed)
    warnings.push(
      "Missing or regressing timestamps: Actual Timing unavailable.",
    );
  const pauses: Track["pauses"] = [];
  let stop: number | null = null;
  for (const event of activity.events) {
    if (event.time === null || event.event !== "timer") continue;
    if (event.type.startsWith("stop")) stop = event.time;
    else if (event.type === "start" && stop !== null && event.time > stop) {
      let index = 0;
      while (
        index + 1 < fixes.length &&
        fixes[index + 1].time !== null &&
        fixes[index + 1].time! <= stop
      )
        index++;
      pauses.push({ start: stop, end: event.time, index });
      stop = null;
    }
  }
  const headings: number[] = [],
    gaps: Track["gaps"] = [];
  fixes.forEach((fix, i) => {
    const next = fixes[i + 1];
    let heading =
      i && fix.segment === fixes[i - 1].segment ? headings[i - 1] : 0;
    if (next && next.segment === fix.segment) {
      const dx = next.p[0] - fix.p[0],
        dz = next.p[2] - fix.p[2];
      if (Math.hypot(dx, dz) > 1e-7) {
        let value = Math.atan2(-dx, -dz);
        while (value - heading > Math.PI) value -= Math.PI * 2;
        while (value - heading < -Math.PI) value += Math.PI * 2;
        heading = value;
      }
    }
    headings.push(heading);
    if (next && next.segment !== fix.segment)
      gaps.push({
        start: fix.time ?? 0,
        end: next.time ?? fix.time ?? 0,
        distance: fix.distance,
      });
  });
  return {
    timingIssues,
    timingJumps: [...new Set(timingJumps)],
    headings,
    gaps,
    metrics: buildMetrics(
      activity,
      fixes,
      timed && (fixes.at(-1)!.time ?? 0) > (fixes[0].time ?? 0),
    ),
    activity: { ...activity, warnings },
    fixes,
    pauses,
    start: fixes[0].time ?? 0,
    end: fixes.at(-1)!.time ?? 0,
    length,
    timed: timed && (fixes.at(-1)!.time ?? 0) > (fixes[0].time ?? 0),
    radius,
    center: [0, 0, 0],
    bounds: {
      min: min.map((v, i) => v - center[i]) as Point,
      max: max.map((v, i) => v - center[i]) as Point,
    },
  };
}
export interface Settings {
  duration: number;
  endHold?: 0 | 2 | 4;
  mode: "actual" | "uniform";
  color: string;
  thickness: number;
  lineWidth?: number;
  style?: VisualStyle;
  backgroundColor?: string;
  overlay?: OverlaySettings;
  reveal?: boolean;
  marker?: boolean;
  markerSize?: number;
  markerColor?: string;
  camera?: CameraSettings;
  exportAspect?: ExportAspect;
  exportResolution?: 720 | 1080;
}
export interface RouteFrame {
  position: Point | null;
  endpoint: Point | null;
  index: number;
  fraction: number;
  activityTime: number;
  distance: number;
}
export interface Frame extends RouteFrame {
  finalHold?: boolean;
  camera: Point;
  target: Point;
  up: Point;
  fov: number;
  near: number;
  far: number;
}
export function motionDuration(settings: Settings): number {
  const hold =
    settings.endHold === 2 || settings.endHold === 4 ? settings.endHold : 0;
  return Math.max(
    1 / 30,
    settings.duration - Math.min(hold, Math.max(0, settings.duration - 1 / 30)),
  );
}
export function evaluateRoute(
  track: Track,
  settings: Settings,
  t: number,
): RouteFrame {
  const u = Math.max(0, Math.min(1, t / motionDuration(settings)));
  if (settings.mode === "actual" && !track.timed)
    throw Error(
      "Actual Timing requires complete, nondecreasing timestamps and a positive time span. Select Uniform Speed explicitly.",
    );
  const key = settings.mode === "actual" ? "time" : "distance",
    value =
      key === "time"
        ? track.start + u * (track.end - track.start)
        : u * track.length;
  const f = track.fixes;
  let lo = 0,
    hi = f.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (f[mid][key]! <= value) lo = mid;
    else hi = mid - 1;
  }
  const pause =
    key === "time"
      ? track.pauses.find((p) => value >= p.start && value < p.end)
      : undefined;
  if (pause) lo = pause.index;
  const a = f[lo],
    b = pause ? a : f[Math.min(lo + 1, f.length - 1)],
    span = b[key]! - a[key]!,
    fraction = span > 0 ? (value - a[key]!) / span : 0;
  const gap = a.segment !== b.segment && fraction > 0;
  const position = gap
    ? null
    : (a.p.map((v, i) => v + (b.p[i] - v) * fraction) as Point);
  return {
    position,
    endpoint: position,
    index: lo,
    fraction,
    activityTime: track.start + u * (track.end - track.start),
    distance: a.distance + (gap ? 0 : (b.distance - a.distance) * fraction),
  };
}
export function evaluate(
  track: Track,
  settings: Settings,
  t: number,
  aspect = 16 / 9,
): Frame {
  // Route, camera and overlays share the same final frame throughout the hold.
  const motion = {
    ...settings,
    duration: motionDuration(settings),
    endHold: 0 as const,
  };
  const time = Math.max(0, Math.min(t, motion.duration));
  const frame = evaluateRoute(track, motion, time);
  const pose = cameraAt(track, motion, time, aspect, frame, (sampleTime) =>
    evaluateRoute(track, motion, sampleTime),
  );
  return {
    ...frame,
    finalHold: !!settings.endHold && t >= motionDuration(settings),
    camera: pose.position,
    target: pose.target,
    up: pose.up,
    fov: pose.fov,
    near: pose.near,
    far: pose.far,
  };
}
export function synthetic(): Activity {
  // Explicit synthetic fixture: hairpins, repeated positions, 12-second stop, variable speeds, missing GPS.
  const rows: [number, number | null, number | null][] = [
    [0, 0, 0],
    [5, 0, 30],
    [8, 2, 30],
    [13, 2, 0],
    [16, 4, 0],
    [22, 4, 30],
    [28, 4, 30],
    [34, 4, 30],
    [40, 20, 45],
    [43, 23, 45],
    [48, null, null],
    [54, 45, 60],
    [60, 60, 60],
    [67, 60, 20],
    [75, 30, 0],
    [80, 0, 0],
  ];
  return {
    sport: "running",
    sportEvidence: "synthetic",
    name: "Synthetic · Turn & Pause",
    source: "synthetic",
    warnings: [
      "Synthetic test activity — not a recorded run.",
      "GPS gap: marker hidden; no bridging geometry.",
    ],
    laps: [],
    events: [],
    samples: rows.map(([t, e, n]) => ({
      time: Date.UTC(2026, 0, 1) + t * 1000,
      lat: n === null ? null : 13.7 + n / 111195,
      lon: e === null ? null : -89.2 + e / (111195 * Math.cos(13.7 * rad)),
      elevation: null,
      hr: null,
      cadence: null,
      distance: null,
      speed: null,
      segment: 0,
    })),
  };
}
