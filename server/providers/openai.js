// OpenAI-compatible provider.  Uses the Responses API's built-in web_search
// tool to gather evidence, then asks the model to synthesize a marginal or
// CPT plus attributed sources.  Called via plain `fetch` — no SDK dependency.
//
// Env-driven knobs (all optional except the API key):
//   OPENAI_API_KEY    bearer token (required)
//   OPENAI_API_BASE   endpoint root, defaults to https://api.openai.com/v1
//                     Point at any OpenAI-compatible proxy that implements
//                     the Responses API + web_search tool (e.g. Azure OpenAI,
//                     local LiteLLM, Cloudflare AI Gateway, …).
//   BAYES_MODEL       model id, defaults to gpt-4.1-mini.
//
// Future split: when we want to use a non-OpenAI LLM (one that doesn't expose
// a web_search tool), this module will shrink to a plain chat/completion call
// and a sibling `providers/search-*.js` module will pre-fetch results and
// pass them to the LLM as context.  The response shape stays the same.

const DEFAULT_BASE  = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-5.4-mini';

export function openaiProvider() {
  return {
    id: 'openai',
    available:     () => !!process.env.OPENAI_API_KEY,
    model:         () => process.env.BAYES_MODEL || DEFAULT_MODEL,
    search,
    suggestStates,
  };
}

async function suggestStates({ node }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const base  = (process.env.OPENAI_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.BAYES_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    instructions: STATES_SYSTEM_PROMPT,
    input: buildStatesPrompt(node),
    text: {
      format: {
        type: 'json_schema',
        name: 'bayes_suggest_states',
        schema: STATES_SCHEMA,
        strict: true
      }
    }
  };

  const res = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const textOut = extractText(data);
  const parsed = extractJSON(textOut);
  if (!parsed) throw new Error(`could not parse JSON from model output:\n${textOut.slice(0, 500)}`);
  return normalizeStates(parsed);
}

// Strict schema for suggest-states. Instead of asking the model to emit final
// labels (which it reflexively collapses to "low/medium/high" for anything
// quantitative), we have it commit to the variable's shape + numeric facts
// and synthesize the labels ourselves. Removes the label-generation failure
// mode at the API layer.
const STATES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['binary', 'categorical', 'numeric', 'subjective']
    },
    // numeric: unit text ("$B", "%", "wk", "bps", "count", "bp", …)
    //         and ordered numeric cut points separating buckets. N cut
    //         points produce N+1 buckets.  Empty for non-numeric kinds.
    unit:      { type: 'string' },
    cutPoints: {
      type: 'array',
      items: { type: 'number' },
      maxItems: 4
    },
    // categorical: the names themselves (e.g. ["Monday",...,"weekend"])
    // subjective: ordinal words ("none","mild","moderate","severe")
    // binary / numeric: leave empty — we synthesize.
    labels:    {
      type: 'array',
      items: { type: 'string' },
      maxItems: 6
    },
    // For YoY-change-style numeric variables where the cut points are
    // signed deltas, set true so the synthesized labels use ± syntax
    // instead of </>.
    signed:    { type: 'boolean' },
    reasoning: { type: 'string' }
  },
  required: ['kind', 'unit', 'cutPoints', 'labels', 'signed', 'reasoning']
};

