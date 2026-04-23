// Example networks shipped with the app; fetched from examples/ at runtime.
// Relative paths so the bundle works from any URL prefix.
export const EXAMPLES = [
  { id: 'asia',       name: 'Asia (diagnosis)',       file: 'examples/asia.json' },
  { id: 'cancer',     name: 'Cancer',                 file: 'examples/cancer.json' },
  { id: 'earthquake', name: 'Earthquake (Pearl)',     file: 'examples/earthquake.json' }
];

export async function loadExample(id) {
  const meta = EXAMPLES.find(e => e.id === id);
  if (!meta) throw new Error(`unknown example: ${id}`);
  const res = await fetch(meta.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`failed to load ${meta.file}: HTTP ${res.status}`);
  return await res.json();
}
