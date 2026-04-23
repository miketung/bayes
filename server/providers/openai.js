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
    available: () => !!process.env.OPENAI_API_KEY,
    model:     () => process.env.BAYES_MODEL || DEFAULT_MODEL,
    search,
  };
}

async function search({ node, parents }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const base  = (process.env.OPENAI_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const model = process.env.BAYES_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    instructions: SYSTEM_PROMPT,
    input: buildUserPrompt(node, parents)
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

const SYSTEM_PROMPT = `You are a calibration expert for Bayesian networks. You receive a node from a
network (its name, description, and discrete states) plus zero or more parent
nodes. Your job:

1. Use the web_search tool 1-4 times to gather recent, relevant evidence about
   the node's likely value(s). For nodes with parents, also search for how the
   parent values change the likelihood of each own state.
2. For every meaningful source you actually relied on, record a citation with
   the headline, canonical URL, an excerpt, a "polarity" of "positive"
   (raises the probability of the affected state) or "negative" (lowers it),
   a weight between 0 and 1 reflecting source credibility and specificity,
   and which state it primarily bears on.

   IMPORTANT: express every source positively when possible. If a source
   argues *against* state A by making state B more likely, record it as
   polarity="positive" with affectsState=B, not polarity="negative" with
   affectsState=A. Reserve polarity="negative" for the rare case where a
   source clearly rules out one state without picking any specific
   alternative among the remaining states.

   EVERY excerpt must include both:
     (a) 1-2 sentences of actual text quoted or paraphrased from the source
         that gave you the signal, AND
     (b) the pivotal phrase INSIDE that excerpt wrapped in <mark>...</mark>
         XML tags (NOT Markdown, NOT asterisks — literal angle-bracket tags).
         Keep the marked span tight — a few words, not a whole sentence.
   Also set a separate "highlight" field equal to the exact phrase you
   wrapped (without the tags).

   Concrete example (note the literal tags, not Markdown):
     excerpt: "The CDC reports that <mark>seasonal flu activity fell sharply this month</mark>, with only 12% of sampled patients testing positive."
     highlight: "seasonal flu activity fell sharply this month"

   Do NOT return the original raw snippet verbatim with no <mark> tag — that
   is a formatting failure. If you cannot identify a pivotal phrase, omit
   the source entirely.
3. Synthesize your findings into either a marginal distribution (for nodes
   with no parents) or a full conditional probability table (rows = all
   combinations of parent states, P1 as the most-significant digit in row
   ordering; each row is a distribution over the node's own states and must
   sum to 1). Values must be in [0, 1].

Return ONLY a JSON object inside a \`\`\`json ... \`\`\` code block, no prose
around it.

Schema for no-parent (root) nodes:
{
  "type": "marginal",
  "marginal": { "<state name>": <prob>, ... },
  "sources": [
    { "title": "...", "url": "https://...",
      "excerpt": "... with the <mark>key phrase</mark> marked ...",
      "highlight": "key phrase",
      "polarity": "positive" | "negative", "weight": 0.0-1.0,
      "affectsState": "<state name>" }
  ],
  "reasoning": "1-3 sentence synthesis"
}

Schema for nodes with parents: same except "type" is "cpt" and you include
"parents" + "cpt" (flat row-major) instead of "marginal".

Be calibrated: if evidence is weak or inconclusive, produce probabilities near
the prior rather than near 0 or 1. Avoid collapsing rows to certainty unless
the evidence is overwhelming.`;

function buildUserPrompt(node, parents) {
  const lines = [];
  lines.push(`Node to calibrate`);
  lines.push(`  id:          ${node.id}`);
  lines.push(`  name:        ${node.name ?? node.id}`);
  if (node.description) lines.push(`  description: ${node.description}`);
  lines.push(`  states:      [${node.states.join(', ')}]`);

  if (parents?.length) {
    lines.push('');
    lines.push('Parents (independent variables that condition this node):');
    for (const p of parents) {
      lines.push(`- ${p.id} "${p.name ?? p.id}" — states [${p.states.join(', ')}]` +
        (p.description ? `\n    ${p.description}` : ''));
    }
    // Explicit row ordering for the CPT to remove any ambiguity.
    lines.push('');
    lines.push('Your CPT must be a flat row-major array in this row order');
    lines.push(`(${parents.map(p => p.id).join(' as most-significant → ')} least-significant):`);
    const rows = enumerateRows(parents);
    for (let r = 0; r < rows.length; r++) {
      lines.push(`  row ${r}: ${rows[r].map((s, i) => `${parents[i].id}=${s}`).join(', ')}`);
    }
    lines.push(`Each row has ${node.states.length} numbers (one per state of ${node.id}), summing to 1.`);
  } else {
    lines.push('');
    lines.push('No parents. Produce a marginal distribution over the states above.');
  }
  lines.push('');
  lines.push('Search the web for current evidence. Cite every source you use.');
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
    if (!Array.isArray(raw.cpt) || raw.cpt.length !== expected) {
      throw new Error(`model returned CPT of length ${raw.cpt?.length ?? 'n/a'}, expected ${expected}`);
    }
    const cpt = raw.cpt.map(v => clamp01(Number(v)));
    // Normalize rows defensively so we don't reject small model rounding errors.
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let k = 0; k < rowSize; k++) s += cpt[r * rowSize + k];
      if (s > 0) for (let k = 0; k < rowSize; k++) cpt[r * rowSize + k] /= s;
    }
    return { type: 'cpt', cpt, sources, reasoning: raw.reasoning ?? '' };
  }
  // marginal
  const dist = {};
  for (const s of node.states) dist[s] = clamp01(Number(raw.marginal?.[s] ?? 0));
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
  return sources.map(s => {
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
  }).filter(s => s.url.startsWith('http'));
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
