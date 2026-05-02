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

## Grounding priors

If the CPTs depend on real-world rates — prevalence, prices, base rates,
historical frequencies — web-search them before filling numbers and cite
the source next to each value in your response. Skip this when the network is illustrative,
the numbers come from the user or problem statement, or it's a toy example.
If the harness has no web search, flag estimates as such and widen the
distributions to reflect the added uncertainty.

## Two workflows

### One-shot: build the JSON, query inline

When you know the full structure up front, construct the network JSON and pass
it directly via `--net`. Set evidence with `--evidence` flags. One bash call,
no file needed.

```
bayes query --net '{
  "version": 1, "name": "Whodunit",
  "nodes": [
    { "id": "culprit", "states": ["scarlett","plum","mustard","green"], "parents": [],
      "cpt": [0.30, 0.20, 0.30, 0.20] },
    { "id": "weapon_found", "states": ["knife","rope","wrench","revolver"], "parents": ["culprit"],
      "cpt": [0.40,0.20,0.10,0.30, 0.10,0.20,0.50,0.20, 0.10,0.10,0.20,0.60, 0.20,0.40,0.30,0.10] },
    { "id": "time_of_death", "states": ["6pm-8pm","8pm-10pm","10pm-12am","after_12am"], "parents": ["culprit"],
      "cpt": [0.10,0.20,0.40,0.30, 0.20,0.30,0.30,0.20, 0.40,0.40,0.15,0.05, 0.30,0.40,0.20,0.10] },
    { "id": "fingerprint_match", "states": ["no","yes"], "parents": ["culprit"],
      "cpt": [0.70,0.30, 0.40,0.60, 0.50,0.50, 0.20,0.80] }
  ]
}' --id culprit --evidence weapon_found=wrench --evidence time_of_death=10pm-12am --evidence fingerprint_match=yes
```

The output variable (`culprit`) has named entities as states — that's the
default whenever the question asks "which one?". The other nodes demonstrate
the two remaining common kinds: numeric ranges (`time_of_death`) and binary
(`fingerprint_match`). Single-quote evidence values that contain shell
metacharacters like `<`, `>`, or `≥`.

Result: `{ "marginal": { "scarlett": 0.101, "plum": 0.504, "mustard": 0.126, "green": 0.269 }, ... }`

Use `--format text` for human-readable output. Use `list` instead of `query`
to see all marginals at once.

### Iterative: build on disk, update as you learn

When the model evolves over the conversation — start simple, query, add
variables, re-query — use mutation commands on a file.

```
bayes new /tmp/whodunit.json --name "Whodunit"

bayes add-node /tmp/whodunit.json --id culprit           --states scarlett,plum,mustard,green
bayes add-node /tmp/whodunit.json --id weapon_found      --states knife,rope,wrench,revolver --parents culprit
bayes add-node /tmp/whodunit.json --id time_of_death     --states '6pm-8pm,8pm-10pm,10pm-12am,after_12am' --parents culprit
bayes add-node /tmp/whodunit.json --id fingerprint_match --states no,yes --parents culprit

bayes set-cpt /tmp/whodunit.json --id culprit           --probs 0.30,0.20,0.30,0.20
bayes set-cpt /tmp/whodunit.json --id weapon_found      --probs 0.40,0.20,0.10,0.30, 0.10,0.20,0.50,0.20, 0.10,0.10,0.20,0.60, 0.20,0.40,0.30,0.10
bayes set-cpt /tmp/whodunit.json --id time_of_death     --probs 0.10,0.20,0.40,0.30, 0.20,0.30,0.30,0.20, 0.40,0.40,0.15,0.05, 0.30,0.40,0.20,0.10
bayes set-cpt /tmp/whodunit.json --id fingerprint_match --probs 0.70,0.30, 0.40,0.60, 0.50,0.50, 0.20,0.80

bayes query /tmp/whodunit.json --id culprit --evidence weapon_found=wrench --evidence time_of_death=10pm-12am --evidence fingerprint_match=yes --format text
# → plum ~50%, green ~27%, mustard ~13%, scarlett ~10%

# `list` shows all marginals at once — useful for sanity-checking priors:
bayes list /tmp/whodunit.json --format text

# Later: a strong motive surfaces — add it as a new node
bayes add-node /tmp/whodunit.json --id motive_strength --states none,weak,strong --parents culprit
bayes set-cpt /tmp/whodunit.json --id motive_strength --probs 0.20,0.30,0.50, 0.50,0.30,0.20, 0.40,0.40,0.20, 0.20,0.30,0.50

# Re-query — Green (strong-motive profile) overtakes Plum (weak-motive profile)
bayes query /tmp/whodunit.json --id culprit --evidence weapon_found=wrench --evidence time_of_death=10pm-12am --evidence fingerprint_match=yes --evidence motive_strength=strong --format text
# → green ~43%, plum ~32%, scarlett ~16%, mustard ~8%
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
- **Pick states at the granularity the question needs** — yes/no, named
  categories (candidates, diagnoses), or bucketed ranges for quantities.
- **Avoid 0 or 1 in CPTs** unless truly deterministic — zeros can make
  evidence combinations impossible.
- **Re-query after new evidence** to watch beliefs shift.
- **Prefer `ve` for final answers**, `lw` for quick checks on large networks.
