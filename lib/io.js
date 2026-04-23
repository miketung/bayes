import { BayesNet } from './network.js';

export function parse(text) {
  const obj = typeof text === 'string' ? JSON.parse(text) : text;
  return BayesNet.fromJSON(obj);
}

export function stringify(net, { pretty = true } = {}) {
  return JSON.stringify(net.toJSON(), null, pretty ? 2 : 0);
}
