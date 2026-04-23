// Top-level orchestration for /api/enrich.
// Validates the request shape and delegates to the configured search provider.

import { getProvider } from './search.js';

export function enrichAvailable() {
  try { return getProvider().available(); } catch { return false; }
}

export function providerInfo() {
  try {
    const p = getProvider();
    return { id: p.id, model: p.model?.() ?? null, available: p.available() };
  } catch { return { id: null, model: null, available: false }; }
}

export async function suggestStates({ node }) {
  if (!node || typeof node !== 'object') throw new Error('missing node');
  if (!node.name && !node.id) throw new Error('node.name or node.id required');
  const provider = getProvider();
  if (!provider.available()) throw new Error('provider not configured');
  if (typeof provider.suggestStates !== 'function') {
    throw new Error(`provider "${provider.id}" does not support state suggestion`);
  }
  return provider.suggestStates({ node });
}

export async function enrich({ node, parents = [] }) {
  if (!node || typeof node !== 'object') throw new Error('missing node');
  if (!node.id) throw new Error('node.id required');
  if (!Array.isArray(node.states) || node.states.length < 2) {
    throw new Error('node.states must be an array of >= 2 state names');
  }
  if (!Array.isArray(parents)) throw new Error('parents must be an array');
  for (const p of parents) {
    if (!p?.id || !Array.isArray(p.states) || p.states.length < 2) {
      throw new Error(`invalid parent: ${JSON.stringify(p)}`);
    }
  }
  const provider = getProvider();
  if (!provider.available()) throw new Error('provider not configured');
  return provider.search({ node, parents });
}
