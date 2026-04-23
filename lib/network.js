// BayesNet — in-memory discrete Bayesian network.
//
// Data model:
//   nodes:   id -> { id, name, states[], parents[], cpt[], description? }
//   evidence: id -> stateIndex
//   positions: id -> {x, y}   (UI hint; preserved through JSON roundtrip)
//
// `description` is an optional free-text explanation of what the variable
// represents — useful for humans reading the net and for LLMs reasoning
// about the model.  Omitted from JSON when empty.
//
// CPT layout (row-major): for a node with parents [p1, p2, ..., pK] each having
// |s_i| states, and the node itself having |s| states, the CPT length is
// (prod |s_i|) * |s|.  Rows iterate over parent combinations with p1 as the
// most-significant digit, pK as the least.  Within a row, entries are indexed
// by own state.  Each row must sum to 1.

export class BayesNet {
  constructor(name = 'untitled') {
    this.name = name;
    this.nodes = new Map();
    this.evidence = new Map();
    this.positions = new Map();
  }

  // --- introspection ---------------------------------------------------------

  get size() { return this.nodes.size; }

  getNode(id) {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown node: ${id}`);
    return n;
  }

  hasNode(id) { return this.nodes.has(id); }

  ids() { return [...this.nodes.keys()]; }

  children(id) {
    const out = [];
    for (const n of this.nodes.values()) {
      if (n.parents.includes(id)) out.push(n.id);
    }
    return out;
  }

  stateIndex(id, state) {
    const n = this.getNode(id);
    if (typeof state === 'number') {
      if (state < 0 || state >= n.states.length) {
        throw new Error(`state index ${state} out of range for ${id}`);
      }
      return state;
    }
    const i = n.states.indexOf(state);
    if (i < 0) throw new Error(`unknown state "${state}" for node ${id}`);
    return i;
  }

  // --- structural mutation --------------------------------------------------

  addNode({ id, name, states, parents = [], cpt = null, description, x, y }) {
    if (!id) throw new Error('node id required');
    if (this.nodes.has(id)) throw new Error(`duplicate node id: ${id}`);
    if (!Array.isArray(states) || states.length < 2) {
      throw new Error(`node ${id}: need >= 2 states`);
    }
    if (new Set(states).size !== states.length) {
      throw new Error(`node ${id}: duplicate state names`);
    }
    for (const p of parents) {
      if (!this.nodes.has(p)) throw new Error(`parent ${p} does not exist`);
    }
    const node = {
      id,
      name: name ?? id,
      states: [...states],
      parents: [...parents],
      cpt: cpt ? [...cpt] : uniformCPT(this, parents, states.length)
    };
    if (typeof description === 'string' && description.length > 0) {
      node.description = description;
    }
    validateCPTShape(this, node);
    this.nodes.set(id, node);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this.positions.set(id, { x, y });
    }
    return node;
  }

  setDescription(id, text) {
    const n = this.getNode(id);
    if (typeof text !== 'string' || text.length === 0) {
      delete n.description;
    } else {
      n.description = text;
    }
  }

  removeNode(id) {
    this.getNode(id);
    this.nodes.delete(id);
    this.evidence.delete(id);
    this.positions.delete(id);
    // Remove from any child's parents; reshape child CPT to uniform over remaining parents.
    for (const child of this.nodes.values()) {
      const idx = child.parents.indexOf(id);
      if (idx >= 0) {
        child.parents.splice(idx, 1);
        child.cpt = uniformCPT(this, child.parents, child.states.length);
      }
    }
  }

  renameNode(id, newName) {
    const n = this.getNode(id);
    n.name = newName;
  }

  setStates(id, states) {
    if (!Array.isArray(states) || states.length < 2) {
      throw new Error('need >= 2 states');
    }
    if (new Set(states).size !== states.length) {
      throw new Error('duplicate state names');
    }
    const n = this.getNode(id);
    const cardinalityChanged = states.length !== n.states.length;
    n.states = [...states];
    // Only wipe CPTs when the cardinality changed — a pure rename leaves
    // the numbers meaningful (same indices, just new labels).  Changing the
    // count invalidates shape, so we must reset to uniform.
    if (cardinalityChanged) {
      n.cpt = uniformCPT(this, n.parents, states.length);
      for (const child of this.nodes.values()) {
        if (child.parents.includes(id)) {
          child.cpt = uniformCPT(this, child.parents, child.states.length);
        }
      }
      // Evidence index may now be out of range.
      if (this.evidence.has(id) && this.evidence.get(id) >= states.length) {
        this.evidence.delete(id);
      }
    }
  }

  addEdge(parentId, childId) {
    if (parentId === childId) throw new Error('self-loop not allowed');
    const parent = this.getNode(parentId);
    const child = this.getNode(childId);
    if (child.parents.includes(parentId)) return; // already present
    // Acyclicity: adding parent -> child creates a cycle iff parent is reachable from child.
    if (reachable(this, childId, parentId)) {
      throw new Error(`cycle: ${parentId} is a descendant of ${childId}`);
    }
    child.parents.push(parentId);
    child.cpt = uniformCPT(this, child.parents, child.states.length);
    void parent;
  }

  removeEdge(parentId, childId) {
    const child = this.getNode(childId);
    const idx = child.parents.indexOf(parentId);
    if (idx < 0) return;
    child.parents.splice(idx, 1);
    child.cpt = uniformCPT(this, child.parents, child.states.length);
  }

  // --- CPT + evidence -------------------------------------------------------

  setCPT(id, cpt, { normalize = false } = {}) {
    const n = this.getNode(id);
    const expected = expectedCPTLength(this, n.parents, n.states.length);
    if (cpt.length !== expected) {
      throw new Error(`CPT length for ${id}: expected ${expected}, got ${cpt.length}`);
    }
    const out = [...cpt];
    const rowSize = n.states.length;
    for (let row = 0; row < out.length; row += rowSize) {
      let sum = 0;
      for (let k = 0; k < rowSize; k++) {
        if (out[row + k] < 0) {
          throw new Error(`CPT for ${id}: negative entry at row ${row / rowSize}`);
        }
        sum += out[row + k];
      }
      if (sum === 0) throw new Error(`CPT for ${id}: zero-sum row ${row / rowSize}`);
      if (normalize) {
        for (let k = 0; k < rowSize; k++) out[row + k] /= sum;
      } else if (Math.abs(sum - 1) > 1e-6) {
        throw new Error(`CPT for ${id}: row ${row / rowSize} sums to ${sum.toFixed(4)}, not 1`);
      }
    }
    n.cpt = out;
  }

  setEvidence(id, state) {
    this.evidence.set(id, this.stateIndex(id, state));
  }

  clearEvidence(id) {
    if (id === undefined) this.evidence.clear();
    else this.evidence.delete(id);
  }

  setPosition(id, x, y) {
    this.getNode(id);
    this.positions.set(id, { x, y });
  }

  // --- topology -------------------------------------------------------------

  topologicalOrder() {
    const indeg = new Map();
    const order = [];
    for (const n of this.nodes.values()) indeg.set(n.id, 0);
    for (const n of this.nodes.values()) {
      for (const p of n.parents) {
        // count children indegree: p -> n.id adds 1 to n.id
        indeg.set(n.id, indeg.get(n.id) + 1);
      }
    }
    const queue = [];
    for (const [id, d] of indeg) if (d === 0) queue.push(id);
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const c of this.children(id)) {
        const d = indeg.get(c) - 1;
        indeg.set(c, d);
        if (d === 0) queue.push(c);
      }
    }
    if (order.length !== this.nodes.size) throw new Error('network contains a cycle');
    return order;
  }

  clone() {
    return BayesNet.fromJSON(this.toJSON());
  }

  // --- JSON ------------------------------------------------------------------

  toJSON() {
    const nodes = [];
    for (const id of this.topologicalOrder()) {
      const n = this.nodes.get(id);
      const serialized = {
        id: n.id,
        name: n.name,
        states: [...n.states],
        parents: [...n.parents],
        cpt: [...n.cpt]
      };
      if (n.description) serialized.description = n.description;
      nodes.push(serialized);
    }
    const evidence = {};
    for (const [id, idx] of this.evidence) evidence[id] = this.nodes.get(id).states[idx];
    const positions = {};
    for (const [id, p] of this.positions) positions[id] = { x: p.x, y: p.y };
    return { version: 1, name: this.name, nodes, evidence, positions };
  }

  static fromJSON(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('fromJSON: object required');
    if (!Array.isArray(obj.nodes)) throw new Error('fromJSON: nodes array required');
    const net = new BayesNet(obj.name ?? 'untitled');
    // Nodes must be added in topological order; we accept any order and retry.
    const pending = [...obj.nodes];
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (let i = 0; i < pending.length; ) {
        const nd = pending[i];
        if ((nd.parents ?? []).every(p => net.nodes.has(p))) {
          net.addNode({
            id: nd.id,
            name: nd.name,
            states: nd.states,
            parents: nd.parents ?? [],
            cpt: nd.cpt,
            description: nd.description
          });
          pending.splice(i, 1);
          progress = true;
        } else {
          i++;
        }
      }
    }
    if (pending.length) {
      throw new Error(`fromJSON: unresolvable parents for: ${pending.map(n => n.id).join(', ')}`);
    }
    if (obj.evidence && typeof obj.evidence === 'object') {
      for (const [id, state] of Object.entries(obj.evidence)) {
        net.setEvidence(id, state);
      }
    }
    if (obj.positions && typeof obj.positions === 'object') {
      for (const [id, p] of Object.entries(obj.positions)) {
        if (net.hasNode(id) && Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
          net.setPosition(id, p.x, p.y);
        }
      }
    }
    return net;
  }
}

// --- helpers ----------------------------------------------------------------

function expectedCPTLength(net, parents, ownStates) {
  let rows = 1;
  for (const p of parents) rows *= net.getNode(p).states.length;
  return rows * ownStates;
}

function uniformCPT(net, parents, ownStates) {
  const len = expectedCPTLength(net, parents, ownStates);
  const v = 1 / ownStates;
  return new Array(len).fill(v);
}

function validateCPTShape(net, node) {
  const expected = expectedCPTLength(net, node.parents, node.states.length);
  if (node.cpt.length !== expected) {
    throw new Error(`node ${node.id}: CPT length ${node.cpt.length} != ${expected}`);
  }
  const rowSize = node.states.length;
  for (let row = 0; row < node.cpt.length; row += rowSize) {
    let sum = 0;
    for (let k = 0; k < rowSize; k++) sum += node.cpt[row + k];
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`node ${node.id}: CPT row ${row / rowSize} sums to ${sum.toFixed(4)}, not 1`);
    }
  }
}

// True if `target` is reachable from `start` by following directed edges.
function reachable(net, start, target) {
  const visited = new Set();
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === target) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const c of net.children(cur)) stack.push(c);
  }
  return false;
}

// Given a parent state assignment (array of state indices matching `parents`
// order), return the row offset into the CPT.
export function cptRowOffset(net, parents, parentStates) {
  let offset = 0;
  for (let i = 0; i < parents.length; i++) {
    const ps = net.getNode(parents[i]).states.length;
    offset = offset * ps + parentStates[i];
  }
  return offset;
}
