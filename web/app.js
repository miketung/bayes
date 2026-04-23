// Main orchestrator for the web app.
// Wires: BayesNet state ↔ Cytoscape graph ↔ inspector ↔ list view ↔ toolbar.

import { BayesNet } from '../lib/network.js';
import { parse, stringify } from '../lib/io.js';
import { infer } from '../lib/inference/infer.js';

import { createGraph } from './ui/graph.js';
import { renderInspector } from './ui/inspector.js';
import { renderListView } from './ui/list-view.js';
import { EXAMPLES, loadExample } from './ui/examples.js';
import * as ai from './ui/ai.js';

// --- global state ----------------------------------------------------------

let net = new BayesNet('untitled');
let selectedId = null;
let marginals = {};                  // id -> {state: prob}
let view = 'graph';                  // 'graph' | 'list'
let algorithm = 've';
let samples = 10000;
let lastInferMs = 0;

// --- DOM refs --------------------------------------------------------------

const $cy = document.getElementById('cy');
const $listView = document.getElementById('listView');
const $inspector = document.getElementById('inspector');
const $inspectorContent = document.getElementById('inspectorContent');
const $netName = document.getElementById('netName');
const $statusInfo = document.getElementById('statusInfo');
const $statusTiming = document.getElementById('statusTiming');
const $toasts = document.getElementById('toasts');
const $fileInput = document.getElementById('fileInput');
const $toolbar = document.getElementById('toolbar');
const $drawerBackdrop = document.getElementById('drawerBackdrop');
const $samplesInput = document.getElementById('samplesInput');
const $algoPicker = document.getElementById('algoPicker');
const $algoPickerMobile = document.getElementById('algoPickerMobile');
const $examplePicker = document.getElementById('examplePicker');
const $exampleList = document.getElementById('exampleList');

// --- graph instance --------------------------------------------------------

const graph = createGraph($cy, {
  onSelect: (id) => { selectedId = id; renderInspectorSafe(); showInspectorSheet(!!id); graph.select(id); renderList(); },
  onSelectEdge: (_p, _c) => {
    // Tapping an edge clears the node inspector so keyboard delete is unambiguous.
    selectedId = null;
    renderInspectorSafe();
    showInspectorSheet(false);
    renderList();
  },
  onEdge:   (from, to) => { net.addEdge(from, to); afterEdit(); },
  onCycle:  (msg) => toast(msg, 'warn'),
  onMove:   (id, x, y) => { net.setPosition(id, x, y); scheduleSave(); }
});

// Keyboard: Delete / Backspace removes the selected node or edge.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  const selNodes = graph.cy.$('node:selected');
  const selEdges = graph.cy.$('edge:selected');

  if (selNodes.length) {
    e.preventDefault();
    const ids = selNodes.map(n => n.id());
    for (const id of ids) net.removeNode(id);
    if (selectedId && ids.includes(selectedId)) selectedId = null;
    afterEdit();
    toast(`Deleted ${ids.length} node${ids.length === 1 ? '' : 's'}`);
  } else if (selEdges.length) {
    e.preventDefault();
    let n = 0;
    for (const edge of selEdges) {
      net.removeEdge(edge.source().id(), edge.target().id());
      n++;
    }
    afterEdit();
    toast(`Deleted ${n} edge${n === 1 ? '' : 's'}`);
  }
});

// --- populate examples -----------------------------------------------------

for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.id;
  opt.textContent = ex.name;
  $examplePicker?.appendChild(opt);

  const btn = document.createElement('button');
  btn.className = 'btn-ghost text-sm justify-start';
  btn.textContent = ex.name;
  btn.addEventListener('click', () => loadExampleIntoApp(ex.id));
  $exampleList?.appendChild(btn);
}

$examplePicker?.addEventListener('change', () => {
  if ($examplePicker.value) {
    loadExampleIntoApp($examplePicker.value);
    $examplePicker.value = '';
  }
});

// --- toolbar / top bar -----------------------------------------------------

document.querySelectorAll('[data-action]').forEach(el => {
  el.addEventListener('click', () => handleAction(el.dataset.action));
});
document.querySelectorAll('[data-view]').forEach(el => {
  el.addEventListener('click', () => setView(el.dataset.view));
});

document.getElementById('toggleDrawer')?.addEventListener('click', toggleDrawer);
$drawerBackdrop?.addEventListener('click', () => toggleDrawer(false));

