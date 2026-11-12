'use strict';
/**
 * robots-check.js — robots.txt helper used by proxy-server.js.
 *
 *   const { createRobotsChecker } = require('./robots-check');
 *   const robots = createRobotsChecker({ userAgent: 'SieveBot' });
 *   await robots.isAllowed('https://example.com/page');   // true | false
 *
 * CLI:  node robots-check.js https://example.com/some/page
 *
 * Policy: if robots.txt cannot be fetched (404, network error, timeout) the URL
 * is treated as allowed, as per RFC 9309 for 4xx; for 5xx / network errors we
 * also allow but you can pass { failClosed: true } to be stricter.
 */
let robotsParser;
try { robotsParser = require("robots-parser"); } catch (e) { robotsParser = require("./robots-mini"); }

function createRobotsChecker(opts) {
  opts = opts || {};
  const userAgent = opts.userAgent || 'SieveBot';
  const ttl = opts.ttlMs || 60 * 60 * 1000;
  const failClosed = !!opts.failClosed;
  const fetchFn = opts.fetch || fetch;
  const cache = new Map(); // origin -> { robots, at }

  async function load(origin) {
    const hit = cache.get(origin);
    if (hit && Date.now() - hit.at < ttl) return hit.robots;
    let robots = null, unreachable = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetchFn(origin + '/robots.txt', {
        signal: ctrl.signal,
        headers: { 'User-Agent': userAgent },
        redirect: 'follow'
      });
      clearTimeout(t);
      if (res.ok) robots = robotsParser(origin + '/robots.txt', (await res.text()).slice(0, 512 * 1024));
      else if (res.status >= 500) unreachable = true;
    } catch (e) { unreachable = true; }
    const entry = { robots: robots || (unreachable && failClosed ? 'deny' : null), at: Date.now() };
    cache.set(origin, entry);
    return entry.robots;
  }

  return {
    async isAllowed(url) {
      let u;
      try { u = new URL(url); } catch (e) { return false; }
      const r = await load(u.origin);
      if (r === 'deny') return false;
      if (!r) return true;
      return r.isAllowed(u.href, userAgent) !== false;
    },
    async crawlDelay(url) {
      const u = new URL(url);
      const r = await load(u.origin);
      return r && r !== 'deny' ? r.getCrawlDelay(userAgent) || 0 : 0;
    },
    clear() { cache.clear(); }
  };
}

module.exports = { createRobotsChecker };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) { console.error('Usage: node robots-check.js <url>'); process.exit(2); }
  createRobotsChecker().isAllowed(target).then((ok) => {
    console.log(ok ? 'ALLOWED' : 'DISALLOWED', '-', target);
    process.exit(ok ? 0 : 1);
  });
}
