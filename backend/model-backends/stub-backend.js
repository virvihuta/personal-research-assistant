import { ModelBackend } from "./model-backend.js";
import { STUB_TRANSFORMER_GRAPH } from "./stub-scene-graph.js";

// Small artificial delay so loading states in the UI are exercised even
// before a real network-backed backend exists.
const STUB_LATENCY_MS = 300;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Offline backend for developing and testing the pipeline shape. No network,
 * no API keys. Schema-constrained requests get the canned transformer scene
 * graph; freeform requests get a canned string.
 */
export class StubBackend extends ModelBackend {
  get name() {
    return "stub";
  }

  async generate(prompt, options = {}) {
    await delay(STUB_LATENCY_MS);

    if (options.schema) {
      return {
        text: null,
        data: structuredClone(STUB_TRANSFORMER_GRAPH),
        backend: this.name
      };
    }

    return {
      text: `[stub backend] No real model is wired up yet. You asked: "${prompt}". ` +
        "A hosted Claude backend (diagrams) and a local OSS backend (chat) arrive in a later milestone.",
      data: null,
      backend: this.name
    };
  }
}
