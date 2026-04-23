import { cptRowOffset } from '../network.js';

// Approximate inference by likelihood weighting.
// Returns { stateName -> probability } for the query node.
export function likelihoodWeighting(net, queryId, evidence, { samples = 10000, rng = Math.random } = {}) {
  const q = net.getNode(queryId);
  const ev = evidence ?? mapFromMap(net.evidence);

  // Resolve evidence to state indices.
  const evIdx = {};
  for (const [id, state] of Object.entries(ev)) {
    evIdx[id] = typeof state === 'number' ? state : net.getNode(id).states.indexOf(state);
    if (evIdx[id] < 0) throw new Error(`evidence: unknown state for ${id}`);
  }

  const order = net.topologicalOrder();
  const counts = new Array(q.states.length).fill(0);
  let totalWeight = 0;

  const sample = {};
  for (let s = 0; s < samples; s++) {
    let w = 1;
    for (const id of order) {
      const n = net.getNode(id);
      const parentStates = n.parents.map(p => sample[p]);
      const rowOff = cptRowOffset(net, n.parents, parentStates);
      const rowStart = rowOff * n.states.length;
      if (Object.prototype.hasOwnProperty.call(evIdx, id)) {
        const obs = evIdx[id];
        w *= n.cpt[rowStart + obs];
        sample[id] = obs;
      } else {
        // Sample from CPT row.
        const r = rng();
        let acc = 0, pick = n.states.length - 1;
        for (let k = 0; k < n.states.length; k++) {
          acc += n.cpt[rowStart + k];
          if (r < acc) { pick = k; break; }
        }
        sample[id] = pick;
      }
    }
    counts[sample[queryId]] += w;
    totalWeight += w;
  }

  const out = {};
  if (totalWeight === 0) {
    // All samples had zero weight (impossible evidence). Fall back to uniform 0.
    for (const s of q.states) out[s] = 0;
    return out;
  }
  for (let i = 0; i < q.states.length; i++) out[q.states[i]] = counts[i] / totalWeight;
  return out;
}

function mapFromMap(m) {
  const o = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}
