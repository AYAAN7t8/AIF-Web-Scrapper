'use strict';
/**
 * proxy-server.js — serves the Sieve site AND the scraping proxy on one origin.
 * Zero dependencies (Node 18+). Run:  node proxy-server.js   →  http://127.0.0.1:8787
 *
 * GET /api/health
 * GET /api/fetch?url=<url>[&render=1][&scroll=1&maxScrolls=30][&wait=15000][&raw=1]
 *      → { ok, finalUrl, status, rendered, html }      (JSON)
 *      → raw bytes with the origin's content-type       (when raw=1, images etc.)
 *
 * Because the page and the proxy share an origin, the app finds the proxy by itself:
 * no CORS problems and no setting to switch on.
 *
 * Safety rails:
 *  - robots.txt is honoured (cached 1 h). IGNORE_ROBOTS=1 turns it off — only with permission.
 *  - 1 request / second / domain
 *  - binds to 127.0.0.1; /api CORS limited to localhost, file:// and ALLOWED_ORIGINS
 *  - refuses private / loopback / link-local targets (SSRF guard), re-checked on redirects
 *  - 8 MB HTML cap, 15 MB binary cap
 *
 * Env: PORT, HOST, USER_AGENT, ALLOWED_ORIGINS (comma list), IGNORE_ROBOTS=1
 * Puppeteer is optional: without it /api/fetch works for static HTML only.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { createRobotsChecker } = require('./robots-check');

const PORT = parseInt(process.env.PORT, 10) || 8787;
// On a host such as Render the platform sets PORT and needs us to listen on every interface.
const HOST = process.env.HOST || (process.env.PORT || process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const RATE_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN, 10) || 120;   // /api/fetch requests per client IP per minute
const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (compatible; SieveBot/1.0; personal data-extraction tool) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_HTML = 8 * 1024 * 1024;
const MAX_BIN = 15 * 1024 * 1024;

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch (e) { /* optional */ }

const robots = createRobotsChecker({ userAgent: 'SieveBot' });

/* ---------------------------------------------------------------- helpers */
const ipHits = new Map();
function rateLimited(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), arr = (ipHits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  ipHits.set(ip, arr);
  if (ipHits.size > 5000) for (const [k, v] of ipHits) if (!v.length || now - v[v.length - 1] > 60000) ipHits.delete(k);
  return arr.length > RATE_PER_MIN;
}
function originAllowed(origin, req) {
  if (!origin || origin === 'null') return true;                       // file:// pages send "null"
  if (ALLOWED.includes(origin)) return true;
  try { if (req && new URL(origin).host === req.headers.host) return true; } catch (e) { /* ignore */ }   // the site itself
  try { const h = new URL(origin).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch (e) { return false; }
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function httpError(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/* ------------------------------------------------------------ SSRF guard */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  return true;
}
const hostOk = new Map();
async function assertPublic(urlStr) {
  const u = new URL(urlStr);
  if (!/^https?:$/.test(u.protocol)) throw httpError(400, 'invalid-url', 'Only http(s) URLs are supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const cached = hostOk.get(host);
  if (cached && Date.now() - cached < 60000) return u;
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw httpError(502, 'dns', 'Could not resolve ' + host); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw httpError(403, 'private', 'Refusing to fetch a private or local address.');
  hostOk.set(host, Date.now());
  return u;
}

/* ----------------------------------------------------------- rate limit */
const nextSlot = new Map();
async function throttle(host) {
  const now = Date.now(), slot = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, slot + 1000);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

/* ------------------------------------------------------------- fetching */
async function readLimited(res, max) {
  const len = parseInt(res.headers.get('content-length'), 10);
  if (len && len > max) throw httpError(413, 'too-large', 'Response is too large.');
  const reader = res.body.getReader(), chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { reader.cancel(); throw httpError(413, 'too-large', 'Response is too large.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function plainFetch(urlStr, waitMs, raw) {
  let current = urlStr;
  for (let hop = 0; hop < 6; hop++) {
    const u = await assertPublic(current);
    await throttle(u.hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), waitMs);
    let res;
    try {
      res = await fetch(u.href, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: raw ? '*/*' : 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }
      });
    } catch (e) {
      throw httpError(504, 'timeout', e.name === 'AbortError' ? 'The site did not answer in time.' : 'Could not reach the site: ' + (e.cause && e.cause.code ? e.cause.code : e.message));
    } finally { clearTimeout(t); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), u).href; continue; }
    return { res, finalUrl: u.href };
  }
  throw httpError(508, 'redirects', 'Too many redirects.');
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) browserPromise = puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => { browserPromise = null; throw e; });
  return browserPromise;
}

