'use strict';
/** Zero-dependency robots.txt parser, used when the "robots-parser" package is not installed.
 *  Same surface as robots-parser: robotsMini(url, text) -> { isAllowed(url, ua), getCrawlDelay(ua) } */
function robotsMini(url, text) {
  const groups = [];
  let cur = null, lastWasUA = false;
  String(text).split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) return;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasUA) { cur = { agents: [], rules: [], delay: 0 }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasUA = true;
      return;
    }
    lastWasUA = false;
    if (!cur) return;
    if (k === 'disallow' || k === 'allow') cur.rules.push({ allow: k === 'allow', path: v });
    else if (k === 'crawl-delay') cur.delay = parseFloat(v) || 0;
  });

  function pick(ua) {
    ua = String(ua || '').toLowerCase();
    let best = null, star = null;
    groups.forEach((g) => g.agents.forEach((a) => {
      if (a === '*') star = g;
      else if (ua.includes(a) && (!best || a.length > best.len)) best = { g, len: a.length };
    }));
    return best ? best.g : star;
  }
  function toRe(p) {
    const end = p.endsWith('$');
    if (end) p = p.slice(0, -1);
    const body = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + body + (end ? '$' : ''));
  }
  return {
    isAllowed(u) {
      const g = pick(arguments[1]);
      if (!g) return true;
      const x = new URL(u), path = x.pathname + x.search;
      let bestLen = -1, allow = true;
      g.rules.forEach((r) => {
        if (r.path && toRe(r.path).test(path) && r.path.length > bestLen) { bestLen = r.path.length; allow = r.allow; }
      });
      return allow;
    },
    getCrawlDelay(ua) { const g = pick(ua); return g ? g.delay : 0; }
  };
}
module.exports = robotsMini;