function handleAction(action) {
  switch (action) {
    case 'new':       newNetwork(); break;
    case 'load':      $fileInput.click(); break;
    case 'save':      saveNetwork(); break;
    case 'add-node':  addNodePrompt(); break;
    case 'layout':    autoLayout(); break;
  }
}

$fileInput.addEventListener('change', async () => {
  const f = $fileInput.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    net = parse(text);
    $fileInput.value = '';
    selectedId = null;
    afterEdit({ fit: true });
    toast(`Loaded "${net.name}" (${net.size} nodes)`);
  } catch (e) {
    toast(`Load failed: ${e.message}`, 'warn');
  }
});

$algoPicker?.addEventListener('change', () => {
  algorithm = $algoPicker.value;
  $samplesInput.classList.toggle('hidden', algorithm !== 'lw');
  if ($algoPickerMobile) $algoPickerMobile.value = algorithm;
  runInference();
  scheduleSave();
});
$algoPickerMobile?.addEventListener('change', () => {
  algorithm = $algoPickerMobile.value;
  if ($algoPicker) $algoPicker.value = algorithm;
  $samplesInput.classList.toggle('hidden', algorithm !== 'lw');
  runInference();
  scheduleSave();
});
$samplesInput?.addEventListener('change', () => {
  samples = Math.max(100, Number($samplesInput.value) || 10000);
  if (algorithm === 'lw') runInference();
  scheduleSave();
});

// --- actions ---------------------------------------------------------------

function newNetwork() {
  if (net.size > 0 && !confirm('Discard current network?')) return;
  net = new BayesNet('untitled');
  selectedId = null;
  afterEdit({ fit: true });
  toast('New network');
}

