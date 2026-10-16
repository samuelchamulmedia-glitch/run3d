import fs from "node:fs/promises";
import assert from "node:assert/strict";
import os from "node:os";
import { execFileSync } from "node:child_process";
export async function runCameraSuite(browser) {
  const dir = "evidence/milestone-2";
  await fs.mkdir(dir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("tab", { name: "Camera", exact: true }).click();
  const presetControl = page.getByLabel("Camera preset");
  await presetControl.waitFor();
  const presets = ["orbit", "follow", "top-down", "flyover", "showcase"],
    uiChecks = [];
  for (const preset of presets) {
    await presetControl.selectOption(preset);
    await page.getByLabel("Timeline").fill("21");
    await page
      .getByRole("slider", { name: "Field of view", exact: true })
      .fill("60");
    await page
      .getByRole("slider", { name: "Rotation", exact: true })
      .fill("50");
    assert.equal(await page.getByLabel("Timeline").inputValue(), "21");
    await page
      .getByRole("slider", { name: "Camera distance", exact: true })
      .fill("1.2");
    await page
      .getByRole("button", { name: "Orbit inspection", exact: true })
      .click();
    await page
      .getByRole("slider", { name: "Field of view", exact: true })
      .fill("45");
    assert.equal(
      await page
        .getByRole("button", { name: "Orbit inspection", exact: true })
        .getAttribute("aria-pressed"),
      "false",
    );
    uiChecks.push(
      `${preset}: editable preset/FOV/rotation/distance; preserves scrub time; exits inspection`,
    );
  }
  await page.getByRole("button", { name: "Reset camera" }).click();
  assert.equal(await presetControl.inputValue(), "orbit");
  assert.equal(
    await page
      .getByRole("slider", { name: "Field of view", exact: true })
      .inputValue(),
    "45",
  );
  assert.equal(await page.getByLabel("Timeline").inputValue(), "21");
  uiChecks.push("Reset camera restores defaults without resetting timeline");
  const projectionChecks = await page.evaluate(async () => {
    const { indexActivity, synthetic, evaluate } =
      await import("/src/domain/activity.ts");
    const { defaultCamera, cameraPresets } =
      await import("/src/simulation/camera.ts");
    const { createScene } = await import("/src/render/scene.ts");
    const track = indexActivity(synthetic());
    let count = 0;
    for (const [preset] of cameraPresets)
      for (const [width, height] of [
        [720, 1280],
        [720, 900],
        [720, 720],
        [1280, 720],
      ]) {
        const scene = createScene(
            document.createElement("canvas"),
            track,
            width,
            height,
          ),
          settings = {
            duration: 5,
            mode: "actual",
            color: "#fff",
            thickness: 1,
            camera: { ...defaultCamera, preset },
          };
        try {
          for (const t of [0, 2.5, 5]) {
            const f = scene.render(t, settings),
              expected = evaluate(track, settings, t, width / height);
            if (JSON.stringify(f) !== JSON.stringify(expected))
              throw Error("Aspect evaluation mismatch");
            if (
              scene.camera.fov !== f.fov ||
              scene.camera.near !== f.near ||
              scene.camera.far !== f.far
            )
              throw Error("Camera projection not applied");
            const direction = scene.camera.getWorldDirection(
                scene.camera.position.clone(),
              ),
              desired = f.target.map((v, i) => v - f.camera[i]),
              norm = Math.hypot(...desired);
            if (
              Math.max(
                ...desired.map((v, i) =>
                  Math.abs(v / norm - direction.toArray()[i]),
                ),
              ) > 1e-12
            )
              throw Error("Camera orientation mismatch");
            if (f.position) {
              const point = scene.marker.position.clone().project(scene.camera);
              if (
                Math.abs(point.x) > 1 ||
                Math.abs(point.y) > 1 ||
                Math.abs(point.z) > 1
              )
                throw Error("Rendered subject clipping");
            }
            count++;
          }
        } finally {
          scene.dispose(true);
        }
      }
    return count;
  });
  assert.equal(projectionChecks, 60);
  const reports = [];
  for (const preset of presets) {
    console.log(`Rendering and decoding ${preset}…`);
    const result = await page.evaluate(async (preset) => {
      const { indexActivity, synthetic, evaluate } =
        await import("/src/domain/activity.ts");
      const { defaultCamera } = await import("/src/simulation/camera.ts");
      const { createScene } = await import("/src/render/scene.ts");
      const { exportVideo } = await import("/src/export/video.ts");
      const track = indexActivity(synthetic()),
        settings = {
          duration: 5,
          mode: "actual",
          color: "#73f5c4",
          thickness: 1,
          camera: {
            ...defaultCamera,
            preset,
            elevation: preset === "top-down" ? 85 : 35,
          },
        };
      const canvas = document.createElement("canvas"),
        preview = createScene(canvas, track, 1280, 720);
      let comparisons = 0,
        maxPoseError = 0;
      const signature = (f) => [
        ...f.camera,
        ...f.target,
        ...f.up,
        f.fov,
        f.near,
        f.far,
      ];
      let exported;
      try {
        exported = await exportVideo(
          track,
          settings,
          new AbortController().signal,
          () => {},
          "mp4",
          (t, frame) => {
            const state = preview.render(t, settings),
              expected = evaluate(track, settings, t, 16 / 9),
              a = signature(frame),
              b = signature(state),
              c = signature(expected);
            for (let i = 0; i < a.length; i++)
              maxPoseError = Math.max(
                maxPoseError,
                Math.abs(a[i] - b[i]),
                Math.abs(a[i] - c[i]),
              );
            if (
              JSON.stringify(frame.position) !==
                JSON.stringify(frame.endpoint) ||
              JSON.stringify(frame.position) !== JSON.stringify(state.position)
            )
              throw Error("Marker/reveal/preview mismatch");
            comparisons++;
          },
        );
      } finally {
        preview.dispose(true);
      }
      const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
        await import("/node_modules/mediabunny/dist/modules/src/index.js");
      const input = new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(exported.blob),
        }),
        video = await input.getPrimaryVideoTrack(),
        sink = new VideoSampleSink(video);
      let frames = 0,
        previous = -1;
      const captures = [];
      for await (const sample of sink.samples()) {
        if (sample.timestamp <= previous)
          throw Error("Nonmonotonic decoded video");
        previous = sample.timestamp;
        if ([0, 75, 149].includes(frames)) {
          const c = document.createElement("canvas");
          c.width = 1280;
          c.height = 720;
          sample.draw(c.getContext("2d"), 0, 0);
          captures.push({ frame: frames, png: c.toDataURL() });
        }
        frames++;
        sample.close();
      }
      const duration = await input.computeDuration();
      input.dispose();
      return {
        bytes: Array.from(new Uint8Array(await exported.blob.arrayBuffer())),
        codec: exported.codec,
        encoderConfig: exported.encoderConfig,
        frames,
        duration,
        comparisons,
        maxPoseError,
        captures,
      };
    }, preset);
    assert.equal(result.frames, 150);
    assert.equal(result.duration, 5);
    assert.equal(result.comparisons, 150);
    assert.equal(result.maxPoseError, 0);
    const extension = result.codec === "avc" ? "mp4" : "webm";
    await fs.writeFile(
      `${dir}/${preset}.${extension}`,
      new Uint8Array(result.bytes),
    );
    for (const capture of result.captures)
      await fs.writeFile(
        `${dir}/${preset}-${capture.frame}.png`,
        Buffer.from(capture.png.split(",")[1], "base64"),
      );
    delete result.bytes;
    delete result.captures;
    // Independent video element: no React, editor, or Vite client scripts.
    const viewer = await browser.newPage();
    await viewer.route("**/camera-player.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><title>${preset} camera video</title><body style="margin:0;background:#090d14"><video controls muted style="width:100%" src="/evidence/milestone-2/${preset}.${extension}"></video></body></html>`,
      }),
    );
    await viewer.goto("http://127.0.0.1:5173/camera-player.html");
    const playback = await viewer.evaluate(async () => {
      const v = document.querySelector("video");
      if (v.readyState < 1)
        await new Promise((resolve, reject) => {
          v.onloadedmetadata = resolve;
          v.onerror = reject;
          setTimeout(() => reject(Error("Metadata timeout")), 10000);
        });
      v.currentTime = 2.5;
      await new Promise((r) => (v.onseeked = r));
      await v.play();
      await new Promise((r) => setTimeout(r, 150));
      const result = {
        playing: !v.paused,
        seeked: v.currentTime >= 2.5,
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
      };
      v.pause();
      return result;
    });
    assert.ok(playback.playing && playback.seeked);
    await viewer.close();
    reports.push({ preset, ...result, playback });
  }
  await presetControl.selectOption("showcase");
  await page.getByLabel("Timeline").fill("29.99");
  await page.screenshot({ path: `${dir}/editor-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: `${dir}/editor-mobile.png`, fullPage: true });
  assert.equal(errors.length, 0);
  const report = {
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
          : null,
    },
    width: 1280,
    height: 720,
    fps: 30,
    projectionChecks,
    uiChecks,
    reports,
    errors,
  };
  await fs.writeFile(
    `${dir}/camera-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS: five decoded/playable videos; 750 exact preview/export camera comparisons; UI controls and responsive layout",
  );
}
