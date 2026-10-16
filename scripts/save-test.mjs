import fs from "node:fs/promises";
import assert from "node:assert/strict";
export const saveTestMode =
  process.env.RUNMOTION_TEST_SAVE_PICKER === "1"
    ? "picker-contract"
    : "native-download";
export async function saveRenderedVideo(page, path) {
  if (saveTestMode === "native-download") {
    const received = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download .mp4" }).click();
    const download = await received;
    const failure = await download.failure();
    if (failure)
      throw Error(
        `Native browser download failed (${failure}). No blob-fetch substitution was used. Run scripts/diagnose-download.mjs to check the host's download transport; RUNMOTION_TEST_SAVE_PICKER=1 separately checks the Save video contract with a simulated file picker.`,
      );
    await download.saveAs(path);
    return;
  }
  // Contract test only: the OS picker is simulated, never presented as a real
  // permission grant or a passing native browser download. Bytes from the
  // actual production Save video handler are persisted and decoded afterward.
  await page.evaluate(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    });
  });
  await page
    .getByRole("button", { name: "Save video...", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Save cancelled." })
    .waitFor();
  assert.ok(
    await page.getByRole("link", { name: "Download .mp4" }).isVisible(),
  );
  await page.evaluate(() => {
    window.__saveAborted = false;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async () => ({
        createWritable: async () => ({
          async write() {
            throw Error("Disk full test");
          },
          async close() {
            throw Error("Must not close after failed write");
          },
          async abort() {
            window.__saveAborted = true;
          },
        }),
      }),
    });
  });
  await page
    .getByRole("button", { name: "Save video...", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Could not save video: Disk full test" })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__saveAborted), true);
  console.log(
    "PASS: UI save cancellation and write failure preserve the export and allow retry (simulated picker)",
  );
  await page.evaluate(() => {
    window.__savedVideo = null;
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: async (options) => ({
        createWritable: async () => ({
          async write(blob) {
            window.__savedVideo = {
              options,
              bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
              closed: false,
            };
          },
          async close() {
            window.__savedVideo.closed = true;
          },
          async abort() {
            window.__savedVideo = null;
          },
        }),
      }),
    });
  });
  await page
    .getByRole("button", { name: "Save video...", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Video saved." }).waitFor();
  const saved = await page.evaluate(() => window.__savedVideo);
  assert.ok(saved.closed && saved.bytes.length > 0);
  assert.equal(saved.options.suggestedName, "runmotion.mp4");
  await fs.writeFile(path, new Uint8Array(saved.bytes));
  console.log(
    "PASS: Save video handler writes/closes exact generated blob (simulated picker; native download unverified)",
  );
}
