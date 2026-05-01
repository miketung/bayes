---
name: bayes
description: Build and query Bayesian networks as a structured reasoning tool. Use when the task involves thinking over multiple related variables, diagnosis under uncertainty, or updating beliefs as new evidence arrives.
---

# bayes — Bayesian networks as a reasoning tool

You have access to the `bayes` CLI (run as `node <repo>/cli/bayes.js`).
It builds discrete Bayesian networks, runs exact or approximate inference,
and can persist networks as JSON files on disk.

Use this when modelling probabilistic relationships between multiple variables
— especially when you need to reason about uncertainty, update beliefs given
evidence, or compare hypotheses that share latent causes.

If the task is a single-variable prior or a calculation that doesn't benefit
from structure, just do the math directly — don't force a network.

## Two workflows

### One-shot: build the JSON, query inline

When you know the full structure up front, construct the network JSON and pass
it directly via `--net`. Set evidence with `--evidence` flags. One bash call,
no file needed.

```
bayes query --net '{
  "version": 1, "name": "Flu",
  "nodes": [
    { "id": "flu",   "states": ["no","yes"], "parents": [], "cpt": [0.95, 0.05] },
    { "id": "fever", "states": ["no","yes"], "parents": ["flu"], "cpt": [0.95,0.05, 0.20,0.80] },
    { "id": "cough", "states": ["no","yes"], "parents": ["flu"], "cpt": [0.90,0.10, 0.30,0.70] }
  ]
}' --id flu --evidence fever=yes --evidence cough=yes
```

Result: `{ "marginal": { "no": 0.145, "yes": 0.855 }, ... }`

Use `--format text` for human-readable output. Use `list` instead of `query`
to see all marginals at once.

### Iterative: build on disk, update as you learn

When the model evolves over the conversation — start simple, query, add
variables, re-query — use mutation commands on a file.

```
bayes new /tmp/flu.json --name "Flu diagnosis"

bayes add-node /tmp/flu.json --id flu    --states no,yes
bayes add-node /tmp/flu.json --id fever  --states no,yes --parents flu
bayes add-node /tmp/flu.json --id cough  --states no,yes --parents flu

bayes set-cpt /tmp/flu.json --id flu    --probs 0.95,0.05
bayes set-cpt /tmp/flu.json --id fever  --probs 0.95,0.05, 0.20,0.80
bayes set-cpt /tmp/flu.json --id cough  --probs 0.90,0.10, 0.30,0.70

bayes query /tmp/flu.json --id flu --evidence fever=yes --evidence cough=yes --format text
# → P(flu=yes | fever=yes, cough=yes) ≈ 85%

# Later: add a new variable
bayes add-node /tmp/flu.json --id aches --states no,yes --parents flu
bayes set-cpt /tmp/flu.json --id aches --probs 0.85,0.15, 0.30,0.70

# Re-query with more evidence
bayes query /tmp/flu.json --id flu --evidence fever=yes --evidence cough=yes --evidence aches=yes --format text
```

You can also write the JSON file directly (with the Write tool) and use the
CLI only for queries — the parser validates structure on load.

## CPT layout

For a node with parents `[P1, ..., Pk]` (cardinalities `[c1, ..., ck]`) and
`m` own states, the CPT is a flat array of length `c1 * c2 * ... * ck * m`.

Each row of `m` values is a distribution summing to 1. Rows iterate parent
combinations with **P1 most significant**, Pk least significant.

Example: `X` with states `[no, yes]`, parents `[A, B]` each `[no, yes]`:

```
A=no,  B=no   → [P(X=no|...), P(X=yes|...)]
A=no,  B=yes  → [P(X=no|...), P(X=yes|...)]
A=yes, B=no   → [P(X=no|...), P(X=yes|...)]
A=yes, B=yes  → [P(X=no|...), P(X=yes|...)]
```

Pass `--normalize` on `set-cpt` to auto-normalize rows.

## Command reference

```
Inference
  query <file|--net JSON> --id ID [--evidence k=v ...] [--algorithm ve|lw] [--samples N]
  list  <file|--net JSON> [--evidence k=v ...] [--algorithm ve|lw] [--samples N]

Building / updating
  new <file> [--name NAME]
  add-node <file> --id ID --states a,b,c [--parents P1,P2]
  remove-node <file> --id ID
  add-edge <file> --from PARENT --to CHILD
  remove-edge <file> --from PARENT --to CHILD
  set-cpt <file> --id ID --probs p,p,... [--normalize]
  set-evidence <file> --id ID --state STATE
  clear-evidence <file> [--id ID]
```

All commands accept `--format text` for human output. Mutation commands accept
`--out FILE` to write to a different file. Pass `-` as `<file>` to read from
stdin.

## JSON format

```json
{
  "version": 1,
  "name": "My Network",
  "nodes": [
    { "id": "X", "states": ["no", "yes"], "parents": [], "cpt": [0.9, 0.1] },
    { "id": "Y", "states": ["no", "yes"], "parents": ["X"], "cpt": [0.7, 0.3, 0.2, 0.8] }
  ],
  "evidence": { "X": "yes" }
}
```

## Inference algorithms

- `ve` (default) — exact variable elimination. Use for networks up to a few
  dozen nodes.
- `lw` — likelihood weighting (approximate). Use when `ve` is slow or for
  quick sample-based estimates. Pass `--samples N` (default 10000).

## Guidance

- **State the DAG before filling numbers.** Verify edges are causal
  (parents cause children).
- **Use 2–3 states per node.** Binary is often enough.
- **Avoid 0 or 1 in CPTs** unless truly deterministic — zeros can make
  evidence combinations impossible.
- **Re-query after new evidence** to watch beliefs shift.
- **Prefer `ve` for final answers**, `lw` for quick checks on large networks.
