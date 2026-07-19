import { generatePresetTargets } from "./shapes.js";
import { sceneGraphToTargets } from "./diagram.js";
import { createMorphMaterial } from "./morph-shader.js";

// Three.js scene + particle morphing. THREE and THREE.OrbitControls come from
// the classic CDN scripts loaded in index.html.
//
// Morphing runs on the GPU (see morph-shader.js): per frame the CPU only
// advances uMix/uScale uniforms. Per-particle CPU passes happen only on
// discrete events: shape switches (beginMorphTo bake) and focus changes
// (focus attribute refill).

let scene, camera, renderer, controls;
let particleGeometry, particleSystem, morphUniforms;

// The original 80000 was too heavy for many machines; 35000 still looks great.
const PARTICLE_COUNT = 35000;

// At scale=1, the model should take up roughly 80% of the screen visually.
const BASE_MODEL_SCALE = 1.75;

// Same exponential chase factor the old CPU loop applied per frame, now used
// for both the morph mix and the scale uniform so the motion feels unchanged.
const MORPH_EASE = 0.08;

const DEFAULT_CAMERA_POS = { x: 0, y: 5, z: 58 };
const FOCUS_VIEW_DIR = { x: 0, y: 0.25, z: 1 }; // normalized at use
const CAMERA_TWEEN_MS = 1400;

// Brightness by hierarchy depth relative to the focused node (Overview acts
// as a virtual root one level above the top-level clusters). Two levels of
// structure render vivid; deeper detail sinks into gray until the user zooms
// toward it. Index = relative depth, last entry applies beyond the array.
const FOCUS_WEIGHT_BY_REL_DEPTH = [1, 1, 1, 0.45, 0.35, 0.28];

let targets = null; // preset arrays + "diagram", filled in initViz/loadDiagram
let diagramColors = null;

// Diagram bookkeeping for focus/navigation, rebuilt on loadDiagram.
let currentGraph = null;
let nodeById = new Map();
let childrenByParent = new Map();
let nodeDepth = new Map();
let diagramNodeRanges = new Map();
let diagramEdgeRanges = [];
let focusedNodeId = null;
let defocusTarget = 0;
let cameraTween = null;
let lastFrameTime = performance.now();

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
  camera.position.set(DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z);

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
  particleGeometry.setAttribute(
    "focus",
    new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT).fill(1), 1)
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
  const leavingFocus = name !== "diagram" && focusedNodeId !== null;
  currentShape = name;
  beginMorphTo(targets[name]);
  if (name === "diagram") {
    particleGeometry.attributes.color.array.set(diagramColors);
    particleGeometry.attributes.color.needsUpdate = true;
    // The diagram always renders with depth-weighted defocus, even at overview.
    applyFocusWeights(focusedNodeId);
    defocusTarget = 1;
  } else {
    if (leavingFocus) {
      focusedNodeId = null;
      startCameraTween(
        new THREE.Vector3(DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z),
        new THREE.Vector3(0, 0, 0)
      );
    }
    particleGeometry.attributes.focus.array.fill(1);
    particleGeometry.attributes.focus.needsUpdate = true;
    defocusTarget = 0;
    fillFlatColor(pickedColor);
  }
  return true;
}

export function setBaseColor(hex) {
  pickedColor = hex;
  if (currentShape !== "diagram") fillFlatColor(hex);
}

export function loadDiagram(graph) {
  const { positions, colors, nodeRanges, edgeRanges } = sceneGraphToTargets(graph, PARTICLE_COUNT);
  targets.diagram = positions;
  diagramColors = colors;
  diagramNodeRanges = nodeRanges;
  diagramEdgeRanges = edgeRanges;

  currentGraph = graph;
  nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  childrenByParent = new Map();
  for (const n of graph.nodes) {
    if (n.parent != null) {
      if (!childrenByParent.has(n.parent)) childrenByParent.set(n.parent, []);
      childrenByParent.get(n.parent).push(n);
    }
  }
  nodeDepth = new Map();
  for (const n of graph.nodes) {
    let depth = 0;
    let current = n;
    while (current.parent != null) {
      depth++;
      current = nodeById.get(current.parent);
    }
    nodeDepth.set(n.id, depth);
  }

  // Regenerating while focused: back to the overview weighting.
  focusedNodeId = null;
  applyFocusWeights(null);
}

