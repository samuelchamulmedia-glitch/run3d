import { chromium } from "playwright";
import fs from "node:fs/promises";
import os from "node:os";
import { execFileSync } from "node:child_process";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => console.error(e));
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => !!window.gate);
  const result = await page.evaluate(() => window.gate.exportVideo());
  const { bytes, ...meta } = result;
  delete meta.blob;
  await fs.writeFile(
    `evidence/gate.${meta.codec === "avc" ? "mp4" : "webm"}`,
    new Uint8Array(bytes),
  );
  const inspection = await page.evaluate(async (bytes) => {
    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      await import("/node_modules/mediabunny/dist/modules/src/index.js");
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    });
    const track = await input.getPrimaryVideoTrack();
    const sink = new VideoSampleSink(track);
    let count = 0,
      previous = -1;
    const timestamps = [];
    const captures = [];
    for await (const sample of sink.samples()) {
      if (sample.timestamp <= previous)
        throw Error("Nonmonotonic decoded timestamp");
      previous = sample.timestamp;
      timestamps.push(sample.timestamp);
      if ([0, 75, 149].includes(count)) {
        const c = document.createElement("canvas");
        c.width = 1280;
        c.height = 720;
        sample.draw(c.getContext("2d"), 0, 0);
        captures.push(c.toDataURL());
      }
      sample.close();
      count++;
    }
    const duration = await input.computeDuration();
    input.dispose();
    return { count, duration, timestamps, captures };
  }, bytes);
  for (let i = 0; i < inspection.captures.length; i++)
    await fs.writeFile(
      `evidence/decoded-${i}.png`,
      Buffer.from(inspection.captures[i].split(",")[1], "base64"),
    );
  delete inspection.captures;
  const viewer =
    '<!doctype html><html lang="en"><title>Standalone video verification</title><body style="margin:0;background:#090d14"><video controls muted src="http://127.0.0.1:5173/evidence/gate.' +
    (meta.codec === "avc" ? "mp4" : "webm") +
    '" style="width:100%"></video></body></html>';
  await page.route("**/standalone-player.html", (route) =>
    route.fulfill({ contentType: "text/html", body: viewer }),
  );
  await page.goto("http://127.0.0.1:5173/standalone-player.html");
  const playback = await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (video.readyState < 1)
      await new Promise((r, j) => {
        video.onloadedmetadata = r;
        video.onerror = j;
        setTimeout(() => j(Error("Standalone metadata timeout")), 10000);
      });
    video.currentTime = 2.5;
    await new Promise((r) => (video.onseeked = r));
    await video.play();
    await new Promise((r) => setTimeout(r, 300));
    const answer = {
      duration: video.duration,
      seeked: video.currentTime > 2.5,
      playing: !video.paused,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    video.pause();
    return answer;
  }, bytes);
  await page.screenshot({ path: "evidence/standalone-playback.png" });
  const report = {
    date: new Date().toISOString(),
    browser: await browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      macOS:
        os.platform() === "darwin"
          ? execFileSync("sw_vers", ["-productVersion"], {
              encoding: "utf8",
            }).trim()
          : null,
    },
    ...meta,
    inspection,
    playback,
  };
  await fs.writeFile(
    "evidence/gate-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, inspection: { ...inspection, timestamps: undefined } },
      null,
      2,
    ),
  );
  if (
    inspection.count !== 150 ||
    Math.abs(inspection.duration - 5) > 1 / 30 ||
    !playback.playing ||
    !playback.seeked
  )
    throw Error("Gate failed");
} finally {
  await browser.close();
}