const STATES_SYSTEM_PROMPT = `You are picking the discrete states for a Bayesian network node. Fill
in the structured response object.

Decide "kind" by asking a single question: does deciding which state a
real observation falls into require looking at a number?

  If yes → kind="numeric". This is the default for anything that is
  reported, measured, or tracked as a quantity — capex, prices,
  inventories, latencies, unemployment rates, percent changes, counts,
  response times, margins, shares, leads, etc. Including things whose
  names look qualitative like "inventory" or "latency" — the decision
  of whether inventory is "low" still requires knowing weeks of stock,
  so it is numeric.

  If no (the observation is literally a yes/no, a categorical name,
  or an inherently subjective scale with no underlying number) → pick
  the matching non-numeric kind.

Then fill the fields:

  kind="numeric" (most variables will be here):
    - "unit": REQUIRED, non-empty. The SI-style suffix or prefix shown
      in every label. Examples: "$B", "%", "wk", "bps", "ms", "count",
      "$M", "°C". Use the unit the variable is normally reported in.
    - "cutPoints": the N numeric thresholds in ascending order, giving
      N+1 buckets. Use domain-conventional cut points — web_search if
      you're unsure what's standard for this specific metric.
    - "signed": true if the variable is a signed change (YoY delta,
      percent change, bps move); false for non-negative quantities
      like inventory weeks or capex level.
    - Leave "labels" empty; the server builds them.

  kind="binary": the variable's answer space is exactly {yes, no} —
    the observation tells you whether a proposition holds. The
    question form (Is/Has/Does/Will...) alone is not enough; extract
    the actual answer space from the description. If the description
    enumerates named alternatives, the answer space is those
    alternatives, not {yes, no}, so the variable is categorical.
    Leave everything else empty. Server emits ["no","yes"].

  kind="categorical": the answer space is a fixed set of named
    alternatives — either enumerated explicitly by the description,
    or drawn from a canonical set (natural enumeration), or from a
    ranked top-N of entities. Fill "labels" with those names.
    Web_search if the top-N is market-dependent. Leave numeric fields
    empty.

  kind="subjective": ONLY for inherently-subjective qualities with NO
    underlying measurable number — pain severity, perceived usability,
    satisfaction ratings. Fill "labels" with an ordinal scale. Leave
    numeric fields empty. A data-analyst test: if someone could compute
    this variable from public data, it is numeric, not subjective.

Keep total state count ≤ 4 where possible. "reasoning" = 1 short
sentence explaining the classification; for numeric, name the unit
and the cut points you chose.`;

function buildStatesPrompt(node) {
  const lines = [`Node name: ${node.name ?? node.id ?? 'Unknown'}`];
  if (node.description) lines.push(`Description: ${node.description}`);
  return lines.join('\n');
}

// Synthesize human-readable state labels from the structured response.
// For numeric kinds we construct labels from cutPoints + unit so the model's
// tendency to collapse everything to "low/medium/high" cannot escape.
function normalizeStates(raw) {
  const reasoning = String(raw?.reasoning ?? '');
  const kind = raw?.kind;
  let states = [];

  if (kind === 'binary') {
    states = ['no', 'yes'];
  } else if (kind === 'numeric' && Array.isArray(raw.cutPoints) && raw.cutPoints.length > 0) {
    states = synthesizeNumericStates(raw.cutPoints, String(raw.unit ?? '').trim(), !!raw.signed);
  } else if ((kind === 'categorical' || kind === 'subjective') && Array.isArray(raw.labels)) {
    const seen = new Set();
    for (const s of raw.labels) {
      const name = String(s ?? '').trim();
      if (name && !seen.has(name)) { seen.add(name); states.push(name); }
    }
  } else if (Array.isArray(raw?.labels) && raw.labels.length >= 2) {
    // Defensive fallback when kind was malformed.
    states = [...new Set(raw.labels.map(s => String(s).trim()).filter(Boolean))];
  }

  if (states.length < 2) throw new Error('could not synthesize >= 2 states from model output');
  return { states: states.slice(0, 6), reasoning };
}

