import { generatePresetTargets } from "./shapes.js";
import { sceneGraphToTargets } from "./diagram.js";
import { createMorphMaterial } from "./morph-shader.js";

// Three.js scene + particle morphing. THREE and THREE.OrbitControls come from
// the classic CDN scripts loaded in index.html.
//
// Morphing runs on the GPU (see morph-shader.js): per frame the CPU only
// advances uMix/uScale uniforms. The one remaining per-particle CPU pass is
// beginMorphTo(), which runs once per shape *switch* to bake the in-flight
// interpolated position into the start attribute before retargeting.

let scene, camera, renderer, controls;
let particleGeometry, particleSystem, morphUniforms;

// The original 80000 was too heavy for many machines; 35000 still looks great.
const PARTICLE_COUNT = 35000;

// At scale=1, the model should take up roughly 80% of the screen visually.
const BASE_MODEL_SCALE = 1.75;

// Same exponential chase factor the old CPU loop applied per frame, now used
// for both the morph mix and the scale uniform so the motion feels unchanged.
const MORPH_EASE = 0.08;

let targets = null; // preset arrays + "diagram", filled in initViz/loadDiagram
let diagramColors = null;

let currentShape = "tree";
let pickedColor = "#00ffcc";
let gestureScale = 1.0;
let targetGestureScale = 1.0;
let targetRotationX = 0;
let targetRotationY = 0;

function fillFlatColor(hex) {
  const c = new THREE.Color(hex);
  const arr = particleGeometry.attributes.color.array;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    arr[i3] = c.r;
    arr[i3 + 1] = c.g;
    arr[i3 + 2] = c.b;
  }
  particleGeometry.attributes.color.needsUpdate = true;
}

export function initViz(container, initialColorHex) {
  if (initialColorHex) pickedColor = initialColorHex;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050505, 0.012);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 58);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  targets = generatePresetTargets(PARTICLE_COUNT);
  targets.diagram = null;

  particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(targets.tree), 3)
  );
  particleGeometry.setAttribute(
    "targetPosition",
    new THREE.BufferAttribute(new Float32Array(targets.tree), 3)
  );
  particleGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3)
  );
  fillFlatColor(pickedColor);

  const material = createMorphMaterial({ size: 0.34, opacity: 0.95, fog: true });
  morphUniforms = material.uniforms;
  morphUniforms.uScale.value = BASE_MODEL_SCALE;

  particleSystem = new THREE.Points(particleGeometry, material);
  // Morph inputs are unscaled model-space; a bounding sphere from the raw
  // position attribute would mis-cull, and the cloud fills the view anyway.
  particleSystem.frustumCulled = false;
  scene.add(particleSystem);

  updatePointScale();
  window.addEventListener("resize", onWindowResize);
  animate();
}

function updatePointScale() {
  // drawingBufferHeight already includes pixelRatio, matching PointsMaterial's
  // size * pixelRatio * (0.5 * cssHeight / -z) attenuation.
  morphUniforms.uPointScale.value = renderer.domElement.height * 0.5;
}

// Bake the currently displayed (interpolated) positions into the start
// attribute, then retarget and restart the mix. O(n), but only on switches.
function beginMorphTo(targetArray) {
  const start = particleGeometry.attributes.position;
  const target = particleGeometry.attributes.targetPosition;
  const mixNow = morphUniforms.uMix.value;
  const s = start.array;
  const t = target.array;
  for (let i = 0; i < s.length; i++) {
    s[i] += (t[i] - s[i]) * mixNow;
  }
  t.set(targetArray);
  morphUniforms.uMix.value = 0;
  start.needsUpdate = true;
  target.needsUpdate = true;
}

export function setShape(name) {
  if (!(name in targets) || !targets[name]) return false;
  currentShape = name;
  beginMorphTo(targets[name]);
  if (name === "diagram") {
    particleGeometry.attributes.color.array.set(diagramColors);
    particleGeometry.attributes.color.needsUpdate = true;
  } else {
    fillFlatColor(pickedColor);
  }
  return true;
}

export function setBaseColor(hex) {
  pickedColor = hex;
  if (currentShape !== "diagram") fillFlatColor(hex);
}

export function loadDiagram(graph) {
  const { positions, colors } = sceneGraphToTargets(graph, PARTICLE_COUNT);
  targets.diagram = positions;
  diagramColors = colors;
}

export function setRotationTarget(x, y) {
  targetRotationX = x;
  targetRotationY = y;
}

export function setScaleTarget(scale) {
  targetGestureScale = scale;
}

function animate() {
  requestAnimationFrame(animate);

  if (!particleSystem || !particleGeometry) return;

  gestureScale += (targetGestureScale - gestureScale) * 0.12;
  const actualScale = BASE_MODEL_SCALE * gestureScale;

  // No per-particle CPU work here anymore — just three scalar uniforms.
  morphUniforms.uScale.value += (actualScale - morphUniforms.uScale.value) * MORPH_EASE;
  morphUniforms.uMix.value += (1 - morphUniforms.uMix.value) * MORPH_EASE;

  particleSystem.rotation.y += (targetRotationY - particleSystem.rotation.y) * 0.05;
  particleSystem.rotation.x += (targetRotationX - particleSystem.rotation.x) * 0.05;

  controls.update();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updatePointScale();
}
