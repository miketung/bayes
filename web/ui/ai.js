// Thin frontend client for the AI enrichment backend.
// The app works fully without the backend running — check `isAvailable`
// after `probe()` and only render AI affordances when true.

let available = false;
let providerInfo = null;

export function isAvailable() { return available; }
export function provider() { return providerInfo; }

export async function probe() {
  try {
    const res = await fetch('api/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return false;
    const data = await res.json();
    available = !!data.ai;
    providerInfo = data.provider ?? null;
    return available;
  } catch {
    available = false;
    providerInfo = null;
    return false;
  }
}

export async function enrichNode({ node, parents }) {
  const res = await fetch('api/enrich', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ node, parents })
  });
  let payload;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) {
    throw new Error(payload?.error ?? `HTTP ${res.status}`);
  }
  return payload;
}

export async function suggestStates({ node }) {
  const res = await fetch('api/suggest-states', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ node })
  });
  let payload;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok) {
    throw new Error(payload?.error ?? `HTTP ${res.status}`);
  }
  return payload;
}
