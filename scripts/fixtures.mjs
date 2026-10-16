import { Encoder, Profile } from "@garmin/fitsdk";
import fs from "node:fs/promises";
const encoder = new Encoder();
encoder.onMesg(Profile.MesgNum.FILE_ID, {
  type: "activity",
  manufacturer: "development",
  product: 1,
  timeCreated: new Date("2026-01-01T00:00:00Z"),
});
encoder.onMesg(Profile.MesgNum.SESSION, {
  sport: "running",
  startTime: new Date("2026-01-01T00:00:00Z"),
  timestamp: new Date("2026-01-01T00:01:00Z"),
});
for (let i = 0; i < 5; i++)
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, i * 5)),
    positionLat: Math.round(((13.7 + i * 0.00001) * 2 ** 31) / 180),
    positionLong: Math.round((-89.2 * 2 ** 31) / 180),
    heartRate: 140 + i,
  });
await fs.writeFile("tests/fixtures/synthetic.fit", encoder.close());
