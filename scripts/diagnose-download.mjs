import { chromium } from "playwright";
import fs from "node:fs/promises";
await fs.mkdir("evidence/download-diagnosis", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.route("http://127.0.0.1:5173/download-diagnosis", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<a id="plain" download="hello.txt">Download text</a><a id="video" download="synthetic.mp4">Download video</a><a id="http" href="/download-test.txt" download>HTTP download</a>',
    }),
  );
  await page.route("**/download-test.txt", (route) =>
    route.fulfill({
      headers: {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="http-test.txt"',
      },
      body: "synthetic download test",
    }),
  );
  await page.goto("http://127.0.0.1:5173/download-diagnosis");
  await page.evaluate(() => {
    document.querySelector("#plain").href = URL.createObjectURL(
      new Blob(["hello"], { type: "text/plain" }),
    );
    document.querySelector("#video").href = URL.createObjectURL(
      new Blob(["not a real video; download transport diagnostic"], {
        type: "video/mp4",
      }),
    );
  });
  const report = [];
  for (const id of ["plain", "video", "http"]) {
    const received = page.waitForEvent("download");
    await page.locator("#" + id).click();
    const d = await received;
    const result = {
      id,
      filename: d.suggestedFilename(),
      url: d.url(),
      failure: await d.failure(),
    };
    try {
      await d.saveAs("evidence/download-diagnosis/" + d.suggestedFilename());
      result.saved = true;
    } catch (e) {
      result.error = e.message;
    }
    report.push(result);
  }
  console.log(JSON.stringify(report, null, 2));
  await fs.writeFile(
    "evidence/download-diagnosis/report.json",
    JSON.stringify(report, null, 2),
  );
} finally {
  await browser.close();
}
