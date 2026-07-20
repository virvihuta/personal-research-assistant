import {
  initViz, setShape, setBaseColor, loadDiagram, focusNode, clearFocus,
  orbitCameraBy, beginZoom, setZoomRatio, setZoomDistance,
  setHoveredNode, setFrameCallback
} from "./viz/particles.js";
import { initGestures } from "./gestures/hands.js";
import { initUI } from "./ui/panel.js";
import { initOverlay } from "./ui/overlay.js";
import { StubBackend } from "../../backend/model-backends/stub-backend.js";
import { validateSceneGraph } from "../../backend/schemas/validate-scene-graph.js";

// Hover-picking radius around the gesture cursor, in screen pixels.
const HOVER_RADIUS_PX = 90;

// Swap for ClaudeBackend (Tier 1) / LocalOSSBackend (Tier 2) in later
// milestones — the pipeline below only depends on the ModelBackend contract.
const backend = new StubBackend();

// The stub ignores the schema, but real structured-output backends need it,
// so the pipeline passes it through from day one. If the fetch fails we pass
// an empty "anything goes" schema — the validator still gates the result.
let sceneGraphSchema = null;
fetch("../../backend/schemas/scene-graph.schema.json")
  .then((res) => (res.ok ? res.json() : null))
  .then((schema) => { sceneGraphSchema = schema; })
  .catch(() => {});

let ui, overlay;
let generating = false;
let graphNodeById = new Map();
let lastFrame = null; // latest projection frame from the viz layer
const cursor = { x: 0, y: 0, active: false };
let hoveredId = null;
let focusedId = null;

// Single navigation path shared by the dropdown, gesture click, and the
// debug hook, so every trigger drives the same focus/zoom/defocus behavior
// and the dropdown stays in sync.
function navigateTo(nodeId) {
  if (nodeId && !graphNodeById.has(nodeId)) return;
  focusedId = nodeId || null;
  if (focusedId) focusNode(focusedId);
  else clearFocus();
  ui.setFocusSelection(focusedId);
  updateCard();
}

function updateCard() {
  overlay.setCard(graphNodeById.get(hoveredId) || graphNodeById.get(focusedId) || null);
}

// Nearest vivid (weight ~1) node to the cursor within the pick radius.
// Dimmed deep-detail nodes aren't hoverable until the user zooms toward them.
function updateHover() {
  let next = null;
  if (cursor.active && lastFrame) {
    let best = HOVER_RADIUS_PX;
    for (const n of lastFrame.nodes) {
      if (!n.inFront || n.weight < 0.999) continue;
      const d = Math.hypot(n.x - cursor.x, n.y - cursor.y);
      if (d < best) {
        best = d;
        next = n.id;
      }
    }
  }
  if (next !== hoveredId) {
    hoveredId = next;
    setHoveredNode(hoveredId);
    updateCard();
  }
}

async function generateDiagram(prompt) {
  if (generating) return;
  generating = true;
  ui.setGenerateBusy(true);
  ui.setPipelineStatus(`Requesting scene graph from "${backend.name}" backend…`);

  try {
    const result = await backend.generate(prompt, { schema: sceneGraphSchema || {} });

    const check = validateSceneGraph(result.data);
    if (!check.valid) {
      console.warn("Scene graph rejected by validator:", check.errors);
      const more = check.errors.length > 1 ? ` (+${check.errors.length - 1} more — see console)` : "";
      ui.setPipelineStatus(`Scene graph rejected: ${check.errors[0]}${more}`, "error");
      return;
    }

    graphNodeById = new Map(result.data.nodes.map((n) => [n.id, n]));
    focusedId = null;
    hoveredId = null;
    loadDiagram(result.data);
    setShape("diagram");
    overlay.setGraph(result.data);
    ui.showDiagramShape();
    ui.populateFocusTree(result.data);
    ui.setPipelineStatus(
      `Rendered ${result.data.nodes.length} nodes / ${result.data.edges.length} edges via "${result.backend}" backend.`,
      "ok"
    );
  } catch (err) {
    console.error(err);
    ui.setPipelineStatus(`Backend error: ${err.message}`, "error");
  } finally {
    generating = false;
    ui.setGenerateBusy(false);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initViz(
    document.getElementById("canvas-container"),
    document.getElementById("particle-color").value
  );

  overlay = initOverlay();

  ui = initUI({
    onShapeChange: (name) => {
      setShape(name);
      if (name !== "diagram") {
        focusedId = null;
        hoveredId = null;
        updateCard();
      }
    },
    onColorChange: (hex) => setBaseColor(hex),
    onGenerate: (prompt) => generateDiagram(prompt),
    onFocusChange: (nodeId) => navigateTo(nodeId)
  });

  setFrameCallback((frame) => {
    lastFrame = frame;
    overlay.sync(frame);
    if (cursor.active) updateHover();
  });

  // Live detection readout for gesture tuning, gated behind ?debug.
  const debugEl = document.getElementById("gesture-debug");
  const debugEnabled = new URLSearchParams(location.search).has("debug");
  if (debugEnabled) debugEl.classList.add("visible");
  const formatDebug = (d) => {
    if (d.state === "none") return "gesture: none (no hand)";
    const finger = (name, f) =>
      `${name} ${f.ratio.toFixed(2)} ${f.extended ? "EXT" : f.curled ? "curl" : "mid "}`;
    return [
      `gesture: ${d.state}`,
      `pinch ${d.pinchRatio.toFixed(2)} (raw ${d.pinchRatioRaw.toFixed(2)})  m/r/p curled: ${d.othersCurled}`,
      `${finger("idx", d.fingers.index)}  ${finger("mid", d.fingers.middle)}`,
      `${finger("rng", d.fingers.ring)}  ${finger("pky", d.fingers.pinky)}`,
      `openness ${d.openness.toFixed(2)}  thumb ${d.thumbCurled ? "curl" : "open"}  fist ${d.isFist ? "YES" : "no"}`
    ].join("\n");
  };

  const gestureHandlers = {
    onOrbitDelta: (deltaTheta, deltaPhi) => orbitCameraBy(deltaTheta, deltaPhi),
    onZoomStart: () => beginZoom(),
    onZoomRatio: (ratio) => setZoomRatio(ratio),
    onDebug: debugEnabled ? (info) => { debugEl.textContent = formatDebug(info); } : undefined,
    onPointer: (x, y) => {
      cursor.x = x;
      cursor.y = y;
      cursor.active = true;
      overlay.setCursor(x, y, true);
      updateHover();
    },
    onPointerEnd: () => {
      cursor.active = false;
      overlay.setCursor(0, 0, false);
      updateHover();
    },
    onSelect: () => {
      // Click on a hovered node focuses it; click on empty space deselects
      // back to Overview (no-op when already there, so a stray click can't
      // yank away a manually orbited/zoomed overview framing).
      if (hoveredId) navigateTo(hoveredId);
      else if (focusedId) navigateTo(null);
    }
  };

  initGestures({
    videoElement: document.getElementById("webcam"),
    statusBox: document.getElementById("gesture-status"),
    loadingText: document.getElementById("loading"),
    handlers: gestureHandlers
  });

  // Debug/testing handle for webcam-less environments: drives the exact same
  // handlers/paths the gesture module uses.
  window.__pra = {
    setShape,
    focusNode: navigateTo,
    clearFocus: () => navigateTo(null),
    orbitBy: orbitCameraBy,
    zoomTo: setZoomDistance,
    pointer: gestureHandlers.onPointer,
    pointerEnd: gestureHandlers.onPointerEnd,
    select: gestureHandlers.onSelect,
    frame: () => lastFrame
  };
});
