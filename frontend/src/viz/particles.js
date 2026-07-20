import { generatePresetTargets } from "./shapes.js";
import { sceneGraphToTargets } from "./diagram.js";
import { createMorphMaterial } from "./morph-shader.js";

// Three.js scene + particle morphing. THREE and THREE.OrbitControls come from
// the classic CDN scripts loaded in index.html.
//
// Morphing runs on the GPU (see morph-shader.js): per frame the CPU only
// advances uniforms. Per-particle CPU passes happen only on discrete events:
// shape switches (beginMorphTo bake), focus changes (focus attribute refill),
// and hover changes (highlight attribute refill).
//
// Gestures drive the CAMERA, not the mesh: pinch-drag orbits around the
// OrbitControls target with accumulated deltas, fist zooms by dollying the
// camera distance. The old absolute-hand-position mesh rotation/scale paths
// are gone.

let scene, camera, renderer, controls;
let particleGeometry, particleSystem, morphUniforms;

// The original 80000 was too heavy for many machines; 35000 still looks great.
const PARTICLE_COUNT = 35000;

// At scale=1, the model should take up roughly 80% of the screen visually.
const BASE_MODEL_SCALE = 1.75;

// Exponential chase factor for the morph mix, matching the original CPU loop.
const MORPH_EASE = 0.08;

const DEFAULT_CAMERA_POS = { x: 0, y: 5, z: 58 };
const FOCUS_VIEW_DIR = { x: 0, y: 0.25, z: 1 }; // normalized at use
const CAMERA_TWEEN_MS = 1400;
const MIN_CAMERA_DISTANCE = 6;
const MAX_CAMERA_DISTANCE = 220;
const MIN_POLAR_ANGLE = 0.05; // keep orbit off the exact poles

// Brightness by hierarchy depth relative to the focused node (Overview acts
// as a virtual root one level above the top-level clusters). Two levels of
// structure render vivid; deeper detail sinks into gray until the user zooms
// toward it. Index = relative depth, last entry applies beyond the array.
const FOCUS_WEIGHT_BY_REL_DEPTH = [1, 1, 1, 0.45, 0.35, 0.28];

let targets = null; // preset arrays + "diagram", filled in initViz/loadDiagram
let diagramColors = null;

// Diagram bookkeeping for focus/hover/navigation, rebuilt on loadDiagram.
let currentGraph = null;
let nodeById = new Map();
let childrenByParent = new Map();
let nodeDepth = new Map();
let nodeWeights = new Map();
let diagramNodeRanges = new Map();
let diagramEdgeRanges = [];
let focusedNodeId = null;
let hoveredNodeId = null;
let defocusTarget = 0;
let cameraTween = null;
let zoomEngageDistance = null;
let zoomTargetDistance = null;
let frameCallback = null;
let lastFrameTime = performance.now();

let currentShape = "tree";
let pickedColor = "#00ffcc";

// Scratch objects reused every frame to avoid GC churn.
const _vec = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _spherical = new THREE.Spherical();

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
  particleGeometry.setAttribute(
    "highlight",
    new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT), 1)
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
  setHoveredNode(null);
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

  // Regenerating while focused/hovered: back to a clean overview state.
  focusedNodeId = null;
  setHoveredNode(null);
  applyFocusWeights(null);
}

function weightForRelDepth(rel) {
  const idx = Math.min(Math.max(rel, 0), FOCUS_WEIGHT_BY_REL_DEPTH.length - 1);
  return FOCUS_WEIGHT_BY_REL_DEPTH[idx];
}

