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
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { enrich, enrichAvailable, providerInfo, suggestStates } from './enrich.js';

const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map':  'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.txt':  'text/plain; charset=utf-8'
};

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
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.url.startsWith('/api/')) {
      if (await serveStatic(req, res)) return;
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

async function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0].split('#')[0];
  try { urlPath = decodeURIComponent(urlPath); } catch { return false; }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const rel = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(DIST_DIR, rel);
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) return false;

  let s;
  try { s = await stat(filePath); } catch { return false; }
  if (s.isDirectory()) {
    const idx = join(filePath, 'index.html');
    try {
      const si = await stat(idx);
      if (!si.isFile()) return false;
      return streamFile(res, idx, si.size);
    } catch { return false; }
  }
  if (!s.isFile()) return false;
  return streamFile(res, filePath, s.size);
}

function streamFile(res, filePath, size) {
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': size });
  createReadStream(filePath).pipe(res);
  return true;
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
