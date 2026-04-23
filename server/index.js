#!/usr/bin/env node
// Minimal HTTP server for AI enrichment. Zero npm deps beyond what the rest
// of the project already uses. Runs alongside Vite; Vite proxies /api/* here.
//
// Env:
//   OPENAI_API_KEY   required for AI features
//   BAYES_MODEL      optional, defaults to gpt-4.1-mini
//   BAYES_PROVIDER   optional, currently only "openai"
//   BAYES_PORT       optional, defaults to 3001
//
// The static web app still works when this server is down — it just hides
// the AI controls. /api/status is the probe.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { enrich, enrichAvailable, providerInfo, suggestStates } from './enrich.js';

loadEnvFile('.env.local');
loadEnvFile('.env');

const PORT = Number(process.env.BAYES_PORT) || 3001;

const server = createServer(async (req, res) => {
  // Permissive CORS for local dev (Vite dev server is on a different port).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      return json(res, 200, { ai: enrichAvailable(), provider: providerInfo() });
    }
    if (req.method === 'POST' && req.url === '/api/enrich') {
      if (!enrichAvailable()) {
        return json(res, 503, { error: 'AI disabled — set OPENAI_API_KEY in .env' });
      }
      const body = await readJSON(req);
      const result = await enrich(body);
      return json(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/suggest-states') {
      if (!enrichAvailable()) {
        return json(res, 503, { error: 'AI disabled — set OPENAI_API_KEY in .env' });
      }
      const body = await readJSON(req);
      const result = await suggestStates(body);
      return json(res, 200, result);
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[bayes api]', e);
    return json(res, 500, { error: e?.message ?? 'internal error' });
  }
});

server.listen(PORT, () => {
  const info = providerInfo();
  console.log(`[bayes api] listening on http://localhost:${PORT}  ai=${info.available} provider=${info.id ?? 'none'} model=${info.model ?? '-'}`);
  if (!info.available) {
    console.log(`[bayes api] tip: set OPENAI_API_KEY in .env to enable the AI features.`);
  }
});

// -- helpers -----------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// Tiny dotenv: KEY=VALUE per line; doesn't overwrite existing process.env.
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] != null) continue;
    let value = rawValue;
    // Strip matching surrounding single or double quotes.
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
