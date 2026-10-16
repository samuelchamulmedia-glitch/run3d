# RunMotion 3D

Turn a running activity into a route animation. React + TypeScript + Three.js, with local GPX, TCX and FIT import and local video export. The default activity is explicitly synthetic.

## Interface

The preview and playback controls remain accessible beside (desktop) or above (phone) a compact control panel. Choose Activity, Timing, Style, Data, Camera or Export instead of scrolling through every setting. Only the selected section scrolls. Enlarge preview gives portrait videos more room; Back to controls or Escape returns to editing. Switching sections preserves imported data, settings and playback position.

## Run locally

Use Node 24 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Tests: `pnpm test`. Production build: `pnpm build`. The Vite base is relative (`./`), so a repository Pages subdirectory does not require a repository name in source.

## Publish on GitHub Pages

1. Create a GitHub repository (for example `runmotion`).
2. Upload this source package's contents, including `.github/workflows/pages.yml`, to its `main` branch. Upload the extracted files, not the ZIP itself.
3. In the repository, open Settings → Pages. Set Source to **GitHub Actions**.
4. Open Actions and wait for **Test and deploy RunMotion** to succeed. The workflow installs locked dependencies, runs tests, builds and publishes `dist`.
5. Open the site URL shown in Settings → Pages on your phone. This is the phone-accessible URL; `127.0.0.1` only works on the computer hosting the local preview.

The workflow can also be started manually from Actions. Publication has not been performed by preparing this package. GitHub project/account settings must allow Pages. See the [official Vite deployment guide](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Phone workflow

Open the published HTTPS site, choose Activity and import a run from your phone's Files picker. Choose Timing for 10/15/20/30/45/60-second videos and a 0/2/4-second final data hold. Use Style for route/marker appearance, Data for sans-serif typography and metric toggles, and Camera for the directed presets. Export chooses square, portrait, story/reel or landscape sizes. Start with 720p on a phone. Save video uses a file picker in supporting browsers; the regular download link remains available.

The interface has been checked at 390×844 and 320×568 sizes, including the enlarged portrait preview. Physical iPhone/Android encoding and saving have not been verified; those depend on the browser's WebGL/WebCodecs support. Export reports unavailable encoders instead of pretending to create a video.

## Data and privacy

No account, backend, upload, analytics, remote fonts or map service is needed. Imported activities stay in memory on the device and are cleared on refresh. The website may be public even when its source repository is private. Do not commit activity files or location/health media. This package contains only source and synthetic test fixtures; `.gitignore` excludes imported GPX/TCX/FIT, generated videos, private directories and test evidence.

Actual Timing preserves nondecreasing recorded timestamps. Same-time position changes are instantaneous disconnected jumps; their pace windows are withheld. Missing/regressing clocks require Uniform Speed explicitly. Nonstandard COROS TCX speed fields are validated against distance/time before conversion. Raw fields are retained. Missing metrics stay missing.

Current route geometry is flat, with recorded elevation available as data. This is recorded replay, not live tracking. No COROS connection, terrain map, private cloud sync or offline caching is included. See `docs/` for metric and export policies.

## Validation

125 unit tests and strict TypeScript/build checks pass. The responsive UI was inspected in the in-app browser; only the active controller panel is exposed, with playback visible and no page overflow at the checked phone sizes. Existing browser scripts navigate the new tabs before exercising controls. Historical native Chrome download limitations are documented in `docs/save-video.md`; simulated picker tests are labelled separately from native downloads.
