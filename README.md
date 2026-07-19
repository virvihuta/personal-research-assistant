# Personal Research Assistant

A voice-navigable 3D research assistant that turns spoken questions into structured, explorable particle diagrams — say "explain a transformer," then "zoom into multi-head attention," and it navigates to and explains that specific part.

> **Status: early scaffold.** The particle renderer and gesture control work, and the diagram pipeline runs end-to-end on a stub backend (no API calls yet). Voice, real model backends, and camera zoom/focus navigation are not built — see the roadmap.

## What works today

- **35,000-point WebGL particle cloud** that morphs between preset shapes (tree / Saturn / heart), with mouse orbit controls — morphing runs in a GPU vertex shader ([benchmarks](docs/benchmarks.md))
- **Webcam hand tracking** (MediaPipe Hands): make a fist and move toward/away from the camera to scale; hand position rotates the cloud
- **End-to-end stub diagram pipeline**: a text prompt goes through the `ModelBackend` interface → the stub returns the transformer layout template's scene graph (32 nodes, 3 zoom levels) → the graph is schema-validated → valid graphs render as per-node colored particle clusters with particle streams along the edges
- **Zoom navigation with focus/defocus**: pick any node in the Navigate dropdown and the camera tweens to it while everything outside its subtree fades to gray — encoder stack → multi-head attention → a single head's Query/Key/Value, and back out to the overview
- **Graceful degradation**: MediaPipe failing to load, camera permission denied, or an invalid scene graph each produce a visible status message instead of a broken page

## Run it

No build step, no dependencies to install. From the repo root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/frontend/src/> (any static file server works — but serve from the **repo root**, because the frontend imports the backend's ES modules by relative path).

Notes:

- A served origin is required — opening the HTML via `file://` will not work (ES modules), and **camera access requires localhost or HTTPS**.
- The page loads Three.js and MediaPipe from CDNs, so first load needs network access. If MediaPipe fails to load, particles still work; only gestures are disabled.

Run the schema validator tests with:

```bash
node backend/schemas/validate-scene-graph.test.mjs
```

A frame-cost benchmark (CPU-loop vs GPU-shader morphing) auto-runs at <http://localhost:8000/frontend/src/benchmark.html>; results and methodology live in [docs/benchmarks.md](docs/benchmarks.md).

## Architecture

The core design decision: **the LLM authors a scene graph, never raw particle coordinates.** The model returns nodes (id, label, position, size, color, parent) and typed edges; the renderer owns particle placement, physics, and morphing. A validator sits between the two so a malformed model response degrades to an error message rather than crashing the render.

The second key decision is a **tiered, swappable model backend**: one `ModelBackend` interface (`generate(prompt, {schema?}) → {text, data}`) with per-tier implementations behind it — a hosted Claude backend for scene-graph generation (reliability-critical structured output) and a self-hosted OSS model for open-ended chat (where an imperfect answer is acceptable). Today only the offline `StubBackend` exists, which is what lets the whole pipeline be developed and tested without any API keys.

```
frontend/src/
  viz/        Three.js scene, preset shapes, scene-graph → particle-cluster expansion
  gestures/   MediaPipe Hands wiring + gesture classification
  voice/      (empty — milestone 7)
  ui/         control panel, status boxes, styles
backend/
  model-backends/   ModelBackend interface + StubBackend (Claude + local OSS later)
  schemas/          scene graph JSON Schema + validator + tests
  templates/        (empty — layout templates arrive in milestone 3)
  tools/            (empty — stretch: sandboxed code execution, arXiv search)
docs/
  brief.md    project north star: scope, quality bar, milestone order
```

## Roadmap

1. [x] Repo scaffold + `ModelBackend` interface with stub backend, wired end-to-end to the renderer
2. [x] GPU shader migration for particle morphing (per-frame morph cost now ~0 ms; 10× total frame-cost win at 1M particles — [docs/benchmarks.md](docs/benchmarks.md))
3. [x] Transformer layout template: 3 zoom levels (stacks → layer sublayers → parallel attention heads with Q/K/V), grounding descriptions on every node
4. [ ] Claude backend generating the transformer scene graph from a text prompt
5. [x] Camera zoom / focus-defocus navigation by node id (done alongside milestone 3; manual dropdown until voice lands)
6. [ ] Contextual explanation flow (second LLM call scoped to the focused node)
7. [ ] Voice loop (local Whisper STT in, Piper TTS out; browser `speechSynthesis` fallback)
8. [ ] Polish: error-handling audit, architecture doc, benchmarks, demo video
9. [ ] Stretch: sandboxed code execution, session memory, arXiv search, richer gestures

## Deliberately not built

Wake-word detection (push-to-talk is fine), smart-home/room-scale presence detection, "zero-latency" responses, and autonomous action-taking without confirmation. These are out of scope by design — see [docs/brief.md](docs/brief.md).
