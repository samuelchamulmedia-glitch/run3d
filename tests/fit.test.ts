import { it, expect } from "vitest";
import {
  Encoder,
  Profile,
  type FileIdMesg,
  type SessionMesg,
  type RecordMesg,
} from "@garmin/fitsdk";
import { parseFit } from "../src/import/activity";
import { indexActivity } from "../src/domain/activity";
function fixture(sport = "running") {
  const encoder = new Encoder();
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "development",
    product: 1,
    timeCreated: new Date("2026-01-01T00:00:00Z"),
  } as FileIdMesg);
  encoder.onMesg(Profile.MesgNum.SESSION, {
    sport,
    startTime: new Date("2026-01-01T00:00:00Z"),
    timestamp: new Date("2026-01-01T00:01:00Z"),
  } as SessionMesg);
  for (let i = 0; i < 5; i++)
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 5)),
      positionLat: Math.round(((13.7 + i * 0.00001) * 2 ** 31) / 180),
      positionLong: Math.round((-89.2 * 2 ** 31) / 180),
      heartRate: 140 + i,
      distance: i * 1.1,
    } as RecordMesg);
  return encoder.close();
}
it("decodes synthetic FIT and preserves measurements", () => {
  const bytes = fixture();
  const a = parseFit(bytes.slice().buffer);
  expect(a.samples.length).toBe(5);
  expect(a.samples[0].lat).toBeCloseTo(13.7, 5);
  expect(a.samples[0].hr).toBe(140);
  expect(a.samples[0].cadence).toBeNull();
  expect(a.samples[1].raw?.length).toBeGreaterThan(0);
  expect(indexActivity(a).timed).toBe(true);
});
it("rejects corrupted CRC", () => {
  const bytes = fixture();
  bytes[bytes.length - 1] ^= 255;
  expect(() => parseFit(bytes.slice().buffer)).toThrow("CRC");
});
it("rejects non-running FIT", () =>
  expect(() => parseFit(fixture("cycling").slice().buffer)).toThrow(
    "Only running",
  ));
