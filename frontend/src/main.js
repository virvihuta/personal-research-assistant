import { initViz, setShape, setBaseColor, loadDiagram, setRotationTarget, setScaleTarget } from "./viz/particles.js";
import { initGestures } from "./gestures/hands.js";
import { initUI } from "./ui/panel.js";
import { StubBackend } from "../../backend/model-backends/stub-backend.js";
import { validateSceneGraph } from "../../backend/schemas/validate-scene-graph.js";

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

let generating = false;

async function generateDiagram(prompt, ui) {
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

    loadDiagram(result.data);
    setShape("diagram");
    ui.showDiagramShape();
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

  const ui = initUI({
    onShapeChange: (name) => setShape(name),
    onColorChange: (hex) => setBaseColor(hex),
    onGenerate: (prompt) => generateDiagram(prompt, ui)
  });

  initGestures({
    videoElement: document.getElementById("webcam"),
    statusBox: document.getElementById("gesture-status"),
    loadingText: document.getElementById("loading"),
    onRotationTarget: setRotationTarget,
    onScaleTarget: setScaleTarget
  });

  // Debug/testing handle: drives the same setters the gesture module uses,
  // for environments where no webcam is available.
  window.__pra = { setShape, setScaleTarget, setRotationTarget };
});
