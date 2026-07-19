/**
 * Hardcoded fake transformer scene graph returned by StubBackend.
 * Illustrative only — a faithful transformer layout arrives with the
 * template system in Milestone 3. Must always pass
 * backend/schemas/validate-scene-graph.js (enforced by the test file there).
 */
export const STUB_TRANSFORMER_GRAPH = {
  id: "transformer-stub",
  label: "Transformer (stub)",
  nodes: [
    {
      id: "input-embedding",
      label: "Input Embedding",
      position: { x: -17, y: -4, z: 0 },
      size: 3,
      color: "#4da6ff",
      parent: null
    },
    {
      id: "positional-encoding",
      label: "Positional Encoding",
      position: { x: -17, y: 8, z: 0 },
      size: 2,
      color: "#66d9e8",
      parent: null
    },
    {
      id: "encoder-block",
      label: "Encoder Block",
      position: { x: -4, y: 2, z: 0 },
      size: 5,
      color: "#9b6bff",
      parent: null
    },
    {
      id: "multi-head-attention",
      label: "Multi-Head Attention",
      position: { x: -7, y: 11, z: 3 },
      size: 3.5,
      color: "#ff6bd6",
      parent: "encoder-block"
    },
    {
      id: "feed-forward",
      label: "Feed Forward",
      position: { x: 1, y: 12, z: -3 },
      size: 3,
      color: "#ffb84d",
      parent: "encoder-block"
    },
    {
      id: "decoder-block",
      label: "Decoder Block",
      position: { x: 9, y: -3, z: 0 },
      size: 5,
      color: "#4dff9e",
      parent: null
    },
    {
      id: "output-probabilities",
      label: "Output Probabilities",
      position: { x: 18, y: -8, z: 0 },
      size: 3,
      color: "#ff5c5c",
      parent: null
    }
  ],
  edges: [
    { from: "input-embedding", to: "encoder-block", type: "flow" },
    { from: "positional-encoding", to: "input-embedding", type: "flow" },
    { from: "multi-head-attention", to: "feed-forward", type: "flow" },
    { from: "encoder-block", to: "decoder-block", type: "flow" },
    { from: "decoder-block", to: "output-probabilities", type: "flow" },
    { from: "input-embedding", to: "feed-forward", type: "residual" }
  ]
};
