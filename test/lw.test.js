import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse } from '../lib/io.js';
import { variableElimination } from '../lib/inference/variable-elimination.js';
import { likelihoodWeighting } from '../lib/inference/likelihood-weighting.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examples = join(__dirname, '..', 'examples');
const load = (f) => parse(readFileSync(join(examples, f), 'utf8'));

// Seedable LCG so test is deterministic.
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('Likelihood weighting converges to variable elimination on Asia (50k samples)', () => {
  const net = load('asia.json');
  const rng = mkRng(42);
  for (const id of net.ids()) {
    const exact = variableElimination(net, id);
    const approx = likelihoodWeighting(net, id, undefined, { samples: 50000, rng });
    for (const state of Object.keys(exact)) {
      const diff = Math.abs(exact[state] - approx[state]);
      assert.ok(diff < 0.02, `${id}.${state}: exact=${exact[state].toFixed(4)} lw=${approx[state].toFixed(4)} diff=${diff.toFixed(4)}`);
    }
  }
});

test('LW with evidence converges on Earthquake (100k samples)', () => {
  const net = load('earthquake.json');
  const rng = mkRng(7);
  const ev = { john: 'yes', mary: 'yes' };
  const exact = variableElimination(net, 'burglary', ev);
  const approx = likelihoodWeighting(net, 'burglary', ev, { samples: 100000, rng });
  assert.ok(Math.abs(exact.yes - approx.yes) < 0.02,
    `exact=${exact.yes.toFixed(4)} lw=${approx.yes.toFixed(4)}`);
});
