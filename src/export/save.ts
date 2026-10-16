export type VideoExtension = "mp4" | "webm";
interface WritableVideo {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
export type VideoSavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableVideo> }>;

export function videoSavePicker(): VideoSavePicker | undefined {
  const host = window as Window & { showSaveFilePicker?: VideoSavePicker };
  return host.showSaveFilePicker?.bind(host);
}

// Call directly from a click handler: the picker requires user activation.
// A denied/cancelled picker never triggers a second download automatically.
export async function saveVideoFile(
  blob: Blob,
  extension: VideoExtension,
  picker: VideoSavePicker | undefined = videoSavePicker(),
): Promise<"saved" | "cancelled" | "unsupported"> {
  if (!picker) return "unsupported";
  let writable: WritableVideo | undefined;
  try {
    const handle = await picker({
      suggestedName: `runmotion.${extension}`,
      types: [
        {
          description: "RunMotion video",
          accept: {
            [extension === "mp4" ? "video/mp4" : "video/webm"]: [
              `.${extension}`,
            ],
          },
        },
      ],
    });
    writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch (error) {
    if (writable) await writable.abort().catch(() => {});
    if (error instanceof DOMException && error.name === "AbortError")
      return "cancelled";
    throw error;
  }
}
