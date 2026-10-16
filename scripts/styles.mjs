import fs from "node:fs/promises";
import assert from "node:assert/strict";
export async function runStyleSuite(browser) {
  const dir = "evidence/styles";
  await fs.mkdir(dir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  await page.getByLabel("Visual style").waitFor();
  await page.getByLabel("Timeline").fill("12");
  for (const id of ["neon", "technical", "paper", "sunset"]) {
    await page.getByLabel("Visual style").selectOption(id);
    assert.equal(await page.getByLabel("Timeline").inputValue(), "12");
    await page
      .getByRole("slider", { name: "Line width", exact: true })
      .fill("10");
    assert.equal(await page.getByLabel("Timeline").inputValue(), "12");
  }
  const pixels = await page.evaluate(async () => {
    const { indexActivity, synthetic } =
      await import("/src/domain/activity.ts");
    const { createScene } = await import("/src/render/scene.ts");
    const track = indexActivity(synthetic()),
      canvas = document.createElement("canvas"),
      scene = createScene(canvas, track, 1280, 720),
      s = {
        duration: 30,
        mode: "actual",
        color: "#00ff00",
        thickness: 1,
        style: "paper",
        reveal: false,
        marker: false,
      };
    const count = (width) => {
      scene.render(12, { ...s, lineWidth: width });
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const ctx = c.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, 1280, 720).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 1] > data[i] + 40 && data[i + 1] > data[i + 2] + 40)
          count++;
      return count;
    };
    const geometry = scene.line.geometry.id,
      narrow = count(1),
      wide = count(12);
    const sameGeometry = geometry === scene.line.geometry.id;
    scene.resize(1920, 1080);
    scene.render(12, { ...s, lineWidth: 12 });
    const width1080 = scene.line.material.linewidth;
    scene.dispose(true);
    return { narrow, wide, sameGeometry, width1080 };
  });
  assert.ok(pixels.wide > pixels.narrow * 3);
  assert.ok(pixels.sameGeometry);
  assert.equal(pixels.width1080, 18);
  const reports = [];
  for (const id of ["neon", "technical", "paper", "sunset"]) {
    console.log(`Exporting style ${id}…`);
    const r = await page.evaluate(async (id) => {
      const { indexActivity, synthetic, evaluate } =
        await import("/src/domain/activity.ts");
      const { applyStyle } = await import("/src/render/styles.ts");
      const { createScene } = await import("/src/render/scene.ts");
      const { exportVideo } = await import("/src/export/video.ts");
      const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } =
        await import("/node_modules/mediabunny/dist/modules/src/index.js");
      const settings = applyStyle(
          { duration: 5, mode: "actual", color: "#fff", thickness: 1 },
          id,
        ),
        track = indexActivity(synthetic()),
        canvas = document.createElement("canvas"),
        scene = createScene(canvas, track, 1280, 720);
      let comparisons = 0;
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      const ctx = c.getContext("2d");
      scene.render(2.5, settings);
      ctx.drawImage(canvas, 0, 0);
      const preview = c.toDataURL();
      let out;
      try {
        out = await exportVideo(
          track,
          settings,
          new AbortController().signal,
          () => {},
          "mp4",
          (t, frame) => {
            if (
              JSON.stringify(frame) !==
              JSON.stringify(evaluate(track, settings, t))
            )
              throw Error("Simulation changed with style");
            comparisons++;
          },
        );
      } finally {
        scene.dispose(true);
      }
      const input = new Input({
          formats: ALL_FORMATS,
          source: new BlobSource(out.blob),
        }),
        video = await input.getPrimaryVideoTrack();
      let frames = 0;
      let decoded;
      for await (const sample of new VideoSampleSink(video).samples()) {
        if (frames === 75) {
          sample.draw(ctx, 0, 0);
          decoded = c.toDataURL();
        }
        frames++;
        sample.close();
      }
      const duration = await input.computeDuration();
      input.dispose();
      return {
        bytes: Array.from(new Uint8Array(await out.blob.arrayBuffer())),
        codec: out.codec,
        frames,
        duration,
        comparisons,
        preview,
        decoded,
      };
    }, id);
    assert.equal(r.frames, 150);
    assert.equal(r.comparisons, 150);
    assert.equal(r.duration, 5);
    await fs.writeFile(`${dir}/${id}.mp4`, new Uint8Array(r.bytes));
    await fs.writeFile(
      `${dir}/${id}-preview.png`,
      Buffer.from(r.preview.split(",")[1], "base64"),
    );
    await fs.writeFile(
      `${dir}/${id}-decoded.png`,
      Buffer.from(r.decoded.split(",")[1], "base64"),
    );
    delete r.bytes;
    delete r.preview;
    delete r.decoded;
    reports.push({ style: id, ...r });
  }
  await page.getByLabel("Visual style").selectOption("technical");
  await page.getByRole("slider", { name: "Line width", exact: true }).fill("8");
  await page.screenshot({ path: `${dir}/editor.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.equal(errors.length, 0);
  await fs.writeFile(
    `${dir}/report.json`,
    JSON.stringify(
      { browser: await browser.version(), pixels, reports, errors },
      null,
      2,
    ),
  );
  console.log(
    "PASS: four styles decoded; width visibly changes pixel coverage; geometry remains cached; style/width edits preserve time",
  );
}
