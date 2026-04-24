// Cytoscape wiring: render the BayesNet as a DAG with drag-to-connect,
// evidence highlighting, and inline marginal bars on each node.

const NODE_W = 200;
const NODE_H = 92;
// Title truncation fits within NODE_W−2·padding at the monospace font size.
// Monospace avg ~6.6px/char, so (200−16)/6.6 ≈ 28; leave a couple chars of
// safety margin for wider glyphs (W, M) before ellipsis.
const TITLE_MAX = 26;
const STATE_MAX = 10;  // clamp long state names so they fit the state column

function buildStyle(t) {
  return [
    {
      selector: 'node',
      style: {
        'shape': 'round-rectangle',
        'background-color': t.nodeFill,
        'border-width': 1.5,
        'border-color': t.nodeBorder,
        'width': NODE_W,
        'height': NODE_H,
        // Node contents are drawn as an SVG background-image (see nodeSvgDataUrl).
        // Vector renders crisp at any zoom — no text-rasterization jitter.
        'background-image': 'data(bg)',
        'background-fit': 'cover',
        'background-clip': 'node',
        'background-image-opacity': 1,
        'label': ''
      }
    },
    {
      selector: 'node:selected',
      style: {
        'border-color': t.nodeSelected,
        'border-width': 2
      }
    },
    {
      selector: 'node.evidence',
      style: {
        'border-color': t.evidenceBorder,
        'border-width': 3,
        'background-color': t.evidenceFill
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 1.6,
        'line-color': t.edge,
        'target-arrow-color': t.edge,
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.1
      }
    },
    {
      selector: 'edge:selected',
      style: {
        'line-color': t.selectedEdge,
        'target-arrow-color': t.selectedEdge,
        'width': 2.2
      }
    },
    {
      selector: 'node.handle',
      style: {
        'background-color': t.handle,
        'border-color': '#ffffff',
        'border-width': 2,
        'width': 24,
        'height': 24,
        'shape': 'ellipse',
        'label': '+',
        'color': '#ffffff',
        'font-size': 14,
        'font-weight': 700,
        'text-valign': 'center',
        'text-halign': 'center',
        'events': 'yes',
        'z-index': 999
      }
    },
    {
      selector: 'node.ghost',
      style: {
        'opacity': 0,
        'width': 1,
        'height': 1,
        'events': 'no'
      }
    },
    {
      selector: 'edge.ghost-edge',
      style: {
        'line-color': t.ghost,
        'target-arrow-color': t.ghost,
        'line-style': 'dashed',
        'width': 2,
        'opacity': 0.8,
        'events': 'no'
      }
    },
    {
      selector: 'node.drop-target',
      style: {
        'border-color': t.dropTarget,
        'border-width': 3,
        'background-color': t.dropTargetBg
      }
    }
  ];
}

