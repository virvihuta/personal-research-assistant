import { generatePresetTargets } from "./shapes.js";
import { createMorphMaterial } from "./morph-shader.js";

// Frame-cost benchmark for the Milestone 2 migration: the pre-migration CPU
// per-frame lerp loop vs the GPU vertex-shader morph, at increasing particle
// counts. Results feed docs/benchmarks.md.
//
// Methodology notes:
// - Frames are driven by a MessageChannel self-ping loop, not
//   requestAnimationFrame, so results are vsync-independent (rAF would cap
//   both modes at the display rate and hide the difference at low counts —
//   and background/embedded pages throttle rAF entirely).
// - Each frame ends with a 1x1 gl.readPixels, forcing the GPU pipeline to
//   drain so "total" includes GPU completion, not just command submission.
//   This serializes CPU/GPU work, so derived FPS is a conservative bound —
//   comparable across modes, slightly below what vsync'd rendering achieves.
// - "morph" isolates the per-frame morph update itself: the full-array lerp
//   in CPU mode vs three uniform writes in GPU mode.

const COUNTS = [35000, 150000, 500000, 1000000];
const MODES = ["cpu", "gpu"];
const WARMUP_FRAMES = 20;
const MEASURE_FRAMES = 150;
const RETARGET_EVERY = 90; // keep a morph in flight, including GPU-mode bakes

const SCALE = 1.75;
const EASE = 0.08;
const COLOR = "#00ffcc";

const statusEl = document.getElementById("status");
const tbody = document.querySelector("#results tbody");
const rawEl = document.getElementById("raw");
const envEl = document.getElementById("env");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(960, 540, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
document.getElementById("canvas-holder").appendChild(renderer.domElement);
const gl = renderer.getContext();
const pixelBuf = new Uint8Array(4);

const camera = new THREE.PerspectiveCamera(60, 960 / 540, 0.1, 1000);
camera.position.set(0, 5, 58);

// Unthrottled frame scheduler (see methodology note above).
const channel = new MessageChannel();
let pumpFn = null;
channel.port1.onmessage = () => { if (pumpFn) pumpFn(); };
const nextFrame = (fn) => { pumpFn = fn; channel.port2.postMessage(0); };

const targetsCache = new Map();
function targetsFor(count) {
  if (!targetsCache.has(count)) targetsCache.set(count, generatePresetTargets(count));
  return targetsCache.get(count);
}

function flatColorArray(count) {
  const c = new THREE.Color(COLOR);
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    arr[i3] = c.r;
    arr[i3 + 1] = c.g;
    arr[i3 + 2] = c.b;
  }
  return arr;
}

// Pre-migration implementation: per-frame lerp over the full position array,
// re-uploaded every frame via needsUpdate.
function buildCpuRun(count) {
  const targets = targetsFor(count);
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(targets.tree), 3));
  const material = new THREE.PointsMaterial({
    size: 0.34,
    color: new THREE.Color(COLOR),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  let current = "tree";
  return {
    scene,
    retarget() { current = current === "tree" ? "saturn" : "tree"; },
    tick() {
      const pos = geometry.attributes.position.array;
      const t = targets[current];
      for (let i = 0; i < pos.length; i++) {
        pos[i] += (t[i] * SCALE - pos[i]) * EASE;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    dispose() { geometry.dispose(); material.dispose(); }
  };
}

// Post-migration implementation: mix factor advances on a uniform; the only
// per-particle CPU pass is the bake on retarget.
function buildGpuRun(count) {
  const targets = targetsFor(count);
  const scene = new THREE.Scene();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(targets.tree), 3));
  geometry.setAttribute("targetPosition", new THREE.BufferAttribute(new Float32Array(targets.tree), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(flatColorArray(count), 3));
  const material = createMorphMaterial({ size: 0.34, opacity: 0.95, fog: false });
  const uniforms = material.uniforms;
  uniforms.uScale.value = SCALE;
  uniforms.uPointScale.value = renderer.domElement.height * 0.5;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  let current = "tree";
  return {
    scene,
    retarget() {
      current = current === "tree" ? "saturn" : "tree";
      const start = geometry.attributes.position;
      const target = geometry.attributes.targetPosition;
      const mixNow = uniforms.uMix.value;
      const s = start.array;
      const t = target.array;
      for (let i = 0; i < s.length; i++) s[i] += (t[i] - s[i]) * mixNow;
      t.set(targets[current]);
      uniforms.uMix.value = 0;
      start.needsUpdate = true;
      target.needsUpdate = true;
    },
    tick() {
      uniforms.uMix.value += (1 - uniforms.uMix.value) * EASE;
    },
    dispose() { geometry.dispose(); material.dispose(); }
  };
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function runConfig(count, mode) {
  return new Promise((resolve) => {
    const run = mode === "cpu" ? buildCpuRun(count) : buildGpuRun(count);
    const morphMs = [];
    const totalMs = [];
    let frame = 0;

    function step() {
      const t0 = performance.now();
      if (frame > 0 && frame % RETARGET_EVERY === 0) run.retarget();
      run.tick();
      const t1 = performance.now();
      renderer.render(run.scene, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuf); // drain GPU
      const t2 = performance.now();

      if (frame >= WARMUP_FRAMES) {
        morphMs.push(t1 - t0);
        totalMs.push(t2 - t0);
      }
      frame++;

      if (frame < WARMUP_FRAMES + MEASURE_FRAMES) {
        nextFrame(step);
      } else {
        run.dispose();
        morphMs.sort((a, b) => a - b);
        totalMs.sort((a, b) => a - b);
        const medianTotal = percentile(totalMs, 0.5);
        resolve({
          count,
          mode,
          morphMsMedian: +percentile(morphMs, 0.5).toFixed(3),
          totalMsMedian: +medianTotal.toFixed(2),
          totalMsP95: +percentile(totalMs, 0.95).toFixed(2),
          maxFps: +(1000 / medianTotal).toFixed(1)
        });
      }
    }
    nextFrame(step);
  });
}

function addRow(r) {
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td>${r.count.toLocaleString()}</td><td>${r.mode}</td>` +
    `<td>${r.morphMsMedian}</td><td>${r.totalMsMedian}</td>` +
    `<td>${r.totalMsP95}</td><td>${r.maxFps}</td>`;
  tbody.appendChild(tr);
}

function describeEnv() {
  let gpu = "unknown";
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  if (info) gpu = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  return {
    gpu,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    cores: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
    visibility: document.visibilityState
  };
}

async function main() {
  const env = describeEnv();
  envEl.textContent = `GPU: ${env.gpu} · pixelRatio ${env.pixelRatio} · ${env.cores} cores · page ${env.visibility}`;

  const results = [];
  for (const count of COUNTS) {
    for (const mode of MODES) {
      statusEl.textContent = `Running ${mode} @ ${count.toLocaleString()} particles…`;
      const r = await runConfig(count, mode);
      results.push(r);
      addRow(r);
    }
  }

  statusEl.textContent = "BENCHMARK COMPLETE";
  const payload = { env, results, completedAt: new Date().toISOString() };
  rawEl.textContent = JSON.stringify(payload);
  window.__praBench = payload;
  console.log("PRA_BENCH " + JSON.stringify(payload));
}

main();
