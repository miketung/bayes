#!/usr/bin/env node
// bayes CLI — operates on a JSON bayesian network file on disk.
//
// Usage:
//   bayes <subcommand> <file.json> [--flags]
//   bayes help
//
// All subcommands read <file.json>, apply the operation, and (for mutating
// commands) write the result back.  Output is JSON by default so Claude can
// parse it; pass --format text for a human-readable summary.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve as resolvePath } from 'node:path';

import { BayesNet } from '../lib/network.js';
import { parse, stringify } from '../lib/io.js';
import { infer } from '../lib/inference/infer.js';

const USAGE = `bayes — Bayesian network CLI

Usage: bayes <command> <file> [options]

Network management
  new <file> [--name NAME]                             create empty network
  info <file>                                          show structure summary
  list <file> [--algorithm ve|lw] [--samples N]        list nodes with current marginals
  export <file>                                        print JSON to stdout
  import <src> <dst>                                   parse+revalidate+rewrite

Nodes
  add-node <file> --id ID [--name N] --states a,b,c [--parents P1,P2] [--description TEXT]
  remove-node <file> --id ID
  rename-node <file> --id ID --name NAME
  set-states <file> --id ID --states a,b,c            (clears dependent CPTs)
  set-description <file> --id ID --text TEXT         (pass empty --text "" to clear)

Edges
  add-edge <file> --from PARENT --to CHILD             (reshapes child CPT)
  remove-edge <file> --from PARENT --to CHILD

CPTs
  set-cpt <file> --id ID --probs 0.1,0.9,...           row-major; --normalize to auto-normalize

Evidence
  set-evidence <file> --id ID --state STATE
  clear-evidence <file> [--id ID]                      omit --id to clear all

Inference
  query <file> --id ID [--algorithm ve|lw] [--samples N]

Common flags
  --format json|text      output format (default: json)
  --out FILE              write mutations to a different file

Run "bayes help <command>" for more detail.
`;

function die(msg, code = 1) {
  process.stderr.write(`bayes: ${msg}\n`);
  process.exit(code);
}

function loadNet(path) {
  if (!existsSync(path)) die(`file not found: ${path}`);
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`${path}: ${e.message}`);
  }
}

function saveNet(net, outPath) {
  writeFileSync(outPath, stringify(net) + '\n', 'utf8');
}

