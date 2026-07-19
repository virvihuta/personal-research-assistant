# Project Brief: Personal Research Assistant ("Jarvis for Research")

This document is the project's north star. Refer back to it whenever scope questions come up.

## 1. What this project is

A voice-and-gesture-driven research assistant for computational science work (quant modeling, AI/ML research, mathematics, physics). It is not a generic chatbot with a mic — its differentiator is a 3D particle-based visualization layer that the LLM can generate, label, and navigate by voice to explain technical concepts spatially.

One-line pitch: A voice-navigable 3D research assistant that turns spoken questions into structured, explorable diagrams — e.g. "explain a transformer," then "zoom into multi-head attention," and it navigates and explains that specific part.

## 2. Who this is for and why it matters

- University panel: needs to see depth, justified engineering decisions, and some form of evaluation/benchmarking — not just a working demo.
- Industry (e.g. Google) reviewers: need to see it work live and clean in under ~2 minutes, with real engineering judgment (performance work, graceful degradation, clean code) visible, not just API plumbing.

Both audiences reward depth on a narrow, well-executed core over breadth across many half-working features. Scope discipline is itself a signal of maturity — don't apologize for cut features, list them explicitly as "future work."

## 3. Current state (starting point)

We already have a working Three.js particle system:

- WebGL particle cloud (35,000 points) that morphs between preset shapes (tree/saturn/heart) via CPU-side per-frame lerp toward target position arrays.
- MediaPipe Hands for webcam-based one-hand gesture tracking: fist detection (curl heuristics on each finger), palm-size-based scale mapping, hand-position-based rotation.
- OrbitControls for manual camera control.
- Basic UI panel (shape selector, color picker, status box).
- All Chinese text has been translated to English; the prototype was a single-file HTML/JS page (now split into modules under `frontend/src/`).

This prototype is the seed for the visualization layer described below — it is not the final architecture (CPU-side lerp loop needs to move to a GPU shader; shape targets need to become an LLM-drivable scene graph instead of three hardcoded presets).

## 4. Core architecture decision: tiered model backend

Do not hardcode a single LLM provider. Build a swappable model-backend interface so different tiers can use different models:

- Tier 1 — flagship diagram/scene-graph generation: hosted Claude API. This must be reliable, low-risk, structured-output-heavy. This is the feature the whole demo hinges on — do not risk it on smaller/local models.
- Tier 2 — general conversation/Q&A: gpt-oss-20b, self-hosted (via Ollama or similar). Free, local, acceptable quality for open-ended chat where an imperfect answer isn't catastrophic.
- STT: Whisper (local). TTS: Piper (local) as default, browser `speechSynthesis` as a zero-dependency fallback.
- Build one `ModelBackend` interface (e.g. `generate(prompt, schema?) -> response`) with at least two implementations (`ClaudeBackend`, `LocalOSSBackend`) selectable via config. This abstraction is itself a portfolio-worthy architecture decision — document it in the README.

Do not add DeepSeek or other providers unless there's a concrete reason; two well-tested backends beat three loosely-tested ones.

## 5. The flagship feature — voice-navigable concept diagrams

This is the centerpiece. Build it deeper than anything else in the project.

Flow:

1. User says "explain a transformer" (or similar).
2. LLM (Tier 1, Claude) is prompted to return a structured scene graph — nodes (id, label, position, size, color, parent/children) and edges (from, to, type) — NOT raw particle coordinates. The LLM authors structure and semantics; the renderer handles particle physics.
3. Renderer expands each node into a particle cluster around its position (density/color driven by node metadata), using a template layout system: predefined layout templates per concept-family (start with exactly one: "transformer architecture") that the LLM populates with labels/content rather than inventing freeform coordinates. Freeform LLM-generated layout will look messy — resist the temptation to let the model position things arbitrarily.
4. User says "zoom into multi-head attention." This resolves to a `node.id` (LLM can return the id directly since it authored the graph). Camera (via OrbitControls target + position) tweens smoothly toward that node. Non-target-subtree particles fade/desaturate to create a focus effect.
5. User says "I don't understand this part." A second LLM call is made with: the user's question + the currently focused `node.id` + its subtree structure. Response is spoken (TTS) and can trigger further visual changes (e.g. animate particles along edges to show data flow).

