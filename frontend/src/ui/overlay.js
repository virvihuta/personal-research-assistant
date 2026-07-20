// Screen-space HTML overlay: label pins for top-level clusters, a detail
// card for the hovered/focused node, and the gesture cursor reticle. All
// positioning data arrives from the viz layer's per-frame projection
// callback — no Three.js math here.

export function initOverlay() {
  const layer = document.getElementById("label-layer");
  const cursorEl = document.getElementById("gesture-cursor");
  const card = document.getElementById("node-card");
  const cardTitle = card.querySelector(".node-card-title");
  const cardDesc = card.querySelector(".node-card-desc");

  let pins = new Map(); // node id -> element (top-level nodes only)
  let cardNodeId = null;

  function setGraph(graph) {
    layer.innerHTML = "";
    pins = new Map();
    for (const n of graph.nodes) {
      if (n.parent != null) continue;
      const el = document.createElement("div");
      el.className = "node-pin";
      el.textContent = n.label;
      el.style.setProperty("--pin-color", n.color);
      layer.appendChild(el);
      pins.set(n.id, el);
    }
    setCard(null);
  }

  // Called once per rendered frame with projected node data (or null when no
  // diagram is showing). Pins show only at overview — when a node is focused
  // the defocus fade + detail card carry the context instead.
  function sync(frame) {
    if (!frame) {
      for (const el of pins.values()) el.style.opacity = 0;
      return;
    }
    for (const n of frame.nodes) {
      const el = pins.get(n.id);
      if (!el) continue;
      const visible = n.inFront && !frame.focusedId;
      el.style.opacity = visible ? Math.min(1, n.weight) : 0;
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
    }
  }

  function setCursor(x, y, active) {
    cursorEl.classList.toggle("active", active);
    if (active) {
      cursorEl.style.left = `${x}px`;
      cursorEl.style.top = `${y}px`;
    }
  }

  function setCard(node) {
    if (!node) {
      card.classList.remove("visible");
      cardNodeId = null;
      return;
    }
    if (node.id !== cardNodeId) {
      cardNodeId = node.id;
      cardTitle.textContent = node.label;
      cardDesc.textContent = node.description;
      card.style.setProperty("--card-color", node.color);
    }
    card.classList.add("visible");
  }

  return { setGraph, sync, setCursor, setCard };
}
