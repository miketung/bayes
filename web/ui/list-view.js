// BayesMobile-style list view: vertical list of every node with its current
// marginal (or evidence) rendered as a bar chart, tap to select.

export function renderListView(container, { net, marginals, selectedId, onSelect }) {
  container.innerHTML = '';
  const ids = net.ids();
  if (!ids.length) {
    container.innerHTML = '<p class="text-sm text-slate-400">No nodes yet. Add one from the toolbar.</p>';
    return;
  }
  const list = document.createElement('div');
  list.className = 'space-y-2 max-w-2xl mx-auto';
  for (const id of ids) {
    const node = net.getNode(id);
    const evIdx = net.evidence.get(id);
    const marginal = marginals[id] ?? {};

    const card = document.createElement('button');
    card.className = 'block w-full text-left p-3 rounded-lg border hover:border-indigo-300 transition-colors ' +
      (selectedId === id ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 bg-white');
    card.addEventListener('click', () => onSelect(id));

    const header = document.createElement('div');
    header.className = 'flex items-baseline justify-between mb-2';
    header.innerHTML = `
      <div class="flex items-baseline gap-2 min-w-0">
        <span class="font-medium text-sm truncate">${escape(node.name)}</span>
        <span class="text-[10px] font-mono text-slate-400">${escape(node.id)}</span>
      </div>
      ${evIdx != null
        ? `<span class="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">observed: ${escape(node.states[evIdx])}</span>`
        : ''}
    `;
    card.appendChild(header);

    if (node.description) {
      const d = document.createElement('p');
      d.className = 'text-xs text-slate-500 leading-snug mb-2';
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
        <span class="label">${escape(s)}</span>
        <span class="track"><span class="fill" style="width:${(p * 100).toFixed(1)}%"></span></span>
        <span class="pct">${(p * 100).toFixed(1)}%</span>
      `;
      card.appendChild(bar);
    }
    list.appendChild(card);
  }
  container.appendChild(list);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