function synthesizeNumericStates(cutPoints, unit, signed) {
  const cps = [...cutPoints].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!cps.length) return [];
  // Split `unit` into (prefix, suffix). Currency symbols sit before the number;
  // everything else (percent, weeks, bps, ms, and magnitude letters like B/M/K
  // paired with a currency) sits after. This handles the common compounds
  // "$B", "$M", "$K", "€B", "¥B" → prefix="$", suffix="B", producing "$350B".
  const raw = (unit ?? '').trim();
  const m = raw.match(/^([\$€£¥])\s*([A-Za-z]*)$/);
  const prefix = m ? m[1] : '';
  const suffix = m ? m[2] : raw;
  const unitIsPercent = suffix === '%' || suffix === 'pp' || suffix === 'bps';
  const needsSpace = suffix && !unitIsPercent && !/^[A-Z]$/.test(suffix); // "wk","ms","count" etc.

  const fmtNum = (n) => {
    const abs = Math.abs(n);
    const s = Number.isInteger(n) ? String(abs) :
              abs >= 10 ? abs.toFixed(0) :
              abs.toFixed(2).replace(/\.?0+$/, '');
    const body = (signed && n > 0) ? `+${s}` : (n < 0 ? `-${s}` : s);
    return body;
  };
  const withUnit = (n) => {
    const num = fmtNum(n);
    // Currency prefix attaches to the absolute part: "-$5" not "$-5".
    const body = prefix
      ? (n < 0 ? `-${prefix}${num.replace(/^-/, '')}` : `${prefix}${num}`)
      : num;
    if (!suffix) return body;
    const sep = needsSpace ? ' ' : '';
    return `${body}${sep}${suffix}`;
  };

  // Range separator: ".." avoids visual clash with negative-value
  // hyphens ("-20%..-5%" vs the ugly "-20%--5%"). Use it whenever any
  // bucket boundary could be negative (signed flag set, or any cut
  // point is negative).
  const anyNegative = cps.some(n => n < 0);
  const sep = (signed || anyNegative) ? '..' : '-';

  const labels = [];
  labels.push(`<${withUnit(cps[0])}`);
  for (let i = 1; i < cps.length; i++) {
    labels.push(`${withUnit(cps[i - 1])}${sep}${withUnit(cps[i])}`);
  }
  labels.push(`>${withUnit(cps[cps.length - 1])}`);
  return labels;
}

async function search({ node, parents }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const base  = (process.env.OPENAI_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.BAYES_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    tools: [{ type: 'web_search' }],
    // Force the web_search tool specifically. Prompt-only instructions
    // were ignored — model rationalized "skipped search, calibrating from
    // priors" on clearly-searchable real-world nodes. For toy nodes the
    // extra search returns nothing useful and the quality filter drops
    // any padding.
    tool_choice: { type: 'web_search' },
    instructions: SYSTEM_PROMPT,
    input: buildUserPrompt(node, parents),
    text: {
      format: {
        type: 'json_schema',
        name: 'bayes_enrich',
        schema: buildEnrichSchema(node, parents),
        strict: true
      }
    }
  };

  const res = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const textOut = extractText(data);
  const parsed = extractJSON(textOut);
  if (!parsed) throw new Error(`could not parse JSON from model output:\n${textOut.slice(0, 500)}`);
  return normalizeResult(parsed, node, parents);
}

// Build a strict JSON schema for the enrichment response. This is passed to
// the Responses API via `text.format`, which enforces shape at the API
// level — including the exact CPT length — so we no longer have to rely on
// the model to count rows correctly.
function buildEnrichSchema(node, parents) {
  const sourceItem = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title:        { type: 'string' },
      url:          { type: 'string' },
      excerpt:      { type: 'string' },
      highlight:    { type: 'string' },
      polarity:     { type: 'string', enum: ['positive', 'negative'] },
      weight:       { type: 'number', minimum: 0, maximum: 1 },
      affectsState: { type: 'string', enum: [...node.states] }
    },
    required: ['title', 'url', 'excerpt', 'highlight', 'polarity', 'weight', 'affectsState']
  };
  if (parents?.length) {
    const expectedLen = parents.reduce((a, p) => a * p.states.length, 1) * node.states.length;
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        type:      { type: 'string', enum: ['cpt'] },
        cpt:       {
          type: 'array',
          items: { type: 'number', minimum: 0, maximum: 1 },
          minItems: expectedLen,
          maxItems: expectedLen
        },
        sources:   { type: 'array', items: sourceItem },
        reasoning: { type: 'string' }
      },
      required: ['type', 'cpt', 'sources', 'reasoning']
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      type:      { type: 'string', enum: ['marginal'] },
      marginal:  {
        type: 'array',
        items: { type: 'number', minimum: 0, maximum: 1 },
        minItems: node.states.length,
        maxItems: node.states.length
      },
      sources:   { type: 'array', items: sourceItem },
      reasoning: { type: 'string' }
    },
    required: ['type', 'marginal', 'sources', 'reasoning']
  };
}

