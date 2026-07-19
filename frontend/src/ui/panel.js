export function initUI({ onShapeChange, onColorChange, onGenerate, onFocusChange }) {
  const modelSelect = document.getElementById("model-select");
  const colorInput = document.getElementById("particle-color");
  const colorHex = document.getElementById("color-hex");
  const promptInput = document.getElementById("diagram-prompt");
  const generateBtn = document.getElementById("btn-generate");
  const pipelineStatus = document.getElementById("pipeline-status");
  const navigateGroup = document.getElementById("navigate-group");
  const focusSelect = document.getElementById("focus-select");

  modelSelect.addEventListener("change", (e) => {
    // Leaving the diagram also leaves any focused node.
    if (e.target.value !== "diagram") focusSelect.value = "";
    onShapeChange(e.target.value);
  });

  focusSelect.addEventListener("change", (e) => {
    onFocusChange(e.target.value || null);
  });

  colorInput.addEventListener("input", (e) => {
    const color = e.target.value;
    colorHex.textContent = color;
    document.documentElement.style.setProperty("--accent-color", color);
    onColorChange(color);
  });

  document.getElementById("btn-fullscreen").addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  const triggerGenerate = () => {
    onGenerate(promptInput.value.trim() || "Explain a transformer");
  };
  generateBtn.addEventListener("click", triggerGenerate);
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") triggerGenerate();
  });

  return {
    setPipelineStatus(text, tone = "info") {
      pipelineStatus.textContent = text;
      pipelineStatus.classList.toggle("active", tone === "ok");
      pipelineStatus.classList.toggle("error", tone === "error");
    },

    setGenerateBusy(busy) {
      generateBtn.disabled = busy;
      generateBtn.textContent = busy ? "Generating…" : "Generate Diagram";
    },

    // The diagram entry only appears in the shape selector once a diagram exists.
    showDiagramShape() {
      if (!modelSelect.querySelector('option[value="diagram"]')) {
        const option = document.createElement("option");
        option.value = "diagram";
        option.textContent = "Concept Diagram (generated)";
        modelSelect.appendChild(option);
      }
      modelSelect.value = "diagram";
    },

    // Depth-indented node tree for manual zoom navigation (stand-in for the
    // voice loop of Milestone 7).
    populateFocusTree(graph) {
      focusSelect.innerHTML = "";
      const overview = document.createElement("option");
      overview.value = "";
      overview.textContent = "Overview (whole diagram)";
      focusSelect.appendChild(overview);

      const childrenOf = (parentId) =>
        graph.nodes.filter((n) => (n.parent ?? null) === parentId);
      const addOptions = (parentId, depth) => {
        for (const node of childrenOf(parentId)) {
          const option = document.createElement("option");
          option.value = node.id;
          option.textContent = `${"— ".repeat(depth)}${node.label}`;
          focusSelect.appendChild(option);
          addOptions(node.id, depth + 1);
        }
      };
      addOptions(null, 0);

      focusSelect.value = "";
      navigateGroup.style.display = "block";
    }
  };
}
