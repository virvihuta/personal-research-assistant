// Transformer architecture layout template.
//
// A template owns positions, hierarchy, colors, and grounding descriptions
// for a known concept-family; a future LLM pass populates/adjusts labels and
// content but never invents coordinates. Zoom levels are encoded spatially:
//
//   Level 0 — five top-level clusters in data-flow order (x axis); encoder
//     and decoder are parents whose children render as stacked layer bands.
//   Level 1 — the bottom encoder layer is itself a parent whose children are
//     the sublayer sequence MHA -> Add&Norm -> Feed-Forward -> Add&Norm,
//     laid out left-to-right with flow edges (+ one residual skip).
//   Level 2 — MHA is a parent of 4 deliberately identical attention heads
//     (2x2 grid) converging on a concat+projection node; each head is a
//     parent of Query/Key/Value sub-groups with consistent colors.
//
// Parent nodes render no particles themselves (the renderer expands leaves
// only), so zooming reveals real substructure rather than a denser blob.

const NUM_HEADS = 4;
const NUM_LAYERS = 3;

const QKV_COLOR = { query: "#ffd166", key: "#6bffb8", value: "#6bd6ff" };
const HEAD_COLOR = "#ff8ae0"; // identical on purpose: the heads ARE identical

export const transformerTemplate = {
  name: "transformer",
  matches: (prompt) => /transformer|attention|encoder|decoder/i.test(prompt),
  build: buildTransformerGraph
};

