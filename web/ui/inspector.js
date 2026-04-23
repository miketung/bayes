// Right-side inspector: shows selected node's editable name, states, CPT,
// evidence buttons, and a posterior bar chart.
//
// Emits all mutations through the `actions` callbacks so app.js can re-run
// inference and re-render.

import { renderCPT } from './cpt-editor.js';
import { isAvailable as aiAvailable } from './ai.js';

export function renderInspector(container, { net, selectedId, marginals, actions }) {
  if (!selectedId) {
    renderSummary(container, { net, marginals, actions });
    return;
  }
  const node = net.getNode(selectedId);
  const marginal = marginals[selectedId] ?? {};
  const evIdx = net.evidence.get(selectedId);

  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 mb-3';
  header.innerHTML = `
    <input type="text" id="nodeName" class="flex-1 px-2 py-1 text-sm font-semibold border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-200" />
    <button class="btn-ghost text-xs" data-act="delete" title="Delete node">✕</button>
    <button class="btn-ghost text-xs md:hidden" data-act="close" title="Close">⌄</button>
  `;
  const nameInput = header.querySelector('#nodeName');
  nameInput.value = node.name;
  nameInput.addEventListener('change', () => actions.rename(selectedId, nameInput.value));
  header.querySelector('[data-act=delete]').addEventListener('click', () => {
    if (confirm(`Delete node "${node.name}"? Edges to/from it will be removed.`)) {
      actions.removeNode(selectedId);
    }
  });
  header.querySelector('[data-act=close]').addEventListener('click', () => actions.deselect());
  container.appendChild(header);

  const idLine = document.createElement('div');
  idLine.className = 'text-xs text-slate-400 mb-3 font-mono';
  idLine.textContent = `id: ${node.id}`;
  container.appendChild(idLine);

  // Description — free-text explanation of the variable. Optional.
  const descSec = section('Description');
  const desc = document.createElement('textarea');
  desc.rows = 1;
  desc.placeholder = 'What does this variable represent?';
  desc.className = 'w-full text-xs border border-slate-200 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200 leading-snug overflow-hidden';
  desc.style.minHeight = '32px';
  desc.value = node.description ?? '';
  const autosize = () => {
    desc.style.height = 'auto';
    desc.style.height = desc.scrollHeight + 'px';
  };
  desc.addEventListener('input', autosize);
  desc.addEventListener('change', () => actions.setDescription(selectedId, desc.value));
  descSec.appendChild(desc);
  container.appendChild(descSec);
  // scrollHeight requires a layout pass; defer so it reads correctly on first paint.
  requestAnimationFrame(autosize);

  // States editor (placed right below description so state-filling is visually
  // separated from the Belief / CPT / sources block below).
  let statesAiBtn = null;
  if (aiAvailable()) {
    statesAiBtn = document.createElement('button');
    statesAiBtn.className = 'ai-btn';
    statesAiBtn.title = 'Suggest discrete states from the node name';
    statesAiBtn.innerHTML = '<span>✦</span> AI fill';
    statesAiBtn.addEventListener('click', () => {
      statesAiBtn.disabled = true;
      statesAiBtn.classList.add('busy');
      statesAiBtn.innerHTML = '<span>thinking…</span>';
      Promise.resolve(actions.suggestStates(selectedId))
        .finally(() => { statesAiBtn.classList.remove('busy'); statesAiBtn.disabled = false; });
    });
  }
  const statesSec = section('States', statesAiBtn);
  const focusStateInput = (idx) => {
    const inputs = container.querySelectorAll('.state-row input');
    const target = inputs[idx];
    if (target) { target.focus(); target.select(); }
  };
  for (let i = 0; i < node.states.length; i++) {
    const row = document.createElement('div');
    row.className = 'state-row';
    row.innerHTML = `
      <input type="text" value="${escapeAttr(node.states[i])}" />
      <button title="Remove" ${node.states.length <= 2 ? 'disabled' : ''}>✕</button>
    `;
    const inp = row.querySelector('input');
    const rmBtn = row.querySelector('button');
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('change', () => {
      const next = [...node.states];
      next[i] = inp.value.trim() || node.states[i];
      actions.setStates(selectedId, next);
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const typed = inp.value.trim() || node.states[i];
      const next = [...node.states];
      let targetIdx = i + 1;
      let mutated = false;
      if (typed !== next[i]) { next[i] = typed; mutated = true; }
      if (i === node.states.length - 1) {
        let k = 1;
        while (next.includes(`state${k}`)) k++;
        next.push(`state${k}`);
        targetIdx = next.length - 1;
        mutated = true;
      }
      if (mutated) {
        actions.setStates(selectedId, next);
        requestAnimationFrame(() => focusStateInput(targetIdx));
      } else {
        focusStateInput(targetIdx);
      }
    });
    rmBtn.addEventListener('click', () => {
      if (node.states.length <= 2) return;
      const next = node.states.filter((_, j) => j !== i);
      actions.setStates(selectedId, next);
    });
    statesSec.appendChild(row);
  }
  const addState = document.createElement('button');
  addState.className = 'btn-ghost text-xs mt-1';
  addState.textContent = '+ Add state';
  addState.addEventListener('click', () => {
    let i = 1;
    while (node.states.includes(`state${i}`)) i++;
    actions.setStates(selectedId, [...node.states, `state${i}`]);
  });
  statesSec.appendChild(addState);
  container.appendChild(statesSec);

  // Posterior / marginal — with optional AI fill button.
  let aiBtn = null;
  if (aiAvailable()) {
    aiBtn = document.createElement('button');
    aiBtn.className = 'ai-btn';
    aiBtn.title = 'Fill probabilities from evidence and reasoning';
    aiBtn.innerHTML = '<span>✦</span> AI fill';
    aiBtn.addEventListener('click', () => {
      aiBtn.disabled = true;
      aiBtn.classList.add('busy');
      aiBtn.innerHTML = '<span>thinking…</span>';
      Promise.resolve(actions.enrich(selectedId))
        .finally(() => { aiBtn.classList.remove('busy'); aiBtn.disabled = false; });
    });
  }
  const marginalSec = section('Belief', aiBtn);
  if (marginal && Object.keys(marginal).length) {
    for (let i = 0; i < node.states.length; i++) {
      const s = node.states[i];
      const p = marginal[s] ?? 0;
      const bar = document.createElement('div');
      bar.className = 'marginal-bar' + (evIdx === i ? ' evidence' : '');
      bar.dataset.nodeId = node.id;
      bar.dataset.stateIdx = String(i);
      bar.innerHTML = `
        <span class="label">${escapeHtml(s)}</span>
        <span class="track"><span class="fill" style="width:${(p * 100).toFixed(1)}%"></span></span>
        <span class="pct">${(p * 100).toFixed(1)}%</span>
      `;
      marginalSec.appendChild(bar);
    }
  } else {
    const msg = document.createElement('div');
    msg.className = 'text-xs text-slate-400';
    msg.textContent = 'Run inference to see beliefs.';
    marginalSec.appendChild(msg);
  }
  container.appendChild(marginalSec);

  // Evidence
  const evSec = section('Evidence');
  const evRow = document.createElement('div');
  evRow.className = 'flex flex-wrap gap-1';
  for (let i = 0; i < node.states.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost text-xs' + (evIdx === i ? ' active' : '');
    btn.textContent = node.states[i];
    btn.addEventListener('click', () => actions.setEvidence(selectedId, i));
    evRow.appendChild(btn);
  }
  const clr = document.createElement('button');
  clr.className = 'btn-ghost text-xs text-slate-400';
  clr.textContent = 'clear';
  clr.disabled = evIdx == null;
  clr.addEventListener('click', () => actions.clearEvidence(selectedId));
  evRow.appendChild(clr);
  evSec.appendChild(evRow);
  container.appendChild(evSec);

  // CPT
  const cptSec = section(node.parents.length ? `Conditional probability — P(${node.id} | ${node.parents.join(', ')})` : `Prior — P(${node.id})`);
  const cptDiv = document.createElement('div');
  renderCPT(cptDiv, net, selectedId, (cpt) => actions.setCPT(selectedId, cpt));
  cptSec.appendChild(cptDiv);
  container.appendChild(cptSec);

  // AI sources (if any are attached to this node)
  if (Array.isArray(node.aiSources) && node.aiSources.length) {
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-ghost text-[11px] text-slate-400';
    clearBtn.textContent = 'clear';
    clearBtn.title = 'Remove attached sources';
    clearBtn.addEventListener('click', () => actions.clearAiSources(selectedId));
    const sourcesSec = section('AI sources', clearBtn);
    for (const s of node.aiSources) {
      sourcesSec.appendChild(renderSourceRow(s));
    }
    container.appendChild(sourcesSec);
  }

  // Parent management
  const parentSec = section('Parents');
  if (node.parents.length === 0) {
    parentSec.appendChild(textLine('No parents.'));
  } else {
    for (const pId of node.parents) {
      const row = document.createElement('div');
      row.className = 'state-row';
      row.innerHTML = `
        <span class="flex-1 text-sm">${escapeHtml(net.getNode(pId).name)} <span class="text-slate-400 font-mono text-xs">(${pId})</span></span>
        <button title="Detach">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => actions.removeEdge(pId, selectedId));
      parentSec.appendChild(row);
    }
  }
  const addParent = document.createElement('div');
  addParent.className = 'flex gap-1 mt-1';
  const sel = document.createElement('select');
  sel.className = 'btn-ghost text-sm bg-transparent flex-1';
  sel.innerHTML = `<option value="">Add parent…</option>` + net.ids()
    .filter(id => id !== selectedId && !node.parents.includes(id))
    .map(id => `<option value="${escapeAttr(id)}">${escapeHtml(net.getNode(id).name)}</option>`)
    .join('');
  sel.addEventListener('change', () => {
    if (sel.value) actions.addEdge(sel.value, selectedId);
  });
  addParent.appendChild(sel);
  parentSec.appendChild(addParent);
  container.appendChild(parentSec);
}

// Summary view shown when no node is selected: every node's current marginals
// as a scrollable stack of compact cards.  Clicking a card selects the node.
function renderSummary(container, { net, marginals, actions }) {
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'flex items-baseline justify-between mb-3';
  header.innerHTML = `
    <div class="text-xs uppercase tracking-wider font-semibold text-slate-400">Beliefs</div>
    <div class="text-[10px] text-slate-400 tabular-nums" id="summaryMeta"></div>
  `;
  container.appendChild(header);

  if (net.size === 0) {
    const msg = document.createElement('p');
    msg.className = 'text-sm text-slate-400';
    msg.textContent = 'Add nodes to see beliefs here.';
    container.appendChild(msg);
    return;
  }

  // If any evidence is set, show a "clear all" affordance.
  if (net.evidence.size > 0) {
    const clr = document.createElement('button');
    clr.className = 'btn-ghost text-xs mb-3';
    clr.textContent = `Clear all evidence (${net.evidence.size})`;
    clr.addEventListener('click', () => actions.clearEvidence());
    container.appendChild(clr);
  }

  const list = document.createElement('div');
  list.className = 'space-y-3';
  for (const id of net.ids()) {
    const node = net.getNode(id);
    const marginal = marginals[id] ?? {};
    const evIdx = net.evidence.get(id);

    const card = document.createElement('div');
    card.className = 'rounded-md border border-slate-200 p-2 hover:border-indigo-300 hover:bg-slate-50/60 cursor-pointer transition-colors';
    card.addEventListener('click', () => actions.select(id));

    const titleRow = document.createElement('div');
    titleRow.className = 'flex items-baseline justify-between gap-2 mb-1';
    titleRow.innerHTML = `
      <span class="text-sm font-medium text-slate-800 truncate">${escapeHtml(node.name)}</span>
      ${evIdx != null
        ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium shrink-0">obs: ${escapeHtml(node.states[evIdx])}</span>`
        : `<span class="text-[10px] font-mono text-slate-400 shrink-0">${escapeHtml(node.id)}</span>`}
    `;
    card.appendChild(titleRow);

    if (node.description) {
      const d = document.createElement('p');
      d.className = 'text-[11px] text-slate-500 leading-snug mb-1.5 line-clamp-2';
      d.textContent = node.description;
      card.appendChild(d);
    }

    for (let i = 0; i < node.states.length; i++) {
      const s = node.states[i];
      const p = marginal[s] ?? 0;
      const bar = document.createElement('div');
      bar.className = 'marginal-bar' + (evIdx === i ? ' evidence' : '');
      bar.dataset.nodeId = node.id;
      bar.dataset.stateIdx = String(i);
      bar.innerHTML = `
        <span class="label">${escapeHtml(s)}</span>
        <span class="track"><span class="fill" style="width:${(p * 100).toFixed(1)}%"></span></span>
        <span class="pct">${(p * 100).toFixed(1)}%</span>
      `;
      card.appendChild(bar);
    }
    list.appendChild(card);
  }
  container.appendChild(list);
}

function section(title, trailing = null) {
  const wrap = document.createElement('div');
  wrap.className = 'inspector-section';
  const h = document.createElement('h3');
  h.textContent = title;
  if (trailing) {
    const row = document.createElement('div');
    row.className = 'section-row';
    row.appendChild(h);
    row.appendChild(trailing);
    wrap.appendChild(row);
  } else {
    wrap.appendChild(h);
  }
  return wrap;
}

function textLine(text) {
  const d = document.createElement('div');
  d.className = 'text-xs text-slate-400';
  d.textContent = text;
  return d;
}

function renderSourceRow(s) {
  const row = document.createElement('div');
  row.className = 'source-row';
  let host = '';
  try { host = new URL(s.url).hostname.replace(/^www\./, ''); } catch { host = ''; }
  const left = document.createElement('div');
  left.className = 'min-w-0';
  left.innerHTML = `
    <a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer" class="title block hover:text-indigo-600 hover:underline">${escapeHtml(s.title || s.url)}</a>
    <div class="host">${escapeHtml(host)}</div>
    ${s.excerpt ? `<div class="text-[11px] text-slate-500 mt-1 leading-snug">${renderExcerpt(s.excerpt, s.highlight)}</div>` : ''}
  `;

  const badge = document.createElement('span');
  const neg = s.polarity === 'negative';
  const verb = neg ? 'against' : 'supports';
  const state = s.affectsState ? escapeHtml(s.affectsState) : '';
  const weightStr = (s.weight ?? 0).toFixed(2);
  badge.className = 'badge ' + (neg ? 'neg' : 'pos');
  badge.title = state
    ? `${verb} ${s.affectsState} with weight ${weightStr}`
    : `${verb} this node with weight ${weightStr}`;
  badge.textContent = state
    ? `${verb} ${s.affectsState}  ·  ${weightStr}`
    : `${verb}  ·  ${weightStr}`;

  row.appendChild(left);
  row.appendChild(badge);
  return row;
}

// Convert an excerpt to safe HTML with the pivotal phrase bolded.
// Three tiers:
//   1) <mark>...</mark> XML tags in the excerpt → <strong>...</strong>
//      (we stash them as placeholders, escape everything else, then restore
//      as real tags — so arbitrary HTML from the web/model is still escaped).
//   2) otherwise, if a separate `highlight` string appears as a substring
//      of the excerpt, bold that substring (case-insensitive).
//   3) otherwise, render as-is (no bold).
function renderExcerpt(text, highlight) {
  let working = String(text);
  const OPEN  = 'SOB';
  const CLOSE = 'EOB';
  working = working
    .replace(/<mark>/gi, OPEN)
    .replace(/<\/mark>/gi, CLOSE);
  const hadMarks = working.includes(OPEN);

  // Escape whatever's left (covers any raw HTML the model or source leaked).
  let escaped = escapeHtml(working);

  if (hadMarks) {
    return escaped
      .split(OPEN).join('<strong class="text-slate-900">')
      .split(CLOSE).join('</strong>');
  }
  if (highlight) {
    const h = escapeHtml(highlight);
    const idx = escaped.toLowerCase().indexOf(h.toLowerCase());
    if (idx >= 0) {
      return escaped.slice(0, idx)
        + `<strong class="text-slate-900">${escaped.slice(idx, idx + h.length)}</strong>`
        + escaped.slice(idx + h.length);
    }
  }
  return escaped;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }
