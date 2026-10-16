import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { saveRenderedVideo, saveTestMode } from "./save-test.mjs";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const evidenceDir = process.argv.includes("--milestone-2")
  ? "evidence/milestone-2/regression"
  : "evidence";
await fs.mkdir(evidenceDir, { recursive: true });
if (process.argv.includes("--overlays")) {
  try {
    const { runOverlaySuite } = await import("./overlays.mjs");
    await runOverlaySuite(browser);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes("--styles")) {
  try {
    const { runStyleSuite } = await import("./styles.mjs");
    await runStyleSuite(browser);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes("--social")) {
  try {
    const { runSocialSuite } = await import("./social.mjs");
    await runSocialSuite(browser);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes("--camera")) {
  try {
    const { runCameraSuite } = await import("./camera.mjs");
    await runCameraSuite(browser);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
if (process.argv.includes("--production")) {
  const page = await browser.newPage();
  const errors = [];
  const failed = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(r.url());
  });
  try {
    await page.goto("http://127.0.0.1:4173");
    await page.getByRole("heading", { name: "RunMotion 3D" }).waitFor();
    await page.getByRole("tab", { name: "Camera", exact: true }).click();
    await page.getByLabel("Camera preset").selectOption("follow");
    await page
      .getByRole("slider", { name: "Field of view", exact: true })
      .fill("60");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page.waitForFunction(
      () =>
        Number(document.querySelector("input[aria-label=Timeline]").value) >
        0.1,
      {},
      { timeout: 10000 },
    );
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.getByLabel("Import activity").setInputFiles({
      name: "synthetic.fit",
      mimeType: "application/octet-stream",
      buffer: await fs.readFile("tests/fixtures/synthetic.fit"),
    });
    await page.getByRole("heading", { name: "Imported FIT run" }).waitFor();
    assert.equal(errors.length, 0);
    assert.equal(failed.length, 0);
    await fs.writeFile(
      `${evidenceDir}/production-report.json`,
      JSON.stringify(
        {
          browser: await browser.version(),
          cameraControls: true,
          playback: true,
          fitImport: true,
          errors,
          failed,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: production build loads, plays, imports FIT; no runtime or asset errors",
    );
  } finally {
    await browser.close();
  }
  process.exit(0);
}
const checks = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log("PASS: " + name);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const external = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:5173") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "RunMotion 3D" }).waitFor();
  const simulation = await page.evaluate(async () => {
    const { indexActivity, synthetic, evaluate } =
      await import("/src/domain/activity.ts");
    const { createScene } = await import("/src/render/scene.ts");
    const track = indexActivity(synthetic()),
      settings = {
        duration: 5,
        mode: "actual",
        color: "#73f5c4",
        thickness: 1,
      };
    const canvas = document.createElement("canvas");
    const scene = createScene(canvas, track, 1280, 720);
    let maxError = 0,
      gaps = 0;
    for (let i = 0; i <= 300; i++) {
      const t = i / 60;
      const state = scene.render(t, settings);
      if (!state.position) {
        gaps++;
        if (scene.marker.visible || scene.tip.visible)
          throw Error("Visible marker/tip in unknown GPS gap");
        continue;
      }
      const pos = scene.marker.position.toArray();
      maxError = Math.max(
        maxError,
        ...pos.map((v, k) => Math.abs(v - state.position[k])),
      );
      if (scene.tip.visible) {
        const tip = scene.tip.geometry.attributes.instanceEnd;
        maxError = Math.max(
          maxError,
          ...pos.map((v, k) =>
            Math.abs(v - [tip.getX(0), tip.getY(0), tip.getZ(0)][k]),
          ),
        );
      }
    }
    const first = scene.render(2.37, settings),
      camera = scene.camera.matrixWorld.toArray();
    for (let i = 100; i >= 0; i--) scene.render(i / 30, settings);
    const second = scene.render(2.37, settings);
    const same =
      JSON.stringify(first) === JSON.stringify(second) &&
      JSON.stringify(camera) ===
        JSON.stringify(scene.camera.matrixWorld.toArray());
    scene.dispose();
    const s = evaluate(track, settings, 1.9),
      s2 = evaluate(track, settings, 2.05);
    return {
      maxError,
      gaps,
      same,
      stationary: JSON.stringify(s.position) === JSON.stringify(s2.position),
    };
  });
  check(
    "Rendered marker and reveal aligned to <0.00001 m",
    simulation.maxError < 1e-5,
  );
  check("Unknown GPS gap hides marker and tip", simulation.gaps > 0);
  check(
    "Simulation and camera identical after reverse scrubbing",
    simulation.same,
  );
  check("Stationary interval preserved", simulation.stationary);
  const xmlResults = await page.evaluate(async () => {
    const { parseXml, SportConfirmationRequired } =
      await import("/src/import/activity.ts");
    const { indexActivity } = await import("/src/domain/activity.ts");
    const gpx =
      '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><name>Synthetic GPX</name><trkseg><trkpt lat="13.7" lon="-89.2"><ele>10</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="13.70001" lon="-89.2"><ele>12</ele><time>2026-01-01T00:00:05Z</time></trkpt></trkseg></trk></gpx>';
    let confirmation = false;
    try {
      parseXml(gpx, "gpx");
    } catch (e) {
      confirmation = e instanceof SportConfirmationRequired;
    }
    const a = parseXml(gpx, "gpx", true);
    const tcx =
      '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Id>Synthetic TCX</Id><Lap StartTime="2026-01-01T00:00:00Z"><TotalTimeSeconds>5</TotalTimeSeconds><DistanceMeters>1.1</DistanceMeters><Track><Trackpoint><Time>2026-01-01T00:00:00Z</Time><Position><LatitudeDegrees>13.7</LatitudeDegrees><LongitudeDegrees>-89.2</LongitudeDegrees></Position><HeartRateBpm><Value>145</Value></HeartRateBpm><Extensions><TPX><RunCadence>90</RunCadence></TPX></Extensions></Trackpoint><Trackpoint><Time>2026-01-01T00:00:05Z</Time><Position><LatitudeDegrees>13.70001</LatitudeDegrees><LongitudeDegrees>-89.2</LongitudeDegrees></Position></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>';
    const b = parseXml(tcx, "tcx");
    const invalid = [
      "<gpx>",
      "<!DOCTYPE gpx><gpx/>",
      gpx.replace('13.7"', '99"'),
      gpx.replace("/GPX/1/1", "/bad"),
      gpx.replace("<trkseg>", "<type>cycling</type><trkseg>"),
    ];
    let rejections = 0;
    for (const text of invalid)
      try {
        indexActivity(parseXml(text, "gpx", true));
      } catch {
        rejections++;
      }
    return {
      gpx,
      tcx,
      confirmation,
      elevation: a.samples[1].elevation,
      missingHR: a.samples[0].hr,
      raw: a.samples[0].raw.length,
      tcxHR: b.samples[0].hr,
      lap: b.laps[0],
      rejections,
      timed: indexActivity(a).timed,
    };
  });
  check(
    "Ambiguous GPX sport requires explicit confirmation",
    xmlResults.confirmation,
  );
  check(
    "GPX elevation preserved, HR absent, raw retained",
    xmlResults.elevation === 12 &&
      xmlResults.missingHR === null &&
      xmlResults.raw > 0,
  );
  check(
    "TCX lap and HR imported",
    xmlResults.tcxHR === 145 && xmlResults.lap.distance === 1.1,
  );
  check(
    "Malformed, DTD, coordinate, namespace, sport failures rejected",
    xmlResults.rejections === 5,
  );
  await page.getByLabel("Import activity").setInputFiles({
    name: "synthetic.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(xmlResults.gpx),
  });
  await page.getByRole("button", { name: "Confirm this is a run" }).click();
  await page
    .getByRole("heading", { name: "Synthetic GPX", exact: true })
    .waitFor();
  check("GPX UI import confirmed", true);
  await page.getByLabel("Import activity").setInputFiles({
    name: "synthetic.tcx",
    mimeType: "application/xml",
    buffer: Buffer.from(xmlResults.tcx),
  });
  await page
    .getByRole("heading", { name: "Synthetic TCX", exact: true })
    .waitFor();
  check("TCX UI import", true);
  const fit = await fs.readFile("tests/fixtures/synthetic.fit");
  await page.getByLabel("Import activity").setInputFiles({
    name: "synthetic.fit",
    mimeType: "application/octet-stream",
    buffer: fit,
  });
  await page.getByRole("heading", { name: "Imported FIT run" }).waitFor();
  check("FIT UI import", true);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page
    .waitForFunction(
      () =>
        Number(document.querySelector("input[aria-label=Timeline]").value) >
        0.1,
      {},
      { timeout: 10000 },
    )
    .catch(async (e) => {
      console.log(await page.locator("body").innerText());
      throw e;
    });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  check(
    "Playback advances",
    Number(await page.getByLabel("Timeline").inputValue()) > 0,
  );
  await page.getByLabel("Timeline").fill("10");
  check(
    "Scrubber seeks",
    (await page.getByLabel("Timeline").inputValue()) === "10",
  );
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  check(
    "Restart resets",
    (await page.getByLabel("Timeline").inputValue()) === "0",
  );
  await page
    .getByRole("button", { name: "Orbit inspection", exact: true })
    .click();
  check(
    "Inspection toggle",
    (await page
      .getByRole("button", { name: "Exit inspection" })
      .getAttribute("aria-pressed")) === "true",
  );
  await page.getByRole("button", { name: "Load synthetic test route" }).click();
  await page
    .getByRole("heading", { name: "Synthetic · Turn & Pause" })
    .waitFor();
  const cancelled = await page.evaluate(async () => {
    const { indexActivity, synthetic } =
      await import("/src/domain/activity.ts");
    const { exportVideo } = await import("/src/export/video.ts");
    const controller = new AbortController();
    let count = 0;
    try {
      await exportVideo(
        indexActivity(synthetic()),
        { duration: 5, mode: "actual", color: "#fff", thickness: 1 },
        controller.signal,
        () => {
          if (++count === 8) controller.abort();
        },
      );
      return false;
    } catch (e) {
      return controller.signal.aborted && e.name === "AbortError";
    }
  });
  check("Mid-export cancellation releases and rejects", cancelled);
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page.getByRole("button", { name: "Cancel export" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Export cancelled." })
    .waitFor();
  check(
    "UI export cancellation restores controls",
    await page
      .getByRole("button", { name: "Export video", exact: true })
      .isEnabled(),
  );

  await page.getByRole("tab", { name: "Timing", exact: true }).click();
  await page.getByLabel("Video duration").selectOption("15");
  await page.getByRole("tab", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Export video", exact: true }).click();
  await page
    .getByRole("link", { name: "Download .mp4" })
    .waitFor({ timeout: 60000 });
  await saveRenderedVideo(page, `${evidenceDir}/prototype-15s.mp4`);
  check(`Full UI export completes and saves MP4 (${saveTestMode})`, true);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    canvas
      .getContext("webgl2")
      .getExtension("WEBGL_lose_context")
      .loseContext();
  });
  await page.getByRole("button", { name: "Rebuild viewport" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(document.querySelector("input[aria-label=Timeline]").value) > 0.1,
    {},
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("tab", { name: "Activity", exact: true }).click();
  check(
    "Context loss recovery preserves activity and resumes playback",
    await page
      .getByRole("heading", { name: "Synthetic · Turn & Pause" })
      .isVisible(),
  );
  await page.screenshot({
    path: `${evidenceDir}/prototype-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${evidenceDir}/prototype-mobile.png`,
    fullPage: true,
  });
  check(
    "Mobile layout has no horizontal overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  check("No external activity network requests", external.length === 0);
  check("No browser runtime errors", errors.length === 0);
  await fs.writeFile(
    `${evidenceDir}/browser-report.json`,
    JSON.stringify(
      {
        browser: await browser.version(),
        saveTestMode,
        checks,
        simulation,
        external,
        errors,
        uiExport: {
          file: "prototype-15s.mp4",
          duration: 15,
          width: 1280,
          height: 720,
          fps: 30,
        },
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks.length} browser assertions`);
} finally {
  await browser.close();
}