export function createGraph(container, { theme, onSelect, onSelectEdge, onEdge, onCycle, onMove }) {
  let currentTheme = theme;
  const cy = window.cytoscape({
    container,
    wheelSensitivity: 0.2,
    minZoom: 0.2,
    maxZoom: 3,
    style: buildStyle(theme),
    layout: { name: 'preset' }
  });

  // --- drag-to-connect --------------------------------------------------
  //
  // On node hover we pin a small "+" handle to the node's right edge (rendered
  // as a Cytoscape child node so it lives on the same canvas and inherits
  // zoom/pan transforms).  Press + drag the handle → follows the cursor via a
  // dashed ghost edge → release on another node to create the edge.

  const HANDLE_ID = '__handle';
  const GHOST_ID = '__ghost';
  const GHOST_EDGE_ID = '__ghost_edge';
  let hoverNode = null;
  let dragging = false;
  let dragSource = null;

  const handleOffset = (node) => {
    const p = node.position();
    const w = node.width();
    return { x: p.x + w / 2, y: p.y };
  };

  const showHandle = (node) => {
    if (dragging) return;
    hideHandle();
    hoverNode = node;
    const pos = handleOffset(node);
    cy.add({
      group: 'nodes',
      data: { id: HANDLE_ID },
      position: pos,
      classes: 'handle',
      selectable: false,
      grabbable: false
    });
  };

  const hideHandle = () => {
    const h = cy.getElementById(HANDLE_ID);
    if (h.nonempty()) h.remove();
    hoverNode = null;
  };

  // Reposition handle if its host node moves while hovered.
  cy.on('position', 'node', (evt) => {
    if (hoverNode && evt.target.id() === hoverNode.id()) {
      const h = cy.getElementById(HANDLE_ID);
      if (h.nonempty()) h.position(handleOffset(hoverNode));
    }
  });

  // Clear the handle if its host node is removed (e.g. deleted from the
  // inspector while hovered — no mouseout would fire in that case).
  cy.on('remove', 'node', (evt) => {
    if (hoverNode && evt.target.id() === hoverNode.id()) hideHandle();
  });

  cy.on('mouseover', 'node', (evt) => {
    const n = evt.target;
    if (n.id() === HANDLE_ID) return;          // pointer on handle → keep current hover
    if (n.id().startsWith('__')) return;
    showHandle(n);
  });
  cy.on('mouseout', 'node', (evt) => {
    if (dragging) return;
    // Debounce so the mouse can cross the gap between node and handle without
    // the handle flickering away.
    setTimeout(() => {
      if (dragging || !hoverNode) return;
      const under = nodeUnderPointer();
      const overHandle = isPointerOverHandle();
      if (!under && !overHandle) hideHandle();
    }, 80);
    void evt;
  });

  function isPointerOverHandle() {
    const h = cy.getElementById(HANDLE_ID);
    if (!h.nonempty()) return false;
    const p = h.renderedPosition();
    const w = h.renderedWidth(), hh = h.renderedHeight();
    return Math.abs(p.x - pointerPos.x) <= w / 2 + 4
        && Math.abs(p.y - pointerPos.y) <= hh / 2 + 4;
  }

  const pointerPos = { x: 0, y: 0 };
  container.addEventListener('pointermove', (e) => {
    const rect = container.getBoundingClientRect();
    pointerPos.x = e.clientX - rect.left;
    pointerPos.y = e.clientY - rect.top;
  });

  function nodeUnderPointer() {
    // Find non-handle node at current pointer.
    const models = cy.nodes().filter(n => !n.id().startsWith('__'));
    for (let i = models.length - 1; i >= 0; i--) {
      const n = models[i];
      const p = n.renderedPosition();
      const w = n.renderedWidth(), h = n.renderedHeight();
      if (Math.abs(p.x - pointerPos.x) <= w / 2 && Math.abs(p.y - pointerPos.y) <= h / 2) {
        return n;
      }
    }
    return null;
  }

  // Start drag on handle mousedown.
  cy.on('mousedown', 'node.handle', (evt) => {
    if (!hoverNode) return;
    evt.preventDefault?.();
    evt.stopPropagation?.();
    dragging = true;
    dragSource = hoverNode;
    cy.userPanningEnabled(false);
    cy.boxSelectionEnabled(false);

    // Hide the handle once drag starts.
    const h = cy.getElementById(HANDLE_ID);
    if (h.nonempty()) h.remove();

    // Ghost node (invisible) tracks cursor; ghost edge connects source → ghost.
    const start = evt.position || dragSource.position();
    cy.add({
      group: 'nodes',
      data: { id: GHOST_ID },
      position: start,
      classes: 'ghost',
      selectable: false,
      grabbable: false
    });
    cy.add({
      group: 'edges',
      data: { id: GHOST_EDGE_ID, source: dragSource.id(), target: GHOST_ID },
      classes: 'ghost-edge',
      selectable: false
    });
  });

  cy.on('mousemove', (evt) => {
    if (!dragging) return;
    const ghost = cy.getElementById(GHOST_ID);
    if (ghost.nonempty()) ghost.position(evt.position);
    // Highlight potential drop target.
    cy.nodes('.drop-target').removeClass('drop-target');
    const tgt = nodeUnderPointer();
    if (tgt && tgt.id() !== dragSource?.id() && !tgt.id().startsWith('__')) {
      tgt.addClass('drop-target');
    }
  });

  const finishDrag = (evt) => {
    if (!dragging) return;
    cy.getElementById(GHOST_EDGE_ID).remove();
    cy.getElementById(GHOST_ID).remove();
    cy.nodes('.drop-target').removeClass('drop-target');
    cy.userPanningEnabled(true);
    cy.boxSelectionEnabled(true);
    const tgt = nodeUnderPointer();
    const src = dragSource;
    dragging = false;
    dragSource = null;
    if (tgt && src && tgt.id() !== src.id() && !tgt.id().startsWith('__')) {
      try { onEdge(src.id(), tgt.id()); }
      catch (e) { onCycle?.(e.message); }
    }
    void evt;
  };

  cy.on('mouseup', finishDrag);
  // Safety: if pointer leaves the canvas we still need to end the drag.
  container.addEventListener('pointerup', () => finishDrag());
  container.addEventListener('pointerleave', () => finishDrag());

  // --- selection / taps -------------------------------------------------

  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id();
    if (id.startsWith('__')) return;
    onSelect(id);
  });
  cy.on('tap', 'edge', (evt) => {
    const e = evt.target;
    if (e.id().startsWith('__')) return;
    onSelectEdge?.(e.source().id(), e.target().id());
  });
  cy.on('tap', (evt) => {
    if (evt.target === cy) onSelect(null);
  });

  cy.on('dragfree', 'node', (evt) => {
    const n = evt.target;
    const p = n.position();
    onMove?.(n.id(), p.x, p.y);
  });

  return {
    cy,

    sync(net, marginals) {
      // Elements: reconcile nodes + edges with net.
      // Ignore internal helper elements whose ids start with "__".
      const isReal = (id) => !id.startsWith('__');
      const existingNodeIds = new Set(cy.nodes().map(n => n.id()).filter(isReal));
      const existingEdgeIds = new Set(cy.edges().map(e => e.id()).filter(isReal));
      const desiredNodes = new Set(net.ids());
      const desiredEdges = new Set();

      // Read theme-driven colors once per sync — applyTheme sets CSS vars on :root.
      const palette = readPalette(currentTheme);

      // Add / update nodes.
      for (const id of net.ids()) {
        const n = net.getNode(id);
        const bg = nodeSvgDataUrl(n, marginals[id], net.evidence.get(id), palette);
        const pos = net.positions.get(id);
        let node = cy.$id(id);
        if (!node.nonempty()) {
          node = cy.add({
            group: 'nodes',
            data: { id, bg },
            position: pos ? { x: pos.x, y: pos.y } : { x: Math.random() * 400, y: Math.random() * 300 }
          });
        } else {
          node.data('bg', bg);
          if (pos && !samePos(node.position(), pos)) node.position(pos);
        }
        if (net.evidence.has(id)) node.addClass('evidence');
        else node.removeClass('evidence');
      }

      // Remove nodes no longer present.
      for (const id of existingNodeIds) if (!desiredNodes.has(id)) cy.$id(id).remove();

      // Edges: one per parent relation.
      for (const id of net.ids()) {
        const n = net.getNode(id);
        for (const p of n.parents) {
          const eid = `${p}->${id}`;
          desiredEdges.add(eid);
          if (!cy.getElementById(eid).nonempty()) {
            cy.add({ group: 'edges', data: { id: eid, source: p, target: id } });
          }
        }
      }
      for (const eid of existingEdgeIds) if (!desiredEdges.has(eid)) cy.getElementById(eid).remove();
    },

    select(id) {
      cy.$('node:selected').unselect();
      if (id) cy.$id(id).select();
    },

    layout() {
      cy.layout({
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 40,
        rankSep: 70,
        fit: true,
        padding: 40
      }).run();
    },

    fit() {
      cy.fit(undefined, 40);
    },

    applyTheme(newTheme) {
      currentTheme = newTheme;
      cy.style().fromJson(buildStyle(newTheme)).update();
      // Caller must re-run sync() afterwards so node SVGs pick up the new palette.
    }
  };
}