// Fill the per-particle focus attribute for a focus target (null = overview,
// treated as a virtual root so top-level clusters sit at relative depth 1).
// Nodes outside the focused subtree get 0; edges take the dimmer endpoint.
// Also caches per-node weights for the overlay and hover candidate logic.
function applyFocusWeights(focusId) {
  if (!currentGraph) return;
  const subtree = focusId ? collectSubtree(focusId) : null;
  const focusDepth = focusId ? nodeDepth.get(focusId) : -1;

  const weightOf = (id) => {
    if (subtree && !subtree.has(id)) return 0;
    return weightForRelDepth(nodeDepth.get(id) - focusDepth);
  };

  nodeWeights = new Map();
  for (const n of currentGraph.nodes) nodeWeights.set(n.id, weightOf(n.id));

  const focusArr = particleGeometry.attributes.focus.array;
  focusArr.fill(0);
  for (const [id, range] of diagramNodeRanges) {
    focusArr.fill(nodeWeights.get(id) ?? 0, range.start, range.start + range.count);
  }
  for (const er of diagramEdgeRanges) {
    const w = Math.min(nodeWeights.get(er.from) ?? 0, nodeWeights.get(er.to) ?? 0);
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
  zoomEngageDistance = null;
  zoomTargetDistance = null;
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

// Hover preview: brightness/size bump on the node's particles (its whole
// subtree, since parents render as their children). Distinct from focus.
export function setHoveredNode(nodeId) {
  if (nodeId === hoveredNodeId) return;
  hoveredNodeId = nodeId;
  const arr = particleGeometry.attributes.highlight.array;
  arr.fill(0);
  if (nodeId && currentShape === "diagram" && currentGraph) {
    for (const id of collectSubtree(nodeId)) {
      const range = diagramNodeRanges.get(id);
      if (range) arr.fill(1, range.start, range.start + range.count);
    }
  }
  particleGeometry.attributes.highlight.needsUpdate = true;
}

// --- Gesture-driven camera --------------------------------------------------

// Accumulate a pinch-drag delta into the camera's orbit around the current
// controls target. Called with deltas only — never absolute positions.
export function orbitCameraBy(deltaTheta, deltaPhi) {
  cameraTween = null;
  zoomEngageDistance = null;
  zoomTargetDistance = null;
  _offset.copy(camera.position).sub(controls.target);
  _spherical.setFromVector3(_offset);
  _spherical.theta += deltaTheta;
  _spherical.phi = THREE.MathUtils.clamp(
    _spherical.phi + deltaPhi,
    MIN_POLAR_ANGLE,
    Math.PI - MIN_POLAR_ANGLE
  );
  _offset.setFromSpherical(_spherical);
  camera.position.copy(controls.target).add(_offset);
}

// Accumulate a gather-drag delta into a strictly horizontal pan: camera and
// orbit target translate together along the camera's right vector, scaled by
// the current distance so the pan feels consistent at any zoom level.
export function panCameraBy(delta) {
  cameraTween = null;
  zoomEngageDistance = null;
  zoomTargetDistance = null;
  const dist = camera.position.distanceTo(controls.target);
  _vec.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(delta * dist);
  camera.position.add(_vec);
  controls.target.add(_vec);
}

// Fist zoom: capture the camera distance at engagement, then dolly by the
// palm-scale ratio relative to that moment (clutched — re-fisting holds).
export function beginZoom() {
  cameraTween = null;
  zoomEngageDistance = camera.position.distanceTo(controls.target);
  zoomTargetDistance = null;
}

export function setZoomRatio(ratio) {
  if (zoomEngageDistance === null) beginZoom();
  zoomTargetDistance = THREE.MathUtils.clamp(
    zoomEngageDistance / Math.max(ratio, 0.01),
    MIN_CAMERA_DISTANCE,
    MAX_CAMERA_DISTANCE
  );
}

// Direct distance target — debug/testing path for webcam-less environments.
export function setZoomDistance(distance) {
  cameraTween = null;
  zoomEngageDistance = null;
  zoomTargetDistance = THREE.MathUtils.clamp(distance, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
}

// --- Overlay support ---------------------------------------------------------

// fn(frame|null) is called once per rendered frame. frame.nodes carries every
// node's projected screen position, focus weight, and hierarchy info for the
// label pins and hover-candidate picking.
export function setFrameCallback(fn) {
  frameCallback = fn;
}

function emitFrame() {
  if (!frameCallback) return;
  if (currentShape !== "diagram" || !currentGraph) {
    frameCallback(null);
    return;
  }
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;
  const scale = morphUniforms.uScale.value;
  const nodes = [];
  for (const n of currentGraph.nodes) {
    _vec.set(n.position.x, n.position.y, n.position.z)
      .multiplyScalar(scale)
      .applyMatrix4(particleSystem.matrixWorld)
      .project(camera);
    nodes.push({
      id: n.id,
      topLevel: n.parent == null,
      weight: nodeWeights.get(n.id) ?? 1,
      inFront: _vec.z < 1,
      x: (_vec.x * 0.5 + 0.5) * width,
      y: (-_vec.y * 0.5 + 0.5) * height
    });
  }
  frameCallback({ focusedId: focusedNodeId, nodes });
}

function animate() {
  requestAnimationFrame(animate);

  if (!particleSystem || !particleGeometry) return;

  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

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
  } else if (zoomTargetDistance !== null) {
    _offset.copy(camera.position).sub(controls.target);
    const dist = _offset.length();
    const next = dist + (zoomTargetDistance - dist) * 0.12;
    camera.position.copy(controls.target).add(_offset.multiplyScalar(next / dist));
  }

  controls.update();
  renderer.render(scene, camera);
  emitFrame();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updatePointScale();
}
