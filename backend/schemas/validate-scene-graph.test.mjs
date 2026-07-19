// Run with: node backend/schemas/validate-scene-graph.test.mjs
import assert from "node:assert/strict";
import { validateSceneGraph } from "./validate-scene-graph.js";
import { STUB_TRANSFORMER_GRAPH } from "../model-backends/stub-scene-graph.js";

const broken = (mutate) => {
  const graph = structuredClone(STUB_TRANSFORMER_GRAPH);
  mutate(graph);
  return graph;
};

const expectInvalid = (name, graph, errorSubstring) => {
  const result = validateSceneGraph(graph);
  assert.equal(result.valid, false, `${name}: expected invalid`);
  assert.ok(
    result.errors.some((e) => e.includes(errorSubstring)),
    `${name}: expected an error containing "${errorSubstring}", got: ${result.errors.join(" | ")}`
  );
};

// The canned stub graph must always be valid — the whole stub pipeline rests on it.
const stubResult = validateSceneGraph(STUB_TRANSFORMER_GRAPH);
assert.deepEqual(stubResult, { valid: true, errors: [] });
assert.ok(
  STUB_TRANSFORMER_GRAPH.nodes.length >= 5 && STUB_TRANSFORMER_GRAPH.nodes.length <= 8,
  "stub graph should stay small (5-8 nodes)"
);

expectInvalid("non-object", "not a graph", "must be a JSON object");
expectInvalid("null", null, "must be a JSON object");
expectInvalid("empty nodes", { nodes: [], edges: [] }, "non-empty array");
expectInvalid("missing edges", broken((g) => delete g.edges), "graph.edges");
expectInvalid("unknown top-level key", broken((g) => (g.particles = [])), 'unknown property "particles"');
expectInvalid("bad color", broken((g) => (g.nodes[0].color = "blue")), "#rrggbb");
expectInvalid("bad node id", broken((g) => (g.nodes[0].id = "Input Embedding")), "kebab-case");
expectInvalid("duplicate id", broken((g) => (g.nodes[1].id = g.nodes[0].id)), "duplicate id");
expectInvalid("missing position axis", broken((g) => delete g.nodes[2].position.y), "position.y");
expectInvalid("non-numeric position", broken((g) => (g.nodes[2].position.x = "left")), "finite number");
expectInvalid("size out of range", broken((g) => (g.nodes[3].size = 0)), "size");
expectInvalid("edge to unknown node", broken((g) => (g.edges[0].to = "does-not-exist")), "unknown node");
expectInvalid("self edge", broken((g) => (g.edges[0].to = g.edges[0].from)), "self-edges");
expectInvalid("bad edge type", broken((g) => (g.edges[0].type = "teleport")), "must be one of");
expectInvalid("unknown parent", broken((g) => (g.nodes[3].parent = "ghost")), "unknown node");
expectInvalid(
  "parent cycle",
  broken((g) => {
    g.nodes[2].parent = "multi-head-attention"; // encoder-block -> mha -> encoder-block
  }),
  "cycle"
);

// Error messages should point at the offending path, not just say "invalid".
const detail = validateSceneGraph(broken((g) => (g.nodes[4].color = 42)));
assert.match(detail.errors[0], /nodes\[4\]\.color/);

console.log("validate-scene-graph: all checks passed");