function weightForRelDepth(rel) {
  const idx = Math.min(Math.max(rel, 0), FOCUS_WEIGHT_BY_REL_DEPTH.length - 1);
  return FOCUS_WEIGHT_BY_REL_DEPTH[idx];
}

// Fill the per-particle focus attribute for a focus target (null = overview,
// treated as a virtual root so top-level clusters sit at relative depth 1).
// Nodes outside the focused subtree get 0; edges take the dimmer endpoint.
function applyFocusWeights(focusId) {
  const subtree = focusId ? collectSubtree(focusId) : null;
  const focusDepth = focusId ? nodeDepth.get(focusId) : -1;

  const weightOf = (id) => {
    if (subtree && !subtree.has(id)) return 0;
    return weightForRelDepth(nodeDepth.get(id) - focusDepth);
  };

  const focusArr = particleGeometry.attributes.focus.array;
  focusArr.fill(0);
  for (const [id, range] of diagramNodeRanges) {
    focusArr.fill(weightOf(id), range.start, range.start + range.count);
  }
  for (const er of diagramEdgeRanges) {
    const w = Math.min(weightOf(er.from), weightOf(er.to));
    focusArr.fill(w, er.start, er.start + er.count);
  }
  particleGeometry.attributes.focus.needsUpdate = true;
}

function collectSubtree(nodeId) {
  const subtree = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const kids = childrenByParent.get(queue.pop()) || [];
    for (const k of kids) {
      subtree.add(k.id);
      queue.push(k.id);
    }
  }
  return subtree;
}

function startCameraTween(toPos, toTarget) {
  cameraTween = {
    t0: performance.now(),
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos,
    toTarget
  };
}

/**
 * Tween the camera toward a node's cluster and fade everything outside its
 * subtree. Framing distance comes from the subtree's bounding radius so
 * deeper (smaller) nodes get proportionally closer views.
 */
export function focusNode(nodeId) {
  if (currentShape !== "diagram" || !currentGraph) return false;
  const node = nodeById.get(nodeId);
  if (!node) return false;

  const subtree = collectSubtree(nodeId);
  applyFocusWeights(nodeId);
  defocusTarget = 1;

  let radius = node.size;
  for (const id of subtree) {
    const n = nodeById.get(id);
    const d = Math.hypot(
      n.position.x - node.position.x,
      n.position.y - node.position.y,
      n.position.z - node.position.z
    );
    radius = Math.max(radius, d + n.size);
  }

  const scale = morphUniforms.uScale.value;
  particleSystem.updateMatrixWorld();
  const center = particleSystem.localToWorld(
    new THREE.Vector3(node.position.x, node.position.y, node.position.z).multiplyScalar(scale)
  );
  const dist = THREE.MathUtils.clamp(radius * 2.8, 5, 90) * scale;
  const dir = new THREE.Vector3(FOCUS_VIEW_DIR.x, FOCUS_VIEW_DIR.y, FOCUS_VIEW_DIR.z).normalize();
  startCameraTween(center.clone().addScaledVector(dir, dist), center);

  focusedNodeId = nodeId;
  return true;
}

export function clearFocus() {
  focusedNodeId = null;
  // Overview keeps the depth-weighted dimming — deep detail stays subdued
  // until the user zooms toward it.
  applyFocusWeights(null);
  defocusTarget = currentShape === "diagram" ? 1 : 0;
  startCameraTween(
    new THREE.Vector3(DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z),
    new THREE.Vector3(0, 0, 0)
  );
}

export function getFocusedNodeId() {
  return focusedNodeId;
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

  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  gestureScale += (targetGestureScale - gestureScale) * 0.12;
  const actualScale = BASE_MODEL_SCALE * gestureScale;

  // No per-particle CPU work here — scalar uniforms only.
  morphUniforms.uScale.value += (actualScale - morphUniforms.uScale.value) * MORPH_EASE;
  morphUniforms.uMix.value += (1 - morphUniforms.uMix.value) * MORPH_EASE;
  // Defocus fade is wall-clock based so it feels the same at any frame rate.
  morphUniforms.uDefocus.value +=
    (defocusTarget - morphUniforms.uDefocus.value) * Math.min(1, dt * 6);

  if (cameraTween) {
    const t = Math.min(1, (now - cameraTween.t0) / CAMERA_TWEEN_MS);
    const e = t * t * (3 - 2 * t); // smoothstep
    camera.position.lerpVectors(cameraTween.fromPos, cameraTween.toPos, e);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, e);
    if (t >= 1) cameraTween = null;
  }

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