function saveNetwork() {
  const blob = new Blob([stringify(net)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (net.name || 'network') + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
}

async function loadExampleIntoApp(id) {
  try {
    const obj = await loadExample(id);
    net = parse(obj);
    selectedId = null;
    afterEdit({ fit: true });
    toast(`Loaded "${net.name}"`);
  } catch (e) {
    toast(`Failed to load example: ${e.message}`, 'warn');
  }
}

function addNodePrompt() {
  const name = (prompt('Node name:', 'New Variable') || '').trim();
  if (!name) return;
  const statesRaw = prompt('States (comma-separated):', 'no,yes');
  if (!statesRaw) return;
  const states = statesRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (states.length < 2) { alert('Need at least 2 states.'); return; }
  const id = uniqueIdFromName(name);
  const pos = graph.cy.extent();
  const center = { x: (pos.x1 + pos.x2) / 2, y: (pos.y1 + pos.y2) / 2 };
  net.addNode({ id, name, states, x: center.x, y: center.y });
  selectedId = id;
  afterEdit();
}

function autoLayout() {
  graph.layout();
  // Sync new positions back to the net.
  graph.cy.nodes().forEach(n => {
    const p = n.position();
    net.setPosition(n.id(), p.x, p.y);
  });
  toast('Auto-layout applied');
}

// Slugify a freeform name into a safe unique node id.
// e.g. "Visit to Asia!" → "visit_to_asia"; "42" → "42"; collisions → "_2", "_3", …
function uniqueIdFromName(name) {
  let base = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) base = 'node';
  if (!net.hasNode(base)) return base;
  let i = 2;
  while (net.hasNode(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// --- inspector / list wiring -----------------------------------------------

const inspectorActions = {
  rename:  (id, name) => { net.renameNode(id, name); afterEdit(); },
  setDescription: (id, text) => { net.setDescription(id, text); renderList(); scheduleSave(); },
  clearAiSources: (id) => { net.setAiSources(id, []); afterEdit(); },
  enrich: async (id) => {
    if (!ai.isAvailable()) { toast('AI backend unavailable', 'warn'); return; }
    try {
      const n = net.getNode(id);
      const parents = n.parents.map(pid => {
        const p = net.getNode(pid);
        return { id: p.id, name: p.name, description: p.description, states: [...p.states] };
      });
      const payload = {
        node: {
          id: n.id, name: n.name, description: n.description,
          states: [...n.states]
        },
        parents
      };
      const t0 = performance.now();
      const result = await ai.enrichNode(payload);
      const ms = Math.round(performance.now() - t0);

      // Apply the CPT (marginal is equivalent to a no-parent CPT).
      let cpt;
      if (result.type === 'cpt') cpt = result.cpt;
      else cpt = n.states.map(s => result.marginal[s] ?? 0);
      net.setCPT(id, cpt, { normalize: true });
      net.setAiSources(id, result.sources ?? []);
      afterEdit();
      toast(`AI: ${result.sources?.length ?? 0} sources · ${ms} ms`);
    } catch (e) {
      toast(`AI enrich failed: ${e.message}`, 'warn');
    }
  },
  setStates: (id, states) => {
    try { net.setStates(id, states); afterEdit(); }
    catch (e) { toast(e.message, 'warn'); renderInspectorSafe(); }
  },
  setCPT: (id, cpt) => {
    try { net.setCPT(id, cpt, { normalize: false }); }
    catch (e) {
      // Row sums off — keep the displayed values, only re-run inference if valid.
      // We don't re-render inspector to preserve in-flight typing.
      return;
    }
    runInference();
    syncGraph();
    renderList();
    scheduleSave();
  },
  setEvidence:   (id, idx) => { net.setEvidence(id, idx); afterEdit(); },
  clearEvidence: (id) => { net.clearEvidence(id); afterEdit(); },
  removeNode:    (id) => { net.removeNode(id); selectedId = null; afterEdit(); },
  addEdge:       (p, c) => {
    try { net.addEdge(p, c); afterEdit(); }
    catch (e) { toast(e.message, 'warn'); }
  },
  removeEdge:    (p, c) => { net.removeEdge(p, c); afterEdit(); },
  deselect:      () => { selectedId = null; showInspectorSheet(false); graph.select(null); renderInspectorSafe(); renderList(); },
  select:        (id) => { selectedId = id; graph.select(id); showInspectorSheet(!!id); renderInspectorSafe(); renderList(); }
};

function renderInspectorSafe() {
  renderInspector($inspectorContent, { net, selectedId, marginals, actions: inspectorActions });
}

function renderList() {
  if (view !== 'list') return;
  renderListView($listView, {
    net,
    marginals,
    selectedId,
    onSelect: (id) => {
      selectedId = id;
      renderInspectorSafe();
      showInspectorSheet(true);
    }
  });
}

function setView(v) {
  view = v;
  document.querySelectorAll('.view-toggle').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $cy.style.display = v === 'graph' ? '' : 'none';
  $listView.classList.toggle('hidden', v !== 'list');
  if (v === 'list') renderList();
  else {
    // Trigger cytoscape to reflow (it was hidden).
    requestAnimationFrame(() => graph.cy.resize());
  }
  scheduleSave();
}

function toggleDrawer(open) {
  const shouldOpen = open ?? $toolbar.classList.contains('-translate-x-full');
  $toolbar.classList.toggle('-translate-x-full', !shouldOpen);
  $drawerBackdrop.classList.toggle('hidden', !shouldOpen);
}

function showInspectorSheet(show) {
  // Only affects mobile layout where inspector is position:fixed at bottom.
  if (window.innerWidth >= 768) return;
  $inspector.classList.toggle('translate-y-full', !show);
}

// --- after every edit -------------------------------------------------------

function afterEdit({ fit = false } = {}) {
  $netName.textContent = net.name ? `· ${net.name}` : '';
  runInference();
  syncGraph({ fit });
  renderInspectorSafe();
  renderList();
  updateStatus();
  scheduleSave();
}

// --- local persistence -----------------------------------------------------
//
// The whole app state (net + view prefs) is kept in localStorage so Vite's
// HMR full-reload, a browser refresh, or a closed tab doesn't wipe the user's
// in-progress work.  Saves are debounced so rapid edits don't thrash IO.

const LS = {
  net:  'bayes:net:v1',
  view: 'bayes:view:v1',
  algo: 'bayes:algo:v1',
  samples: 'bayes:samples:v1'
};

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}
function saveNow() {
  try {
    localStorage.setItem(LS.net, stringify(net));
    localStorage.setItem(LS.view, view);
    localStorage.setItem(LS.algo, algorithm);
    localStorage.setItem(LS.samples, String(samples));
  } catch (_) { /* quota, private mode, etc. — silently ignore */ }
}

// Save on every tab close / refresh too, in case the debounce hasn't fired.
window.addEventListener('beforeunload', saveNow);

function syncGraph({ fit = false } = {}) {
  graph.sync(net, marginals);
  graph.select(selectedId);
  if (fit) requestAnimationFrame(() => graph.fit());
}

function runInference() {
  const started = performance.now();
  const out = {};
  for (const id of net.ids()) {
    try {
      out[id] = infer(net, id, {
        algorithm,
        samples: algorithm === 'lw' ? samples : undefined
      });
    } catch (e) {
      out[id] = null;
      toast(`${id}: ${e.message}`, 'warn');
    }
  }
  lastInferMs = performance.now() - started;
  marginals = out;
  syncGraph();
  // In-place updates: preserve DOM (and focus) in the CPT editor and other
  // inputs while belief bars animate to new values.
  updateBeliefs($inspectorContent);
  updateBeliefs($listView);
  updateStatus();
}

// Update every `.marginal-bar[data-node-id][data-state-idx]` inside `container`
// with the current marginal, without rebuilding any DOM.  Used instead of a
// full re-render when only probabilities changed, so the CPT editor keeps its
// focus during Tab/Enter.
function updateBeliefs(container) {
  if (!container) return;
  const bars = container.querySelectorAll('.marginal-bar[data-node-id]');
  for (const bar of bars) {
    const nodeId = bar.dataset.nodeId;
    const stateIdx = Number(bar.dataset.stateIdx);
    if (!net.hasNode(nodeId)) continue;
    const m = marginals[nodeId];
    if (!m) continue;
    const stateName = net.getNode(nodeId).states[stateIdx];
    const p = m[stateName] ?? 0;
    const pct = (p * 100).toFixed(1);
    const fill = bar.querySelector('.fill');
    const pctEl = bar.querySelector('.pct');
    if (fill) fill.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
  }
}

function updateStatus() {
  const edgeCount = [...net.nodes.values()].reduce((n, v) => n + v.parents.length, 0);
  const aiTag = ai.isAvailable() ? `  ·  ✦ AI (${ai.provider()?.model ?? 'on'})` : '';
  $statusInfo.textContent = `${net.size} node${net.size === 1 ? '' : 's'}, ${edgeCount} edge${edgeCount === 1 ? '' : 's'}${aiTag}`;
  const algoLabel = algorithm === 've' ? 'VE' : `LW (${samples.toLocaleString()})`;
  $statusTiming.textContent = net.size ? `${algoLabel} · ${lastInferMs.toFixed(1)} ms` : '';
}

// --- toasts ----------------------------------------------------------------

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = text;
  $toasts.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

// --- boot ------------------------------------------------------------------

(async () => {
  // 1. Restore previous session from localStorage if present — so HMR / refresh
  //    doesn't destroy in-progress work.
  // 2. Fall back to the Asia example so the canvas is never empty on first run.
  let restored = false;
  try {
    const saved = localStorage.getItem(LS.net);
    if (saved) { net = parse(saved); restored = true; }
  } catch (e) {
    console.warn('could not restore session:', e);
  }
  if (!restored) {
    try {
      net = parse(await loadExample('asia'));
    } catch (e) {
      console.warn('could not preload example:', e);
      net = new BayesNet('untitled');
    }
  }

  // Restore view + algorithm preferences.
  const savedView = localStorage.getItem(LS.view);
  if (savedView === 'graph' || savedView === 'list') view = savedView;
  const savedAlgo = localStorage.getItem(LS.algo);
  if (savedAlgo === 've' || savedAlgo === 'lw') algorithm = savedAlgo;
  const savedSamples = Number(localStorage.getItem(LS.samples));
  if (Number.isFinite(savedSamples) && savedSamples >= 100) samples = savedSamples;

  // Sync the UI widgets to whatever we restored.
  if ($algoPicker) $algoPicker.value = algorithm;
  if ($algoPickerMobile) $algoPickerMobile.value = algorithm;
  $samplesInput.value = String(samples);
  $samplesInput.classList.toggle('hidden', algorithm !== 'lw');
  if (view !== 'graph') setView(view);

  afterEdit({ fit: !restored });    // only auto-fit on fresh-load; respect saved positions otherwise

  // Probe the optional AI backend; if reachable, re-render the inspector so
  // the AI button appears.  If not, stay silent — the app is fully functional
  // without it.
  ai.probe().then(on => {
    if (on) {
      renderInspectorSafe();
      updateStatus();
    }
  });
})();

// Keep Cytoscape happy when the viewport resizes.
window.addEventListener('resize', () => graph.cy.resize());