const SYSTEM_PROMPT = `You are a calibration expert for Bayesian networks. You receive a node
(name, description, states) plus zero or more parent nodes. Your job is to
produce a well-calibrated marginal (or full CPT) for that node and cite
real-world sources ONLY when they actually informed the number.

===== STEP 0: use the search results well =====

A web_search call is always made before you answer. Your job is to
decide what to do with the results.

If the node is a real-world, time-varying quantity (market prices,
inventories, rates, capex, counts of policy actions, benchmark indexes,
company events, etc.), the search results are the primary evidence —
they should shift your estimate and you should cite the specific facts
that moved it.

If the node is a structural/toy variable (textbook example, hypothetical
conditional, timeless base rate like a fair coin, or a name too vague
to pin down anything searchable), the search results will be irrelevant
padding. In that case: ignore the results, reason from priors /
modeling judgment, and return sources: [].

Anti-padding rules (always apply):
  * Only cite sources that provide a specific, dated, relevant fact
    that shifted your estimate.
  * Drop generic hub pages, index / calendar pages, top-level
    homepages, encyclopedia landing pages, and anything duplicated
    across hosts.
  * If every result was padding, return sources: [] — don't fill the
    array with pages you didn't actually use.

===== STEP 1: produce the distribution =====

Either way, always return a calibrated distribution:
  * no parents → "marginal": array of N numbers aligned with state order
  * with parents → "cpt": flat row-major array covering every parent
    combination (P1 most-significant), each row a distribution over the
    node's own states summing to 1. Values in [0, 1].

Be calibrated. If evidence is weak or you skipped search, produce
probabilities reflecting the base rate and your uncertainty — not
near 0 or 1. Never collapse a row to a one-hot vector unless the
relationship is genuinely deterministic (e.g., an OR gate).

===== STEP 2: cite sources (only if you used any) =====

For every source you actually relied on, record a citation with title,
canonical URL, a 1-2 sentence excerpt, a "polarity" of "positive" (raises
the affected state) or "negative" (lowers it), a weight 0-1 reflecting
source credibility and specificity, and which state it bears on.

Express sources positively when possible. If a source argues *against*
state A by making state B more likely, record it as polarity="positive"
with affectsState=B, not polarity="negative" with affectsState=A. Reserve
polarity="negative" for the rare case where a source rules out one state
without picking a specific alternative.

Every excerpt must include both:
  (a) 1-2 sentences of actual text quoted or paraphrased from the source, AND
  (b) the pivotal phrase INSIDE that excerpt wrapped in <mark>...</mark>
      XML tags (literal angle brackets, not Markdown asterisks). Keep the
      marked span tight — a few words, not a whole sentence.
Also set a separate "highlight" field equal to the exact wrapped phrase
(without tags).

Concrete example (note the literal tags, not Markdown):
  excerpt: "The CDC reports that <mark>seasonal flu activity fell sharply this month</mark>, with only 12% of sampled patients testing positive."
  highlight: "seasonal flu activity fell sharply this month"

If you cannot identify a pivotal phrase, omit the source rather than pad it.

===== output shape (enforced by schema, don't wrap in a code block) =====

  type:      "marginal" | "cpt"
  marginal | cpt:  array aligned with state/row order
  sources:   array of { title, url, excerpt, highlight, polarity, weight, affectsState }
             — may be empty [], and should be empty for abstract / toy /
             common-knowledge nodes
  reasoning: "1-3 sentence synthesis. Start by stating whether you used
             web_search and why (e.g. 'Skipped search: abstract toy
             variable, priors from common sense.' or 'Searched for recent
             activity near Kharg Island.')"`;

