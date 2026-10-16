import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { saveVideoFile, type VideoSavePicker } from "../src/export/save";
beforeEach(() => vi.stubGlobal("window", {}));
afterEach(() => vi.unstubAllGlobals());
const video = new Blob(["test-video"], { type: "video/mp4" });
function fixture(extension: "mp4" | "webm" = "mp4") {
  const stream = {
    write: vi.fn(async (_data: Blob) => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const createWritable = vi.fn(async () => stream);
  const picker = vi.fn(async () => ({ createWritable }));
  return {
    stream,
    picker,
    createWritable,
    save: () => saveVideoFile(video, extension, picker),
  };
}
it("opens the picker synchronously in the initiating click and closes only after writing the exact blob", async () => {
  const f = fixture();
  const saving = f.save();
  expect(f.picker).toHaveBeenCalledOnce();
  expect(f.stream.write).not.toHaveBeenCalled();
  await expect(saving).resolves.toBe("saved");
  expect(f.stream.write).toHaveBeenCalledWith(video);
  expect(f.stream.close).toHaveBeenCalledOnce();
  expect(f.stream.abort).not.toHaveBeenCalled();
  expect(f.stream.write.mock.invocationCallOrder[0]).toBeLessThan(
    f.stream.close.mock.invocationCallOrder[0],
  );
});
it("offers matching MP4/WebM names and MIME types", async () => {
  for (const extension of ["mp4", "webm"] as const) {
    const f = fixture(extension);
    await f.save();
    expect(f.picker.mock.calls[0]).toEqual([
      {
        suggestedName: `runmotion.${extension}`,
        types: [
          {
            description: "RunMotion video",
            accept: { [`video/${extension}`]: [`.${extension}`] },
          },
        ],
      },
    ]);
  }
});
it("treats picker cancellation as cancellation without a second download", async () => {
  const picker: VideoSavePicker = vi.fn(async () => {
    throw new DOMException("User cancelled", "AbortError");
  });
  await expect(saveVideoFile(video, "mp4", picker)).resolves.toBe("cancelled");
  expect(picker).toHaveBeenCalledOnce();
});
it("reports unavailable picker without claiming the file was saved", async () => {
  await expect(saveVideoFile(video, "mp4")).resolves.toBe("unsupported");
});
it("propagates denied permission without triggering an alternative download", async () => {
  const error = new DOMException("Denied", "NotAllowedError");
  await expect(
    saveVideoFile(video, "mp4", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
});
it("aborts a failed write and does not close or claim success", async () => {
  const f = fixture(),
    error = Error("Disk full");
  f.stream.write.mockRejectedValueOnce(error);
  await expect(f.save()).rejects.toBe(error);
  expect(f.stream.abort).toHaveBeenCalledOnce();
  expect(f.stream.close).not.toHaveBeenCalled();
});
it("handles finalization failure and preserves the original error if abort also fails", async () => {
  const f = fixture(),
    error = Error("Close failed");
  f.stream.close.mockRejectedValueOnce(error);
  f.stream.abort.mockRejectedValueOnce(Error("Already closed"));
  await expect(f.save()).rejects.toBe(error);
  expect(f.stream.abort).toHaveBeenCalledOnce();
});