// Read theme + CSS-custom-property colors once per render. The CSS vars are
// set on :root by applyTheme() in themes.js, so this picks up theme switches
// without needing to plumb them through every function.
function readPalette(theme) {
  const css = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement) : null;
  const cv = (k, fb) => (css?.getPropertyValue(k).trim() || fb);
  return {
    text:      theme.nodeText,
    muted:     cv('--bar-to', '#64748b'),   // reuse accent-end for % labels
    barFrom:   cv('--bar-from', '#0ea5e9'),
    barTo:     cv('--bar-to',   '#6366f1'),
    barTrack:  cv('--bar-track','#e5e7eb'),
    evidence:  cv('--evidence', '#f59e0b'),
    evFrom:    cv('--evidence-bar-from', cv('--evidence', '#f59e0b')),
    evTo:      cv('--evidence-bar-to',   cv('--evidence', '#f59e0b'))
  };
}

function nodeSvgDataUrl(n, marginal, evIdx, c) {
  const svg = buildNodeSvg(n, marginal, evIdx, c);
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function buildNodeSvg(n, marginal, evIdx, c) {
  const W = NODE_W, H = NODE_H;
  const padX = 10;
  const titleBaseline = 16;
  const title = xmlEscape(truncate(n.name, TITLE_MAX));
  const parts = [];

  // Title
  parts.push(
    `<text x="${padX}" y="${titleBaseline}" font-family="ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="600" fill="${c.text}">${title}</text>`
  );
  // Subtle divider under title
  parts.push(
    `<line x1="${padX}" y1="22" x2="${W - padX}" y2="22" stroke="${c.barTrack}" stroke-width="1"/>`
  );

  const bodyTop = 26;
  const bodyBot = H - 6;

  if (evIdx != null) {
    const stateName = xmlEscape(truncate(n.states[evIdx], 20));
    const midY = (bodyTop + bodyBot) / 2 + 4;
    parts.push(
      `<text x="${W / 2}" y="${midY}" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="13" font-weight="600" fill="${c.evidence}">◉ ${stateName}</text>`
    );
    return wrapSvg(W, H, parts.join(''));
  }

  if (!marginal) return wrapSvg(W, H, parts.join(''));

  const entries = Object.entries(marginal);
  const n_rows = Math.max(1, entries.length);
  const rowH = Math.max(11, Math.min(16, Math.floor((bodyBot - bodyTop) / n_rows)));
  const stateColW = 50;
  const pctColW = 36;
  const gap = 4;
  const barX = padX + stateColW + gap + pctColW + gap;
  const barW = W - barX - padX;
  const barH = Math.max(5, Math.min(8, rowH - 5));

  // Gradient (id is local to this data: URL SVG, no collision across nodes)
  parts.push(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${c.barFrom}"/>` +
    `<stop offset="1" stop-color="${c.barTo}"/>` +
    `</linearGradient></defs>`
  );

  let y = bodyTop;
  for (const [state, p] of entries) {
    const textY = y + rowH - Math.max(3, (rowH - 9) / 2);
    const barTop = y + (rowH - barH) / 2;
    const stateName = xmlEscape(truncate(state, STATE_MAX));
    const pct = (p * 100).toFixed(1) + '%';
    parts.push(
      `<text x="${padX}" y="${textY}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="10" fill="${c.text}">${stateName}</text>`,
      `<text x="${padX + stateColW + gap + pctColW}" y="${textY}" text-anchor="end" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="10" fill="${c.text}" fill-opacity="0.65">${pct}</text>`,
      `<rect x="${barX}" y="${barTop.toFixed(2)}" width="${barW}" height="${barH}" rx="${(barH / 2).toFixed(2)}" fill="${c.barTrack}"/>`,
      `<rect x="${barX}" y="${barTop.toFixed(2)}" width="${(barW * p).toFixed(2)}" height="${barH}" rx="${(barH / 2).toFixed(2)}" fill="url(#g)"/>`
    );
    y += rowH;
  }
  return wrapSvg(W, H, parts.join(''));
}

function wrapSvg(w, h, inner) {
  // Intrinsic size = 3× display size: matches max zoom so rasterization stays
  // crisp without wasting memory beyond that.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 3}" height="${h * 3}">${inner}</svg>`;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function xmlEscape(s) {
  return String(s).replace(/[<>&"']/g, ch => (
    { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[ch]
  ));
}

function samePos(a, b) {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

