/**
 * Shared interface every model backend implements (Tier 1 hosted Claude,
 * Tier 2 local OSS, test stubs). Callers depend only on this contract, so
 * backends are swappable via config without touching the pipeline.
 *
 * generate(prompt, options) -> Promise<GenerateResult>
 *
 *   prompt          string — the user/system text to send to the model.
 *   options.schema  optional JSON Schema object. When present, the backend
 *                   must attempt structured output and return parsed JSON in
 *                   `data`. Best-effort only: callers MUST still validate
 *                   `data` (see backend/schemas/) before using it.
 *   options.context optional extra context object (e.g. the focused node's
 *                   subtree for scoped explanations — used from Milestone 6).
 *
 *   GenerateResult: {
 *     text:    string|null — freeform answer (null for structured requests),
 *     data:    object|null — parsed structured output (null for freeform),
 *     backend: string      — name of the backend that produced it
 *   }
 */
export class ModelBackend {
  get name() {
    return "base";
  }

  async generate(prompt, options = {}) {
    throw new Error(`${this.constructor.name} must implement generate(prompt, options)`);
  }
}
