// Search provider abstraction.
//
// A provider is an object `{ id, available(), search({name, description, parents, ownStates}) }`
// whose `search` method returns:
//
//   { type: 'marginal', marginal: {state: prob}, sources: [...], reasoning? }
//   { type: 'cpt',      cpt: [row-major...],     sources: [...], reasoning? }
//
// `sources` is an array of { title, url, excerpt?, polarity: 'positive'|'negative',
// weight: 0..1, affectsState? }.
//
// For now the only provider is OpenAI's Responses API with its built-in
// `web_search` tool.  Add more providers (Tavily, Brave, self-hosted) by
// exporting another function with the same shape and selecting via env.

import { openaiProvider } from './providers/openai.js';

export function getProvider() {
  const choice = (process.env.BAYES_PROVIDER || 'openai').toLowerCase();
  switch (choice) {
    case 'openai': return openaiProvider();
    default:
      throw new Error(`unknown BAYES_PROVIDER: ${choice}`);
  }
}
