/* ==========================================================================
   Sieve — scraper.js
   • fetching (direct CORS fetch → optional local proxy → demo:// → pasted HTML)
   • AUTO TABLE DETECTION  (heuristic table scoring + repeated-sibling fallback)
   • PAGINATION detection and the crawl loop
   • Dataset model shared by every mode (columns, rename, filter, dedupe)
   • Bulk multi-URL runner

   Detection pseudo-code (see README "How the auto-detect heuristic works"):
     1. score every <table>:  rows × avgCols × (sticky/thead header ? 1.2 : 1)
     2. best table with score > TABLE_THRESHOLD wins
     3. otherwise group siblings by  tagName + className signature, pick the
        group with most members × most leaf text nodes; every sibling is a row,
        every leaf text/link/image inside it is a column
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve = global.Sieve || {};
  var util = Sieve.util;
  var X = function () { return Sieve.extractors; };

  var TABLE_THRESHOLD = 10;   // rows × avgCols must exceed this for a <table> to win outright
  var MIN_ROWS = 3;

  /* ------------------------------------------------------------------ errors */
  function ScrapeError(code, message, extra) {
    var e = new Error(message);
    e.name = 'ScrapeError';
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  /* --------------------------------------------------------------- proxy conf */
  var autoProxy = null; // { url } when a Sieve server answers on this origin (or on the default port)
  var proxy = {
    get: function () {
      var s = Sieve.store.get('proxy', null) || {};
      if (s.enabled == null && autoProxy) return { enabled: true, url: autoProxy.url, auto: true };
      return { enabled: !!s.enabled, url: (s.url || Sieve.config.defaultProxy).replace(/\/+$/, '') };
    },
    /** Resolves once the same-origin / default-port proxy probe has finished. */
    ready: (function () {
      var cands = [];
      if (/^https?:$/.test(location.protocol)) cands.push(location.origin);
      cands.push(Sieve.config.defaultProxy);
      function probe(i) {
        if (i >= cands.length) return Promise.resolve();
        var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, 1500);
        return fetch(cands[i] + '/api/health', { cache: 'no-store', signal: ctrl.signal })
          .then(function (r) { return r.json(); })
          .then(function (j) { clearTimeout(t); if (j && j.ok) autoProxy = { url: cands[i].replace(/\/+$/, '') }; else return probe(i + 1); })
          .catch(function () { clearTimeout(t); return probe(i + 1); });
      }
      return probe(0);
    })(),
    set: function (patch) {
      var cur = proxy.get();
      Sieve.store.set('proxy', { enabled: patch.enabled != null ? !!patch.enabled : cur.enabled, url: (patch.url || cur.url).replace(/\/+$/, '') });
    },
    test: function () {
      var p = proxy.get();
      return fetch(p.url + '/api/health', { cache: 'no-store' }).then(function (r) { return r.json(); });
    }
  };

  /* ----------------------------------------------------------------- fetching */
  function linkedAbort(outer, ms) {
    var ctrl = new AbortController(), timedOut = false, t = null;
    if (ms > 0) t = setTimeout(function () { timedOut = true; ctrl.abort(); }, ms);
    function onAbort() { ctrl.abort(); }
    if (outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener('abort', onAbort, { once: true }); }
    return {
      signal: ctrl.signal,
      timedOut: function () { return timedOut; },
      done: function () { clearTimeout(t); if (outer) outer.removeEventListener('abort', onAbort); }
    };
  }

  function mapFetchError(err, link, ms, url) {
    if (err && err.name === 'ScrapeError') return err;
    if (err && err.name === 'AbortError') {
      return link.timedOut() ? ScrapeError('timeout', 'No response after ' + Math.round(ms / 1000) + ' s (Max wait). Raise "Max wait" or try the proxy.')
                             : ScrapeError('aborted', 'Cancelled');
    }
    return ScrapeError('cors', 'The browser could not read ' + (util.host(url) || 'that site') +
      '. It most likely blocks cross-origin requests (CORS) or is unreachable.');
  }

  function directFetch(url, o) {
    var ms = o.timeout || 15000, link = linkedAbort(o.signal, ms), t0 = performance.now();
    return fetch(url, { signal: link.signal, credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' })
      .then(function (resp) {
        if (!resp.ok) throw ScrapeError('http', 'The server answered ' + resp.status + (resp.statusText ? ' ' + resp.statusText : '') + '.', { status: resp.status });
        var ct = resp.headers.get('content-type') || '';
        if (ct && !/html|xml|text\/plain/i.test(ct)) throw ScrapeError('type', 'That URL returns ' + ct.split(';')[0] + ', not an HTML page.');
        return resp.text().then(function (html) {
          return { html: html, finalUrl: resp.url || url, via: 'direct', status: resp.status, ms: Math.round(performance.now() - t0) };
        });
      })
      .catch(function (e) { throw mapFetchError(e, link, ms, url); })
      .then(function (r) { link.done(); return r; }, function (e) { link.done(); throw e; });
  }

  function proxyFetch(url, o) {
    var p = proxy.get(), ms = (o.timeout || 15000) + (o.scroll ? 60000 : 20000), link = linkedAbort(o.signal, ms), t0 = performance.now();
    var q = new URLSearchParams({ url: url });
    if (o.render || o.scroll) q.set('render', '1');
    if (o.scroll) { q.set('scroll', '1'); q.set('maxScrolls', String(o.maxScrolls || 30)); }
    if (o.timeout) q.set('wait', String(o.timeout));
    return fetch(p.url + '/api/fetch?' + q.toString(), { signal: link.signal })
      .catch(function (e) {
        if (e && e.name === 'AbortError') throw mapFetchError(e, link, ms, url);
        throw ScrapeError('proxy', 'The proxy is not reachable at ' + p.url + '. Start it with "node proxy-server.js" (see README).');
      })
      .then(function (resp) {
        return resp.json().catch(function () { return {}; }).then(function (j) {
          if (!resp.ok || j.ok === false) {
            throw ScrapeError(j.code || (resp.status === 403 ? 'robots' : 'http'), j.error || ('Proxy error ' + resp.status), { status: resp.status });
          }
          return { html: j.html, finalUrl: j.finalUrl || url, via: j.rendered ? 'proxy (rendered)' : 'proxy', status: j.status || 200, ms: Math.round(performance.now() - t0), rendered: !!j.rendered };
        });
      })
      .then(function (r) { link.done(); return r; }, function (e) { link.done(); throw e; });
  }

  /**
   * Fetch a page as HTML text.
   * o: { signal, timeout, render, scroll, maxScrolls, proxy:{enabled,url}, html (pre-supplied) }
   */
  function fetchHtml(url, o) {
    o = o || {};
    if (o.html != null) {
      return Promise.resolve({ html: o.html, finalUrl: url, via: 'pasted HTML', status: 200, ms: 0 });
    }
    if (Sieve.demo && Sieve.demo.isDemo(url)) {
      return Sieve.demo.buildHtml(url).then(function (html) {
        return util.sleep(140, o.signal).then(function () { return { html: html, finalUrl: url, via: 'demo', status: 200, ms: 140 }; });
      });
    }
    var nu = util.normalizeUrl(url);
    if (!nu) return Promise.reject(ScrapeError('invalid-url', 'That does not look like a valid http(s) URL.'));
    return proxy.ready.then(function () {
      var px = proxy.get(); // read after detection finished; callers may hold a stale copy
      // With a proxy available, go through it first: it avoids CORS and most "blocked" cases.
      if (px.enabled) {
        return proxyFetch(nu, o).catch(function (err) {
          if (err.code === 'proxy' && !o.render && !o.scroll) return directFetch(nu, o); // proxy down → try direct
          throw err;
        });
      }
      return directFetch(nu, o);
    });
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function effectiveBase(doc, finalUrl) {
    var b = doc.querySelector('base[href]');
    if (b) { try { return new URL(b.getAttribute('href'), finalUrl).href; } catch (e) { /* ignore */ } }
    return finalUrl;
  }

  /* ----------------------------------------------------------------- helpers */
  var clean = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };
  function abs(href, base) { return X().util.abs(href, base); }

  function cellText(cell) {
    return clean(Array.prototype.map.call(cell.childNodes, function (n) {
      return n.nodeName === 'BR' ? ' ' : n.textContent;
    }).join(''));
  }

  function normKey(s) {
    var k = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return k || 'col';
  }

  function uniqueNames(names) {
    var seen = Object.create(null);
    return names.map(function (n) {
      var base = n || 'Column', c = ++seen[base.toLowerCase()] || (seen[base.toLowerCase()] = 1);
      return c > 1 ? base + ' ' + c : base;
    });
  }

  function makeColumns(names) {
    var used = Object.create(null);
    return names.map(function (n) {
      var k = normKey(n), i = 2, orig = k;
      while (used[k]) k = orig + '_' + (i++);
      used[k] = 1;
      return { key: k, name: n };
    });
  }

  function tagLabel(el) {
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return '<' + el.tagName.toLowerCase() + (cls ? '.' + cls : '') + '>';
  }

  /* ------------------------------------------------------- 1. TABLE candidates */
  function tableCandidates(doc, base) {
    var out = [];
    doc.querySelectorAll('table').forEach(function (t) {
      if (t.querySelector('table')) return;                       // outer layout table
      var rows = Array.prototype.filter.call(t.rows, function (r) { return r.cells.length > 0; });
      if (rows.length < 2) return;
      var total = 0;
      rows.forEach(function (r) {
        Array.prototype.forEach.call(r.cells, function (c) { total += Math.min(parseInt(c.getAttribute('colspan'), 10) || 1, 30); });
      });
      var avgCols = total / rows.length;
      if (avgCols < 2) return;
      var first = rows[0];
      var sticky = !!t.tHead || (first.cells.length > 0 && Array.prototype.every.call(first.cells, function (c) { return c.tagName === 'TH'; })) ||
        /sticky/i.test((t.getAttribute('style') || '') + ' ' + (t.getAttribute('class') || ''));
      var score = rows.length * avgCols * (sticky ? 1.2 : 1);
      var cand = {
        kind: 'table', el: t, score: score, rowCount: rows.length, avgCols: avgCols, sticky: sticky,
        label: 'Table · ' + (rows.length - (sticky ? 1 : 0)) + ' rows × ' + Math.round(avgCols) + ' cols',
        signature: null, _data: null
      };
      cand.extract = function () { return cand._data || (cand._data = extractTable(t, base)); };
      cand.signature = 'T|' + tableHeaderSig(t) + '|' + Math.round(avgCols);
      out.push(cand);
    });
    return out;
  }

  function tableHeaderSig(t) {
    var h = (t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : null) ||
      (t.rows[0] && Array.prototype.every.call(t.rows[0].cells, function (c) { return c.tagName === 'TH'; }) ? t.rows[0] : null);
    return h ? Array.prototype.map.call(h.cells, function (c) { return normKey(cellText(c)); }).join(',') : 'noheader';
  }

  function expandRow(tr, base) {
    var cells = [];
    Array.prototype.forEach.call(tr.cells, function (c) {
      var span = Math.min(parseInt(c.getAttribute('colspan'), 10) || 1, 30);
      var a = c.querySelector('a[href]'), img = c.querySelector('img');
      var txt = cellText(c);
      var d = { text: txt, href: a ? abs(a.getAttribute('href'), base) : '', img: img ? abs(img.getAttribute('src') || img.getAttribute('data-src'), base) : '' };
      if (!txt && img) d.text = clean(img.getAttribute('alt') || '');
      cells.push(d);
      for (var i = 1; i < span; i++) cells.push({ text: '', href: '', img: '' });
    });
    return cells;
  }

  function extractTable(t, base) {
    var allRows = Array.prototype.filter.call(t.rows, function (r) { return r.cells.length > 0; });
    var headerRow = null, dataRows;
    if (t.tHead && t.tHead.rows.length) {
      headerRow = t.tHead.rows[t.tHead.rows.length - 1];
      var headSet = Array.prototype.slice.call(t.tHead.rows);
      dataRows = allRows.filter(function (r) { return headSet.indexOf(r) === -1 && !(t.tFoot && r.parentNode === t.tFoot); });
    } else {
      var first = allRows[0];
      var allTh = Array.prototype.every.call(first.cells, function (c) { return c.tagName === 'TH'; });
      var boldHead = !allTh && Array.prototype.every.call(first.cells, function (c) { return c.querySelector('b,strong') && cellText(c); }) &&
        !allRows.slice(1, 4).some(function (r) { return Array.prototype.some.call(r.cells, function (c) { return c.querySelector('b,strong'); }); });
      if (allTh || boldHead) { headerRow = first; dataRows = allRows.slice(1); } else dataRows = allRows;
      dataRows = dataRows.filter(function (r) { return !(t.tFoot && r.parentNode === t.tFoot); });
    }
    var grid = dataRows.map(function (r) { return expandRow(r, base); });
    var headerCells = headerRow ? expandRow(headerRow, base) : [];
    var nCols = Math.max(headerCells.length, grid.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
    var names = [];
    for (var c = 0; c < nCols; c++) names.push((headerCells[c] && headerCells[c].text) || 'Column ' + (c + 1));
    names = uniqueNames(names);

    // decide which columns also get a URL / image companion column
    var linkCols = [], imgCols = [];
    for (var j = 0; j < nCols; j++) {
      var withLink = 0, withImg = 0;
      grid.forEach(function (r) { if (r[j] && r[j].href) withLink++; if (r[j] && r[j].img) withImg++; });
      if (withLink >= Math.max(2, grid.length * 0.5)) linkCols.push(j);
      if (withImg >= Math.max(2, grid.length * 0.5)) imgCols.push(j);
    }
    var outNames = names.slice();
    linkCols.forEach(function (j) { outNames.push(names[j] + ' URL'); });
    imgCols.forEach(function (j) { outNames.push(names[j] + ' Image'); });
    var columns = makeColumns(uniqueNames(outNames));

    var rows = grid.map(function (r) {
      var out = [];
      for (var k = 0; k < nCols; k++) out.push(r[k] ? r[k].text : '');
      linkCols.forEach(function (jj) { out.push(r[jj] ? r[jj].href : ''); });
      imgCols.forEach(function (jj) { out.push(r[jj] ? r[jj].img : ''); });
      return out;
    }).filter(function (r) { return r.some(function (v) { return v !== ''; }); });
    return { columns: columns, rows: rows };
  }

  /* ----------------------------------------- 2. REPEATED-SIBLING candidates */
  var SKIP_CHILD = /^(BR|HR|OPTION|SCRIPT|STYLE|LINK|META|SOURCE|PATH|TD|TH|TR|THEAD|TBODY|TFOOT|COL|COLGROUP|INPUT|IMG|SVG|OPTGROUP|TEMPLATE|NOSCRIPT|LABEL|BUTTON|SPAN|B|I|EM|STRONG|SMALL)$/;
  var SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|SVG|TEMPLATE|SELECT|OPTION|IFRAME|CANVAS|PATH)$/;
  var DYNAMIC = /^(active|selected|current|odd|even|first|last|first-child|last-child|open|show|hidden|disabled|focus|hover|is-.+|has-.+|js-.+|ng-.+|\d+|row)$/i;

  function classList(el) {
    var c = el.getAttribute('class');
    return c ? c.trim().split(/\s+/).filter(function (x) { return x && !DYNAMIC.test(x); }) : [];
  }
  /** group signature: tagName + sorted class names */
  function sigOf(el) {
    var cls = classList(el).sort();
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  }
  /** path step signature (first two classes, original order) */
  function stepOf(el) {
    var cls = classList(el).slice(0, 2);
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  }

  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += ' ' + n.nodeValue;
    return clean(t);
  }

  function leafCount(el) {
    var n = 0;
    (function walk(e) {
      if (SKIP_TAGS.test(e.tagName)) return;
      if (ownText(e)) n++;
      for (var c = e.firstElementChild; c; c = c.nextElementSibling) walk(c);
    })(el);
    return n;
  }

  function collectFields(row, base) {
    var fields = [], order = 0;
    function addHref(el, path) {
      var raw = el.getAttribute('href');
      if (!raw || raw.charAt(0) === '#' || /^javascript:/i.test(raw)) return;
      var h = abs(raw, base);
      if (h) fields.push({ path: path + '@href', value: h, o: order++ });
    }
    var rt = ownText(row);
    if (rt) fields.push({ path: '', value: rt, o: order++ });
    if (row.tagName === 'A') addHref(row, '');
    (function walk(el, path) {
      var counts = Object.create(null);
      for (var ch = el.firstElementChild; ch; ch = ch.nextElementSibling) {
        if (SKIP_TAGS.test(ch.tagName)) continue;
        var step = stepOf(ch), n = counts[step] = (counts[step] === undefined ? 0 : counts[step] + 1);
        var p = path + '>' + step + '[' + n + ']';
        if (ch.tagName === 'IMG') {
          var src = ch.getAttribute('src') || ch.getAttribute('data-src') || ch.getAttribute('data-lazy-src') || '';
          if (src && !(/^data:/i.test(src) && src.length < 60)) fields.push({ path: p + '@src', value: abs(src, base), o: order++ });
        }
        var t = ownText(ch);
        if (t) fields.push({ path: p, value: t, o: order++ });
        if (ch.tagName === 'A') addHref(ch, p);
        walk(ch, p);
      }
    })(row, '');
    return fields;
  }

  var TAG_NAME = { a: 'Link', img: 'Image', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
    p: 'Text', span: 'Text', div: 'Text', li: 'Item', time: 'Date', strong: 'Value', b: 'Value', em: 'Note', i: 'Note', td: 'Cell', th: 'Cell', small: 'Note', label: 'Label' };

  function pathName(path) {
    var suffix = '';
    if (/@href$/.test(path)) { suffix = ' URL'; path = path.slice(0, -5); }
    else if (/@src$/.test(path)) { suffix = ' Image'; path = path.slice(0, -4); }
    var last = path.split('>').pop().replace(/\[\d+\]$/, '');
    if (!last) return 'Text' + suffix;
    var parts = last.split('.'), tag = parts[0], cls = parts[1];
    var name;
    if (cls && !/\d{3,}|^[a-z]{1,3}-[a-z0-9]{5,}$|^css-|^_|^sc-/i.test(cls)) name = cls.replace(/[-_]+/g, ' ');
    else name = TAG_NAME[tag] || tag;
    name = name.charAt(0).toUpperCase() + name.slice(1);
    if (suffix && (name === 'Link' || name === 'Image')) return name === 'Link' ? 'URL' : 'Image';
    return name + suffix;
  }

  function extractRepeat(els, base) {
    var perRow = els.map(function (e) { return collectFields(e, base); });
    var stats = Object.create(null), n = els.length;
    perRow.forEach(function (fs) {
      fs.forEach(function (f) {
        var s = stats[f.path] || (stats[f.path] = { path: f.path, count: 0, order: 0 });
        s.count++; s.order += f.o;
      });
    });
    var need = Math.max(2, Math.ceil(n * 0.35));
    var kept = Object.keys(stats).map(function (k) { return stats[k]; }).filter(function (s) { return s.count >= need; });
    kept.forEach(function (s) { s.order = s.order / s.count; });
    kept.sort(function (a, b) { return a.order - b.order; });

    var values = perRow.map(function (fs) {
      var m = Object.create(null);
      fs.forEach(function (f) { m[f.path] = m[f.path] ? m[f.path] + ' ' + f.value : f.value; });
      return m;
    });
    // drop constant link labels (e.g. every card says "View details") and fully-empty columns
    var hrefSet = Object.create(null);
    kept.forEach(function (s) { hrefSet[s.path] = 1; });
    kept = kept.filter(function (s) {
      var vals = values.map(function (m) { return m[s.path] || ''; });
      if (!vals.some(Boolean)) return false;
      var distinct = Object.create(null); vals.forEach(function (v) { distinct[v] = 1; });
      var nd = Object.keys(distinct).length;
      if (/@href$/.test(s.path) && nd === 1 && n > 2) return false;
      if (!/@/.test(s.path) && nd === 1 && n > 2 && hrefSet[s.path + '@href']) return false;
      return true;
    });
    var names = uniqueNames(kept.map(function (s) { return pathName(s.path); }));
    var columns = makeColumns(names);
    var rows = values.map(function (m) { return kept.map(function (s) { return m[s.path] || ''; }); })
      .filter(function (r) { return r.some(Boolean); });
    var coverage = kept.length ? kept.reduce(function (a, s) { return a + s.count / n; }, 0) / kept.length : 0;
    return { columns: columns, rows: rows, coverage: coverage };
  }

  function inChrome(el) { return !!el.closest('nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"]'); }


  /* If every row is just a wrapper holding several identical cards (bootstrap "row" > "col" cards,
     grids of 3), use the inner cards as the rows. Tag lists inside cards are ignored (too few leaves). */
  function flattenGroup(els) {
    for (var depth = 0; depth < 2; depth++) {
      var sample = els.slice(0, 12), counts = Object.create(null), best = null;
      sample.forEach(function (e) {
        var seen = Object.create(null);
        Array.prototype.forEach.call(e.children, function (ch) {
          if (SKIP_CHILD.test(ch.tagName)) return;
          var sg = sigOf(ch); seen[sg] = (seen[sg] || 0) + 1;
        });
        Object.keys(seen).forEach(function (sg) { if (seen[sg] >= 2) counts[sg] = (counts[sg] || 0) + 1; });
      });
      Object.keys(counts).forEach(function (sg) {
        if (counts[sg] >= Math.ceil(sample.length * 0.7) && (!best || counts[sg] > counts[best])) best = sg;
      });
      if (!best) break;
      var inner = [];
      els.forEach(function (e) {
        Array.prototype.forEach.call(e.children, function (ch) { if (!SKIP_CHILD.test(ch.tagName) && sigOf(ch) === best) inner.push(ch); });
      });
      var iLeaf = 0, oLeaf = 0, n = Math.min(inner.length, 12);
      for (var i = 0; i < n; i++) iLeaf += leafCount(inner[i]);
      sample.forEach(function (e) { oLeaf += leafCount(e); });
      iLeaf /= n; oLeaf /= sample.length;
      if (inner.length < els.length * 2 || iLeaf < 2 || iLeaf < oLeaf * 0.2) break;
      els = inner;
    }
    return els;
  }

  function repeatCandidates(doc, base) {
    var raw = [];
    var root = doc.body || doc.documentElement;
    var parents = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    parents.forEach(function (parent) {
      if (SKIP_TAGS.test(parent.tagName) || /^(TABLE|THEAD|TBODY|TR|SELECT|HEAD)$/.test(parent.tagName)) return;
      if (parent.children.length < MIN_ROWS) return;
      var groups = Object.create(null);
      Array.prototype.forEach.call(parent.children, function (ch) {
        if (SKIP_CHILD.test(ch.tagName)) return;
        (groups[sigOf(ch)] || (groups[sigOf(ch)] = [])).push(ch);
      });
      Object.keys(groups).forEach(function (sig) {
        var els = groups[sig];
        if (els.length < MIN_ROWS) return;
        els = flattenGroup(els);
        var sample = els.slice(0, 25), leaves = 0, len = 0;
        sample.forEach(function (e) { leaves += leafCount(e); len += clean(e.textContent).length; });
        var avgLeaf = leaves / sample.length, avgLen = len / sample.length;
        if (avgLeaf < 1) return;
        var score = els.length * avgLeaf;
        if (avgLeaf < 2 && avgLen < 24) score *= 0.3;                     // menus, tag clouds
        if (inChrome(parent)) score *= 0.3;                               // site chrome
        var factor = 1;
        if (avgLeaf <= 3 && parent.closest('[role="menu"],[role="listbox"],[role="tablist"],details,[class*="dropdown"],[class*="menu"],[class*="facet"],[class*="filter"],[class*="breadcrumb"],[class*="pagination"]')) factor *= 0.2;
        if (els[0].tagName === 'A' && avgLeaf <= 2) factor *= 0.4;         // bare link lists
        score *= factor;
        raw.push({ parent: parent, els: els, sig: sig, score: score, factor: factor });
      });
    });
    raw.sort(function (a, b) { return b.score - a.score; });
    // drop groups that are ancestors/descendants-with-same-els of a better group
    var top = [];
    var taken = new Set();
    raw.slice(0, 12).forEach(function (g) {
      if (taken.has(g.els[0])) return;                                 // already covered by a better group
      g.els.forEach(function (e) { taken.add(e); });
      top.push(g);
    });
    var out = [];
    top.forEach(function (g) {
      var data = extractRepeat(g.els, base);
      if (data.columns.length < 2 && data.rows.length < MIN_ROWS) return;
      if (data.columns.length < 1) return;
      var cand = {
        kind: 'repeat', el: g.parent, els: g.els, rowCount: data.rows.length, avgCols: data.columns.length,
        score: data.rows.length * data.columns.length * (0.4 + 0.6 * data.coverage) * (inChrome(g.parent) ? 0.3 : 1) * g.factor,
        label: 'Repeated list · ' + data.rows.length + ' × ' + tagLabel(g.els[0]),
        signature: 'R|' + g.sig + '|' + sigOf(g.parent), _data: { columns: data.columns, rows: data.rows }
      };
      cand.extract = function () { return cand._data; };
      out.push(cand);
    });
    return out;
  }

  /**
   * Detect every plausible table/list on the page, best first.
   * Spec: <table> candidates win when their score passes TABLE_THRESHOLD,
   * otherwise repeated-sibling groups are preferred.
   */
  function detectCandidates(doc, base) {
    var tables = tableCandidates(doc, base).sort(function (a, b) { return b.score - a.score; });
    var repeats = repeatCandidates(doc, base).sort(function (a, b) { return b.score - a.score; });
    var tableWins = tables.length && tables[0].score > TABLE_THRESHOLD && tables[0].rowCount >= MIN_ROWS - 1;
    var ordered = tableWins ? tables.concat(repeats) : repeats.concat(tables);
    ordered.forEach(function (c, i) { c.id = i; });
    return ordered;
  }

  function matchTemplate(cands, signature) {
    if (!signature) return cands[0];
    for (var i = 0; i < cands.length; i++) if (cands[i].signature === signature) return cands[i];
    var kind = signature.charAt(0) === 'T' ? 'table' : 'repeat';
    var prefix = signature.split('|').slice(0, 2).join('|');
    for (var j = 0; j < cands.length; j++) if (cands[j].signature.indexOf(prefix) === 0) return cands[j];
    for (var k = 0; k < cands.length; k++) if (cands[k].kind === kind) return cands[k];
    return cands[0];
  }

  /* -------------------------------------------------------- page extraction */
  /**
   * Run a mode over a parsed document.
   * Returns { columns, rows, meta } — meta.candidate / meta.candidates for Auto Table.
   */
  function extractPage(mode, doc, base, o) {
    o = o || {};
    if (mode === 'table') {
      var cands = detectCandidates(doc, base);
      if (!cands.length) return { columns: [], rows: [], meta: { noTable: true, candidates: [], signature: null } };
      var pick = o.template ? matchTemplate(cands, o.template) : (cands[o.candidateIndex || 0] || cands[0]);
      var data = pick.extract();
      return { columns: data.columns, rows: data.rows, meta: { candidate: pick, candidates: cands, signature: pick.signature, label: pick.label } };
    }
    var r = X().run(mode, doc, base);
    r.meta = r.meta || {};
    r.meta.signature = 'M|' + mode;
    return r;
  }

  /* ------------------------------------------------------------ 3. PAGINATION */
  var NEXT_STRICT = /^\s*(next(\s+page)?|older|more|siguiente|suivant|weiter|volgende|pr[óo]xima?|seguente|下一页|下一頁|次へ|→|»|›|>|>>|»»|›\s*›)\s*[›»→>]*\s*$/i;
  var NEXT_LOOSE = /next|→|»|siguiente|suivant/i;
  var PAGER_SEL = '[class*="pagination" i],[class*="pager" i],[class*="paging" i],nav[aria-label*="pag" i],[role="navigation"][aria-label*="pag" i],ul.pages,.page-numbers';

  function isDisabled(el) {
    if (!el) return true;
    var c = el.closest('[aria-disabled="true"],.disabled,[disabled],[class*="disabled" i]');
    return !!c;
  }
  function normUrl(u) { return String(u || '').split('#')[0].replace(/\/$/, ''); }
  function sameSite(a, b) {
    try {
      if (/^demo:/i.test(a) && /^demo:/i.test(b)) return true;
      return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
    } catch (e) { return false; }
  }

  /**
   * Find the "next page" link. Priority:
   *  1 <link rel=next> / <a rel=next>   2 aria-label~=next   3 pagination wrapper (active item's next sibling / .next)
   *  4 short link text such as Next, →, », siguiente, suivant
   * Returns { url, via } | { url: null, via, needsJs: true } | null
   */
  function findNext(doc, base, currentUrl, visited) {
    visited = visited || new Set();
    var cur = normUrl(currentUrl);
    function accept(href, via) {
      var u = abs(href, base);
      if (!u || !/^(https?|demo):/i.test(u)) return null;
      var n = normUrl(u);
      if (n === cur || visited.has(n) || !sameSite(u, currentUrl)) return null;
      return { url: u, via: via };
    }
    var el, r, i;
    var rels = doc.querySelectorAll('link[rel~="next" i][href], a[rel~="next" i][href]');
    for (i = 0; i < rels.length; i++) {
      if (rels[i].tagName === 'A' && isDisabled(rels[i])) continue;
      if ((r = accept(rels[i].getAttribute('href'), 'rel="next" link'))) return r;
    }
    var aria = doc.querySelectorAll('a[aria-label*="next" i][href], a[title*="next" i][href], [aria-label*="next" i] a[href]');
    for (i = 0; i < aria.length; i++) {
      if (isDisabled(aria[i])) continue;
      if ((r = accept(aria[i].getAttribute('href'), 'aria-label "next"'))) return r;
    }
    var wrappers = doc.querySelectorAll(PAGER_SEL);
    for (i = 0; i < wrappers.length; i++) {
      var w = wrappers[i];
      var nx = w.querySelectorAll('a.next[href], li.next a[href], a[class*="next" i][href], li[class*="next" i] a[href]');
      for (var a = 0; a < nx.length; a++) {
        if (isDisabled(nx[a])) continue;
        if ((r = accept(nx[a].getAttribute('href'), 'pagination "next"'))) return r;
      }
      var act = w.querySelector('[aria-current="page"], [aria-current="true"], .active, .current, .selected');
      if (act) {
        var item = act.closest('li') || act, sib = item.nextElementSibling;
        while (sib) {
          var link = sib.matches('a[href]') ? sib : sib.querySelector('a[href]');
          if (link && !isDisabled(link) && !/prev|back|←|«/i.test(link.textContent) && (r = accept(link.getAttribute('href'), 'pagination (next page number)'))) return r;
          sib = sib.nextElementSibling;
          if (sib && !sib.querySelector('a[href]') && !sib.matches('a[href]')) break;
        }
      }
      var loose = w.querySelectorAll('a[href]');
      for (var l = 0; l < loose.length; l++) {
        var lt = clean(loose[l].textContent);
        if (lt.length <= 20 && NEXT_LOOSE.test(lt) && !isDisabled(loose[l]) && (r = accept(loose[l].getAttribute('href'), 'pagination link "' + lt + '"'))) return r;
      }
    }
    var all = doc.querySelectorAll('a[href], button');
    for (i = 0; i < all.length; i++) {
      el = all[i];
      var t = clean(el.textContent || el.getAttribute('aria-label') || '');
      if (!t || t.length > 20 || !NEXT_STRICT.test(t) || isDisabled(el)) continue;
      if (el.tagName === 'A') { if ((r = accept(el.getAttribute('href'), 'link "' + t + '"'))) return r; }
      else if (el.tagName === 'BUTTON' && !el.closest('form')) return { url: null, via: 'button "' + t + '"', needsJs: true };
    }
    return null;
  }

  /* ----------------------------------------------------------------- Dataset */
  /**
   * Table-shaped result store used by every mode.
   * columns: [{key, name, enabled}]   rows: [{v:{key:value}, src, page, order, id}]
   * Meta columns source_url / page_index are separate and appended on output.
   */
  function Dataset() {
    this.columns = [];
    this.rows = [];
    this.meta = [
      { key: '__source_url', name: 'source_url', enabled: false, meta: true },
      { key: '__page_index', name: 'page_index', enabled: false, meta: true }
    ];
    this.dedupe = false;
    this.filterFn = null;
    this._ver = 0;
    this._cache = null;
    this._listeners = [];
    this._seq = 0;
    this._sources = Object.create(null);
    this._maxPage = 0;
    this._touched = Object.create(null);
    this._ordered = false;
  }
  Dataset.prototype.on = function (fn) { this._listeners.push(fn); return this; };
  Dataset.prototype._emit = function (type, origin) {
    this._ver++;
    var self = this;
    this._listeners.forEach(function (fn) { try { fn({ type: type, origin: origin || null, dataset: self }); } catch (e) { console.error(e); } });
  };
  Dataset.prototype.reset = function () {
    this.columns = []; this.rows = []; this._sources = Object.create(null); this._maxPage = 0; this._seq = 0; this._ordered = false;
    this._touched = Object.create(null);
    this.meta.forEach(function (m) { m.enabled = false; });
    this._emit('reset');
  };
  /** Clear rows but keep column names the user edited. */
  Dataset.prototype.clearRows = function () { this.rows = []; this._sources = Object.create(null); this._maxPage = 0; this._emit('rows'); };
  Dataset.prototype.allColumns = function () { return this.columns.concat(this.meta); };
  Dataset.prototype.dataColumns = function () { return this.columns; };
  Dataset.prototype.addRows = function (colDefs, rows, ctx) {
    ctx = ctx || {};
    var self = this, changedCols = false;
    var keys = colDefs.map(function (d) {
      var ex = self.columns.find(function (c) { return c.key === d.key; });
      if (!ex) { self.columns.push({ key: d.key, name: d.name, enabled: true }); changedCols = true; }
      return d.key;
    });
    rows.forEach(function (arr) {
      var v = {};
      keys.forEach(function (k, i) { v[k] = arr[i] == null ? '' : arr[i]; });
      self.rows.push({ v: v, src: ctx.source_url || '', page: ctx.page_index || 1, order: ctx.order == null ? 0 : ctx.order, id: ++self._seq });
    });
    if (ctx.order != null) this._ordered = true;
    if (ctx.source_url) this._sources[ctx.source_url] = 1;
    if (ctx.page_index) this._maxPage = Math.max(this._maxPage, ctx.page_index);
    // auto-reveal provenance columns once they carry information
    var multiSource = Object.keys(this._sources).length > 1, multiPage = this._maxPage > 1;
    if ((multiSource || multiPage || ctx.forceMeta) && !this._touched.__source_url) this.meta[0].enabled = true;
    if ((multiPage || ctx.forceMeta === 'page') && !this._touched.__page_index) this.meta[1].enabled = true;
    this._emit(changedCols ? 'columns' : 'rows');
  };
  Dataset.prototype.rename = function (key, name, origin) {
    var c = this.allColumns().find(function (x) { return x.key === key; });
    if (!c) return;
    name = String(name).trim();
    if (!name || c.name === name) return;
    c.name = name;
    this._emit('rename', origin);
  };
  Dataset.prototype.setEnabled = function (key, on, origin) {
    var c = this.allColumns().find(function (x) { return x.key === key; });
    if (!c || c.enabled === !!on) return;
    c.enabled = !!on;
    if (c.meta) this._touched[key] = true;
    this._emit('toggle', origin);
  };
  Dataset.prototype.setAllEnabled = function (on) {
    this.allColumns().forEach(function (c) { c.enabled = !!on; if (c.meta) this._touched[c.key] = true; }, this);
    this._emit('toggle');
  };
  Dataset.prototype.setDedupe = function (on) { this.dedupe = !!on; this._emit('rows'); };
  Dataset.prototype.setFilter = function (fn) { this.filterFn = fn || null; this._emit('rows'); };
  Dataset.prototype.enabledColumns = function () { return this.allColumns().filter(function (c) { return c.enabled; }); };

  Dataset.prototype.visibleRows = function () {
    var rows = this.rows;
    if (this._ordered) {
      rows = rows.slice().sort(function (a, b) { return (a.order - b.order) || (a.page - b.page) || (a.id - b.id); });
    }
    if (this.filterFn) rows = rows.filter(this.filterFn);
    if (this.dedupe) {
      var keys = this.columns.filter(function (c) { return c.enabled; }).map(function (c) { return c.key; });
      var seen = Object.create(null);
      rows = rows.filter(function (r) {
        var k = keys.map(function (kk) { return r.v[kk]; }).join('\u0001');
        if (seen[k]) return false;
        seen[k] = 1; return true;
      });
    }
    return rows;
  };
  /** { headers: [display names of enabled columns], matrix: [[cell…]], keys: [...] } — preview and exports both use this. */
  Dataset.prototype.view = function () {
    if (this._cache && this._cache.ver === this._ver) return this._cache.out;
    var cols = this.enabledColumns(), rows = this.visibleRows();
    var out = {
      keys: cols.map(function (c) { return c.key; }),
      headers: cols.map(function (c) { return c.name; }),
      matrix: rows.map(function (r) {
        return cols.map(function (c) {
          if (c.key === '__source_url') return r.src;
          if (c.key === '__page_index') return r.page;
          var v = r.v[c.key];
          return v == null ? '' : v;
        });
      })
    };
    this._cache = { ver: this._ver, out: out };
    return out;
  };
  Dataset.prototype.rowCount = function () { return this.visibleRows().length; };
  Dataset.prototype.totalRows = function () { return this.rows.length; };
  Dataset.prototype.columnValues = function (key) { return this.visibleRows().map(function (r) { return r.v[key] || ''; }); };
  Dataset.prototype.pageCount = function () { return this._maxPage; };
  Dataset.prototype.sourceCount = function () { return Object.keys(this._sources).length; };

  /* --------------------------------------------------------- scrape + crawl */
  function previewHtml(doc, finalUrl, cand) {
    var marked = [];
    if (cand && cand.el) { cand.el.setAttribute('data-sieve-hit', '1'); marked.push(cand.el); }
    var clone = doc.documentElement.cloneNode(true);
    marked.forEach(function (m) { m.removeAttribute('data-sieve-hit'); });
    clone.querySelectorAll('script,iframe,object,embed,meta[http-equiv],link[rel="preload"],link[rel="prefetch"]').forEach(function (n) { n.remove(); });
    var head = clone.querySelector('head');
    if (!head) { head = doc.createElement('head'); clone.insertBefore(head, clone.firstChild); }
    if (/^https?:/i.test(finalUrl)) {
      var b = doc.createElement('base'); b.setAttribute('href', finalUrl); head.insertBefore(b, head.firstChild);
    }
    var st = doc.createElement('style');
    st.textContent = 'a{pointer-events:none}[data-sieve-hit]{outline:3px solid #5B5BFF !important;outline-offset:2px;box-shadow:0 0 0 6px rgba(91,91,255,.18) !important;border-radius:4px}';
    head.appendChild(st);
    return '<!doctype html>' + clone.outerHTML;
  }

  /**
   * Fetch + parse + extract one page.
   * o: fetch options + { template, candidateIndex, visited, html }
   */
  function scrapePage(url, mode, o) {
    o = o || {};
    return fetchHtml(url, o).then(function (page) {
      var doc = parseHtml(page.html);
      var base = effectiveBase(doc, page.finalUrl);
      var res = extractPage(mode, doc, base, { template: o.template, candidateIndex: o.candidateIndex });
      var next = o.findNext === false ? null : findNext(doc, base, page.finalUrl, o.visited);
      return { page: page, doc: doc, base: base, res: res, next: next };
    });
  }

  /**
   * Crawl one starting URL (and optionally follow pagination) into `dataset`.
   * o: { followPagination, maxPages, delay, timeout, scroll, maxScrolls, signal, dataset,
   *      candidateIndex, startHtml, order, forceMeta }
   * hooks: { onPage(info), onProgress(info), onLog(msg) }
   * Resolves { pages, rows, first (first scrapePage result), stoppedBecause }
   */
  async function crawl(startUrl, mode, o, hooks) {
    hooks = hooks || {};
    var ds = o.dataset, visited = o.visited || new Set(), template = o.template || null, first = null;
    var offset = o.pageOffset || 0;                     // pages already scraped (continuing a crawl)
    var maxPages = o.followPagination ? Math.max(1, o.maxPages || 10) : 1;
    var current = startUrl, pageIndex = 0, added = 0, stopped = 'done', last = null;
    while (current && pageIndex < maxPages) {
      if (o.signal && o.signal.aborted) { stopped = 'cancelled'; break; }
      if (hooks.onProgress) hooks.onProgress({ page: offset + pageIndex + 1, max: offset + maxPages, url: current, phase: 'fetch' });
      var r;
      try {
        r = await scrapePage(current, mode, {
          signal: o.signal, timeout: o.timeout, scroll: o.scroll && pageIndex === 0, maxScrolls: o.maxScrolls, proxy: o.proxy,
          template: template, candidateIndex: pageIndex === 0 ? o.candidateIndex : undefined,
          visited: visited, html: pageIndex === 0 ? o.startHtml : undefined, findNext: true
        });
      } catch (err) {
        if (err.code === 'aborted') { stopped = 'cancelled'; break; }
        if (pageIndex === 0) throw err;
        if (hooks.onLog) hooks.onLog('Stopped on page ' + (pageIndex + 1) + ': ' + err.message);
        stopped = 'error'; break;
      }
      if (pageIndex === 0) { first = r; if (!template) template = r.res.meta.signature; }
      last = r;
      visited.add(normUrl(r.page.finalUrl));
      visited.add(normUrl(current));
      var before = ds.totalRows();
      if (r.res.rows.length) {
        ds.addRows(r.res.columns, r.res.rows, { source_url: r.page.finalUrl, page_index: offset + pageIndex + 1, order: o.order, forceMeta: o.forceMeta });
      }
      added += ds.totalRows() - before;
      pageIndex++;
      if (hooks.onPage) hooks.onPage({ page: offset + pageIndex, max: offset + maxPages, url: r.page.finalUrl, rows: r.res.rows.length, result: r, total: ds.totalRows() });
      if (!o.followPagination) break;
      var nx = r.next;
      if (!nx) { stopped = 'no-next'; if (hooks.onLog) hooks.onLog('No further "next" link found.'); break; }
      if (nx.needsJs) { stopped = 'needs-js'; if (hooks.onLog) hooks.onLog('Next page is a JavaScript button (' + nx.via + '). Enable the proxy to render it.'); break; }
      current = nx.url;
      if (pageIndex >= maxPages) { stopped = 'max-pages'; break; }
      try { await util.sleep(o.delay == null ? 1000 : o.delay, o.signal); } catch (e) { stopped = 'cancelled'; break; }
    }
    return { pages: pageIndex, rows: added, first: first, last: last, stopped: stopped, template: template, visited: visited };
  }

  /* ---------------------------------------------------------------------- bulk */
  /**
   * Parse a pasted URL list. Returns { urls, invalid, duplicates, truncated }.
   */
  function parseUrlList(text, max) {
    max = max || 500;
    var seen = Object.create(null), urls = [], invalid = [], dup = 0, truncated = 0;
    String(text || '').split(/[\r\n,;\t ]+/).forEach(function (raw) {
      raw = raw.trim();
      if (!raw) return;
      var u = util.normalizeUrl(raw);
      if (!u) { invalid.push(raw); return; }
      if (seen[u]) { dup++; return; }
      seen[u] = 1;
      if (urls.length >= max) { truncated++; return; }
      urls.push(u);
    });
    return { urls: urls, invalid: invalid, duplicates: dup, truncated: truncated };
  }

  /**
   * Scrape many URLs into one dataset.
   * o: { concurrency, delay, maxPages, followPagination, timeout, signal, dataset }
   * hooks: { onStatus(index, status, info) }
   */
  async function bulk(urls, mode, o, hooks) {
    hooks = hooks || {};
    var ds = o.dataset, next = 0, conc = Math.max(1, Math.min(o.concurrency || 3, 8)), summary = { done: 0, error: 0, cancelled: 0 };
    async function worker() {
      while (true) {
        if (o.signal && o.signal.aborted) return;
        var i = next++;
        if (i >= urls.length) return;
        var t0 = performance.now();
        if (hooks.onStatus) hooks.onStatus(i, 'running', {});
        try {
          var r = await crawl(urls[i], mode, {
            dataset: ds, followPagination: !!o.followPagination, maxPages: o.maxPages, delay: o.delay, timeout: o.timeout,
            signal: o.signal, order: i, forceMeta: true, proxy: o.proxy
          }, {});
          if (r.stopped === 'cancelled') { summary.cancelled++; if (hooks.onStatus) hooks.onStatus(i, 'pending', {}); return; }
          summary.done++;
          if (hooks.onStatus) hooks.onStatus(i, 'done', { rows: r.rows, pages: r.pages, ms: Math.round(performance.now() - t0) });
        } catch (err) {
          if (err.code === 'aborted') { if (hooks.onStatus) hooks.onStatus(i, 'pending', {}); return; }
          summary.error++;
          if (hooks.onStatus) hooks.onStatus(i, 'error', { error: err.message, code: err.code, ms: Math.round(performance.now() - t0) });
        }
        try { await util.sleep(o.delay == null ? 500 : Math.min(o.delay, 5000), o.signal); } catch (e) { return; }
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(conc, urls.length); w++) workers.push(worker());
    await Promise.all(workers);
    return summary;
  }

  /* ------------------------------------------------------------------ export */
  Sieve.Dataset = Dataset;
  Sieve.scraper = {
    TABLE_THRESHOLD: TABLE_THRESHOLD,
    ScrapeError: ScrapeError,
    proxy: proxy,
    fetchHtml: fetchHtml,
    parseHtml: parseHtml,
    effectiveBase: effectiveBase,
    detectCandidates: detectCandidates,
    findNext: findNext,
    extractPage: extractPage,
    scrapePage: scrapePage,
    crawl: crawl,
    bulk: bulk,
    parseUrlList: parseUrlList,
    previewHtml: previewHtml,
    normUrl: normUrl
  };

})(window);
