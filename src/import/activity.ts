import { Decoder, Stream } from "@garmin/fitsdk";
import { calibrateCorosTcxSpeed } from "./tcx-speed";
import type { Activity, Sample } from "../domain/activity";
export class SportConfirmationRequired extends Error {}
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const number = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v.trim() === "") return null;
  const n = finite(Number(v));
  if (n === null) throw Error("Invalid numeric measurement.");
  return n;
};
const time = (v: string | null | undefined): number | null =>
  v ? finite(Date.parse(v)) : null;
const descendants = (e: Element | Document, n: string) =>
  Array.from(e.getElementsByTagNameNS("*", n));
const text = (e: Element, n: string) => descendants(e, n)[0]?.textContent;
function empty(segment: number): Sample {
  return {
    time: null,
    lat: null,
    lon: null,
    elevation: null,
    hr: null,
    cadence: null,
    distance: null,
    speed: null,
    segment,
  };
}
function checkSport(sport: string | null | undefined, confirmed: boolean) {
  if (sport && /^(running|run|trail running|trail_run)$/i.test(sport.trim()))
    return;
  if (sport && !/^(other|unknown)$/i.test(sport.trim()))
    throw Error(`Only running is supported. Recorded sport: ${sport}`);
  if (!confirmed)
    throw new SportConfirmationRequired(
      "This file does not identify its sport. Confirm that this is a running activity.",
    );
}
export function parseXml(
  xml: string,
  format: "gpx" | "tcx",
  confirmed = false,
): Activity {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("DTD and entity declarations are unsupported.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (descendants(doc, "parsererror").length) throw Error("Malformed XML.");
  if (doc.getElementsByTagName("*").length > 3000000)
    throw Error("Too many XML elements.");
  const root = doc.documentElement;
  if (root.localName !== (format === "gpx" ? "gpx" : "TrainingCenterDatabase"))
    throw Error("Unexpected activity file root.");
  if (
    format === "gpx" &&
    ![
      "http://www.topografix.com/GPX/1/1",
      "http://www.topografix.com/GPX/1/0",
    ].includes(root.namespaceURI ?? "")
  )
    throw Error("Unsupported GPX namespace.");
  if (
    format === "tcx" &&
    root.namespaceURI !==
      "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  )
    throw Error("Unsupported TCX namespace.");
  const activities = descendants(doc, format === "gpx" ? "trk" : "Activity");
  if (activities.length !== 1)
    throw Error(
      "Import one activity/track at a time. Split multi-activity files first.",
    );
  const activity = activities[0];
  checkSport(
    format === "tcx" ? activity.getAttribute("Sport") : text(activity, "type"),
    confirmed,
  );
  const samples: Sample[] = [];
  const coreSpeed: boolean[] = [];
  const segments = descendants(activity, format === "gpx" ? "trkseg" : "Track");
  for (const [segment, container] of segments.entries())
    for (const e of descendants(
      container,
      format === "gpx" ? "trkpt" : "Trackpoint",
    )) {
      const s = empty(segment);
      if (format === "gpx") {
        s.lat = number(e.getAttribute("lat"));
        s.lon = number(e.getAttribute("lon"));
        s.time = time(text(e, "time"));
        s.elevation = number(text(e, "ele"));
        s.hr = number(text(e, "hr"));
        s.cadence = null;
      } else {
        s.lat = number(text(e, "LatitudeDegrees"));
        s.lon = number(text(e, "LongitudeDegrees"));
        s.time = time(text(e, "Time"));
        s.elevation = number(text(e, "AltitudeMeters"));
        s.distance = number(text(e, "DistanceMeters"));
        s.speed = number(text(e, "Speed"));
        const hr = descendants(e, "HeartRateBpm")[0];
        s.hr = hr ? number(text(hr, "Value")) : null;
        s.cadence = null;
      }
      s.raw = Array.from(e.getElementsByTagName("*"))
        .filter((n) => !n.children.length)
        .map((n) => ({
          field: n.tagName,
          value: n.textContent ?? "",
          unit: null,
        }));
      if (format === "gpx")
        s.raw.push(
          {
            field: "latitude",
            value: e.getAttribute("lat") ?? "",
            unit: "degrees",
          },
          {
            field: "longitude",
            value: e.getAttribute("lon") ?? "",
            unit: "degrees",
          },
        );
      const speedField = descendants(e, "Speed")[0];
      coreSpeed.push(
        format === "tcx" && speedField?.namespaceURI === root.namespaceURI,
      );
      samples.push(s);
      if (samples.length > 200000) throw Error("Maximum 200,000 samples.");
    }
  const creator = descendants(activity, "Creator")[0];
  const calibration =
    format === "tcx"
      ? calibrateCorosTcxSpeed(
          samples,
          creator ? (text(creator, "Name") ?? "") : "",
          coreSpeed,
        )
      : null;
  const speedWarnings =
    calibration?.unit === "km/h"
      ? [
          "COROS TCX speed behaves as km/h according to recorded distance/time validation; converted to m/s for pace. Original speed fields retained.",
        ]
      : calibration?.unit === "unverified"
        ? [
            "COROS TCX speed units could not be verified. Those speed fields are withheld; pace uses GPS/time where reliable. Original fields retained.",
          ]
        : [];
  return {
    sport: "running",
    sportEvidence: confirmed ? "user-confirmed" : "recorded",
    name:
      text(activity, format === "gpx" ? "name" : "Id")
        ?.trim()
        .slice(0, 120) || "Imported run",
    source: format,
    samples,
    laps: descendants(activity, "Lap").map((l) => ({
      start: time(l.getAttribute("StartTime")),
      duration: number(text(l, "TotalTimeSeconds")),
      distance: number(text(l, "DistanceMeters")),
    })),
    events: [],
    warnings: [
      ...speedWarnings,
      "Elevation and cadence are preserved as source measurements; the Milestone 1 viewport is flat.",
      "GPX cadence units vary by producer; cadence is not converted or displayed.",
    ].filter(
      (warning) => format === "gpx" || !warning.startsWith("GPX cadence"),
    ),
  };
}
export function parseFit(buffer: ArrayBuffer, confirmed = false): Activity {
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  if (!decoder.isFIT() || !decoder.checkIntegrity())
    throw Error("Invalid FIT header, file size, or CRC.");
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    convertDateTimesToDates: true,
    convertTypesToStrings: true,
  });
  if (errors.length) throw Error(`FIT decode failed: ${errors[0].message}`);
  const sessions = messages.sessionMesgs ?? [];
  if (sessions.length > 1) throw Error("Import a single running FIT session.");
  checkSport(sessions[0]?.sport as string | undefined, confirmed);
  const samples = (messages.recordMesgs ?? []).map((r) => {
    const s = empty(0);
    s.time = r.timestamp instanceof Date ? r.timestamp.getTime() : null;
    s.lat = finite(r.positionLat);
    s.lon = finite(r.positionLong);
    if (s.lat !== null) s.lat *= 180 / 2 ** 31;
    if (s.lon !== null) s.lon *= 180 / 2 ** 31;
    s.elevation = finite(r.enhancedAltitude) ?? finite(r.altitude);
    s.hr = finite(r.heartRate);
    s.distance = finite(r.distance);
    s.speed = finite(r.enhancedSpeed) ?? finite(r.speed);
    // FIT running cadence is cycles/min. Retain original fields; do not guess steps conversion.
    s.raw = Object.entries(r)
      .filter(([, v]) => typeof v === "number" || typeof v === "string")
      .map(([field, value]) => ({
        field,
        value: value as number | string,
        unit: null,
      }));
    return s;
  });
  return {
    sport: "running",
    sportEvidence: confirmed ? "user-confirmed" : "recorded",
    summary: {
      elapsed: finite(sessions[0]?.totalElapsedTime),
      timer: finite(sessions[0]?.totalTimerTime),
      distance: finite(sessions[0]?.totalDistance),
    },
    name: "Imported FIT run",
    source: "fit",
    samples,
    laps: (messages.lapMesgs ?? []).map((l) => ({
      start: l.startTime instanceof Date ? l.startTime.getTime() : null,
      duration: finite(l.totalElapsedTime),
      distance: finite(l.totalDistance),
    })),
    events: (messages.eventMesgs ?? []).map((e) => ({
      time: e.timestamp instanceof Date ? e.timestamp.getTime() : null,
      event: String(e.event),
      type: String(e.eventType),
    })),
    warnings: [
      "FIT cadence retained in raw measurements; steps/min conversion is not assumed.",
    ],
  };
}
export async function importActivity(
  file: File,
  confirmed = false,
): Promise<Activity> {
  if (file.size > 25 * 1024 * 1024)
    throw Error("Maximum activity file size is 25 MiB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension === "fit") return parseFit(await file.arrayBuffer(), confirmed);
  if (extension === "gpx" || extension === "tcx")
    return parseXml(await file.text(), extension, confirmed);
  throw Error("Choose a GPX, TCX, or FIT file.");
}
