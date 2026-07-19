# Benchmarks

## 1. Particle morphing: CPU per-frame lerp vs GPU vertex shader (Milestone 2)

**Date:** 2026-07-19
**Machine:** Apple M1 Max, 10 cores, Chromium 148 (ANGLE Metal), pixelRatio 2
**Harness:** [`frontend/src/benchmark.html`](../frontend/src/benchmark.html) — auto-runs on load, prints this table plus raw JSON.

### What is being compared

The original prototype morphed shapes by lerping all N particle positions in
JavaScript every frame and re-uploading the position buffer
(`positions[i] += (target[i] - positions[i]) * 0.08`). Milestone 2 moved the
interpolation into a vertex shader: start and target positions live in buffer
attributes, a `uMix` uniform advances with the same 0.08 exponential ease, and
the CPU updates three scalar uniforms per frame. The only remaining
per-particle CPU pass runs once per shape *switch* (baking the in-flight
position into the start attribute), not per frame.

### Method

- Frames are driven by a MessageChannel self-ping loop rather than
  `requestAnimationFrame`, so results are vsync-independent — rAF would cap
  both modes at the display rate and hide the difference at low counts.
- Each frame ends with a 1×1 `gl.readPixels`, forcing the GPU pipeline to
  drain so frame times include GPU completion, not just command submission.
  This serializes CPU/GPU work, making derived FPS a conservative bound; the
  comparison across modes is what matters.
- Per config: 20 warmup frames, 150 measured frames, a shape retarget every
  90 frames so a morph is always in flight (including the GPU mode's
  occasional O(n) bake). Scene: single Points object, additive blending,
  960×540 canvas at pixelRatio 2.
- "morph ms" isolates the per-frame morph update itself: the full-array lerp
  (CPU mode) vs three uniform writes (GPU mode).

### Results

| particles | mode | morph ms/frame | total ms/frame (median) | p95 ms | max FPS (1000/median) |
|---:|---|---:|---:|---:|---:|
| 35,000 | cpu | 1.30 | 3.8 | 6.5 | 263 |
| 35,000 | **gpu** | **0.00** | **1.9** | **2.9** | **526** |
| 150,000 | cpu | 4.10 | 8.7 | 14.1 | 115 |
| 150,000 | **gpu** | **0.00** | **3.4** | **4.0** | **294** |
| 500,000 | cpu | 14.70 | 23.6 | 38.9 | 42 |
| 500,000 | **gpu** | **0.00** | **4.8** | **9.0** | **208** |
| 1,000,000 | cpu | 32.90 | 47.8 | 62.1 | 21 |
| 1,000,000 | **gpu** | **0.00** | **4.8** | **6.6** | **208** |

### Interpretation

- **CPU-mode cost is linear in particle count** (~33 ms of main-thread morph
  work per frame at 1M particles) and falls below 60 FPS between 150k and
  500k particles. The GPU mode's morph cost is unmeasurably small at every
  count, and total frame cost plateaus around 4.8 ms (208 FPS) — at that
  point the bottleneck is fill/vertex work, not morphing.
- **At the app's current 35,000 particles both modes exceed the display
  cap**, so the user-visible win today is not raw FPS — it is the ~1.3 ms of
  main-thread time per frame the old loop burned, which is now free for the
  STT/LLM/TTS pipeline, plus ~30× particle headroom for denser diagrams
  before the frame budget is threatened.
- The migration also stopped re-uploading a 420 KB position buffer to the GPU
  every frame (12 MB/frame at 1M particles); buffers now upload only on shape
  switches.

### Reproduce

```bash
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000/frontend/src/benchmark.html and wait ~30s
```

Numbers vary with hardware, browser, and thermal state; treat trends, not
absolute values, as the result.
