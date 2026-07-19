export function initUI({ onShapeChange, onColorChange, onGenerate }) {
  const modelSelect = document.getElementById("model-select");
  const colorInput = document.getElementById("particle-color");
  const colorHex = document.getElementById("color-hex");
  const promptInput = document.getElementById("diagram-prompt");
  const generateBtn = document.getElementById("btn-generate");
  const pipelineStatus = document.getElementById("pipeline-status");

  modelSelect.addEventListener("change", (e) => {
    onShapeChange(e.target.value);
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
    }
  };
}
