// CPT editor as a plain DOM table.
// Emits onChange(cpt) with a flat row-major array whenever the user edits a cell.

export function renderCPT(container, net, nodeId, onChange) {
  const node = net.getNode(nodeId);
  const parents = node.parents;
  const parentCards = parents.map(p => net.getNode(p).states.length);
  const rowSize = node.states.length;
  const rows = parentCards.reduce((a, b) => a * b, 1);

  // Parent combination for row index `r`.
  const parentStatesAt = (r) => {
    const out = new Array(parents.length);
    for (let i = parents.length - 1; i >= 0; i--) {
      out[i] = r % parentCards[i];
      r = Math.floor(r / parentCards[i]);
    }
    return out;
  };

  const table = document.createElement('table');
  table.className = 'cpt-table';

  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const pId of parents) {
    const th = document.createElement('th');
    th.className = 'parent-header';
    th.textContent = net.getNode(pId).name;
    tr.appendChild(th);
  }
  for (const s of node.states) {
    const th = document.createElement('th');
    th.textContent = s;
    tr.appendChild(th);
  }
  const sumTh = document.createElement('th');
  sumTh.textContent = 'Σ';
  tr.appendChild(sumTh);
  thead.appendChild(tr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let r = 0; r < rows; r++) {
    const ps = parentStatesAt(r);
    const row = document.createElement('tr');
    for (let i = 0; i < parents.length; i++) {
      const td = document.createElement('td');
      td.className = 'parent-cell';
      td.textContent = net.getNode(parents[i]).states[ps[i]];
      row.appendChild(td);
    }
    for (let k = 0; k < rowSize; k++) {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = format(node.cpt[r * rowSize + k]);
      input.dataset.row = r;
      input.dataset.col = k;
      input.addEventListener('focus', () => input.select());
      input.addEventListener('change', () => commit(input));
      input.addEventListener('blur',   () => commit(input));
      td.appendChild(input);
      row.appendChild(td);
    }
    const sumTd = document.createElement('td');
    sumTd.className = 'sum-cell';
    row.appendChild(sumTd);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  const controls = document.createElement('div');
  controls.className = 'mt-2 flex gap-1';
  controls.innerHTML = `
    <button class="btn-ghost text-xs" data-act="uniform">Uniform</button>
    <button class="btn-ghost text-xs" data-act="normalize">Normalize</button>
  `;
  controls.querySelector('[data-act=uniform]').addEventListener('click', () => {
    const v = 1 / rowSize;
    const cpt = new Array(rows * rowSize).fill(v);
    writeCPT(table, rows, rowSize, parents.length, cpt);
    updateRowSums(table, rows, rowSize, parents.length);
    onChange(cpt);
  });
  controls.querySelector('[data-act=normalize]').addEventListener('click', () => {
    const cpt = readCPT(table, rows, rowSize, parents.length);
    // normalize rows in place
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let k = 0; k < rowSize; k++) s += cpt[r * rowSize + k];
      if (s > 0) for (let k = 0; k < rowSize; k++) cpt[r * rowSize + k] /= s;
    }
    writeCPT(table, rows, rowSize, parents.length, cpt);
    updateRowSums(table, rows, rowSize, parents.length);
    onChange(cpt);
  });

  container.innerHTML = '';
  container.appendChild(table);
  container.appendChild(controls);

  updateRowSums(table, rows, rowSize, parents.length);

  function commit(input) {
    // Read all cells, attempt to set CPT; if invalid, just repaint row sums.
    const cpt = readCPT(table, rows, rowSize, parents.length);
    updateRowSums(table, rows, rowSize, parents.length);
    onChange(cpt);
  }
}

// Write CPT values back into the input fields — used by Uniform/Normalize so
// the DOM reflects the computed values (otherwise the user's stale text + red
// row-sum indicator stay on screen even though the model is fine).
function writeCPT(table, rows, rowSize, numParentCols, cpt) {
  const bodyRows = table.tBodies[0].rows;
  for (let r = 0; r < rows; r++) {
    const cells = bodyRows[r].cells;
    for (let k = 0; k < rowSize; k++) {
      const input = cells[numParentCols + k].querySelector('input');
      input.value = format(cpt[r * rowSize + k]);
    }
  }
}

function readCPT(table, rows, rowSize, numParentCols) {
  const cpt = new Array(rows * rowSize);
  const bodyRows = table.tBodies[0].rows;
  for (let r = 0; r < rows; r++) {
    const cells = bodyRows[r].cells;
    for (let k = 0; k < rowSize; k++) {
      const input = cells[numParentCols + k].querySelector('input');
      const n = Number(input.value);
      cpt[r * rowSize + k] = Number.isFinite(n) && n >= 0 ? n : 0;
    }
  }
  return cpt;
}

function updateRowSums(table, rows, rowSize, numParentCols) {
  const bodyRows = table.tBodies[0].rows;
  for (let r = 0; r < rows; r++) {
    let s = 0;
    const cells = bodyRows[r].cells;
    for (let k = 0; k < rowSize; k++) {
      const v = Number(cells[numParentCols + k].querySelector('input').value);
      if (Number.isFinite(v)) s += v;
    }
    const sumTd = cells[numParentCols + rowSize];
    sumTd.textContent = s.toFixed(3);
    // Match BayesNet.setCPT's 1e-6 tolerance so a "green" row is always
    // acceptable to the model — otherwise the user types valid-looking values,
    // setCPT rejects them, inference silently stales.
    const bad = Math.abs(s - 1) > 1e-6;
    bodyRows[r].classList.toggle('bad-row', bad);
  }
}

function format(x) {
  if (x === 0) return '0';
  if (x === 1) return '1';
  return Number(x.toFixed(6)).toString();
}
