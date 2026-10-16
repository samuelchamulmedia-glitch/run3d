import os from "node:os";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
export async function runOverlaySuite(browser) {
  const dir = "evidence/overlays";
  await fs.mkdir(dir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Show activity data", exact: true })
    .waitFor();
  await page.getByLabel("Timeline").fill("12");
  await page
    .getByRole("checkbox", { name: "Show Elevation", exact: true })
    .check();
  await page.waitForFunction(() =>
    document
      .querySelector(".overlay-canvas")
      .getAttribute("aria-label")
      .includes("Elevation: —"),
  );
  assert.equal(await page.getByLabel("Timeline").inputValue(), "12");
  await page
    .getByRole("checkbox", { name: "Show Distance", exact: true })
    .uncheck();
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".overlay-canvas")
        .getAttribute("aria-label")
        .includes("Distance:"),
  );
  await page
    .getByRole("checkbox", { name: "Show activity data", exact: true })
    .uncheck();
  await page.waitForFunction(
    () =>
      document.querySelector(".overlay-canvas").getAttribute("aria-label") ===
      "Activity data hidden",
  );
  assert.ok(
    await page.evaluate(() => {
      const c = document.querySelector(".overlay-canvas"),
        data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      return !data.some((v, i) => i % 4 === 3 && v !== 0);
    }),
  );
  await page
    .getByRole("checkbox", { name: "Show activity data", exact: true })
    .check();
  for (let i = 0; i < 5; i++)
    await page
      .getByRole("button", { name: "Move Elevation up", exact: true })
      .click();
  assert.equal(
    await page.locator(".metric-list li").first().getAttribute("data-metric"),
    "elevation",
  );
  await page.waitForFunction(() =>
    document
      .querySelector(".overlay-canvas")
      .getAttribute("aria-label")
      .startsWith("Elevation:"),
  );
  await page
    .locator('[data-metric="cadence"]')
    .dragTo(page.locator('[data-metric="elevation"]'));
  assert.equal(
    await page.locator(".metric-list li").first().getAttribute("data-metric"),
    "cadence",
  );
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  await page.getByLabel("Visual style").selectOption("paper");
  await page.getByRole("tab", { name: "Data", exact: true }).click();
  assert.equal(
    await page.locator(".metric-list li").first().getAttribute("data-metric"),
    "cadence",
  );
  assert.equal(await page.getByLabel("Timeline").inputValue(), "12");
  const reports = [];
  for (const style of ["neon", "technical", "paper", "sunset"]) {
    console.log(`Exporting ${style} data typography…`);
    const result = await page.evaluate(async (style) => {
      const { indexActivity, synthetic, evaluate } =
        await import("/src/domain/activity.ts");
      const { normalizeOverlay, metricDefinitions } =
        await import("/src/domain/metrics.ts");
      const { applyStyle } = await import("/src/render/styles.ts");
      const { drawOverlay, overlayLayout } =
        await import("/src/render/overlays.ts");
      const { createScene } = await import("/src/render/scene.ts");
      const { exportVideo } = await import("/src/export/video.ts");
      const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
        await import("/node_modules/mediabunny/dist/modules/src/index.js");
      // Explicit synthetic sensor fixture, never inserted into the user's activity.
      const activity = synthetic();
      activity.name = "Synthetic sensor fixture";
      activity.samples.forEach((s, i) => {
        s.hr = 140 + i;
        s.cadence = 170 + (i % 4);
        s.elevation = 100 + i * 1.2;
      });
      const track = indexActivity(activity),
        settings = applyStyle(
          {
            duration: 5,
            mode: "actual",
            color: "#fff",
            thickness: 1,
            overlay: normalizeOverlay({
              order: [
                "heartRate",
                "pace",
                "distance",
                "elapsed",
                "elevation",
                "gain",
                "averagePace",
                "cadence",
              ],
              visible: metricDefinitions.map((m) => m.id),
            }),
          },
          style,
        ),
        baseline = structuredClone(settings);
      let comparisons = 0,
        mutated = false;
      const out = await exportVideo(
        track,
        settings,
        new AbortController().signal,
        () => {
          if (!mutated) {
            settings.overlay.visible = [];
            settings.overlay.order.reverse();
            settings.overlay.enabled = false;
            mutated = true;
          }
        },
        "mp4",
        (t, f) => {
          if (
            JSON.stringify(f) !== JSON.stringify(evaluate(track, baseline, t))
          )
            throw Error("Overlay changed simulation");
          comparisons++;
        },
      );
      const input = new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(out.blob),
        }),
        video = await input.getPrimaryVideoTrack(),
        decodedCanvas = document.createElement("canvas");
      decodedCanvas.width = 1280;
      decodedCanvas.height = 720;
      const decodedCtx = decodedCanvas.getContext("2d");
      let frames = 0,
        previous = -1;
      for await (const sample of new VideoSampleSink(video).samples()) {
        if (sample.timestamp <= previous) throw Error("Timestamp order");
        previous = sample.timestamp;
        if (frames === 75) sample.draw(decodedCtx, 0, 0);
        frames++;
        sample.close();
      }
      const duration = await input.computeDuration();
      input.dispose();
      const sceneCanvas = document.createElement("canvas"),
        scene = createScene(sceneCanvas, track, 1280, 720),
        overlay = document.createElement("canvas"),
        composite = document.createElement("canvas");
      overlay.width = composite.width = 1280;
      overlay.height = composite.height = 720;
      const ctx = overlay.getContext("2d"),
        full = composite.getContext("2d");
      const frame = scene.render(2.5, baseline),
        layout = drawOverlay(ctx, track, baseline, frame, 1280, 720);
      full.drawImage(sceneCanvas, 0, 0);
      full.drawImage(overlay, 0, 0);
      const expected = full.getImageData(0, 0, 1280, 720).data,
        actual = decodedCtx.getImageData(0, 0, 1280, 720).data,
        mask = ctx.getImageData(0, 0, 1280, 720).data;
      let count = 0,
        error = 0;
      const bg =
        style === "paper"
          ? [239, 236, 227]
          : style === "technical"
            ? [11, 21, 30]
            : style === "sunset"
              ? [36, 23, 45]
              : [9, 13, 20];
      for (const cell of layout.cells)
        for (let y = Math.ceil(cell.y); y < cell.y + cell.height; y++)
          for (let x = Math.ceil(cell.x); x < cell.x + cell.width; x++) {
            const i = (y * 1280 + x) * 4;
            if (
              Math.max(...bg.map((v, k) => Math.abs(mask[i + k] - v))) > 100 &&
              mask[i + 3] > 200
            ) {
              count++;
              error +=
                Math.abs(expected[i] - actual[i]) +
                Math.abs(expected[i + 1] - actual[i + 1]) +
                Math.abs(expected[i + 2] - actual[i + 2]);
            }
          }
      const pixelError = count ? error / (count * 3) : Infinity;
      if (count < 200 || pixelError > 35)
        throw Error(`Export overlay mismatch: ${pixelError}, mask ${count}`);
      const first = overlay.toDataURL();
      for (const t of [4, 1, 3, 0])
        drawOverlay(
          ctx,
          track,
          baseline,
          evaluate(track, baseline, t),
          1280,
          720,
        );
      drawOverlay(ctx, track, baseline, frame, 1280, 720);
      if (overlay.toDataURL() !== first)
        throw Error("Nondeterministic overlay pixels");
      const answer = {
        bytes: Array.from(new Uint8Array(await out.blob.arrayBuffer())),
        codec: out.codec,
        encoderConfig: out.encoderConfig,
        width: out.width,
        height: out.height,
        fps: out.fps,
        frames,
        duration,
        comparisons,
        pixelError,
        maskPixels: count,
        order: layout.cells.map((c) => c.metric.id),
        values: layout.cells.map((c) => c.metric.value),
        preview: composite.toDataURL(),
        decoded: decodedCanvas.toDataURL(),
        snapshotMutation: true,
      };
      scene.dispose(true);
      return answer;
    }, style);
    assert.equal(result.frames, 150);
    assert.equal(result.duration, 5);
    assert.equal(result.comparisons, 150);
    assert.equal(result.order[0], "heartRate");
    await fs.writeFile(`${dir}/${style}.mp4`, new Uint8Array(result.bytes));
    for (const key of ["preview", "decoded"])
      await fs.writeFile(
        `${dir}/${style}-${key}.png`,
        Buffer.from(result[key].split(",")[1], "base64"),
      );
    delete result.bytes;
    delete result.preview;
    delete result.decoded;
    reports.push({ style, ...result });
  }
  for (const metric of [
    "Distance",
    "Elapsed time",
    "Current pace",
    "Average pace",
    "Elevation",
    "Elevation gain",
    "Heart rate",
    "Cadence",
  ])
    await page
      .getByRole("checkbox", { name: `Show ${metric}`, exact: true })
      .check();
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByLabel("Export format").selectOption("9:16");
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByLabel("Export resolution").selectOption("1080");
  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  await page.getByLabel("Video duration").selectOption("15");
  await page.getByLabel("Timeline").fill("8");
  await page.screenshot({
    path: `${dir}/editor-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page
    .getByRole("link", { name: "Download .mp4" })
    .waitFor({ timeout: 60000 });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download .mp4" }).click();
  await (await download).saveAs(`${dir}/ui-vertical.mp4`);
  const ui = await page.evaluate(async () => {
    const blob = await (
        await fetch(document.querySelector("a.download").href)
      ).blob(),
      { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
        await import("/node_modules/mediabunny/dist/modules/src/index.js");
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(blob),
      }),
      video = await input.getPrimaryVideoTrack();
    let frames = 0;
    for await (const sample of new VideoSampleSink(video).samples()) {
      frames++;
      sample.close();
    }
    const result = {
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      duration: await input.computeDuration(),
      frames,
    };
    input.dispose();
    return result;
  });
  assert.deepEqual(ui, {
    width: 1080,
    height: 1920,
    duration: 15,
    frames: 450,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  await page.screenshot({ path: `${dir}/editor-mobile.png`, fullPage: true });
  assert.equal(errors.length, 0);
  await fs.writeFile(
    `${dir}/report.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        date: new Date().toISOString(),
        os: {
          platform: os.platform(),
          arch: os.arch(),
          release: os.release(),
          version:
            os.platform() === "darwin"
              ? execFileSync("sw_vers", ["-productVersion"], {
                  encoding: "utf8",
                }).trim()
              : os.release(),
        },
        reports,
        ui,
        uiChecks: [
          "Independent toggles",
          "Global off clears all overlay pixels",
          "Arrow reorder",
          "Drag reorder",
          "Preset changes preserve order/time",
          "Vertical UI export",
          "Mobile layout",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: toggles, arrows/drag reorder, four preset typography exports, pixel parity, snapshot isolation and 1080p UI export",
  );
}
