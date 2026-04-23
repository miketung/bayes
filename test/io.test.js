import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { BayesNet } from '../lib/network.js';
import { parse, stringify } from '../lib/io.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examples = join(__dirname, '..', 'examples');

for (const name of ['asia', 'cancer', 'earthquake']) {
  test(`roundtrip: ${name}`, () => {
    const raw = readFileSync(join(examples, `${name}.json`), 'utf8');
    const net = parse(raw);
    const again = parse(stringify(net));
    assert.equal(net.size, again.size);
    for (const id of net.ids()) {
      const a = net.getNode(id);
      const b = again.getNode(id);
      assert.deepEqual(a.states, b.states);
      assert.deepEqual(a.parents, b.parents);
      assert.equal(a.cpt.length, b.cpt.length);
      for (let i = 0; i < a.cpt.length; i++) {
        assert.ok(Math.abs(a.cpt[i] - b.cpt[i]) < 1e-12);
      }
    }
  });
}

test('fromJSON accepts nodes in non-topological order', () => {
  // child listed before parent
  const obj = {
    version: 1,
    name: 't',
    nodes: [
      { id: 'c', states: ['no','yes'], parents: ['p'], cpt: [1,0,0,1] },
      { id: 'p', states: ['no','yes'], parents: [], cpt: [0.5,0.5] }
    ]
  };
  const net = parse(obj);
  assert.equal(net.size, 2);
});

test('addEdge rejects cycles', () => {
  const net = new BayesNet();
  net.addNode({ id: 'a', states: ['no','yes'] });
  net.addNode({ id: 'b', states: ['no','yes'] });
  net.addEdge('a', 'b');
  assert.throws(() => net.addEdge('b', 'a'));
});

test('setCPT validates shape', () => {
  const net = new BayesNet();
  net.addNode({ id: 'a', states: ['no','yes'] });
  net.addNode({ id: 'b', states: ['no','yes'], parents: ['a'] });
  // Wrong length:
  assert.throws(() => net.setCPT('b', [0.5, 0.5]));
  // Non-normalized row:
  assert.throws(() => net.setCPT('b', [0.5, 0.6, 0.5, 0.5]));
  // Normalize option fixes it:
  net.setCPT('b', [1, 1, 1, 3], { normalize: true });
  assert.equal(net.getNode('b').cpt[0], 0.5);
  assert.equal(net.getNode('b').cpt[3], 0.75);
});

test('removeNode clears dependent CPTs', () => {
  const net = new BayesNet();
  net.addNode({ id: 'a', states: ['no','yes'] });
  net.addNode({ id: 'b', states: ['no','yes'] });
  net.addNode({ id: 'c', states: ['no','yes'], parents: ['a','b'] });
  net.removeNode('a');
  const c = net.getNode('c');
  assert.deepEqual(c.parents, ['b']);
  assert.equal(c.cpt.length, 4);
});

test('setStates preserves CPTs on pure rename (same cardinality)', () => {
  const net = new BayesNet();
  net.addNode({ id: 'a', states: ['no','yes'] });
  net.setCPT('a', [0.8, 0.2]);
  net.addNode({ id: 'b', states: ['no','yes'], parents: ['a'] });
  net.setCPT('b', [0.9, 0.1, 0.2, 0.8]);
  // Rename states of `a` — CPT of `a` and `b` must be preserved.
  net.setStates('a', ['absent', 'present']);
  assert.deepEqual(net.getNode('a').cpt, [0.8, 0.2]);
  assert.deepEqual(net.getNode('b').cpt, [0.9, 0.1, 0.2, 0.8]);
});

test('aiSources round-trip and clear', () => {
  const net = new BayesNet();
  net.addNode({ id: 'rain', states: ['no','yes'] });
  net.setAiSources('rain', [
    { title: 'NOAA', url: 'https://noaa.gov/x', polarity: 'positive', weight: 0.9, excerpt: 'Rain likely.', affectsState: 'yes' },
    { title: 'Wikipedia', url: 'https://wiki/x', polarity: 'negative', weight: 0.4 }
  ]);
  const again = parse(stringify(net));
  const sources = again.getNode('rain').aiSources;
  assert.equal(sources.length, 2);
  assert.equal(sources[0].title, 'NOAA');
  assert.equal(sources[0].weight, 0.9);
  assert.equal(sources[1].polarity, 'negative');
  // Omitted when empty.
  net.setAiSources('rain', []);
  const obj = net.toJSON();
  assert.ok(!('aiSources' in obj.nodes.find(n => n.id === 'rain')));
});

test('description is preserved through JSON roundtrip; empty clears', () => {
  const net = new BayesNet();
  net.addNode({ id: 'rain', states: ['no','yes'], description: 'overnight precipitation' });
  net.addNode({ id: 'wet',  states: ['no','yes'], parents: ['rain'] });
  assert.equal(net.getNode('rain').description, 'overnight precipitation');
  assert.equal(net.getNode('wet').description, undefined);

  // Roundtrip
  const roundtripped = parse(stringify(net));
  assert.equal(roundtripped.getNode('rain').description, 'overnight precipitation');
  assert.equal(roundtripped.getNode('wet').description, undefined);

  // Serialized JSON must omit description when absent
  const obj = net.toJSON();
  const wetNode = obj.nodes.find(n => n.id === 'wet');
  assert.ok(!('description' in wetNode), 'description should be omitted when empty');

  // Clear via empty string
  net.setDescription('rain', '');
  assert.equal(net.getNode('rain').description, undefined);
});

test('setStates resets CPTs when cardinality changes', () => {
  const net = new BayesNet();
  net.addNode({ id: 'a', states: ['no','yes'] });
  net.setCPT('a', [0.8, 0.2]);
  net.addNode({ id: 'b', states: ['no','yes'], parents: ['a'] });
  net.setCPT('b', [0.9, 0.1, 0.2, 0.8]);
  net.setStates('a', ['low','med','high']);
  assert.equal(net.getNode('a').cpt.length, 3);
  assert.equal(net.getNode('b').cpt.length, 6);
});
