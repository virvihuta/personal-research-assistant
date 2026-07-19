// Run with: node backend/schemas/validate-scene-graph.test.mjs
import assert from "node:assert/strict";
import { validateSceneGraph } from "./validate-scene-graph.js";
import { buildTransformerGraph } from "../templates/transformer.js";

const nodeById = (graph, id) => graph.nodes.find((n) => n.id === id);

const broken = (mutate) => {
  const graph = buildTransformerGraph();
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

// The transformer template must always produce a valid graph — the whole
// stub pipeline (and later the Claude prompt contract) rests on it.
const graph = buildTransformerGraph();
const templateResult = validateSceneGraph(graph);
assert.deepEqual(templateResult, { valid: true, errors: [] });

// Structural expectations for the zoom-level design.
const topLevel = graph.nodes.filter((n) => n.parent === null);
assert.equal(topLevel.length, 5, "five top-level clusters");
const heads = graph.nodes.filter((n) => n.parent === "enc-mha" && n.id.startsWith("enc-head-"));
assert.equal(heads.length, 4, "four attention heads");
assert.ok(
  heads.every((h) => h.color === heads[0].color && h.size === heads[0].size),
  "heads must be visually identical (same color and size)"
);
for (const h of heads) {
  const kids = graph.nodes.filter((n) => n.parent === h.id);
  assert.equal(kids.length, 3, `${h.id} has Query/Key/Value children`);
}
assert.ok(
  graph.nodes.every((n) => typeof n.description === "string" && n.description.length > 0),
  "every node carries a grounding description"
);
assert.ok(graph.nodes.length <= 64, "node budget respected");

expectInvalid("non-object", "not a graph", "must be a JSON object");
expectInvalid("null", null, "must be a JSON object");
expectInvalid("empty nodes", { nodes: [], edges: [] }, "non-empty array");
expectInvalid("missing edges", broken((g) => delete g.edges), "graph.edges");
expectInvalid("unknown top-level key", broken((g) => (g.particles = [])), 'unknown property "particles"');
expectInvalid("unknown node key", broken((g) => (nodeById(g, "enc-mha").glow = true)), 'unknown property "glow"');
expectInvalid("bad color", broken((g) => (nodeById(g, "enc-ff").color = "orange")), "#rrggbb");
expectInvalid("bad node id", broken((g) => (g.nodes[0].id = "Input Embedding")), "kebab-case");
expectInvalid("duplicate id", broken((g) => (g.nodes[1].id = g.nodes[0].id)), "duplicate id");
expectInvalid("missing description", broken((g) => delete nodeById(g, "enc-ff").description), "description");
expectInvalid("empty description", broken((g) => (nodeById(g, "enc-ff").description = "")), "description");
expectInvalid("bad shape", broken((g) => (nodeById(g, "enc-layer-2").shape = "cube")), "shape");
expectInvalid("missing position axis", broken((g) => delete nodeById(g, "enc-mha").position.y), "position.y");
expectInvalid("non-numeric position", broken((g) => (nodeById(g, "enc-mha").position.x = "left")), "finite number");
expectInvalid("size out of range", broken((g) => (nodeById(g, "output-softmax").size = 0)), "size");
expectInvalid("edge to unknown node", broken((g) => (g.edges[0].to = "does-not-exist")), "unknown node");
expectInvalid("self edge", broken((g) => (g.edges[0].to = g.edges[0].from)), "self-edges");
expectInvalid("bad edge type", broken((g) => (g.edges[0].type = "teleport")), "must be one of");
expectInvalid("unknown parent", broken((g) => (nodeById(g, "enc-ff").parent = "ghost")), "unknown node");
expectInvalid(
  "parent cycle",
  broken((g) => {
    nodeById(g, "enc-layer-1").parent = "enc-mha"; // enc-layer-1 -> enc-mha -> enc-layer-1
  }),
  "cycle"
);

// Error messages should point at the offending path, not just say "invalid".
const detail = validateSceneGraph(broken((g) => (g.nodes[4].color = 42)));
assert.match(detail.errors[0], /nodes\[4\]\.color/);

console.log("validate-scene-graph: all checks passed");
