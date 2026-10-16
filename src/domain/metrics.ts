import type { Activity, Fix, Track, Frame, Settings } from "./activity";
export const metricDefinitions = [
  { id: "distance", label: "Distance" },
  { id: "elapsed", label: "Elapsed time" },
  { id: "totalTime", label: "Total time" },
  { id: "pace", label: "Current pace" },
  { id: "averagePace", label: "Average pace" },
  { id: "elevation", label: "Elevation" },
  { id: "gain", label: "Elevation gain" },
  { id: "heartRate", label: "Heart rate" },
  { id: "cadence", label: "Cadence" },
] as const;
export type MetricId = (typeof metricDefinitions)[number]["id"];
export type TypographyStyle = "modern" | "compact" | "rounded" | "bold";
export interface OverlaySettings {
  typography?: TypographyStyle;
  position?: "top" | "middle" | "bottom";
  alignment?: "left" | "center" | "right";
  size?: "small" | "medium" | "large";
  panelColor?: string;
  textColor?: string;
  enabled: boolean;
  order: MetricId[];
  visible: MetricId[];
}
export const defaultOverlay: OverlaySettings = {
  enabled: true,
  order: metricDefinitions.map((m) => m.id),
  visible: ["distance", "elapsed", "totalTime", "pace"],
  typography: "modern",
};
export function normalizeOverlay(
  input: Partial<OverlaySettings> = {},
): OverlaySettings {
  const known = (id: unknown): id is MetricId =>
    metricDefinitions.some((m) => m.id === id);
  return {
    typography: ["modern", "compact", "rounded", "bold"].includes(
      input.typography ?? "",
    )
      ? input.typography
      : "modern",
    position: ["top", "middle", "bottom"].includes(input.position ?? "")
      ? input.position
      : "bottom",
    alignment: ["left", "center", "right"].includes(input.alignment ?? "")
      ? input.alignment
      : "center",
    size: ["small", "medium", "large"].includes(input.size ?? "")
      ? input.size
      : "medium",
    panelColor: /^#[0-9a-f]{6}$/i.test(input.panelColor ?? "")
      ? input.panelColor
      : undefined,
    textColor: /^#[0-9a-f]{6}$/i.test(input.textColor ?? "")
      ? input.textColor
      : undefined,
    enabled: input.enabled ?? true,
    order: [
      ...new Set([
        ...(input.order ?? []).filter(known),
        ...defaultOverlay.order,
      ]),
    ],
    visible: [
      ...new Set((input.visible ?? defaultOverlay.visible).filter(known)),
    ],
  };
}
export function moveMetric(
  overlay: OverlaySettings,
  id: MetricId,
  to: number,
): OverlaySettings {
  const order = [...overlay.order],
    from = order.indexOf(id);
  if (from < 0) return overlay;
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
  return { ...overlay, order };
}
export function totalActivityTime(
  activity: Activity,
): { seconds: number; kind: "elapsed" | "timer"; source: string } | null {
  const positive = (v: number | null | undefined): v is number =>
    v != null && Number.isFinite(v) && v > 0;
  if (positive(activity.summary?.elapsed))
    return {
      seconds: activity.summary!.elapsed!,
      kind: "elapsed",
      source: "source activity summary",
    };
  const stamps = activity.samples.flatMap((s) =>
    s.time != null && Number.isFinite(s.time) ? [s.time] : [],
  );
  if (
    stamps.length > 1 &&
    stamps.every((t, i) => !i || t >= stamps[i - 1]) &&
    stamps.at(-1)! > stamps[0]
  )
    return {
      seconds: (stamps.at(-1)! - stamps[0]) / 1000,
      kind: "elapsed",
      source: "first-to-last recorded timestamps",
    };
  if (positive(activity.summary?.timer))
    return {
      seconds: activity.summary!.timer!,
      kind: "timer",
      source: "source timer summary (may exclude pauses)",
    };
  if (
    activity.laps.length &&
    activity.laps.every((lap) => positive(lap.duration))
  )
    return {
      seconds: activity.laps.reduce((sum, lap) => sum + lap.duration!, 0),
      kind: "timer",
      source: "sum of recorded lap durations (may exclude pauses)",
    };
  return null;
}
type Reading = { time: number; value: number };
export interface MetricsIndex {
  heartRate: Reading[];
  cadence: Reading[];
  speed: Reading[];
  elevation: Reading[];
  gain: (number | null)[];
  gainPartial: boolean[];
  available: Record<MetricId, boolean>;
}
export function buildMetrics(
  activity: Activity,
  fixes: Fix[],
  timed: boolean,
): MetricsIndex {
  const series = (field: "hr" | "cadence" | "speed" | "elevation") =>
    activity.samples
      .flatMap((s) =>
        s.time !== null &&
        Number.isFinite(s.time) &&
        s[field] !== null &&
        Number.isFinite(s[field]) &&
        (field === "elevation" || s[field]! >= 0) &&
        (field !== "hr" || s[field]! > 0)
          ? [{ time: s.time, value: s[field]! }]
          : [],
      )
      .sort((a, b) => a.time - b.time);
  const gain: (number | null)[] = [],
    gainPartial: boolean[] = [];
  let total = 0,
    seen = false,
    partial = false;
  fixes.forEach((fix, i) => {
    const value = activity.samples[fix.sourceIndex].elevation,
      previous = i
        ? activity.samples[fixes[i - 1].sourceIndex].elevation
        : null;
    if (value !== null && Number.isFinite(value)) {
      seen = true;
      if (
        i &&
        previous !== null &&
        Number.isFinite(previous) &&
        fix.segment === fixes[i - 1].segment
      )
        total += Math.max(0, value - previous);
      else if (i) partial = true;
    } else partial = true;
    gain.push(seen ? total : null);
    gainPartial.push(partial);
  });
  const heartRate = series("hr"),
    cadence = series("cadence"),
    speed = series("speed"),
    elevation = series("elevation");
  return {
    heartRate,
    cadence,
    speed,
    elevation,
    gain,
    gainPartial,
    available: {
      distance: true,
      elapsed: timed,
      totalTime: totalActivityTime(activity) !== null,
      pace: timed || activity.samples.some((s) => s.speed !== null),
      averagePace: timed,
      elevation: activity.samples.some((s) => s.elevation !== null),
      gain: seen,
      heartRate: activity.samples.some((s) => s.hr !== null && s.hr > 0),
      cadence: activity.samples.some((s) => s.cadence !== null),
    },
  };
}
function readingAt(series: Reading[], time: number | null): number | null {
  if (time === null) return null;
  let lo = 0,
    hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  const reading = series[lo - 1];
  return reading && time - reading.time <= 10000 ? reading.value : null;
}
export interface MetricView {
  id: MetricId;
  label: string;
  value: string;
  unavailable: boolean;
  partial: boolean;
}
function elapsedText(seconds: number) {
  const s = Math.max(0, Math.floor(seconds)),
    hours = Math.floor(s / 3600),
    minutes = Math.floor((s % 3600) / 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${minutes}:${String(s % 60).padStart(2, "0")}`;
}
function paceText(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
}
function gpsDistanceAt(
  track: Track,
  time: number,
): { distance: number; segment: number } {
  const f = track.fixes;
  let lo = 0,
    hi = f.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (f[mid].time! <= time) lo = mid;
    else hi = mid - 1;
  }
  const a = f[lo],
    b = f[Math.min(lo + 1, f.length - 1)],
    span = b.time! - a.time!,
    fraction = span > 0 ? (time - a.time!) / span : 0;
  return {
    distance:
      a.distance +
      (a.segment === b.segment ? (b.distance - a.distance) * fraction : 0),
    segment: a.segment,
  };
}
export function metricsAt(
  track: Track,
  settings: Settings,
  frame: Frame,
): MetricView[] {
  const a = track.fixes[frame.index],
    b = track.fixes[Math.min(frame.index + 1, track.fixes.length - 1)],
    source = track.activity.samples[a.sourceIndex],
    next = track.activity.samples[b.sourceIndex];
  const time = track.timed
    ? settings.mode === "actual"
      ? frame.activityTime
      : a.time! + (b.time! - a.time!) * frame.fraction
    : null;
  const elapsed = time === null ? null : (time - track.start) / 1000,
    partial = frame.position === null || a.segment > 0;
  let speed = readingAt(track.metrics.speed, time);
  if (
    track.pauses.some((p) => time !== null && time >= p.start && time < p.end)
  )
    speed = 0;
  else if (frame.position === null) speed = null;
  else if (speed === null && time !== null && elapsed !== null && elapsed > 0) {
    const before = Math.max(track.start, time - 5000),
      start = gpsDistanceAt(track, before);
    if (start.segment === a.segment && time > before)
      speed = Math.max(
        0,
        (frame.distance - start.distance) / ((time - before) / 1000),
      );
  } else if (time === null) speed = source.speed;
  // A rolling pace window crossing an instantaneous GPS jump has no reliable
  // speed. Suppress both source speed and derived pace for that whole window.
  if (
    time !== null &&
    track.timingJumps.some((stamp) => stamp <= time && stamp >= time - 5000)
  )
    speed = null;
  const finite = (value: number | null) =>
    value !== null && Number.isFinite(value) ? value : null;
  let elevation = finite(source.elevation);
  const nextElevation = finite(next.elevation);
  if (elevation !== null && nextElevation !== null && a.segment === b.segment)
    elevation += (nextElevation - elevation) * frame.fraction;
  else if (time !== null) elevation = readingAt(track.metrics.elevation, time);
  let gain = track.metrics.gain[frame.index];
  const sourceElevation = finite(source.elevation);
  if (
    gain !== null &&
    sourceElevation !== null &&
    nextElevation !== null &&
    a.segment === b.segment
  )
    gain += Math.max(0, nextElevation - sourceElevation) * frame.fraction;
  const hr =
      time !== null ? readingAt(track.metrics.heartRate, time) : source.hr,
    cadence =
      time !== null ? readingAt(track.metrics.cadence, time) : source.cadence;
  const total = totalActivityTime(track.activity);
  const values: Record<MetricId, string> = {
    totalTime: total ? elapsedText(total.seconds) : "—",
    distance: `${(frame.distance / 1000).toFixed(2)} km`,
    elapsed: elapsed === null ? "—" : elapsedText(elapsed),
    pace:
      speed === 0
        ? "Stopped"
        : speed !== null && speed > 0
          ? paceText(1000 / speed)
          : "—",
    averagePace:
      elapsed !== null && frame.distance > 0 && !partial
        ? paceText(elapsed / (frame.distance / 1000))
        : "—",
    elevation: elevation === null ? "—" : `${Math.round(elevation)} m`,
    gain:
      gain === null || !Number.isFinite(gain) ? "—" : `${Math.round(gain)} m`,
    heartRate:
      hr !== null && Number.isFinite(hr) && hr > 0
        ? `${Math.round(hr)} BPM`
        : "—",
    cadence:
      cadence !== null && Number.isFinite(cadence) && cadence >= 0
        ? `${Math.round(cadence)} spm`
        : "—",
  };
  return metricDefinitions.map((m) => ({
    ...m,
    label:
      m.id === "totalTime" && total?.kind === "timer"
        ? "Total timer time"
        : m.label,
    value: values[m.id],
    unavailable: values[m.id] === "—",
    partial:
      m.id === "distance"
        ? partial
        : m.id === "gain"
          ? track.metrics.gainPartial[frame.index]
          : false,
  }));
}
