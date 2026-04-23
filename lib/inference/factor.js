// Factor: a function over a set of discrete variables.
//
//   vars:      [varId, ...]                   — in order of significance (first = most sig)
//   cards:     [numStates per var]
//   values:    Float64Array, length = prod(cards), row-major (vars[0] most sig)
//
// An empty-scope factor is a scalar: vars=[], cards=[], values=[scalar].

export function makeFactor(vars, cards, values) {
  if (vars.length !== cards.length) throw new Error('vars/cards mismatch');
  const expected = cards.reduce((a, b) => a * b, 1);
  if (values.length !== expected) {
    throw new Error(`factor values: expected ${expected}, got ${values.length}`);
  }
  return { vars: [...vars], cards: [...cards], values: Float64Array.from(values) };
}

// Build a factor from a CPT where `vars = [...parents, nodeId]` with cards
// `[...parentCards, ownCard]`.  CPT is already in the right order (parents
// most-sig, own least-sig).
export function factorFromCPT(nodeId, parents, parentCards, ownCard, cpt) {
  const vars = [...parents, nodeId];
  const cards = [...parentCards, ownCard];
  return makeFactor(vars, cards, cpt);
}

// Return the index into `f.values` for a given assignment.
// `assign` is an object mapping varId -> stateIndex.  Vars not in f.vars are ignored.
export function indexOf(f, assign) {
  let idx = 0;
  for (let i = 0; i < f.vars.length; i++) {
    idx = idx * f.cards[i] + assign[f.vars[i]];
  }
  return idx;
}

// Iterate every assignment in f; call cb(assign, index, value).
export function eachAssign(f, cb) {
  const n = f.vars.length;
  const a = new Array(n).fill(0);
  const len = f.values.length;
  for (let idx = 0; idx < len; idx++) {
    const assign = {};
    for (let i = 0; i < n; i++) assign[f.vars[i]] = a[i];
    cb(assign, idx, f.values[idx]);
    // increment rightmost digit
    for (let i = n - 1; i >= 0; i--) {
      if (++a[i] < f.cards[i]) break;
      a[i] = 0;
    }
  }
}

// Multiply two factors. Union of scopes, new var order = f1.vars then new vars from f2.
export function multiply(f1, f2) {
  const vars = [...f1.vars];
  const cards = [...f1.cards];
  const f2NewVars = [];
  for (let i = 0; i < f2.vars.length; i++) {
    if (!vars.includes(f2.vars[i])) {
      vars.push(f2.vars[i]);
      cards.push(f2.cards[i]);
      f2NewVars.push(f2.vars[i]);
    }
  }
  const total = cards.reduce((a, b) => a * b, 1);
  const values = new Float64Array(total);
  const a = new Array(vars.length).fill(0);
  // Precompute strides for f1 and f2 indexing from assignment.
  const f1Pos = f1.vars.map(v => vars.indexOf(v));
  const f2Pos = f2.vars.map(v => vars.indexOf(v));
  for (let idx = 0; idx < total; idx++) {
    // f1 index
    let i1 = 0;
    for (let k = 0; k < f1.vars.length; k++) i1 = i1 * f1.cards[k] + a[f1Pos[k]];
    // f2 index
    let i2 = 0;
    for (let k = 0; k < f2.vars.length; k++) i2 = i2 * f2.cards[k] + a[f2Pos[k]];
    values[idx] = f1.values[i1] * f2.values[i2];
    for (let i = a.length - 1; i >= 0; i--) {
      if (++a[i] < cards[i]) break;
      a[i] = 0;
    }
  }
  void f2NewVars;
  return { vars, cards, values };
}

// Sum out a variable. Returns a new factor.
export function marginalize(f, varId) {
  const pos = f.vars.indexOf(varId);
  if (pos < 0) return f;
  const newVars = f.vars.filter((_, i) => i !== pos);
  const newCards = f.cards.filter((_, i) => i !== pos);
  const total = newCards.reduce((a, b) => a * b, 1);
  const out = new Float64Array(total);
  const card = f.cards[pos];
  // For each original index, compute the new-index by stripping position `pos`.
  // Use strides: contribution of digit d at position p in old = d * (prod of cards after p).
  const oldLen = f.values.length;
  // Stride for pos in old:
  let strideAtPos = 1;
  for (let i = pos + 1; i < f.cards.length; i++) strideAtPos *= f.cards[i];
  // Block size and repetitions:
  //  high part (positions 0..pos-1) stride in new layout:
  let highStrideOld = strideAtPos * card;
  let highStrideNew = strideAtPos;
  for (let idx = 0; idx < oldLen; idx++) {
    const high = Math.floor(idx / highStrideOld);
    const withinHigh = idx % highStrideOld;
    const digit = Math.floor(withinHigh / strideAtPos);
    const low = withinHigh % strideAtPos;
    const newIdx = high * highStrideNew + low;
    out[newIdx] += f.values[idx];
    void digit;
  }
  return { vars: newVars, cards: newCards, values: out };
}

// Reduce a factor by fixing a variable to a given state.
// Drops the variable from scope.
export function reduce(f, varId, stateIdx) {
  const pos = f.vars.indexOf(varId);
  if (pos < 0) return f;
  const newVars = f.vars.filter((_, i) => i !== pos);
  const newCards = f.cards.filter((_, i) => i !== pos);
  const total = newCards.reduce((a, b) => a * b, 1);
  const out = new Float64Array(total);
  let strideAtPos = 1;
  for (let i = pos + 1; i < f.cards.length; i++) strideAtPos *= f.cards[i];
  const card = f.cards[pos];
  const highStrideOld = strideAtPos * card;
  const highStrideNew = strideAtPos;
  for (let newIdx = 0; newIdx < total; newIdx++) {
    const high = Math.floor(newIdx / highStrideNew);
    const low = newIdx % highStrideNew;
    const oldIdx = high * highStrideOld + stateIdx * strideAtPos + low;
    out[newIdx] = f.values[oldIdx];
  }
  return { vars: newVars, cards: newCards, values: out };
}

// Normalize so values sum to 1. Returns a new factor (non-destructive).
export function normalize(f) {
  let sum = 0;
  for (let i = 0; i < f.values.length; i++) sum += f.values[i];
  if (sum === 0) throw new Error('normalize: zero-sum factor (inconsistent evidence?)');
  const out = new Float64Array(f.values.length);
  for (let i = 0; i < f.values.length; i++) out[i] = f.values[i] / sum;
  return { vars: [...f.vars], cards: [...f.cards], values: out };
}
