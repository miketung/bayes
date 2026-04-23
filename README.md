# Bayes

A Bayesian network toolkit in three parts:

- **`lib/`** — a zero-dependency ES-module JavaScript library. Runs in the
  browser and in Node. Discrete networks, variable elimination, likelihood
  weighting, JSON I/O.
- **`web/`** — a static SPA: drag-and-drop DAG editor, CPT table editor, live
  marginals, mobile-friendly list view. Modeled after BayesFusion's
  GeNIE/BayesBox/BayesMobile.
- **`cli/`** — a Node CLI + Claude Code skill that lets Claude treat a
  Bayesian network as a structured reasoning/memory tool.

Everything shares one `package.json` and the same library code.

## Quick start

```bash
npm install       # installs vite + concurrently
npm run dev       # runs the web app at http://localhost:5173 + the optional AI API on :3001
npm test          # runs the inference / IO test suite
```

`npm run dev` launches two processes side-by-side: Vite for the static SPA and
a tiny Node HTTP server for the (optional) AI enrichment endpoint. You can also
run them separately: `npm run dev:web` and `npm run dev:api`. The static app
works fine on its own — the AI button only appears when the API server is
reachable and an API key is configured.

## Optional AI enrichment

If you'd like the "✦ AI fill" button in the node inspector to search the web
and fill in node probabilities and citations automatically, copy `.env.example`
to `.env` and set `OPENAI_API_KEY`:

```bash
cp .env.example .env
echo "OPENAI_API_KEY=sk-..." >> .env
npm run dev
```

Override the base URL (`OPENAI_API_BASE`) to point at any OpenAI-compatible
endpoint that supports the Responses API + web_search tool. Model is
configurable via `BAYES_MODEL` (default: `gpt-5.4-mini`).

When you click **✦ AI fill** in the inspector, the backend runs the
`web_search` tool through the LLM, synthesizes a marginal (for root nodes) or
a full CPT (for nodes with parents), and attaches the cited sources to the
node. Sources are persisted with the network JSON so you can see them again
next time you load the file.

## Using the CLI

```bash
# interactive use from the repo
node cli/bayes.js query examples/asia.json --id dysp --format text

# or install globally
npm link
bayes list examples/earthquake.json --format text
bayes set-evidence examples/earthquake.json --id john --state yes --out /tmp/eq.json
bayes query /tmp/eq.json --id burglary --format text
```

Full command list: `bayes help`. Or see `skill/SKILL.md` for a worked example
and a description of the JSON schema.

## Installing the Claude Code skill

```bash
# make the CLI available on PATH
npm link

# install the skill so Claude Code picks it up
mkdir -p ~/.claude/skills/bayes
cp skill/SKILL.md ~/.claude/skills/bayes/SKILL.md
```

From then on, a Claude Code session can say "model this with a Bayes net" and
Claude will shell out to `bayes` to build/query a network on disk.

## Library API

```js
import { BayesNet, parse, stringify, infer } from './lib/index.js';

const net = new BayesNet('demo');
net.addNode({ id: 'rain',  states: ['no','yes'] });
net.addNode({ id: 'wet',   states: ['no','yes'], parents: ['rain'] });
net.setCPT('rain', [0.8, 0.2]);
net.setCPT('wet',  [0.9, 0.1, 0.1, 0.9]);   // row-major, parents most-sig first
net.setEvidence('wet', 'yes');

infer(net, 'rain');                          // { no: 0.31, yes: 0.69 }
infer(net, 'rain', { algorithm: 'lw', samples: 20000 });
```

### CPT layout

For a node with parents `[P1, P2, …, Pk]` (cardinalities `[c1, …, ck]`) and
`m` own states, the CPT is a flat row-major array of length `c1·c2·…·ck·m`.
Each row of length `m` is a distribution summing to 1. Rows iterate parent
combinations with **P1 as the most significant digit**, `Pk` as the least.

Within a row, entries are in the declared order of the node's own states.

## JSON schema

```json
{
  "version": 1,
  "name": "Asia",
  "nodes": [
    { "id": "asia", "name": "Visit to Asia", "states": ["no","yes"],
      "parents": [], "cpt": [0.99, 0.01] }
  ],
  "evidence": { "asia": "yes" },
  "positions": { "asia": {"x": 60, "y": 40} }
}
```

## Web app features

- Cytoscape-powered DAG canvas with pan / zoom / drag
- Per-node label shows live marginal probabilities and tiny bar charts
- Right-side inspector: rename, edit states, edit CPT, set evidence
- Auto-layout via dagre
- Three built-in example networks (Asia, Cancer, Earthquake)
- Load / save JSON; ships with no backend
- Switch between Variable Elimination (exact) and Likelihood Weighting (approx)
- Mobile: off-canvas drawer, bottom-sheet inspector, BayesMobile-style list view
- Tailwind via CDN; no build step required to hack on the UI

### Interactions

- **Connect nodes**: hover over a node — a handle appears on its edge. Drag
  the handle onto another node to create a directed arc. The **Parents**
  section in the inspector has a dropdown as a keyboard-free alternative.
- **Delete**: click a node or edge to select it, then press <kbd>Delete</kbd>
  (or <kbd>Backspace</kbd>).
- **Edit**: click a node to open the inspector. Rename, add/remove states,
  edit the CPT table, or set evidence. Everything re-runs inference live.

## Repository layout

```
index.html              static entry (Vite serves from the repo root)
lib/                    core library (zero deps, browser + node)
web/                    SPA wiring + UI components
cli/                    Node CLI (#!/usr/bin/env node, zero deps)
skill/                  Claude Code skill definition
examples/               classic networks in JSON
test/                   node --test test suite
```

## Scope / roadmap

Included: discrete chance nodes, exact inference (VE), approximate inference
(LW), JSON I/O, full graphical editor, mobile layout.

Not yet: decision nodes / utility nodes (influence diagrams), dynamic
Bayesian networks, continuous / equation nodes, noisy-MAX / noisy-adder,
sensitivity analysis, XDSL / Netica / BIF import. All are reachable from this
foundation without redesigning the data model.
