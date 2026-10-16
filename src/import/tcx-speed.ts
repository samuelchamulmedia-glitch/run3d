import type { Sample } from "../domain/activity";
export interface TcxSpeedCalibration {
  unit: "m/s" | "km/h" | "unverified" | "not-applicable";
  windows: number;
  ratio: number | null;
}
/** COROS TCX files can place Speed in the core TCX namespace, without units.
 * Validate those fields against recorded DistanceMeters and timestamps before
 * using them. Standard extension Speed fields are never converted here.
 * Original XML fields remain unchanged in Sample.raw.
 */
export function calibrateCorosTcxSpeed(
  samples: Sample[],
  producer: string,
  coreSpeed: boolean[],
): TcxSpeedCalibration {
  if (!/^COROS\b/i.test(producer.trim()) || !coreSpeed.some(Boolean))
    return { unit: "not-applicable", windows: 0, ratio: null };
  const ratios: number[] = [];
  let seconds = 0,
    meters = 0,
    integral = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1],
      b = samples[i];
    if (
      a.time == null ||
      b.time == null ||
      a.distance == null ||
      b.distance == null ||
      b.speed == null ||
      !coreSpeed[i] ||
      a.segment !== b.segment
    ) {
      seconds = meters = integral = 0;
      continue;
    }
    const dt = (b.time - a.time) / 1000,
      dd = b.distance - a.distance;
    if (dt === 0) continue;
    if (
      dt < 0 ||
      dt > 10 ||
      dd < 0 ||
      !Number.isFinite(b.speed) ||
      b.speed < 0
    ) {
      seconds = meters = integral = 0;
      continue;
    }
    seconds += dt;
    meters += dd;
    integral += b.speed * dt;
    if (seconds >= 20) {
      if (meters >= 10 && integral > 0) ratios.push(integral / meters);
      seconds = meters = integral = 0;
    }
  }
  ratios.sort((a, b) => a - b);
  const ratio = ratios.length
    ? (ratios[Math.floor((ratios.length - 1) / 2)] +
        ratios[Math.floor(ratios.length / 2)]) /
      2
    : null;
  const agrees = (expected: number, tolerance: number) =>
    ratios.length >= 3 &&
    ratio !== null &&
    Math.abs(ratio / expected - 1) <= tolerance &&
    ratios.filter((r) => Math.abs(r / expected - 1) <= tolerance).length /
      ratios.length >=
      0.7;
  const unit: TcxSpeedCalibration["unit"] = agrees(1, 0.2)
    ? "m/s"
    : agrees(3.6, 0.25)
      ? "km/h"
      : "unverified";
  samples.forEach((sample, i) => {
    if (!coreSpeed[i] || sample.speed === null) return;
    if (unit === "km/h") sample.speed /= 3.6;
    else if (unit === "unverified") sample.speed = null;
  });
  return { unit, windows: ratios.length, ratio };
}
