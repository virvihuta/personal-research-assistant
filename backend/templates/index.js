// Layout-template registry. A template is { name, matches(prompt), build() }
// where build() returns a scene graph that passes
// backend/schemas/validate-scene-graph.js. The LLM's job (Milestone 4+) is to
// populate/adjust labels and descriptions inside a template's structure —
// never to invent positions. Add future templates (CNN, generic DAG) here.

import { transformerTemplate } from "./transformer.js";

const TEMPLATES = [transformerTemplate];

export function findTemplate(prompt) {
  return TEMPLATES.find((t) => t.matches(prompt)) || null;
}

export function getTemplate(name) {
  return TEMPLATES.find((t) => t.name === name) || null;
}

export function listTemplates() {
  return TEMPLATES.map((t) => t.name);
}
