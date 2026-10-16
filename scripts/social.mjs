import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { saveRenderedVideo, saveTestMode } from "./save-test.mjs";
import os from "node:os";
import { execFileSync } from "node:child_process";
export async function runSocialSuite(browser) {
  const dir = "evidence/stabilization-social";
  await fs.mkdir(dir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByLabel("Export format").waitFor();
  for (const id of ["9:16", "4:5", "1:1", "16:9"]) {
    await page.getByLabel("Export format").selectOption(id);
    const [a, b] = id.split(":").map(Number);
    await page.waitForFunction((r) => {
      const canvas = document.querySelector("canvas");
      return Math.abs(canvas.width / canvas.height - r) < 0.005;
    }, a / b);
  }
  const cases = [
    { aspect: "9:16", preset: "follow", duration: 15 },
    { aspect: "4:5", preset: "top-down", duration: 15 },
    { aspect: "1:1", preset: "showcase", duration: 15 },
    { aspect: "16:9", preset: "flyover", duration: 5 },
    { aspect: "9:16", preset: "follow", duration: 2, resolution: 1080 },
  ];
  const reports = [];
  for (const spec of cases) {
    console.log(`Exporting ${spec.aspect} ${spec.preset}…`);
    const r = await page.evaluate(async (spec) => {
      const { indexActivity, synthetic, evaluate } =
        await import("/src/domain/activity.ts");
      const { defaultCamera } = await import("/src/simulation/camera.ts");
      const { exportDimensions } = await import("/src/export/formats.ts");
      const { exportVideo } = await import("/src/export/video.ts");
      const { createScene } = await import("/src/render/scene.ts");
      const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
        await import("/node_modules/mediabunny/dist/modules/src/index.js");
      const settings = {
          duration: spec.duration,
          mode: "actual",
          color: "#73f5c4",
          thickness: 1,
          exportAspect: spec.aspect,
          exportResolution: spec.resolution ?? 720,
          camera: {
            ...defaultCamera,
            preset: spec.preset,
            elevation: spec.preset === "top-down" ? 85 : 35,
          },
        },
        track = indexActivity(synthetic()),
        d = exportDimensions(spec.aspect, spec.resolution ?? 720),
        scene = createScene(
          document.createElement("canvas"),
          track,
          d.width,
          d.height,
        );
      let comparisons = 0;
      let output;
      try {
        output = await exportVideo(
          track,
          settings,
          new AbortController().signal,
          () => {},
          "mp4",
          (t, f) => {
            const preview = scene.render(t, settings),
              expected = evaluate(track, settings, t, d.width / d.height);
            if (
              JSON.stringify(f) !== JSON.stringify(expected) ||
              JSON.stringify(f) !== JSON.stringify(preview)
            )
              throw Error("Preview/export aspect or camera mismatch");
            comparisons++;
          },
        );
      } finally {
        scene.dispose(true);
      }
      const input = new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(output.blob),
        }),
        video = await input.getPrimaryVideoTrack();
      let frames = 0,
        previous = -1;
      const captures = [];
      for await (const sample of new VideoSampleSink(video).samples()) {
        if (sample.timestamp <= previous) throw Error("Timestamp regression");
        previous = sample.timestamp;
        if (
          [0, Math.floor(output.frames / 2), output.frames - 1].includes(frames)
        ) {
          const canvas = document.createElement("canvas");
          canvas.width = d.width;
          canvas.height = d.height;
          sample.draw(canvas.getContext("2d"), 0, 0);
          captures.push({ frame: frames, png: canvas.toDataURL() });
        }
        frames++;
        sample.close();
      }
      const result = {
        ...spec,
        width: await video.getDisplayWidth(),
        height: await video.getDisplayHeight(),
        decodedDuration: await input.computeDuration(),
        frames,
        comparisons,
        codec: output.codec,
        encoderConfig: output.encoderConfig,
        bytes: Array.from(new Uint8Array(await output.blob.arrayBuffer())),
        captures,
      };
      input.dispose();
      return result;
    }, spec);
    assert.equal(r.frames, spec.duration * 30);
    assert.equal(r.comparisons, r.frames);
    assert.equal(r.decodedDuration, spec.duration);
    const base = `${spec.aspect.replace(":", "x")}-${spec.preset}${spec.resolution ? "-" + spec.resolution : ""}`,
      ext = r.codec === "avc" ? "mp4" : "webm";
    await fs.writeFile(`${dir}/${base}.${ext}`, new Uint8Array(r.bytes));
    for (const capture of r.captures)
      await fs.writeFile(
        `${dir}/${base}-${capture.frame}.png`,
        Buffer.from(capture.png.split(",")[1], "base64"),
      );
    delete r.bytes;
    delete r.captures;
    const viewer = await browser.newPage();
    await viewer.route("**/social-player.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<video controls muted src="/evidence/stabilization-social/${base}.${ext}"></video>`,
      }),
    );
    await viewer.goto("http://127.0.0.1:5173/social-player.html");
    r.playback = await viewer.evaluate(async () => {
      const v = document.querySelector("video");
      if (v.readyState < 1)
        await new Promise((resolve, reject) => {
          v.onloadedmetadata = resolve;
          v.onerror = reject;
          setTimeout(() => reject(Error("Metadata timeout")), 10000);
        });
      const seekTime = v.duration / 2;
      v.currentTime = seekTime;
      await new Promise((r) => (v.onseeked = r));
      await v.play();
      await new Promise((r) => setTimeout(r, 200));
      const result = { playing: !v.paused, seeked: v.currentTime >= seekTime };
      v.pause();
      return result;
    });
    assert.ok(r.playback.playing && r.playback.seeked);
    await viewer.close();
    reports.push(r);
  }
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByLabel("Export format").selectOption("9:16");
  await page.getByRole("tab", { name: "Camera", exact: true }).click();
  await page.getByLabel("Camera preset").selectOption("follow");
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  await page.getByLabel("Video duration").selectOption("15");
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByLabel("Export resolution").selectOption("1080");
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page
    .getByRole("link", { name: "Download .mp4" })
    .waitFor({ timeout: 60000 });
  await saveRenderedVideo(page, `${dir}/ui-vertical.mp4`);
  const uiVideo = await page.evaluate(async () => {
    const href = document.querySelector("a.download").href;
    const blob = await (await fetch(href)).blob();
    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
      await import("/node_modules/mediabunny/dist/modules/src/index.js");
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(blob),
      }),
      track = await input.getPrimaryVideoTrack();
    let frames = 0;
    for await (const sample of new VideoSampleSink(track).samples()) {
      frames++;
      sample.close();
    }
    const result = {
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      duration: await input.computeDuration(),
      frames,
    };
    input.dispose();
    return result;
  });
  assert.deepEqual(uiVideo, {
    width: 1080,
    height: 1920,
    duration: 15,
    frames: 450,
  });
  await page.screenshot({ path: `${dir}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  assert.equal(errors.length, 0);
  await fs.writeFile(
    `${dir}/report.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: await browser.version(),
        os: {
          platform: os.platform(),
          release: os.release(),
          arch: os.arch(),
          version:
            os.platform() === "darwin"
              ? execFileSync("sw_vers", ["-productVersion"], {
                  encoding: "utf8",
                }).trim()
              : os.version(),
        },
        saveTestMode,
        reports,
        uiVerticalExport: uiVideo,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: four social formats decoded and played; 1560 exact preview/export comparisons; vertical UI export and responsive preview",
  );
}