function buildUserPrompt(node, parents) {
  const lines = [];
  lines.push(`Node to calibrate`);
  lines.push(`  id:          ${node.id}`);
  lines.push(`  name:        ${node.name ?? node.id}`);
  if (node.description) lines.push(`  description: ${node.description}`);
  lines.push(`  states:      [${node.states.join(', ')}]`);

  if (parents?.length) {
    const rows = enumerateRows(parents);
    const expectedLen = rows.length * node.states.length;
    lines.push('');
    lines.push('Parents (independent variables that condition this node):');
    for (const p of parents) {
      lines.push(`- ${p.id} "${p.name ?? p.id}" — states [${p.states.join(', ')}]` +
        (p.description ? `\n    ${p.description}` : ''));
    }
    lines.push('');
    lines.push(`Return \`cpt\` as a flat row-major array of ${expectedLen} numbers`);
    lines.push(`(${rows.length} rows × ${node.states.length} cols). Row order`);
    lines.push(`(${parents.map(p => p.id).join(' most-significant → ')} least-significant):`);
    for (let r = 0; r < rows.length; r++) {
      lines.push(`  row ${r}: ${rows[r].map((s, i) => `${parents[i].id}=${s}`).join(', ')}`);
    }
    lines.push(`Each row is ${node.states.length} numbers in the order [${node.states.join(', ')}], summing to 1.`);
  } else {
    lines.push('');
    lines.push(`Return \`marginal\` as an array of ${node.states.length} numbers`);
    lines.push(`in the order [${node.states.join(', ')}], summing to 1.`);
  }
  lines.push('');
  lines.push('Follow the STEP 0 decision: skip web_search and return an empty');
  lines.push('sources array if this is an abstract / toy / common-knowledge node.');
  lines.push('Only cite sources that materially shifted your estimate.');
  return lines.join('\n');
}

function enumerateRows(parents) {
  const cards = parents.map(p => p.states.length);
  const total = cards.reduce((a, b) => a * b, 1);
  const rows = [];
  for (let r = 0; r < total; r++) {
    let x = r;
    const row = new Array(parents.length);
    for (let i = parents.length - 1; i >= 0; i--) {
      row[i] = parents[i].states[x % cards[i]];
      x = Math.floor(x / cards[i]);
    }
    rows.push(row);
  }
  return rows;
}

// The Responses API returns an `output` array of message / tool-call items.
// `output_text` is a convenience aggregation; prefer it when present.
function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text.length) return data.output_text;
  const bits = [];
  for (const item of data.output ?? []) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') bits.push(part.text);
      }
    }
  }
  return bits.join('\n');
}

function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
  // Last-ditch: find the first {...} block.
  const m = candidate.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* */ } }
  return null;
}

function normalizeResult(raw, node, parents) {
  const sources = normalizeSources(raw.sources, node);
  if (raw.type === 'cpt' || parents?.length) {
    const rowSize = node.states.length;
    const parentCards = parents.map(p => p.states.length);
    const rows = parentCards.reduce((a, b) => a * b, 1);
    const expected = rows * rowSize;
    // Auto-repair: the most common bad shape is a nested 2-D array
    // (`[[0.3, 0.7], [0.5, 0.5], ...]`). Deep-flatten and re-check.
    let flat = raw.cpt;
    if (Array.isArray(flat) && flat.length !== expected && flat.some(Array.isArray)) {
      flat = flat.flat(Infinity);
    }
    if (!Array.isArray(flat) || flat.length !== expected) {
      throw new Error(`model returned CPT of length ${flat?.length ?? 'n/a'}, expected ${expected}`);
    }
    const cpt = flat.map(v => clamp01(Number(v)));
    // Normalize rows defensively so we don't reject small model rounding errors.
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let k = 0; k < rowSize; k++) s += cpt[r * rowSize + k];
      if (s > 0) for (let k = 0; k < rowSize; k++) cpt[r * rowSize + k] /= s;
    }
    return { type: 'cpt', cpt, sources, reasoning: raw.reasoning ?? '' };
  }
  // marginal: prefer the array-aligned-with-states form (what the schema
  // enforces), but fall back to the legacy object-keyed-by-state form.
  const dist = {};
  const m = raw.marginal;
  if (Array.isArray(m)) {
    for (let i = 0; i < node.states.length; i++) {
      dist[node.states[i]] = clamp01(Number(m[i] ?? 0));
    }
  } else if (m && typeof m === 'object') {
    for (const s of node.states) dist[s] = clamp01(Number(m[s] ?? 0));
  } else {
    for (const s of node.states) dist[s] = 0;
  }
  let sum = 0;
  for (const s of node.states) sum += dist[s];
  if (sum > 0) for (const s of node.states) dist[s] /= sum;
  else {
    const u = 1 / node.states.length;
    for (const s of node.states) dist[s] = u;
  }
  return { type: 'marginal', marginal: dist, sources, reasoning: raw.reasoning ?? '' };
}