function printResult(value, format) {
  if (format === 'text') {
    if (typeof value === 'string') { process.stdout.write(value + '\n'); return; }
    if (value && typeof value === 'object' && value.__text) {
      process.stdout.write(value.__text + '\n');
      return;
    }
    // For simple { ok: true, ...fields } results, print a one-line summary.
    if (value && typeof value === 'object' && value.ok === true) {
      const parts = ['ok'];
      for (const [k, v] of Object.entries(value)) {
        if (k === 'ok') continue;
        parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
      process.stdout.write(parts.join('  ') + '\n');
      return;
    }
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  }
}

function parseCSV(s) {
  if (s == null) return null;
  return s.split(',').map(x => x.trim()).filter(x => x.length);
}

function parseProbs(s) {
  if (s == null) return null;
  return s.split(',').map(x => {
    const n = Number(x.trim());
    if (!Number.isFinite(n)) throw new Error(`bad probability: "${x}"`);
    return n;
  });
}

// ---------- dispatch ----------

const subcommand = process.argv[2];
const rest = process.argv.slice(3);

if (!subcommand || subcommand === 'help' || subcommand === '-h' || subcommand === '--help') {
  process.stdout.write(USAGE);
  process.exit(subcommand ? 0 : 1);
}

try {
  switch (subcommand) {
    case 'new':            cmdNew(rest); break;
    case 'info':           cmdInfo(rest); break;
    case 'list':           cmdList(rest); break;
    case 'export':         cmdExport(rest); break;
    case 'import':         cmdImport(rest); break;
    case 'add-node':       cmdAddNode(rest); break;
    case 'remove-node':    cmdRemoveNode(rest); break;
    case 'rename-node':    cmdRenameNode(rest); break;
    case 'set-states':     cmdSetStates(rest); break;
    case 'set-description': cmdSetDescription(rest); break;
    case 'add-edge':       cmdAddEdge(rest); break;
    case 'remove-edge':    cmdRemoveEdge(rest); break;
    case 'set-cpt':        cmdSetCpt(rest); break;
    case 'set-evidence':   cmdSetEvidence(rest); break;
    case 'clear-evidence': cmdClearEvidence(rest); break;
    case 'query':          cmdQuery(rest); break;
    default:               die(`unknown command: ${subcommand}\n\n${USAGE}`);
  }
} catch (e) {
  die(e.message);
}

// ---------- command implementations ----------

function parseCmd(argv, opts) {
  // First positional is the file path; remainder goes through parseArgs.
  const [file, ...rest] = argv;
  if (!file) die(`missing file argument`);
  const { values } = parseArgs({ args: rest, options: opts, allowPositionals: false, strict: true });
  return { file: resolvePath(file), values };
}

function cmdNew(argv) {
  const { file, values } = parseCmd(argv, {
    name: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  const net = new BayesNet(values.name ?? 'untitled');
  saveNet(net, file);
  printResult({ ok: true, file, name: net.name }, values.format);
}

function cmdInfo(argv) {
  const { file, values } = parseCmd(argv, {
    format: { type: 'string', default: 'json' }
  });
  const net = loadNet(file);
  const summary = {
    name: net.name,
    nodeCount: net.size,
    edgeCount: [...net.nodes.values()].reduce((n, v) => n + v.parents.length, 0),
    nodes: [...net.nodes.values()].map(n => ({
      id: n.id, name: n.name, states: n.states, parents: n.parents,
      description: n.description ?? null,
      evidence: net.evidence.has(n.id) ? n.states[net.evidence.get(n.id)] : null
    }))
  };
  if (values.format === 'text') {
    let t = `Network: ${summary.name}\n`;
    t += `Nodes: ${summary.nodeCount}, Edges: ${summary.edgeCount}\n\n`;
    for (const n of summary.nodes) {
      const ev = n.evidence ? `  [evidence: ${n.evidence}]` : '';
      t += `  ${n.id} "${n.name}" [${n.states.join('|')}]${ev}\n`;
      if (n.parents.length) t += `    parents: ${n.parents.join(', ')}\n`;
      if (n.description) t += `    ${n.description.split('\n').join('\n    ')}\n`;
    }
    process.stdout.write(t);
  } else {
    printResult(summary, 'json');
  }
}

function cmdList(argv) {
  const { file, values } = parseCmd(argv, {
    algorithm: { type: 'string', default: 've' },
    samples: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  const net = loadNet(file);
  const results = [];
  for (const id of net.ids()) {
    const marginal = infer(net, id, {
      algorithm: values.algorithm,
      samples: values.samples ? Number(values.samples) : undefined
    });
    results.push({ id, name: net.getNode(id).name, marginal,
      evidence: net.evidence.has(id) ? net.getNode(id).states[net.evidence.get(id)] : null });
  }
  if (values.format === 'text') {
    for (const r of results) {
      const ev = r.evidence ? ` [observed: ${r.evidence}]` : '';
      const bars = Object.entries(r.marginal)
        .map(([s, p]) => `${s}=${(p * 100).toFixed(1)}%`).join('  ');
      process.stdout.write(`  ${r.id.padEnd(12)} ${bars}${ev}\n`);
    }
  } else {
    printResult({ algorithm: values.algorithm, nodes: results }, 'json');
  }
}

function cmdExport(argv) {
  const { file } = parseCmd(argv, {});
  const net = loadNet(file);
  process.stdout.write(stringify(net) + '\n');
}

function cmdImport(argv) {
  const [src, dst, ...rest] = argv;
  if (!src || !dst) die('usage: bayes import <src> <dst> [--format json|text]');
  const { values } = parseArgs({
    args: rest,
    options: { format: { type: 'string', default: 'json' } },
    allowPositionals: false,
    strict: true
  });
  const net = parse(readFileSync(resolvePath(src), 'utf8'));
  saveNet(net, resolvePath(dst));
  printResult({ ok: true, src, dst, nodes: net.size }, values.format);
}

function cmdAddNode(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    name: { type: 'string' },
    states: { type: 'string' },
    parents: { type: 'string' },
    description: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id) die('--id required');
  if (!values.states) die('--states required (comma-separated)');
  const net = loadNet(file);
  net.addNode({
    id: values.id,
    name: values.name,
    states: parseCSV(values.states),
    parents: parseCSV(values.parents) ?? [],
    description: values.description
  });
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id }, values.format);
}

function cmdSetDescription(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    text: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id) die('--id required');
  if (values.text == null) die('--text required (pass "" to clear)');
  const net = loadNet(file);
  net.setDescription(values.id, values.text);
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id, cleared: values.text === '' }, values.format);
}