export function buildTransformerGraph() {
  const nodes = [];
  const edges = [];
  const node = (n) => { nodes.push(n); return n.id; };
  const flow = (from, to) => edges.push({ from, to, type: "flow" });

  // ---- Level 0: five top-level clusters, left to right in data-flow order
  node({
    id: "input-embedding", label: "Input Embedding",
    position: { x: -20, y: -2, z: 0 }, size: 3, color: "#4da6ff", parent: null,
    description: "Turns each input token into a dense vector of numbers. Similar words end up with similar vectors, giving the model something meaningful to compute with."
  });
  node({
    id: "positional-encoding", label: "Positional Encoding",
    position: { x: -10, y: 7, z: 0 }, size: 2.5, color: "#66d9e8", parent: null,
    description: "Adds a position-dependent pattern to each token vector so the model knows word order. Without it, attention would treat a sentence as an unordered bag of words."
  });
  node({
    id: "encoder-stack", label: "Encoder Stack",
    position: { x: 1, y: 0, z: 0 }, size: 4.5, color: "#9b6bff", parent: null,
    description: "A stack of identical layers that read the whole input at once and build increasingly abstract representations of it. Each layer refines the previous layer's output."
  });
  node({
    id: "decoder-stack", label: "Decoder Stack",
    position: { x: 14.5, y: 0, z: 0 }, size: 4.5, color: "#4dff9e", parent: null,
    description: "A stack of layers that generates the output one token at a time. Each layer attends both to what has been generated so far (masked self-attention) and to the encoder's representation of the input (cross-attention)."
  });
  node({
    id: "output-softmax", label: "Output / Softmax",
    position: { x: 26, y: -4, z: 0 }, size: 3, color: "#ff5c5c", parent: null,
    description: "Projects the decoder's final vector onto the whole vocabulary and turns the scores into probabilities. The next output token is chosen from this distribution."
  });

  flow("input-embedding", "positional-encoding");
  flow("positional-encoding", "encoder-stack");
  flow("encoder-stack", "decoder-stack");
  flow("decoder-stack", "output-softmax");

  // ---- Encoder layers: stacked bands, bottom-to-top flow.
  // Layer 1 (bottom) is the detailed one; layers 2..N are plain slabs.
  node({
    id: "enc-layer-1", label: "Encoder Layer 1",
    position: { x: 1, y: -6, z: 0 }, size: 4, color: "#8a5cf5", parent: "encoder-stack",
    description: "One encoder layer, opened up to show its two sublayers: multi-head attention followed by a feed-forward network, each wrapped in Add & Norm. Every layer in the stack has exactly this structure."
  });
  for (let l = 2; l <= NUM_LAYERS; l++) {
    node({
      id: `enc-layer-${l}`, label: `Encoder Layer ${l}`,
      position: { x: 1, y: -6 + (l - 1) * 6, z: 0 }, size: 4,
      color: l === 2 ? "#9b6bff" : "#ac7cff", parent: "encoder-stack", shape: "slab",
      description: `Encoder layer ${l} — structurally identical to layer 1. Stacking layers lets simple per-layer operations compose into deep understanding of the input.`
    });
    flow(`enc-layer-${l - 1}`, `enc-layer-${l}`);
  }

  // ---- Level 1: sublayer sequence inside encoder layer 1, left to right
  node({
    id: "enc-mha", label: "Multi-Head Attention",
    position: { x: -5.5, y: -6, z: 0 }, size: 2, color: "#ff6bd6", parent: "enc-layer-1",
    description: "Lets every token look at every other token and gather relevant context, e.g. linking a pronoun to what it refers to. It runs several attention heads in parallel, each free to focus on a different kind of relationship."
  });
  node({
    id: "enc-add-norm-1", label: "Add & Norm",
    position: { x: -1.8, y: -6, z: 0 }, size: 1, color: "#c8c8d0", parent: "enc-layer-1",
    description: "Adds the sublayer's input back onto its output (a residual connection) and normalizes the result. This keeps gradients healthy and lets deep stacks train reliably."
  });
  node({
    id: "enc-ff", label: "Feed-Forward",
    position: { x: 1.4, y: -6, z: 0 }, size: 1.4, color: "#ffb84d", parent: "enc-layer-1",
    description: "A small two-layer neural network applied to each token position independently. Where attention mixes information between tokens, this transforms each token's representation on its own."
  });
  node({
    id: "enc-add-norm-2", label: "Add & Norm",
    position: { x: 4.6, y: -6, z: 0 }, size: 1, color: "#c8c8d0", parent: "enc-layer-1",
    description: "The second residual-plus-normalization step, wrapping the feed-forward sublayer just like the first one wraps attention. Its output is what the next encoder layer receives."
  });
  flow("enc-mha", "enc-add-norm-1");
  flow("enc-add-norm-1", "enc-ff");
  flow("enc-ff", "enc-add-norm-2");
  edges.push({ from: "enc-add-norm-1", to: "enc-add-norm-2", type: "residual" });

  // ---- Level 2: attention heads (2x2 grid) + concat/projection
  const headGrid = [
    { x: -6.9, y: -3.8 }, { x: -4.1, y: -3.8 },
    { x: -6.9, y: -6.6 }, { x: -4.1, y: -6.6 }
  ];
  for (let h = 1; h <= NUM_HEADS; h++) {
    const c = headGrid[h - 1];
    node({
      id: `enc-head-${h}`, label: `Head ${h}`,
      position: { x: c.x, y: c.y, z: 0.6 }, size: 0.9, color: HEAD_COLOR, parent: "enc-mha",
      description: `One of ${NUM_HEADS} identical attention heads running in parallel. Each head projects the input into its own Query/Key/Value spaces, so different heads can specialize in different relationships — syntax, coreference, position — without interfering.`
    });
    node({
      id: `enc-head-${h}-query`, label: "Query",
      position: { x: c.x - 0.8, y: c.y + 0.5, z: 0.6 }, size: 0.4,
      color: QKV_COLOR.query, parent: `enc-head-${h}`,
      description: "What this token is looking for. Each token's query is compared against every key to decide how much attention to pay to each other token."
    });
    node({
      id: `enc-head-${h}-key`, label: "Key",
      position: { x: c.x, y: c.y - 0.7, z: 0.6 }, size: 0.4,
      color: QKV_COLOR.key, parent: `enc-head-${h}`,
      description: "What this token offers to be found by. A high query-key match between two tokens means one attends strongly to the other."
    });
    node({
      id: `enc-head-${h}-value`, label: "Value",
      position: { x: c.x + 0.8, y: c.y + 0.5, z: 0.6 }, size: 0.4,
      color: QKV_COLOR.value, parent: `enc-head-${h}`,
      description: "The information actually passed along once attention weights are decided. The head's output is the attention-weighted mix of all values."
    });
    flow(`enc-head-${h}`, "enc-concat-linear");
  }
  node({
    id: "enc-concat-linear", label: "Concat + Linear",
    position: { x: -5.5, y: -8.9, z: 0.4 }, size: 0.8, color: "#e6e6ff", parent: "enc-mha",
    description: "Glues the parallel heads' outputs back together and mixes them through one linear projection, producing a single vector per token for the rest of the layer."
  });

  // ---- Decoder layers: plain stacked bands (detail lives on the encoder path)
  const decColors = ["#3fe98c", "#4dff9e", "#5bffab"];
  for (let l = 1; l <= NUM_LAYERS; l++) {
    node({
      id: `dec-layer-${l}`, label: `Decoder Layer ${l}`,
      position: { x: 14.5, y: -6 + (l - 1) * 6, z: 0 }, size: 4,
      color: decColors[l - 1], parent: "decoder-stack", shape: "slab",
      description: `Decoder layer ${l}. Like an encoder layer but with two attention steps: masked self-attention over the output generated so far, then cross-attention that consults the encoder's reading of the input.`
    });
    if (l > 1) flow(`dec-layer-${l - 1}`, `dec-layer-${l}`);
  }

  return {
    id: "transformer",
    label: "Transformer Architecture",
    nodes,
    edges
  };
}