function normalizeSources(sources, node) {
  if (!Array.isArray(sources)) return [];
  const states = new Set(node.states);
  const mapped = sources.map(s => {
    const out = {
      title:        String(s.title ?? '').slice(0, 300),
      url:          String(s.url ?? ''),
      polarity:     s.polarity === 'negative' ? 'negative' : 'positive',
      weight:       clamp01(Number(s.weight ?? 0.5)),
    };
    if (states.has(s.affectsState)) out.affectsState = s.affectsState;

    let excerpt = s.excerpt ? String(s.excerpt).slice(0, 500) : undefined;
    let highlight = s.highlight ? String(s.highlight).slice(0, 200).trim() : undefined;

    const hasMarkTag = excerpt ? /<mark>[\s\S]+?<\/mark>/i.test(excerpt) : false;

    // If the model handed us Markdown bold (old habit) rather than the
    // requested <mark> tags, convert.
    if (excerpt && !hasMarkTag && /\*\*[^*]+?\*\*/.test(excerpt)) {
      excerpt = excerpt.replace(/\*\*([^*]+?)\*\*/g, '<mark>$1</mark>');
    }

    // Fallback A: no markers at all — if the excerpt is ellipsis-stitched
    // (the model often returns "A... B... C") then each chunk is already an
    // implicit highlight.  Pick the longest as the pivotal one.
    if (excerpt && !highlight && !/<mark>[\s\S]+?<\/mark>/i.test(excerpt)) {
      const fragments = excerpt
        .split(/\s*(?:\.{3,}|…)\s*/)
        .map(f => f.trim())
        .filter(f => f.length >= 10);
      if (fragments.length >= 2) {
        fragments.sort((a, b) => b.length - a.length);
        highlight = fragments[0].replace(/[.,;:!?]+$/, '').trim();
      }
    }

    // Fallback B: we have a highlight string but no <mark> tags — splice
    // them in around the first case-insensitive substring match.
    if (excerpt && highlight && !/<mark>[\s\S]+?<\/mark>/i.test(excerpt)) {
      const idx = excerpt.toLowerCase().indexOf(highlight.toLowerCase());
      if (idx >= 0) {
        excerpt = excerpt.slice(0, idx) + '<mark>' +
                  excerpt.slice(idx, idx + highlight.length) + '</mark>' +
                  excerpt.slice(idx + highlight.length);
      }
    }

    if (excerpt) out.excerpt = excerpt;
    if (highlight) out.highlight = highlight;
    return out;
  });

  // Quality filter: drop obvious padding. The prompt already discourages
  // this, but the model is trained to lean on tools so we enforce defense
  // in depth server-side.
  const seenUrls = new Set();
  const seenHostTitle = new Set();
  const hostCounts = new Map();
  const out = [];
  for (const s of mapped) {
    if (!s.url.startsWith('http')) continue;
    // Exact URL dedup
    if (seenUrls.has(s.url)) continue;
    let host = '', pathDepth = 0;
    try {
      const u = new URL(s.url);
      host = u.hostname.replace(/^www\./, '');
      pathDepth = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
    } catch { continue; }
    // (host, title) dedup — kills the "3x Weather for United States" case
    const ht = host + '||' + s.title.toLowerCase().trim();
    if (seenHostTitle.has(ht)) continue;
    // Throttle same-hostname repetition (>2 per response is usually padding)
    const hc = hostCounts.get(host) ?? 0;
    if (hc >= 2) continue;
    // Drop very-shallow "homepage" / hub URLs — anything with < 2 path
    // segments is almost always a section index, not evidence.
    if (pathDepth < 2 && !/\.(html?|pdf)$/i.test(s.url)) continue;
    // Drop generic "overview" / "guide" titles unless the URL has depth
    // suggesting a specific article.
    if (/(\b(overview|guide|introduction|about|home|index)\b|— an overview|- an overview)/i.test(s.title) && pathDepth < 3) continue;

    seenUrls.add(s.url);
    seenHostTitle.add(ht);
    hostCounts.set(host, hc + 1);
    out.push(s);
  }
  return out;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
