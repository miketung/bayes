#!/usr/bin/env node
// bayes CLI — operates on a JSON bayesian network file on disk.
//
// Usage:
//   bayes <subcommand> <file.json> [--flags]
//   bayes help

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve as resolvePath } from 'node:path';

import { BayesNet } from '../lib/network.js';
import { parse, stringify } from '../lib/io.js';
import { infer } from '../lib/inference/infer.js';

const USAGE = `bayes — Bayesian network CLI

Usage: bayes <command> <file> [options]

Inference
  query <file|--net JSON> --id ID [--evidence k=v ...] [--algorithm ve|lw]
  list  <file|--net JSON> [--evidence k=v ...] [--algorithm ve|lw]

Building / updating a network on disk
  new <file> [--name NAME]
  add-node <file> --id ID --states a,b,c [--parents P1,P2]
  remove-node <file> --id ID
  add-edge <file> --from PARENT --to CHILD
  remove-edge <file> --from PARENT --to CHILD
  set-cpt <file> --id ID --probs p,p,... [--normalize]
  set-evidence <file> --id ID --state STATE
  clear-evidence <file> [--id ID]

Common flags
  --format json|text      output format (default: json)
  --net JSON              pass network inline instead of reading a file
  --evidence id=state     set evidence inline (repeatable; query/list)

Pass - as <file> to read from stdin.
`;

function die(msg, code = 1) {
  process.stderr.write(`bayes: ${msg}\n`);
  process.exit(code);
}

function loadNet(path) {
  if (path === '-') return loadNetFromStdin();
  if (path === null) die('no file or --net provided');
  if (!existsSync(path)) die(`file not found: ${path}`);
  try {
    return parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`${path}: ${e.message}`);
  }
}

function loadNetFromJSON(json) {
  try {
    return parse(json);
  } catch (e) {
    die(`--net: ${e.message}`);
  }
}

function loadNetFromStdin() {
  try {
    const json = readFileSync(0, 'utf8');
    return parse(json);
  } catch (e) {
    die(`stdin: ${e.message}`);
  }
}

function resolveNet(file, values) {
  return values.net ? loadNetFromJSON(values.net) : loadNet(file);
}

function applyEvidenceFlags(net, evidenceFlags) {
  if (!evidenceFlags) return;
  for (const entry of evidenceFlags) {
    const eq = entry.indexOf('=');
    if (eq < 1) die(`bad --evidence format: "${entry}" (expected id=state)`);
    const id = entry.slice(0, eq);
    const state = entry.slice(eq + 1);
    net.setEvidence(id, state);
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
    case 'list':           cmdList(rest); break;
    case 'add-node':       cmdAddNode(rest); break;
    case 'remove-node':    cmdRemoveNode(rest); break;
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

function parseCmd(argv, opts, { fileOptional = false } = {}) {
  if (fileOptional) {
    const netIdx = argv.indexOf('--net');
    if (netIdx !== -1) {
      opts.net = { type: 'string' };
      const { values } = parseArgs({ args: argv, options: opts, allowPositionals: false, strict: true });
      return { file: null, values };
    }
  }
  const [file, ...rest] = argv;
  if (!file) die(`missing file argument (or use --net '{...}')`);
  const { values } = parseArgs({ args: rest, options: opts, allowPositionals: false, strict: true });
  return { file: file === '-' ? '-' : resolvePath(file), values };
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

function cmdList(argv) {
  const { file, values } = parseCmd(argv, {
    algorithm: { type: 'string', default: 've' },
    samples: { type: 'string' },
    evidence: { type: 'string', multiple: true },
    format: { type: 'string', default: 'json' }
  }, { fileOptional: true });
  const net = resolveNet(file, values);
  applyEvidenceFlags(net, values.evidence);
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

function cmdAddNode(argv) {
  const { file, values } = parseCmd(argv, {
    id: { type: 'string' },
    name: { type: 'string' },
    states: { type: 'string' },
    parents: { type: 'string' },
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
    parents: parseCSV(values.parents) ?? []
  });
  saveNet(net, values.out ? resolvePath(values.out) : file);
  printResult({ ok: true, id: values.id }, values.format);
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
    evidence: { type: 'string', multiple: true },
    format: { type: 'string', default: 'json' }
  }, { fileOptional: true });
  if (!values.id) die('--id required');
  const net = resolveNet(file, values);
  applyEvidenceFlags(net, values.evidence);
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