function cmdRemoveNode(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id) die('--id required');
  const net = loadNet(file);
  net.removeNode(values.id);
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, removed: values.id }, values.format);
}

function cmdRenameNode(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    name: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id || !values.name) die('--id and --name required');
  const net = loadNet(file);
  net.renameNode(values.id, values.name);
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id, name: values.name }, values.format);
}

function cmdSetStates(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    states: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id || !values.states) die('--id and --states required');
  const net = loadNet(file);
  net.setStates(values.id, parseCSV(values.states));
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id, states: parseCSV(values.states) }, values.format);
}

function cmdAddEdge(argv) {
  const { file, values } = parseCmd(argv, {
    from: { type: 'string' },
    to: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.from || !values.to) die('--from and --to required');
  const net = loadNet(file);
  net.addEdge(values.from, values.to);
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, from: values.from, to: values.to }, values.format);
}

function cmdRemoveEdge(argv) {
  const { file, values } = parseCmd(argv, {
    from: { type: 'string' },
    to: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.from || !values.to) die('--from and --to required');
  const net = loadNet(file);
  net.removeEdge(values.from, values.to);
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, from: values.from, to: values.to }, values.format);
}

function cmdSetCpt(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    probs: { type: 'string' },
    normalize: { type: 'boolean', default: false },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id || !values.probs) die('--id and --probs required');
  const net = loadNet(file);
  net.setCPT(values.id, parseProbs(values.probs), { normalize: values.normalize });
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id }, values.format);
}

function cmdSetEvidence(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    state: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id || values.state == null) die('--id and --state required');
  const net = loadNet(file);
  net.setEvidence(values.id, values.state);
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id, state: values.state }, values.format);
}

function cmdClearEvidence(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    out: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  const net = loadNet(file);
  if (values.id) net.clearEvidence(values.id);
  else net.clearEvidence();
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, cleared: values.id ?? 'all' }, values.format);
}

function cmdQuery(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    algorithm: { type: 'string', default: 've' },
    samples: { type: 'string' },
    format: { type: 'string', default: 'json' }
  });
  if (!values.id) die('--id required');
  const net = loadNet(file);
  const started = Date.now();
  const marginal = infer(net, values.id, {
    algorithm: values.algorithm,
    samples: values.samples ? Number(values.samples) : undefined
  });
  const ms = Date.now() - started;
  const result = {
    query: values.id,
    algorithm: values.algorithm,
    samples: values.algorithm === 'lw' ? Number(values.samples ?? 10000) : null,
    evidence: (() => {
      const e = {};
      for (const [id, idx] of net.evidence) e[id] = net.getNode(id).states[idx];
      return e;
    })(),
    marginal,
    elapsedMs: ms
  };
  if (values.format === 'text') {
    const bars = Object.entries(marginal)
      .map(([s, p]) => `${s} = ${(p * 100).toFixed(2)}%`).join('\n  ');
    const ev = Object.entries(result.evidence).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)';
    process.stdout.write(
      `P(${values.id}) given evidence [${ev}] via ${values.algorithm}:\n  ${bars}\n(${ms} ms)\n`
    );
  } else {
    printResult(result, 'json');
  }
}
