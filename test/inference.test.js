import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse } from '../lib/io.js';
import { variableElimination } from '../lib/inference/variable-elimination.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examples = join(__dirname, '..', 'examples');

const load = (f) => parse(readFileSync(join(examples, f), 'utf8'));

const close = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

test('Asia: prior marginals match known values', () => {
  const net = load('asia.json');
  const P = (id) => variableElimination(net, id);

  assert.ok(close(P('asia').yes,   0.01));
  assert.ok(close(P('smoke').yes,  0.5));
  assert.ok(close(P('tub').yes,    0.0104));
  assert.ok(close(P('lung').yes,   0.055));
  assert.ok(close(P('bronc').yes,  0.45));
  assert.ok(close(P('either').yes, 0.0648, 1e-3));
  assert.ok(close(P('xray').yes,   0.11029, 1e-3));
  assert.ok(close(P('dysp').yes,   0.4360, 1e-3));
});

test('Asia: posterior given xray=yes, dyspnea=yes', () => {
  const net = load('asia.json');
  const ev = { xray: 'yes', dysp: 'yes' };
  const P = (id) => variableElimination(net, id, ev);

  // Both xray=yes and dyspnea=yes push P(lung=yes) well above the 0.055 prior.
  const lung = P('lung').yes;
  assert.ok(lung > 0.1 && lung < 0.9, `lung posterior out of range: ${lung}`);
  const tub = P('tub').yes;
  assert.ok(tub > 0.0104, `tub posterior should rise above prior: ${tub}`);
  // Marginals must still sum to 1.
  const sum = P('lung').no + P('lung').yes;
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('Earthquake: P(burglary | john=yes, mary=yes) is the classic Pearl value', () => {
  const net = load('earthquake.json');
  const p = variableElimination(net, 'burglary', { john: 'yes', mary: 'yes' });
  // Russell & Norvig quote 0.284 for this.
  assert.ok(close(p.yes, 0.284, 0.005), `got ${p.yes}, expected ~0.284`);
});

test('Memory Prices: marginals sum to 1 across all 13 nodes', () => {
  const net = load('memory-prices.json');
  for (const id of net.ids()) {
    const p = variableElimination(net, id);
    const sum = Object.values(p).reduce((a, b) => a + b, 0);
    assert.ok(close(sum, 1, 1e-9), `node ${id} sums to ${sum}`);
  }
});

test('Impossible evidence throws', () => {
  const net = load('asia.json');
  // Evidence: either=no but xray=yes with X|E=no uniform? xray=yes is possible, just unlikely.
  // Use a true impossibility: set either=no via deterministic parents forcing yes.
  net.setEvidence('tub', 'yes');
  net.setEvidence('either', 'no');
  assert.throws(() => variableElimination(net, 'bronc'));
});
