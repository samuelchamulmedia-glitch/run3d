# Saving exported videos

After Export video finishes, click **Save video...** to choose a destination in browsers that support the File System Access API (for example, current desktop Chrome/Edge in a secure context). The picker opens directly from the click. Success appears only after write and close succeed. Cancel keeps the ready video available for retry. Failed writes are aborted, reported, and never silently treated as a saved file. No alternative download is automatically started after cancellation or a denied permission.

The existing Download .mp4/.webm link remains available for other browsers. Its success cannot be detected reliably by the page. No tokens, uploads, or server-side storage are introduced.

Changing activity/settings discards the old export link; ongoing exports are cancelled rather than exposing an out-of-date result. A new export clears the previous ready result.

## Windows diagnostics and tests

`node scripts/diagnose-download.mjs` tests synthetic text/blob/HTTP downloads independently of RunMotion. It writes its report under evidence/download-diagnosis. On the Codex test host, all three native downloads were cancelled, including the plain text file. That isolates the observed transport problem from the video encoder; it does not establish a specific browser policy as the cause.

`pnpm test` includes seven save-helper regression tests. Browser/social suites keep their native-download test by default and fail explicitly if Chrome cancels it. To test the Save video handler separately in headless environments, set RUNMOTION_TEST_SAVE_PICKER=1 before running them. Reports then identify saveTestMode as picker-contract.

```powershell
$env:RUNMOTION_TEST_SAVE_PICKER='1'
pnpm test:browser
pnpm test:social
Remove-Item Env:RUNMOTION_TEST_SAVE_PICKER
```

Picker-contract mode simulates the OS picker, verifies cancellation/error/retry in the UI, saves the exact bytes written by the production handler, and decodes the resulting video. It is NOT a passing native browser download, native OS picker interaction, or real permission grant. Verify the native Save video picker interactively before claiming full device support.

The social reporter now runs on Windows/Linux using os.version(); only macOS uses sw_vers. Existing video encoding/resolution/camera behavior is unchanged.
