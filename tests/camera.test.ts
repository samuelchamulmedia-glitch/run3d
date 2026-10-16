import { describe, it, expect } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  synthetic,
  indexActivity,
  evaluate,
  type Track,
  type Point,
  type Settings,
} from "../src/domain/activity";
import {
  cameraPresets,
  defaultCamera,
  normalizeCamera,
  fitDistance,
  type CameraPreset,
} from "../src/simulation/camera";
const base: Settings = {
  duration: 30,
  mode: "actual",
  color: "#fff",
  thickness: 1,
};
const aspects = [9 / 16, 4 / 5, 1, 16 / 9];
function shaped(points: Point[]): Track {
  const a = synthetic();
  a.samples = points.map((_, i) => ({
    ...a.samples[0],
    time: a.samples[0].time! + i * 1000,
  }));
  const track = indexActivity(a);
  const min = [0, 1, 2].map((k) => Math.min(...points.map((p) => p[k]))),
    max = [0, 1, 2].map((k) => Math.max(...points.map((p) => p[k]))),
    center = min.map((v, i) => (v + max[i]) / 2);
  track.fixes.forEach(
    (f, i) => (f.p = points[i].map((v, k) => v - center[k]) as Point),
  );
  track.radius = Math.max(10, ...track.fixes.map((f) => Math.hypot(...f.p)));
  track.bounds = {
    min: min.map((v, i) => v - center[i]) as Point,
    max: max.map((v, i) => v - center[i]) as Point,
  };
  track.length = points.length - 1;
  track.fixes.forEach((f, i) => (f.distance = i));
  return track;
}
const shapes: Record<string, Track> = {
  hairpins: indexActivity(synthetic()),
  line: shaped([
    [0, 0, 0],
    [500, 0, 0],
    [1000, 0, 0],
  ]),
  tiny: shaped([
    [0, 0, 0],
    [0.01, 0, 0.01],
    [0, 0, 0],
  ]),
  tall: shaped([
    [0, 0, 0],
    [5, 800, 2],
    [30, 1000, 40],
  ]),
  loop: shaped([
    [0, 0, 0],
    [100, 0, 0],
    [100, 0, 100],
    [0, 0, 100],
    [0, 0, 0],
  ]),
};
function projection(
  track: Track,
  preset: CameraPreset,
  t: number,
  aspect: number,
  cameraOptions = {},
) {
  const settings = {
    ...base,
    camera: { ...defaultCamera, preset, ...cameraOptions },
  };
  const f = evaluate(track, settings, t, aspect),
    camera = new PerspectiveCamera(f.fov, aspect, f.near, f.far);
  camera.position.set(...f.camera);
  camera.up.set(...f.up);
  camera.lookAt(...f.target);
  camera.updateMatrixWorld(true);
  return { f, camera };
}
function visible(p: Point, camera: PerspectiveCamera) {
  const ndc = new Vector3(...p).project(camera);
  return (
    Math.abs(ndc.x) <= 1.00001 &&
    Math.abs(ndc.y) <= 1.00001 &&
    ndc.z >= -1 &&
    ndc.z <= 1
  );
}
describe.each(cameraPresets)("%s deterministic camera", (preset) => {
  it("matches after reverse-order evaluation and at 24/30/60 preview sampling", () => {
    const track = shapes.hairpins,
      s = { ...base, camera: { ...defaultCamera, preset } };
    const expected = evaluate(track, s, 17.125, 9 / 16);
    for (const fps of [24, 30, 60]) {
      for (let i = fps * 30; i >= 0; i -= 7)
        evaluate(track, s, i / fps, 9 / 16);
      expect(evaluate(track, s, 17.125, 9 / 16)).toEqual(expected);
    }
  });
  it("retains subjects and avoids clipping for all shapes/aspects", () => {
    for (const track of Object.values(shapes))
      for (const aspect of aspects)
        for (let i = 0; i <= 60; i++) {
          const { f, camera } = projection(track, preset, i / 2, aspect);
          expect(
            [...f.camera, ...f.target, ...f.up, f.near, f.far].every(
              Number.isFinite,
            ),
          ).toBe(true);
          expect(f.camera[1]).toBeGreaterThan(track.bounds.max[1]);
          expect(f.near).toBeGreaterThan(0);
          expect(f.far).toBeGreaterThan(f.near);
          if (f.position)
            expect(
              visible(f.position, camera),
              `${preset} subject t=${i / 2} aspect=${aspect}`,
            ).toBe(true);
          if (
            preset === "orbit" ||
            preset === "flyover" ||
            (preset === "showcase" && i === 60)
          )
            for (const fix of track.fixes)
              expect(
                visible(fix.p, camera),
                `${preset} whole route t=${i / 2} aspect=${aspect}`,
              ).toBe(true);
        }
  });
  it("locks camera movement at zero intensity", () => {
    const track = shapes.hairpins,
      s = { ...base, camera: { ...defaultCamera, preset, movement: 0 } };
    const start = evaluate(track, s, 0);
    for (const t of [3, 11, 17, 22, 29, 30]) {
      const f = evaluate(track, s, t);
      expect(f.camera).toEqual(start.camera);
      expect(f.target).toEqual(start.target);
    }
  });
});
it("fits portrait more conservatively than landscape", () =>
  expect(fitDistance(100, 45, 9 / 16)).toBeGreaterThan(
    fitDistance(100, 45, 16 / 9),
  ));
