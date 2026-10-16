import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { getStyle, scaledLineWidth } from "./styles";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  evaluate,
  type Track,
  type Settings,
  type Frame,
} from "../domain/activity";
export function createScene(
  canvas: HTMLCanvasElement,
  track: Track,
  width: number,
  height: number,
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(1);
  const scene = new T.Scene();
  scene.background = new T.Color("#090d14");
  const camera = new T.PerspectiveCamera(
    45,
    width / height,
    Math.max(0.01, track.radius / 1000),
    track.radius * 30,
  );
  const offsets: number[] = [];
  const vertices: T.Vector3[] = [];
  track.fixes.forEach((f, i) => {
    if (
      i &&
      f.segment === track.fixes[i - 1].segment &&
      f.p.some(
        (v, k) => Math.fround(v) !== Math.fround(track.fixes[i - 1].p[k]),
      )
    )
      vertices.push(
        new T.Vector3(...track.fixes[i - 1].p),
        new T.Vector3(...f.p),
      );
    offsets[i] = vertices.length;
  });
  const data = vertices.flatMap((p) => p.toArray());
  const full = new LineSegmentsGeometry().setPositions(
    data.length ? data : [0, 0, 0, 0, 0, 0],
  );
  const reveal = full.clone();
  const makeMaterial = (opacity = 1) =>
    new LineMaterial({
      color: "#73f5c4",
      linewidth: 4,
      worldUnits: false,
      transparent: opacity < 1,
      opacity,
      depthWrite: false,
      alphaToCoverage: true,
    });
  const baseMaterial = makeMaterial(0.4),
    material = makeMaterial();
  const base = new LineSegments2(full, baseMaterial),
    line = new LineSegments2(reveal, material);
  scene.add(base, line);
  const tipGeometry = new LineSegmentsGeometry().setPositions([
    0, 0, 0, 0, 0, 0,
  ]);
  const tip = new LineSegments2(tipGeometry, material);
  scene.add(tip);
  const halos = [1.8, 3.4, 5.5].map((factor, i) => {
    const m = makeMaterial([0.14, 0.06, 0.025][i]);
    m.blending = T.AdditiveBlending;
    m.alphaToCoverage = false;
    const route = new LineSegments2(reveal, m),
      end = new LineSegments2(tipGeometry, m);
    scene.add(route, end);
    return { factor, material: m, route, end };
  });
  const grid = new T.GridHelper(track.radius * 3, 20, "#2a6374", "#1c3545");
  grid.position.y = -track.radius * 0.035;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.material.depthWrite = false;
  scene.add(grid);
  const marker = new T.Mesh(
    new T.SphereGeometry(track.radius * 0.018, 16, 12),
    new T.MeshBasicMaterial({ color: "#ffffff" }),
  );
  scene.add(marker);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = false;
  controls.minDistance = track.radius * 0.2;
  controls.maxDistance = track.radius * 12;
  let viewWidth = width,
    viewHeight = height;
  let lost = false,
    inspection = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);
  function render(t: number, s: Settings): Frame {
    if (lost) throw Error("WebGL context lost. Reload to restore the scene.");
    const state = evaluate(track, s, t, camera.aspect);
    const style = getStyle(s.style),
      width = scaledLineWidth(s.lineWidth, viewWidth, viewHeight);
    (scene.background as T.Color).set(s.backgroundColor ?? style.background);
    grid.visible = style.grid;
    full.instanceCount = vertices.length / 2;
    reveal.instanceCount =
      s.reveal === false ? vertices.length / 2 : offsets[state.index] / 2;
    baseMaterial.color.set(style.ghost);
    baseMaterial.linewidth = Math.max(0.5, width * 0.45);
    material.color.set(s.color);
    material.linewidth = width;
    marker.material.color.set(s.markerColor ?? style.marker);
    for (const halo of halos) {
      halo.material.color.set(s.color);
      halo.material.linewidth = width * halo.factor;
      halo.material.opacity =
        style.glow * [0.14, 0.06, 0.025][halos.indexOf(halo)];
      halo.route.visible = style.glow > 0;
    }
    tip.visible =
      s.reveal !== false &&
      state.endpoint !== null &&
      state.index < track.fixes.length - 1 &&
      track.fixes[state.index].segment ===
        track.fixes[state.index + 1].segment &&
      state.endpoint.some(
        (v, k) => Math.fround(v) !== Math.fround(track.fixes[state.index].p[k]),
      );
    if (tip.visible && state.endpoint) {
      const start = tipGeometry.attributes.instanceStart,
        end = tipGeometry.attributes.instanceEnd;
      start.setXYZ(0, ...track.fixes[state.index].p);
      end.setXYZ(0, ...state.endpoint);
      start.needsUpdate = true;
      end.needsUpdate = true;
      tipGeometry.computeBoundingSphere();
    }
    for (const halo of halos) halo.end.visible = style.glow > 0 && tip.visible;
    marker.visible = s.marker !== false && state.position !== null;
    if (state.position) marker.position.set(...state.position);
    const markerSize = s.markerSize ?? s.thickness;
    marker.scale.setScalar(
      Number.isFinite(markerSize) ? Math.max(0.25, Math.min(4, markerSize)) : 1,
    );
    if (!inspection) {
      camera.position.set(...state.camera);
      camera.up.set(...state.up);
      camera.fov = state.fov;
      camera.near = state.near;
      camera.far = state.far;
      camera.updateProjectionMatrix();
      camera.lookAt(...state.target);
      controls.target.set(...state.target);
    } else controls.update();
    renderer.render(scene, camera);
    return state;
  }
  return {
    render,
    renderer,
    camera,
    scene,
    marker,
    tip,
    line,
    halos,
    grid,
    setInspection(value: boolean) {
      inspection = value;
      controls.enabled = value;
    },
    resize(w: number, h: number) {
      viewWidth = w;
      viewHeight = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    dispose(releaseContext = false) {
      canvas.removeEventListener("webglcontextlost", onLost);
      controls.dispose();
      full.dispose();
      reveal.dispose();
      tipGeometry.dispose();
      baseMaterial.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      for (const halo of halos) halo.material.dispose();
      material.dispose();
      marker.geometry.dispose();
      marker.material.dispose();
      renderer.dispose();
      if (releaseContext) renderer.forceContextLoss();
    },
  };
}
