import { normalizeOverlay, type OverlaySettings } from "../domain/metrics";
import { applyStyle, type VisualStyle } from "../render/styles";
import {
  defaultCamera,
  normalizeCamera,
  type CameraSettings,
} from "../simulation/camera";
import { create } from "zustand";
import {
  synthetic,
  indexActivity,
  type Track,
  type Settings,
} from "../domain/activity";
interface Editor {
  track: Track;
  settings: Settings;
  time: number;
  playing: boolean;
  inspect: boolean;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setInspect: (inspect: boolean) => void;
  setSettings: (settings: Partial<Settings>) => void;
  setTrack: (track: Track) => void;
  setCamera: (camera: Partial<CameraSettings>) => void;
  setStyle: (style: VisualStyle) => void;
  setVisual: (visual: Partial<Settings>) => void;
  setOverlay: (overlay: Partial<OverlaySettings>) => void;
}
export const useEditor = create<Editor>((set) => ({
  track: indexActivity(synthetic()),
  settings: {
    duration: 30,
    endHold: 2,
    mode: "actual",
    color: "#73f5c4",
    thickness: 1,
    lineWidth: 4,
    style: "neon",
    overlay: normalizeOverlay(),
    camera: { ...defaultCamera },
  },
  time: 0,
  playing: false,
  inspect: false,
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing, inspect: false }),
  setInspect: (inspect) => set({ inspect, playing: false }),
  setSettings: (settings) =>
    set((s) => ({
      settings: { ...s.settings, ...settings },
      time: 0,
      playing: false,
    })),
  setCamera: (camera) =>
    set((s) => ({
      settings: {
        ...s.settings,
        camera: normalizeCamera({ ...s.settings.camera, ...camera }),
      },
      inspect: false,
      playing: false,
    })),
  setOverlay: (overlay) =>
    set((s) => ({
      settings: {
        ...s.settings,
        overlay: normalizeOverlay({ ...s.settings.overlay, ...overlay }),
      },
    })),
  setStyle: (style) =>
    set((s) => ({ settings: applyStyle(s.settings, style) })),
  setVisual: (visual) =>
    set((s) => ({ settings: { ...s.settings, ...visual } })),
  setTrack: (track) => set({ track, time: 0, playing: false, inspect: false }),
}));
