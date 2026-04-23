---
name: bayes
description: Build and query Bayesian networks on disk as a structured reasoning/memory tool. Use when the task involves probabilistic reasoning over multiple related variables, diagnosis under uncertainty, updating beliefs as new evidence arrives, or any request phrased as "reason about X with a Bayes net" / "model the probability of Y given Z". Especially useful when a decision hinges on several uncertain, interdependent factors.
---

# bayes — Bayesian networks as a reasoning tool

You have access to the `bayes` CLI (installed at `bayes` on PATH, or run as
`node <repo>/cli/bayes.js`). It persists discrete Bayesian networks as JSON
files on disk and runs exact/approximate inference over them.

Use this when modelling probabilistic relationships between multiple variables
— especially when the user asks you to reason about uncertainty, update beliefs
given evidence, or compare hypotheses that share latent causes.

## When to reach for a Bayes net

- **Diagnosis**: a set of symptoms → which underlying cause is most likely?
- **Sensor fusion**: several noisy observations → best estimate of a hidden state.
- **Causal what-ifs**: "if I intervene on X, how do downstream variables shift?"
- **Multi-evidence updating**: when naive probability math gets messy because
  variables are correlated through shared parents.

If the task is a single-variable prior or a calculation that doesn't benefit
from structure, just do the math directly — don't force a network.

## Workflow

1. **Sketch the DAG**: decide variables (node IDs), their discrete states, and
   which nodes depend on which. Only allow edges parent → child (it must be a
   DAG).
2. **Create the file**: `bayes new <file.json> --name "<model>"`.
3. **Add nodes** in topological order (parents first):
   `bayes add-node <file> --id X --name "X" --states a,b,c [--parents P1,P2] [--description "what this variable means"]`.
   A short description helps readers (and future-you) remember the modelling
   choice behind each variable. Add or update one later with
   `bayes set-description <file> --id X --text "..."`.
4. **Fill CPTs**: `bayes set-cpt <file> --id X --probs p1,p2,...`.  See CPT
   layout below. Pass `--normalize` if your values aren't already normalized.
5. **Set evidence** as observations arrive:
   `bayes set-evidence <file> --id X --state a`.
6. **Query**: `bayes query <file> --id X [--algorithm ve|lw]` — returns a JSON
   probability distribution.  Use `--format text` for human-readable output.
7. **Explore**: `bayes list <file>` shows every node's current marginal so you
   can watch beliefs propagate.

## CPT layout (important)

For a node `X` with parents `[P1, P2, ..., Pk]` each having cardinalities
`[c1, ..., ck]` and `X` having `m` states:

- CPT length is `c1 * c2 * ... * ck * m`.
- It's row-major. Each row is a probability distribution over `X`'s states and
  must sum to 1. There is one row per combination of parent values.
- Parent combinations iterate with **`P1` as the most significant digit**,
  `Pk` as the least significant. Within a row, entries are in the declared
  order of `X`'s states.

Example: `X` with states `[no, yes]`, parents `[A, B]` each `[no, yes]`:

```
row 0: A=no,  B=no   → [P(X=no|A=no,B=no),   P(X=yes|A=no,B=no)]
row 1: A=no,  B=yes  → [P(X=no|A=no,B=yes),  P(X=yes|A=no,B=yes)]
row 2: A=yes, B=no   → [P(X=no|A=yes,B=no),  P(X=yes|A=yes,B=no)]
row 3: A=yes, B=yes  → [P(X=no|A=yes,B=yes), P(X=yes|A=yes,B=yes)]
```

`--probs` takes a flat comma-separated list of all 8 values in that order.

## Inference algorithms

- `ve` (default, exact variable elimination) — use for any network up to a few
  dozen nodes and moderate connectivity. Result is exact up to float precision.
- `lw` (likelihood weighting, approximate) — use when `ve` is slow (networks of
  50+ densely-connected nodes) or you just want a quick sample-based estimate.
  Pass `--samples N` (default 10 000). Results are stochastic.

## Full command reference

```
bayes new <file> [--name NAME]
bayes info <file>
bayes list <file> [--algorithm ve|lw] [--samples N]
bayes export <file>                                   # prints JSON to stdout

bayes add-node <file>        --id ID [--name N] --states a,b,c [--parents P1,P2] [--description TEXT]
bayes remove-node <file>     --id ID
bayes rename-node <file>     --id ID --name NAME
bayes set-states <file>      --id ID --states a,b,c       # only clears CPTs if cardinality changes
bayes set-description <file> --id ID --text TEXT          # pass --text "" to clear

bayes add-edge <file>    --from PARENT --to CHILD
bayes remove-edge <file> --from PARENT --to CHILD

bayes set-cpt <file>     --id ID --probs p,p,...  [--normalize]

bayes set-evidence <file>   --id ID --state STATE
bayes clear-evidence <file> [--id ID]                 # omit --id to clear all

bayes query <file> --id ID [--algorithm ve|lw] [--samples N]
```

Every command accepts `--format text` for human output and `--out FILE` to
write mutations elsewhere instead of in place. All JSON responses include
`ok: true` on success; errors go to stderr with non-zero exit.

## Worked example: cough + fever diagnosis

```
bayes new /tmp/flu.json --name "Flu diagnosis"
bayes add-node /tmp/flu.json --id flu    --name "Flu"    --states no,yes
bayes add-node /tmp/flu.json --id fever  --name "Fever"  --states no,yes --parents flu
bayes add-node /tmp/flu.json --id cough  --name "Cough"  --states no,yes --parents flu

bayes set-cpt /tmp/flu.json --id flu    --probs 0.95,0.05
bayes set-cpt /tmp/flu.json --id fever  --probs 0.95,0.05, 0.20,0.80
bayes set-cpt /tmp/flu.json --id cough  --probs 0.90,0.10, 0.30,0.70

# Patient reports both fever and cough
bayes set-evidence /tmp/flu.json --id fever --state yes
bayes set-evidence /tmp/flu.json --id cough --state yes

bayes query /tmp/flu.json --id flu --format text
# → P(flu=yes | fever=yes, cough=yes) ≈ 76%
```

## JSON format

Networks are plain JSON. Feel free to hand-edit them if that's faster than
issuing many CLI calls — the schema is:

```json
{
  "version": 1,
  "name": "My Network",
  "nodes": [
    { "id": "X", "name": "X", "states": ["no", "yes"],
      "parents": [],            "cpt": [0.9, 0.1],
      "description": "optional free-text notes about what X represents" },
    { "id": "Y", "name": "Y", "states": ["no", "yes"],
      "parents": ["X"],         "cpt": [0.7, 0.3, 0.2, 0.8] }
  ],
  "evidence": { "X": "yes" },
  "positions": { "X": { "x": 100, "y": 100 } }
}
```

After hand-editing, verify with `bayes info <file>` — it reparses and will
complain about bad shapes, unnormalized rows, or cycles.

## Guidance for reasoning

- **State the structure before filling numbers.** Write down the DAG and state
  sets first; verify they make causal/semantic sense (parents cause children).
- **Use 2–3 states per node by default.** Binary is often enough; only split
  finer if the question genuinely requires it.
- **Calibrate CPTs conservatively.** Don't put 0 or 1 unless the relationship
  is truly deterministic — zero-probability rows can make evidence combinations
  impossible (inference errors out).
- **Re-query after every new piece of evidence.** Part of the point is watching
  beliefs shift.
- **Prefer `ve` for final answers**, reserve `lw` for quick sanity checks on
  large networks.