async function renderPage(urlStr, { scroll, maxScrolls, waitMs }) {
  const u = await assertPublic(urlStr);
  await throttle(u.hostname);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      try {
        if (['media', 'font'].includes(req.resourceType())) return req.abort();
        await assertPublic(req.url());
        req.continue();
      } catch (e) { req.abort(); }
    });
    const resp = await page.goto(u.href, { waitUntil: 'networkidle2', timeout: waitMs });
    if (scroll) {
      let last = 0, stable = 0;
      for (let i = 0; i < maxScrolls && stable < 2; i++) {
        const h = await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return document.body.scrollHeight; });
        await new Promise((r) => setTimeout(r, 900));
        stable = h === last ? stable + 1 : 0;
        last = h;
      }
    }
    const html = await page.content();
    return { html: html.slice(0, MAX_HTML), finalUrl: page.url(), status: resp ? resp.status() : 200 };
  } finally { await page.close().catch(() => {}); }
}

/* --------------------------------------------------------------- routes */
async function handleFetch(q, res) {
  try {
    const target = String(q.get('url') || '');
    let u;
    try { u = new URL(target); } catch (e) { throw httpError(400, 'invalid-url', 'Missing or invalid ?url='); }
    await assertPublic(u.href);
    if (process.env.IGNORE_ROBOTS !== '1' && !(await robots.isAllowed(u.href))) {
      throw httpError(403, 'robots', u.hostname + ' disallows this path for crawlers in its robots.txt. (Start the server with IGNORE_ROBOTS=1 only if you have permission.)');
    }
    const waitMs = Math.min(Math.max(parseInt(q.get('wait'), 10) || 15000, 2000), 90000);
    const raw = q.get('raw') === '1';
    const wantRender = q.get('render') === '1' || q.get('scroll') === '1';

    if (raw) {
      const { res: up } = await plainFetch(u.href, waitMs, true);
      if (!up.ok) throw httpError(up.status, 'http', 'Upstream answered ' + up.status);
      const buf = await readLimited(up, MAX_BIN);
      res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return res.end(buf);
    }
    if (wantRender) {
      if (!puppeteer) throw httpError(501, 'no-puppeteer', 'Rendering needs Puppeteer: run "npm install puppeteer" next to proxy-server.js.');
      const r = await renderPage(u.href, { scroll: q.get('scroll') === '1', maxScrolls: Math.min(parseInt(q.get('maxScrolls'), 10) || 30, 100), waitMs });
      return sendJson(res, 200, Object.assign({ ok: true, rendered: true }, r));
    }
    const { res: up, finalUrl } = await plainFetch(u.href, waitMs, false);
    if (!up.ok) {
      const blocked = up.status === 401 || up.status === 403 ? ' (the site is blocking automated requests or needs a login)' : '';
      throw httpError(up.status, 'http', 'The site answered ' + up.status + ' ' + (up.statusText || '') + blocked);
    }
    const ct = up.headers.get('content-type') || '';
    if (ct && !/html|xml|text\//i.test(ct)) throw httpError(415, 'type', 'That URL returns ' + ct.split(';')[0] + ', not HTML.');
    const html = (await readLimited(up, MAX_HTML)).toString('utf8');
    sendJson(res, 200, { ok: true, rendered: false, html, finalUrl, status: up.status });
  } catch (e) {
    sendJson(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { ok: false, code: e.code || 'error', error: e.message || 'Proxy error' });
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};
const ROOT = __dirname;
const STATIC_BLOCK = /^\/(node_modules|\.|proxy-server|robots-|serve\.js|render\.yaml|package)/;

function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || STATIC_BLOCK.test(p)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin, req)) return sendJson(res, 403, { ok: false, code: 'origin', error: 'Origin not allowed. Set ALLOWED_ORIGINS.' });
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, puppeteer: !!puppeteer, userAgent: USER_AGENT });
    if (url.pathname === '/api/fetch') {
      if (rateLimited(req)) return sendJson(res, 429, { ok: false, code: 'http', error: 'Too many requests from your address. Slow down and retry in a minute.' });
      return handleFetch(url.searchParams, res);
    }
    return sendJson(res, 404, { ok: false, error: 'Not found. Try /api/health or /api/fetch?url=' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url.pathname);
});

function start(port) {
  const p = port || PORT;
  server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + p + ' is already in use. Try: node serve.js ' + (p + 1) : e.message); process.exit(1); });
  server.listen(p, HOST, () => {
    console.log('Sieve is running: http://' + HOST + ':' + p + '   (site + scraping proxy, same origin)');
    console.log(puppeteer ? 'Puppeteer found: rendering + infinite scroll enabled.' : 'Puppeteer not installed: static HTML only (npm install puppeteer to enable rendering).');
  });
  process.on('SIGINT', async () => { if (browserPromise) (await browserPromise).close().catch(() => {}); process.exit(0); });
}

if (require.main === module) start();

module.exports = { server, start, isPrivateIp };