Scope discipline for v1: Build exactly one deeply polished example — the transformer architecture — end to end (generation → zoom → contextual explanation), rather than a generic "any diagram" system. Depth over breadth applies here more than anywhere else in the project.

## 6. Secondary features (build only after the flagship works end-to-end)

In priority order — treat everything below as optional/stretch, not core:

1. Voice loop as general interface — streaming STT → LLM → streaming TTS for everything, not just diagram requests. Must be interrupt-able (user can barge in mid-response). Latency is a human-judgment tuning problem, not a coding-speed problem — budget real iteration time for this, not just implementation time.
2. Code execution tool — sandboxed Python (numpy/scipy/sympy/pandas), voice-triggered, results rendered as text/plot/LaTeX and optionally reflected back into the particle field.
3. Session memory — remembers recent research threads across a session (and ideally across days).
4. arXiv/paper search + summarization tool.
5. Extended gesture vocabulary — point-to-select, pinch, swipe — using the 21 MediaPipe hand landmarks already available (currently only fist-vs-not-fist is used).

Explicitly out of scope, do not build, mention only as future work if asked:

- Wake-word detection (push-to-talk is fine for v1)
- Smart home / room-scale presence detection (no depth camera; out of scope for browser-based project)
- True zero-latency responses (physics of network round-trips — not solvable)
- Fully autonomous action-taking without confirmation for anything destructive

## 7. Non-negotiable engineering quality bar

- GPU-based particle morphing, not CPU per-frame loops over the full position array. Move interpolation into a vertex shader (pass current + target positions as attributes, interpolate via a uniform mix factor) — the current prototype's CPU loop is a known bottleneck to fix early, before building more features on top of it.
- Graceful degradation everywhere: mic denied, camera denied, API down, no hand detected, malformed LLM JSON output — none of these should produce a silent failure or broken UI state. The existing prototype already does this reasonably well for MediaPipe load failure and camera permission failure — extend that same discipline to every new subsystem.
- Validate LLM structured output before rendering it (schema validation on the scene graph JSON) — a malformed response should degrade gracefully (e.g. fall back to text-only explanation), not crash the render.
- Clean resource cleanup: stop webcam/mic streams and dispose Three.js resources on teardown/navigation to avoid leaks.
- HTTPS/localhost requirement for camera/mic access — document this clearly in setup instructions.

## 8. Suggested repo structure

```
/personal-research-assistant
  /frontend
    /src
      /viz            # Three.js scene, particle shader, camera tween/focus logic
      /gestures        # MediaPipe hand tracking, gesture classification
      /voice           # mic capture, STT client, TTS playback, interrupt handling
      /ui              # panels, status, controls
  /backend
    /model-backends    # ClaudeBackend, LocalOSSBackend implementing shared interface
    /schemas           # scene graph JSON schema + validation
    /templates         # layout templates (transformer.json, etc.)
    /tools             # code execution sandbox, arXiv search (stretch)
  /docs
    architecture.md     # pipeline diagram + design decisions + trade-offs considered
    benchmarks.md        # latency numbers, structured-output reliability tests, frame rate before/after shader migration
  README.md              # setup, demo video link, feature list, explicit "not built" list
```

## 9. Milestone order (build in this sequence)

1. Repo scaffold + model-backend interface (with a stub/mock backend for early testing)
2. GPU shader migration for particle morphing (fix the foundation before building on it)
3. Scene graph JSON schema + transformer layout template + validation
4. Wire Tier 1 (Claude) to generate the transformer scene graph from a text prompt; render it
5. Camera zoom/focus-defocus navigation triggered by node id
6. Contextual explanation flow (second LLM call scoped to focused node)
7. Voice loop wrapping the above (STT in, TTS out) — text-based interaction should already work before voice is layered on top
8. Polish pass: error handling audit, README, architecture doc, benchmarks, 60–90 second demo video
9. Stretch features only if time remains, in the priority order listed in Section 6

## 10. What "done" looks like for the portfolio deliverable

A ~90 second demo: user speaks a request, a transformer diagram forms from particles, user asks to zoom into multi-head attention, camera navigates there and the rest defocuses, user asks a follow-up question, gets a spoken, contextually accurate explanation — all without visible glitches, lag spikes, or fallback states triggering. Backed by a README with an architecture diagram, a short "design decisions and trade-offs" section, a benchmarks doc (latency, structured-output reliability, frame rate), and an honest "what's not built and why" section.
