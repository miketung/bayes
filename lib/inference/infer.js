import { variableElimination } from './variable-elimination.js';
import { likelihoodWeighting } from './likelihood-weighting.js';

// High-level entry point. `opts.algorithm` is 've' (default) or 'lw'.
export function infer(net, queryId, { evidence, algorithm = 've', samples, rng } = {}) {
  switch (algorithm) {
    case 've':
    case 'variable-elimination':
      return variableElimination(net, queryId, evidence);
    case 'lw':
    case 'likelihood-weighting':
      return likelihoodWeighting(net, queryId, evidence, { samples, rng });
    default:
      throw new Error(`unknown inference algorithm: ${algorithm}`);
  }
}
