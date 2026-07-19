import { sceneGraphToTargets } from "./diagram.js";

// Three.js scene + particle morphing. THREE and THREE.OrbitControls come from
// the classic CDN scripts loaded in index.html.
//
// TODO(milestone 2): morphing is still a CPU per-frame lerp over the full
// position array — move it into a vertex shader (current + target position
// attributes, uniform mix factor) before building more on top.

let scene, camera, renderer, controls;
let particleGeometry, particleSystem;

// The original 80000 was too heavy for many machines; 35000 still looks great.
const PARTICLE_COUNT = 35000;

// At scale=1, the model should take up roughly 80% of the screen visually.
const BASE_MODEL_SCALE = 1.75;

const targets = {
  heart: new Float32Array(PARTICLE_COUNT * 3),
  saturn: new Float32Array(PARTICLE_COUNT * 3),
  tree: new Float32Array(PARTICLE_COUNT * 3),
  diagram: null // filled by loadDiagram()
};
let diagramColors = null;

let currentShape = "tree";
let pickedColor = "#00ffcc";
let gestureScale = 1.0;
let targetGestureScale = 1.0;
let targetRotationX = 0;
let targetRotationY = 0;

function generatePresetPositions() {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;

    // Christmas tree
    if (i < PARTICLE_COUNT * 0.08) {
      const angle = Math.random() * Math.PI * 2;
      const starWave = Math.abs(Math.sin(angle * 5));
      const r = (1.8 + starWave * 3.0) * Math.sqrt(Math.random());
      targets.tree[i3] = r * Math.cos(angle);
      targets.tree[i3 + 1] = 20 + (Math.random() - 0.5) * 1.5;
      targets.tree[i3 + 2] = r * Math.sin(angle) * 0.45;
    } else if (i < PARTICLE_COUNT * 0.92) {
      const h = Math.random() * 32 - 14;
      const layerNormalized = (h + 14) / 32;
      const layerProgress = (layerNormalized * 4) % 1.0;
      let baseRadius = (1.0 - layerNormalized) * 18;
      baseRadius *= Math.pow(layerProgress, 0.42);
      const angle = Math.random() * Math.PI * 2;
      const r = Math.max(0, baseRadius * Math.sqrt(Math.random()) + (Math.random() - 0.5) * 2.5);
      targets.tree[i3] = Math.cos(angle) * r;
      targets.tree[i3 + 1] = h;
      targets.tree[i3 + 2] = Math.sin(angle) * r;
    } else {
      const h = Math.random() * 5 - 19;
      const r = Math.random() * 2.2;
      const angle = Math.random() * Math.PI * 2;
      targets.tree[i3] = Math.cos(angle) * r;
      targets.tree[i3 + 1] = h;
      targets.tree[i3 + 2] = Math.sin(angle) * r;
    }

    // Saturn
    if (i < PARTICLE_COUNT * 0.42) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const latFlatten = 0.82 + Math.random() * 0.06;
      const r = 11.5 * Math.cbrt(Math.random());
      targets.saturn[i3] = r * Math.sin(phi) * Math.cos(theta);
      targets.saturn[i3 + 1] = r * Math.sin(phi) * Math.sin(theta) * latFlatten;
      targets.saturn[i3 + 2] = r * Math.cos(phi);
    } else {
      const ringBand = Math.random();
      const bandBase =
        ringBand < 0.22 ? 14.5 :
        ringBand < 0.48 ? 18.5 :
        ringBand < 0.72 ? 23.5 :
        28.5;
      const rRing = bandBase + Math.random() * 3.5 + Math.sin(bandBase * 1.7 + i * 0.013) * 0.9;
      const thetaRing = Math.random() * Math.PI * 2;
      const ringRipple = Math.sin(thetaRing * 10 + rRing * 0.9) * 0.45 + Math.sin(thetaRing * 23) * 0.18;
      const ringThickness = (Math.random() - 0.5) * (0.45 + ringBand * 0.85);
      targets.saturn[i3] = (rRing + ringRipple) * Math.cos(thetaRing);
      targets.saturn[i3 + 1] = ringThickness;
      targets.saturn[i3 + 2] = (rRing + ringRipple) * Math.sin(thetaRing);
    }

    // Heart
    const t = Math.PI * 2 * Math.random();
    const u = Math.PI * (Math.random() - 0.5);
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2*t) - 2 * Math.cos(3*t) - Math.cos(4*t);
    const z = 6 * Math.sin(u) * (1 - Math.abs(Math.sin(t)));
    targets.heart[i3] = x * 1.35;
    targets.heart[i3 + 1] = y * 1.35;
    targets.heart[i3 + 2] = z * 1.35;
  }
}

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

  generatePresetPositions();

  particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(targets.tree), 3)
  );
  particleGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(new Float32Array(PARTICLE_COUNT * 3), 3)
  );
  fillFlatColor(pickedColor);

  // vertexColors so diagram nodes can each carry their own color; preset
  // shapes just fill the attribute with the picked color.
  const material = new THREE.PointsMaterial({
    size: 0.34,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });

  particleSystem = new THREE.Points(particleGeometry, material);
  scene.add(particleSystem);

  window.addEventListener("resize", onWindowResize);
  animate();
}

export function setShape(name) {
  if (!(name in targets) || !targets[name]) return false;
  currentShape = name;
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

  particleSystem.rotation.y += (targetRotationY - particleSystem.rotation.y) * 0.05;
  particleSystem.rotation.x += (targetRotationX - particleSystem.rotation.x) * 0.05;

  const positions = particleGeometry.attributes.position.array;
  const targetArray = targets[currentShape] || targets.tree;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3;
    positions[i3] += (targetArray[i3] * actualScale - positions[i3]) * 0.08;
    positions[i3 + 1] += (targetArray[i3 + 1] * actualScale - positions[i3 + 1]) * 0.08;
    positions[i3 + 2] += (targetArray[i3 + 2] * actualScale - positions[i3 + 2]) * 0.08;
  }

  particleGeometry.attributes.position.needsUpdate = true;

  controls.update();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