it("clamps malformed controls and unknown presets deterministically", () => {
  const c = normalizeCamera({
    fov: Infinity,
    distance: -10,
    smoothing: 99,
    elevation: 89,
    preset: "orbit",
  });
  expect(c.fov).toBe(defaultCamera.fov);
  expect(c.distance).toBe(1);
  expect(c.smoothing).toBe(2);
  expect(c.elevation).toBe(80);
  expect(normalizeCamera({ preset: "unknown" as CameraPreset }).preset).toBe(
    "orbit",
  );
});
it("top-down uses actual near-vertical elevation and north up", () => {
  const { f } = projection(shapes.loop, "top-down", 7, 1, { elevation: 85 });
  expect(f.up).toEqual([0, 0, -1]);
  const d = f.camera.map((v, i) => v - f.target[i]);
  expect(
    (Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI,
  ).toBeCloseTo(85, 5);
});
it("presets produce distinct camera poses without changing recorded replay", () => {
  const track = shapes.hairpins,
    frames = cameraPresets.map(
      ([preset]) => projection(track, preset, 27, 16 / 9).f,
    );
  expect(
    new Set(frames.map((f) => JSON.stringify([f.camera, f.target, f.up]))).size,
  ).toBe(5);
  for (const f of frames) {
    expect(f.position).toEqual(frames[0].position);
    expect(f.endpoint).toEqual(f.position);
    expect(f.activityTime).toBe(frames[0].activityTime);
  }
});
it("showcase finishes at full-route center and pulls away from follow view", () => {
  const t = shapes.loop;
  const start = projection(t, "showcase", 15, 1).f,
    end = projection(t, "showcase", 30, 1).f;
  expect(end.target).toEqual([0, 0, 0]);
  expect(Math.hypot(...end.camera)).toBeGreaterThan(
    Math.hypot(...start.camera.map((v, i) => v - start.target[i])),
  );
});
it("honors smoothing and rotation without depending on mutable history", () => {
  const t = shapes.loop,
    a = projection(t, "follow", 7.5, 1, { smoothing: 0 }).f,
    b = projection(t, "follow", 7.5, 1, { smoothing: 2 }).f,
    c = projection(t, "follow", 7.5, 1, { smoothing: 0, rotation: 90 }).f;
  expect(a.target).not.toEqual(b.target);
  expect(a.camera).not.toEqual(c.camera);
  expect(a.position).toEqual(b.position);
});
it("never creates a subject or reveal endpoint in GPS gaps", () => {
  for (const [preset] of cameraPresets) {
    const f = projection(shapes.hairpins, preset, 18, 1).f;
    expect(f.position).toBeNull();
    expect(f.endpoint).toBeNull();
  }
});
it.each([
  ["distance", 2, "orbit"],
  ["elevation", 60, "orbit"],
  ["orbit", 1.2, "orbit"],
  ["rotation", 90, "orbit"],
  ["fov", 65, "orbit"],
  ["movement", 0.5, "orbit"],
  ["followDistance", 2, "follow"],
  ["smoothing", 2, "follow"],
] as const)(
  "%s changes the camera while preserving recorded position",
  (control, value, preset) => {
    const track = shapes.hairpins,
      a = projection(track, preset, 8, 1).f,
      b = projection(track, preset, 8, 1, { [control]: value }).f;
    expect([b.camera, b.target, b.fov]).not.toEqual([
      a.camera,
      a.target,
      a.fov,
    ]);
    expect(b.position).toEqual(a.position);
  },
);
it.each(cameraPresets)(
  "%s transitions through tight turns, stops and gaps without camera teleports",
  (preset) => {
    const track = shapes.hairpins;
    let previous = projection(track, preset, 0, 16 / 9).f.camera,
      maxStep = 0;
    for (let i = 1; i <= 900; i++) {
      const p = projection(track, preset, i / 30, 16 / 9).f.camera;
      maxStep = Math.max(
        maxStep,
        Math.hypot(...p.map((v, k) => v - previous[k])),
      );
      previous = p;
    }
    expect(maxStep).toBeLessThan(track.radius * 0.5);
  },
);
it("retains deterministic gap widening when only Uniform Speed is available", () => {
  const activity = synthetic();
  activity.samples.forEach((s) => (s.time = null));
  const track = indexActivity(activity),
    settings = {
      ...base,
      mode: "uniform" as const,
      camera: { ...defaultCamera, preset: "follow" as const },
    };
  expect(track.gaps.length).toBeGreaterThan(0);
  const distance = track.gaps[0].distance,
    t = (distance / track.length) * settings.duration;
  const f = evaluate(track, settings, t);
  expect(f.target.every(Number.isFinite)).toBe(true);
  expect(evaluate(track, settings, t)).toEqual(f);
});
