// Example networks shipped with the app; fetched from examples/ at runtime.
// Relative paths so the bundle works from any URL prefix.
export const EXAMPLES = [
  { id: 'asia',          name: 'Diagnosis',              file: 'examples/asia.json' },
  { id: 'earthquake',    name: 'Earthquake',             file: 'examples/earthquake.json' },
  { id: 'memory-prices', name: 'Global Memory Prices',   file: 'examples/memory-prices.json' }
];

export async function loadExample(id) {
  const meta = EXAMPLES.find(e => e.id === id);
  if (!meta) throw new Error(`unknown example: ${id}`);
  const res = await fetch(meta.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`failed to load ${meta.file}: HTTP ${res.status}`);
  return await res.json();
}