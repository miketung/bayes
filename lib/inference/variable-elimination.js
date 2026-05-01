import { factorFromCPT, multiply, marginalize, reduce, normalize } from './factor.js';

// Exact inference by variable elimination.
// Returns an object mapping stateName -> probability for the query node.
//
// If `evidence` is omitted, uses net.evidence.
export function variableElimination(net, queryId, evidence) {
  const q = net.getNode(queryId);
  const ev = evidence ?? mapFromMap(net.evidence);

  if (queryId in ev) {
    const eState = ev[queryId];
    const evIdx = typeof eState === 'number'
      ? eState
      : q.states.indexOf(eState);
    const out = {};
    for (let i = 0; i < q.states.length; i++) out[q.states[i]] = i === evIdx ? 1 : 0;
    return out;
  }

  // 1. Build one factor per node, reducing by evidence up front.
  let factors = [];
  for (const n of net.nodes.values()) {
    const parentCards = n.parents.map(p => net.getNode(p).states.length);
    let f = factorFromCPT(n.id, n.parents, parentCards, n.states.length, n.cpt);
    for (const [eid, eState] of Object.entries(ev)) {
      const evIdx = typeof eState === 'number'
        ? eState
        : net.getNode(eid).states.indexOf(eState);
      if (evIdx < 0) throw new Error(`evidence: unknown state for ${eid}`);
      if (f.vars.includes(eid)) f = reduce(f, eid, evIdx);
    }
    factors.push(f);
  }

  // 2. Determine variables to eliminate: every variable except query and evidence.
  const keep = new Set([queryId, ...Object.keys(ev)]);
  const toEliminate = [];
  for (const id of net.ids()) if (!keep.has(id)) toEliminate.push(id);

  // 3. Greedy min-neighbors elimination order.
  while (toEliminate.length) {
    // For each candidate, count unique neighbors across factors that mention it.
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < toEliminate.length; i++) {
      const v = toEliminate[i];
      const neigh = new Set();
      for (const f of factors) {
        if (!f.vars.includes(v)) continue;
        for (const u of f.vars) if (u !== v) neigh.add(u);
      }
      if (neigh.size < bestScore) {
        bestScore = neigh.size;
        best = i;
      }
    }
    const v = toEliminate.splice(best, 1)[0];
    // Multiply all factors mentioning v; marginalize v out; replace.
    const containing = [];
    const rest = [];
    for (const f of factors) (f.vars.includes(v) ? containing : rest).push(f);
    if (containing.length === 0) { factors = rest; continue; }
    let product = containing[0];
    for (let i = 1; i < containing.length; i++) product = multiply(product, containing[i]);
    const summed = marginalize(product, v);
    factors = [...rest, summed];
  }

  // 4. Multiply remaining factors; marginalize out any remaining non-query var
  // (should only be query left, but be defensive).
  let result = factors[0];
  for (let i = 1; i < factors.length; i++) result = multiply(result, factors[i]);
  for (const v of [...result.vars]) if (v !== queryId) result = marginalize(result, v);

  // 5. Normalize.
  result = normalize(result);

  const out = {};
  for (let i = 0; i < q.states.length; i++) out[q.states[i]] = result.values[i];
  return out;
}

function mapFromMap(m) {
  const o = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}
