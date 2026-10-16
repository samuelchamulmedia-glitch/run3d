import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5173");
  const bytes = Array.from(await fs.readFile("evidence/prototype-15s.mp4"));
  const ui = await page.evaluate(async (bytes) => {
    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      await import("/node_modules/mediabunny/dist/modules/src/index.js");
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(new Blob([new Uint8Array(bytes)])),
    });
    const track = await input.getPrimaryVideoTrack();
    let frames = 0,
      previous = -1;
    for await (const sample of new VideoSampleSink(track).samples()) {
      if (sample.timestamp <= previous) throw Error("Nonmonotonic timestamps");
      previous = sample.timestamp;
      frames++;
      sample.close();
    }
    const result = {
      frames,
      duration: await input.computeDuration(),
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      codec: await track.getCodecParameterString(),
    };
    input.dispose();
    return result;
  }, bytes);
  assert.equal(ui.frames, 450);
  assert.equal(ui.duration, 15);
  assert.equal(ui.width, 1280);
  assert.equal(ui.height, 720);
  const webm = await page.evaluate(async () => {
    const { indexActivity, synthetic } =
      await import("/src/domain/activity.ts");
    const { exportVideo } = await import("/src/export/video.ts");
    const result = await exportVideo(
      indexActivity(synthetic()),
      { duration: 2, mode: "actual", color: "#73f5c4", thickness: 1 },
      new AbortController().signal,
      () => {},
      "webm",
    );
    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      await import("/node_modules/mediabunny/dist/modules/src/index.js");
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(result.blob),
      }),
      track = await input.getPrimaryVideoTrack();
    let frames = 0;
    for await (const sample of new VideoSampleSink(track).samples()) {
      frames++;
      sample.close();
    }
    const duration = await input.computeDuration();
    input.dispose();
    return {
      bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())),
      codec: result.codec,
      mime: result.blob.type,
      frames,
      duration,
      encoderConfig: result.encoderConfig,
    };
  });
  assert.equal(webm.frames, 60);
  assert.equal(webm.duration, 2);
  assert.equal(webm.mime, "video/webm");
  await fs.writeFile("evidence/webm-smoke.webm", new Uint8Array(webm.bytes));
  delete webm.bytes;
  await fs.writeFile(
    "evidence/inspection-report.json",
    JSON.stringify({ browser: await browser.version(), ui, webm }, null, 2),
  );
  console.log(JSON.stringify({ ui, webm }, null, 2));
} finally {
  await browser.close();
}
