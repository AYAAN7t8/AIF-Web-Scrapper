/* ==========================================================================
   Sieve — extractors.js
   Built-in extractors. Each one takes a parsed Document + base URL and returns
   { columns: [{key, name}], rows: [[...values]], meta: {...} }.
   (Auto Table detection lives in scraper.js.)

   Modes: email · phone · links · images · text · reviews · people ·
          business · social · b2b
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve = global.Sieve || {};

  /* ---------------------------------------------------------------- helpers */
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  function text(el) { return el ? clean(el.textContent) : ''; }

  function abs(href, base) {
    if (!href) return '';
    href = String(href).trim();
    if (!href || /^(javascript:|data:text|#)/i.test(href)) return '';
    if (/^data:/i.test(href)) return href;
    try { return new URL(href, base).href; } catch (e) { return ''; }
  }

  function cols(names) {
    return names.map(function (n) { return { key: n.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: n }; });
  }

  function result(names, rows, meta) { return { columns: cols(names), rows: rows, meta: meta || {} }; }

  /** Body text without script/style/etc. Works on a clone so the doc stays intact. */
  var NOISE = 'script,style,noscript,template,svg,iframe,canvas,head';
  function bodyText(doc) {
    var root = doc.body || doc.documentElement;
    var clone = root.cloneNode(true);
    clone.querySelectorAll(NOISE).forEach(function (n) { n.remove(); });
    // textContent glues block elements together; insert separators first
    clone.querySelectorAll('br').forEach(function (n) { n.replaceWith(doc.createTextNode(' \n ')); });
    clone.querySelectorAll('p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,section,article,address,dd,dt').forEach(function (n) {
      n.appendChild(doc.createTextNode(' \n '));
    });
    return clone.textContent || '';
  }

  function dedupeBy(items, keyFn) {
    var seen = Object.create(null), out = [];
    items.forEach(function (it) {
      var k = keyFn(it);
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(it);
    });
    return out;
  }

  function jsonLd(doc) {
    var out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var data = JSON.parse(s.textContent);
        (function walk(node) {
          if (Array.isArray(node)) { node.forEach(walk); return; }
          if (node && typeof node === 'object') {
            out.push(node);
            Object.keys(node).forEach(function (k) { if (typeof node[k] === 'object') walk(node[k]); });
          }
        })(data);
      } catch (e) { /* ignore malformed JSON-LD */ }
    });
    return out;
  }
  function ldType(node, name) {
    var t = node && node['@type'];
    if (!t) return false;
    var re = new RegExp('^(' + name + ')$', 'i');
    return Array.isArray(t) ? t.some(function (x) { return re.test(x); }) : re.test(t);
  }
  function ldAddress(a) {
    if (!a) return '';
    if (typeof a === 'string') return clean(a);
    return clean([a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(', '));
  }

  /**
   * Climb from an anchor element to the closest ancestor ("card") that still
   * contains every selector group and is small enough to be a single record.
   */
  function climbToCard(anchor, groups, maxText, maxLevels) {
    var el = anchor;
    for (var i = 0; i <= (maxLevels || 6) && el && el.nodeType === 1 && el.tagName !== 'BODY'; i++, el = el.parentElement) {
      var ok = groups.every(function (g) { return !!el.querySelector(g) || (el.matches && el.matches(g)); });
      if (ok) return (clean(el.textContent).length <= maxText) ? el : null;
    }
    return null;
  }

  function findCards(doc, anchorSel, groups, maxText) {
    var cards = [];
    doc.querySelectorAll(anchorSel).forEach(function (a) {
      var c = climbToCard(a, groups, maxText || 700, 6);
      if (c && cards.indexOf(c) === -1) cards.push(c);
    });
    // keep leaf-most cards only
    return cards.filter(function (c) { return !cards.some(function (o) { return o !== c && c.contains(o); }); });
  }

  /* ------------------------------------------------------------------ email */
  var EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  var FILE_TLD = /^(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|json|woff2?|ttf|eot|map|mp4|webm|pdf|zip)$/i;

  function deobfuscate(s) {
    return s
      .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, '@')
      .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, '.');
  }

  function extractEmails(doc) {
    var found = [];
    function push(addr, how) {
      addr = addr.replace(/^mailto:/i, '').split('?')[0].trim().replace(/[.,;:]+$/, '');
      var m = addr.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.([a-zA-Z]{2,})$/);
      if (!m || FILE_TLD.test(m[1]) || /^\d+x\./.test(addr.split('@')[1] || '')) return;
      found.push({ email: addr.toLowerCase(), how: how });
    }
    doc.querySelectorAll('a[href^="mailto:" i]').forEach(function (a) {
      a.getAttribute('href').replace(/^mailto:/i, '').split(',').forEach(function (p) { push(decodeURIComponent(p.split('?')[0]), 'mailto'); });
    });
    var t = deobfuscate(bodyText(doc));
    (t.match(EMAIL_RE) || []).forEach(function (m) { push(m, 'text'); });
    // Cloudflare-style obfuscation: data-cfemail
    doc.querySelectorAll('[data-cfemail]').forEach(function (el) {
      try {
        var hex = el.getAttribute('data-cfemail'), key = parseInt(hex.substr(0, 2), 16), out = '';
        for (var i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
        push(out, 'obfuscated');
      } catch (e) { /* ignore */ }
    });
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      (s.textContent.match(EMAIL_RE) || []).forEach(function (m) { push(m, 'json-ld'); });
    });
    var uniq = dedupeBy(found, function (f) { return f.email; });
    return result(['Email', 'Domain', 'Found In'], uniq.map(function (f) {
      return [f.email, f.email.split('@')[1], f.how];
    }));
  }

  /* ------------------------------------------------------------------ phone */
  var PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/g;

  function phoneOk(raw) {
    var digits = raw.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return false;
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(raw.trim())) return false;      // 2026-03-02
    if (/^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(raw.trim())) return false;    // 03/02/2026
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(raw.trim())) return false;              // IPv4
    if (/^(\d)\1+$/.test(digits)) return false;                                // 00000000
    if (/^\d+\.\d+$/.test(raw.trim())) return false;                           // 1234.5678
    if (/^\d{4}\s*-\s*\d{4}$/.test(raw.trim())) return false;                  // year ranges
    return true;
  }

  function extractPhones(doc) {
    var found = [];
    function add(raw, how) {
      raw = clean(raw).replace(/^[\s.-]+|[\s.-]+$/g, '');
      if (!phoneOk(raw)) return;
      var norm = (raw.trim().charAt(0) === '+' ? '+' : '') + raw.replace(/\D/g, '');
      found.push({ phone: raw, norm: norm, how: how });
    }
    doc.querySelectorAll('a[href^="tel:" i]').forEach(function (a) {
      add(decodeURIComponent(a.getAttribute('href').replace(/^tel:/i, '')), 'tel link');
    });
    (bodyText(doc).match(PHONE_RE) || []).forEach(function (m) { add(m, 'text'); });
    doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try {
        jsonLd(doc).forEach(function (n) { if (n.telephone) add(String(n.telephone), 'json-ld'); });
      } catch (e) { /* ignore */ }
    });
    var uniq = dedupeBy(found, function (f) { return f.norm; });
    return result(['Phone', 'Normalized', 'Found In'], uniq.map(function (f) { return [f.phone, f.norm, f.how]; }));
  }

  /* ------------------------------------------------------------------ links */
  function extractLinks(doc, base) {
    var origin = '';
    try { origin = new URL(base).hostname; } catch (e) { origin = ''; }
    var items = [];
    doc.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || /^(javascript:|mailto:|tel:|sms:|data:)/i.test(href.trim()) || href.trim().charAt(0) === '#') return;
      var u = abs(href, base);
      if (!/^(https?|demo):/i.test(u)) return;
      var key = u.split('#')[0];
      var host = '';
      try { host = new URL(u).hostname; } catch (e) { host = u.replace(/^demo:\/\//, '').split(/[/?]/)[0]; }
      var type = host === origin || host.replace(/^www\./, '') === origin.replace(/^www\./, '') ? 'internal' : 'external';
      items.push({ url: key, text: clean(a.textContent) || clean(a.getAttribute('aria-label') || a.getAttribute('title') || ''), type: type, rel: a.getAttribute('rel') || '' });
    });
    var uniq = dedupeBy(items, function (i) { return i.url; });
    return result(['URL', 'Text', 'Type', 'Rel'], uniq.map(function (i) { return [i.url, i.text, i.type, i.rel]; }));
  }

  /* ----------------------------------------------------------------- images */
  function bestSrcset(srcset, base) {
    var best = '', bestScore = -1;
    String(srcset || '').split(/,\s+(?=\S)|,$/).forEach(function (part) {
      var m = part.trim().split(/\s+/);
      if (!m[0]) return;
      var d = m[1] || '', score = /w$/.test(d) ? parseFloat(d) : /x$/.test(d) ? parseFloat(d) * 1000 : 1;
      if (score > bestScore) { bestScore = score; best = m[0]; }
    });
    return abs(best, base);
  }

  function imgType(url) {
    if (/^data:image\/([a-z0-9+.-]+)/i.test(url)) return RegExp.$1.replace('svg+xml', 'svg');
    var m = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : '';
  }

  function extractImages(doc, base) {
    var items = [];
    function add(u, alt, w, h, via) {
      if (!u) return;
      if (/^data:/i.test(u) && u.length < 60) return;                      // 1px placeholders
      items.push({ url: u, alt: clean(alt), w: w || '', h: h || '', via: via, type: imgType(u) });
    }
    doc.querySelectorAll('img').forEach(function (img) {
      var src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') || '';
      var set = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
      var u = set ? (bestSrcset(set, base) || abs(src, base)) : abs(src, base);
      add(u, img.getAttribute('alt'), img.getAttribute('width'), img.getAttribute('height'), 'img');
    });
    doc.querySelectorAll('source[srcset], source[data-srcset]').forEach(function (s) {
      add(bestSrcset(s.getAttribute('srcset') || s.getAttribute('data-srcset'), base), '', '', '', 'source');
    });
    doc.querySelectorAll('[style*="url("]').forEach(function (el) {
      var style = el.getAttribute('style') || '';
      var re = /url\(\s*(['"]?)(.*?)\1\s*\)/gi, m;
      while ((m = re.exec(style))) { if (/background/i.test(style)) add(abs(m[2], base), el.getAttribute('aria-label') || '', '', '', 'css background'); }
    });
    doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(function (m) {
      add(abs(m.getAttribute('content'), base), 'social preview', '', '', 'meta');
    });
    doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(function (l) {
      add(abs(l.getAttribute('href'), base), 'icon', '', '', 'icon');
    });
    var uniq = dedupeBy(items, function (i) { return i.url; });
    return result(['Image URL', 'Alt', 'Width', 'Height', 'Type', 'Source'],
      uniq.map(function (i) { return [i.url, i.alt, i.w, i.h, i.type, i.via]; }));
  }

  /* -------------------------------------------------------------- page text */
  var STRIP = 'script,style,noscript,template,nav,footer,svg,iframe,canvas,form,[hidden],[aria-hidden="true"],.sr-only';
  var BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt,figcaption,tr,summary,address';
  var HEADING = /^H[1-6]$/;

  function extractText(doc) {
    var root = (doc.body || doc.documentElement).cloneNode(true);
    root.querySelectorAll(STRIP).forEach(function (n) { n.remove(); });
    var blocks = [], section = clean((doc.title || '')) || 'Page';
    (function walk(node) {
      Array.prototype.forEach.call(node.children, function (el) {
        if (el.matches(BLOCK) && !el.querySelector(BLOCK)) {
          var t = el.tagName === 'TR'
            ? clean(Array.prototype.map.call(el.children, function (c) { return clean(c.textContent); }).filter(Boolean).join(' | '))
            : clean(el.textContent);
          if (!t) return;
          if (HEADING.test(el.tagName)) { section = t; blocks.push({ section: t, text: t, heading: true }); }
          else blocks.push({ section: section, text: t });
        } else if (el.matches(BLOCK)) {
          // block that contains blocks (e.g. li > p) -> recurse
          walk(el);
        } else walk(el);
      });
    })(root);

    var words = blocks.reduce(function (n, b) { return n + b.text.split(' ').length; }, 0);
    if (words < 25) {                                                      // fallback for div-soup pages
      var raw = (root.innerText || root.textContent || '').split(/\n+/).map(clean).filter(function (l) { return l.length > 1; });
      if (raw.length > blocks.length) blocks = raw.map(function (l) { return { section: section, text: l }; });
    }
    // adjacent duplicate removal
    blocks = blocks.filter(function (b, i) { return !(i && blocks[i - 1].text === b.text); });
    var rows = blocks.map(function (b, i) { return [i + 1, b.section, b.text]; });
    var full = blocks.map(function (b) { return b.heading ? '\n' + b.text.toUpperCase() : b.text; }).join('\n').replace(/^\n/, '');
    var wc = full ? full.split(/\s+/).length : 0;
    var r = result(['#', 'Section', 'Text'], rows, { fullText: full, words: wc, title: clean(doc.title) });
    return r;
  }

  /* ---------------------------------------------------------------- reviews */
  function ratingFrom(el) {
    if (!el) return '';
    var rv = el.querySelector('[itemprop="ratingValue"]');
    if (rv) { var v = clean(rv.getAttribute('content') || rv.textContent); if (/\d/.test(v)) return v.match(/\d+(\.\d+)?/)[0]; }
    var attrEl = el.querySelector('[data-rating],[data-score],[data-stars]') || (el.matches('[data-rating],[data-score],[data-stars]') ? el : null);
    if (attrEl) { var d = attrEl.getAttribute('data-rating') || attrEl.getAttribute('data-score') || attrEl.getAttribute('data-stars'); if (/^\d+(\.\d+)?$/.test(d)) return d; }
    var labelled = el.querySelectorAll('[aria-label],[title]');
    for (var i = 0; i < labelled.length; i++) {
      var l = (labelled[i].getAttribute('aria-label') || '') + ' ' + (labelled[i].getAttribute('title') || '');
      var m = l.match(/(\d+(?:\.\d+)?)\s*(?:out of|\/)\s*5/i) || l.match(/(\d+(?:\.\d+)?)\s*stars?/i) || l.match(/rated\s*(\d+(?:\.\d+)?)/i);
      if (m && parseFloat(m[1]) <= 5) return m[1];
    }
    var starEl = el.querySelector('[class*="star" i],[class*="rating" i]');
    if (starEl) {
      var cls = starEl.className && starEl.className.baseVal === undefined ? starEl.className : '';
      var cm = String(cls).match(/(?:star|rating|rated)[-_]?(\d)(?:[-_.]?(\d))?\b/i);
      if (cm) return cm[2] ? cm[1] + '.' + cm[2] : cm[1];
      var st = starEl.getAttribute('style') || '';
      var wm = st.match(/width\s*:\s*(\d+(?:\.\d+)?)%/i);
      if (wm) return (parseFloat(wm[1]) / 20).toFixed(1).replace(/\.0$/, '');
    }
    var t = clean(el.textContent);
    var tm = t.match(/(\d(?:\.\d)?)\s*(?:\/|out of)\s*5/i);
    if (tm) return tm[1];
    var filled = (t.match(/★/g) || []).length;
    if (filled && filled <= 5) return String(filled);
    return '';
  }

  function dateFrom(el) {
    var t = el.querySelector('time[datetime],[itemprop="datePublished"]');
    if (t) return clean(t.getAttribute('datetime') || t.getAttribute('content') || t.textContent);
    var d = el.querySelector('time,[class*="date" i]');
    return d ? text(d) : '';
  }

  function extractReviews(doc) {
    var rows = [], meta = {};
    // 1) JSON-LD
    jsonLd(doc).forEach(function (n) {
      if (ldType(n, 'Review')) {
        var a = n.author; a = a && (a.name || a);
        rows.push([typeof a === 'string' ? clean(a) : '', n.reviewRating ? String(n.reviewRating.ratingValue || '') : '', clean(n.name || ''), clean(n.datePublished || ''), clean(n.reviewBody || n.description || '')]);
      }
      if (ldType(n, 'AggregateRating') && n.ratingValue) meta.aggregate = { rating: n.ratingValue, count: n.reviewCount || n.ratingCount || '' };
    });
    // 2) schema.org microdata
    doc.querySelectorAll('[itemtype*="schema.org/Review" i]').forEach(function (el) {
      if (/AggregateRating/i.test(el.getAttribute('itemtype') || '')) return;
      var au = el.querySelector('[itemprop="author"]');
      var nm = el.querySelector('[itemprop="name"]:not([itemprop="author"] *)');
      rows.push([
        au ? clean(au.getAttribute('content') || au.textContent) : '',
        ratingFrom(el),
        nm && nm !== au ? text(nm) : '',
        dateFrom(el),
        text(el.querySelector('[itemprop="reviewBody"],[itemprop="description"]'))
      ]);
    });
    // 3) class heuristics — leaf-most [class*=review] blocks that have real prose
    var cand = Array.prototype.filter.call(doc.querySelectorAll('[class*="review" i],[class*="testimonial" i],[id^="review" i]'), function (el) {
      if (el.matches('[itemtype*="schema.org/Review" i]')) return false;
      if (el.closest('[itemtype*="schema.org/Review" i]')) return false;
      // skip wrappers ("reviews", "review-list") and fragments ("review-author", "review-text")
      var tokens = ((typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '')).split(/\s+/)
        .filter(function (t) { return /review|testimonial/i.test(t); });
      var PART = /^(reviews|testimonials)$|^reviews?[-_](list|summary|count|title|author|text|date|body|stars?|rating|header|meta|form|section|wrapper|container|grid|heading|score|average)$|^reviewer/i;
      if (tokens.length && tokens.every(function (t) { return PART.test(t); })) return false;
      return clean(el.textContent).length >= 25;
    });
    cand = cand.filter(function (c) { return !cand.some(function (o) { return o !== c && c.contains(o); }); });
    // if everything collapsed to tiny inner pieces, climb to their shared parent
    cand.forEach(function (el) {
      var au = el.querySelector('[itemprop="author"],[class*="author" i],[class*="user" i],[class*="reviewer" i],cite');
      var body = el.querySelector('[class*="text" i],[class*="body" i],[class*="content" i],[class*="comment" i],[itemprop="reviewBody"]');
      var bodyT = body ? text(body) : '';
      if (!bodyT) {
        var ps = Array.prototype.map.call(el.querySelectorAll('p,q,blockquote'), text).sort(function (a, b) { return b.length - a.length; });
        bodyT = ps[0] || '';
      }
      if (!bodyT) {
        var all = clean(el.textContent);
        if (all.length > 400) return;
        bodyT = all;
      }
      var tt = el.querySelector('[class*="title" i],[class*="headline" i],h3,h4,h5');
      rows.push([au ? text(au) : '', ratingFrom(el), tt && tt !== body ? text(tt) : '', dateFrom(el), bodyT]);
    });
    rows = dedupeBy(rows, function (r) { return (r[4] || r[2]).slice(0, 120).toLowerCase() + '|' + r[0].toLowerCase(); });
    // aggregate rating fallback from microdata
    if (!meta.aggregate) {
      var agg = doc.querySelector('[itemprop="aggregateRating"],[itemtype*="AggregateRating" i]');
      if (agg) {
        var rv = agg.querySelector('[itemprop="ratingValue"]'), rc = agg.querySelector('[itemprop="reviewCount"],[itemprop="ratingCount"]');
        if (rv) meta.aggregate = { rating: clean(rv.getAttribute('content') || rv.textContent), count: rc ? clean(rc.getAttribute('content') || rc.textContent) : '' };
      }
    }
    return result(['Author', 'Rating', 'Title', 'Date', 'Review'], rows, meta);
  }

  /* ----------------------------------------------------------------- social */
  var SOCIAL = [
    ['Facebook', /(^|\.)facebook\.com$|(^|\.)fb\.com$/i],
    ['Twitter / X', /(^|\.)twitter\.com$|(^|\.)x\.com$/i],
    ['Instagram', /(^|\.)instagram\.com$/i],
    ['LinkedIn', /(^|\.)linkedin\.com$/i],
    ['YouTube', /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i],
    ['TikTok', /(^|\.)tiktok\.com$/i]
  ];
  var SHARE = /(sharer|share|intent|dialog|plugins|login|signup|oauth|privacy|policy|terms|help|about\/|legal|ads|business\.|embed|watch\?|hashtag|search|explore|\/p\/|\/reel\/|\/status\/)/i;

  function socialInfo(url) {
    var u;
    try { u = new URL(url); } catch (e) { return null; }
    var host = u.hostname.replace(/^www\.|^m\./, '');
    for (var i = 0; i < SOCIAL.length; i++) {
      if (!SOCIAL[i][1].test(host)) continue;
      var path = u.pathname.replace(/\/+$/, '');
      if (!path || path === '/') return null;                                // bare homepage
      if (SHARE.test(path + u.search)) return null;
      var seg = path.split('/').filter(Boolean), handle = seg[0];
      if (/^(company|in|school|showcase|pub|channel|user|c|groups|pages)$/i.test(handle) && seg[1]) handle = seg[1];
      handle = decodeURIComponent(handle).replace(/^@/, '');
      return { platform: SOCIAL[i][0], handle: handle, url: u.origin + path };
    }
    return null;
  }

  function extractSocial(doc, base) {
    var urls = [];
    doc.querySelectorAll('a[href]').forEach(function (a) { urls.push(abs(a.getAttribute('href'), base)); });
    jsonLd(doc).forEach(function (n) {
      [].concat(n.sameAs || []).forEach(function (s) { if (typeof s === 'string') urls.push(s); });
    });
    doc.querySelectorAll('meta[name="twitter:site"],meta[name="twitter:creator"]').forEach(function (m) {
      var h = clean(m.getAttribute('content')).replace(/^@/, '');
      if (h) urls.push('https://twitter.com/' + h);
    });
    doc.querySelectorAll('meta[property="article:author"],meta[property="og:see_also"]').forEach(function (m) { urls.push(m.getAttribute('content') || ''); });
    var items = urls.map(socialInfo).filter(Boolean);
    items = dedupeBy(items, function (i) { return i.platform + '|' + i.handle.toLowerCase(); });
    var order = SOCIAL.map(function (s) { return s[0]; });
    items.sort(function (a, b) { return order.indexOf(a.platform) - order.indexOf(b.platform); });
    return result(['Platform', 'Handle', 'URL'], items.map(function (i) { return [i.platform, i.handle, i.url]; }));
  }

  /* ----------------------------------------------------------------- people */
  var NAME_SEL = '[itemprop="name"],[class*="name" i],h2,h3,h4,h5,strong';
  var JOB_SEL = '[class*="job" i],[class*="role" i],[class*="position" i],[class*="designation" i],[itemprop="jobTitle"],[class*="title" i]';

  function looksLikeName(s) {
    s = clean(s);
    if (s.length < 3 || s.length > 60) return false;
    var words = s.split(' ');
    if (words.length < 2 || words.length > 5) return false;
    if (/\d|@|https?:/i.test(s)) return false;
    return /^[\p{Lu}][\p{L}'’.-]+/u.test(words[0]);
  }

  function firstName(card) {
    var els = card.querySelectorAll('[itemprop="name"],[class*="name" i]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (/company|business|org|brand|file|user-?name|nick/i.test(el.className || '')) continue;
      if (looksLikeName(el.textContent)) return el;
    }
    var heads = card.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b');
    for (var j = 0; j < heads.length; j++) if (looksLikeName(heads[j].textContent)) return heads[j];
    return null;
  }

  function extractPeople(doc, base) {
    var rows = [];
    var groups = [JOB_SEL, '[itemprop="name"],[class*="name" i],h2,h3,h4,h5,h6,strong,b'];
    var cards = findCards(doc, JOB_SEL, groups, 520).filter(function (c) { return !!firstName(c); });
    cards.forEach(function (c) {
      var nameEl = firstName(c);
      var name = text(nameEl);
      var jobEl = null;
      var preferred = c.querySelector('[itemprop="jobTitle"],[class*="job" i],[class*="role" i],[class*="position" i],[class*="designation" i]');
      if (preferred && preferred !== nameEl && !preferred.contains(nameEl)) jobEl = preferred;
      if (!jobEl) {
        var all = c.querySelectorAll('[class*="title" i]');
        for (var i = 0; i < all.length; i++) if (all[i] !== nameEl && !all[i].contains(nameEl) && !nameEl.contains(all[i])) { jobEl = all[i]; break; }
      }
      if (!jobEl) return;
      var job = text(jobEl);
      if (!job || job === name || job.length > 100) return;
      var mail = c.querySelector('a[href^="mailto:" i]'), tel = c.querySelector('a[href^="tel:" i]');
      var li = c.querySelector('a[href*="linkedin.com" i]');
      var co = c.querySelector('[class*="company" i],[class*="org" i],[itemprop="worksFor"]');
      var loc = c.querySelector('[class*="location" i],[class*="city" i],[itemprop="addressLocality"]');
      var img = c.querySelector('img');
      var prof = c.querySelector('a[href]:not([href^="mailto:"]):not([href^="tel:"])');
      rows.push([name, job,
        co && co !== nameEl && co !== jobEl ? text(co) : '',
        mail ? mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0] : '',
        tel ? text(tel) || tel.getAttribute('href').replace(/^tel:/i, '') : '',
        loc ? text(loc) : '',
        li ? abs(li.getAttribute('href'), base) : (prof ? abs(prof.getAttribute('href'), base) : ''),
        img ? abs(img.getAttribute('src') || img.getAttribute('data-src'), base) : '']);
    });
    // schema.org Person (microdata + JSON-LD)
    doc.querySelectorAll('[itemtype*="schema.org/Person" i]').forEach(function (el) {
      var n = el.querySelector('[itemprop="name"]'), j = el.querySelector('[itemprop="jobTitle"]');
      if (n) rows.push([text(n), j ? text(j) : '', text(el.querySelector('[itemprop="worksFor"]')), text(el.querySelector('[itemprop="email"]')), text(el.querySelector('[itemprop="telephone"]')), text(el.querySelector('[itemprop="addressLocality"]')), abs((el.querySelector('[itemprop="url"],[itemprop="sameAs"]') || {}).href || '', base), '']);
    });
    jsonLd(doc).forEach(function (n) {
      if (ldType(n, 'Person') && n.name) {
        rows.push([clean(n.name), clean(n.jobTitle || ''), clean((n.worksFor && (n.worksFor.name || n.worksFor)) || ''), clean(n.email || ''), clean(n.telephone || ''), ldAddress(n.address), typeof n.url === 'string' ? n.url : '', typeof n.image === 'string' ? n.image : '']);
      }
    });
    rows = dedupeBy(rows, function (r) { return (r[0] + '|' + r[1]).toLowerCase(); });
    return result(['Name', 'Job Title', 'Company', 'Email', 'Phone', 'Location', 'Profile URL', 'Image URL'], rows);
  }

  /* --------------------------------------------------------------- business */
  var CO_SEL = '[class*="company" i],[class*="business" i],[itemprop="legalName"]';
  var ADDR_SEL = '[class*="address" i],address,[itemprop="address"]';
  var IND_SEL = '[class*="industry" i],[class*="sector" i],[class*="category" i]';

  function stripLabel(s) { return clean(s).replace(/^(industry|sector|address|company|phone|email|category|location)\s*[:\-–]\s*/i, ''); }

  function businessRecords(doc, base) {
    var recs = [];
    // JSON-LD organisations
    jsonLd(doc).forEach(function (n) {
      if (ldType(n, 'Organization|LocalBusiness|Corporation|Store|Restaurant|ProfessionalService|[A-Za-z]*Business|[A-Za-z]*Shop')) {
        if (!n.name) return;
        recs.push({
          name: clean(n.name), industry: clean(n.industry || n.knowsAbout || n['@type'] && [].concat(n['@type']).filter(function (t) { return !/^(Organization|LocalBusiness|Corporation|Thing)$/i.test(t); }).join(', ') || ''),
          address: ldAddress(n.address), phone: clean(n.telephone || ''), email: clean(n.email || ''),
          website: clean(n.url || ''), description: clean(n.description || ''), src: 'json-ld'
        });
      }
    });
    // Repeated listing cards (directories)
    var CO_NAME = '[class*="company-name" i],[class*="companyname" i],[class*="business-name" i],[class*="org-name" i],[itemprop="legalName"],' +
      ':is(h1,h2,h3,h4,h5,h6,a,strong,b)[class*="company" i],:is(h1,h2,h3,h4,h5,h6,a,strong,b)[class*="business" i]';
    var cards = findCards(doc, CO_NAME, [ADDR_SEL + ',' + IND_SEL + ',a[href^="tel:" i]'], 1400);
    cards.forEach(function (c) {
      var nm = c.querySelector(CO_NAME) || (c.matches(CO_NAME) ? c : null);
      var name = nm ? text(nm.querySelector('h1,h2,h3,h4,a') || nm) : '';
      if (!name || name.length > 120) return;
      var addr = c.querySelector(ADDR_SEL), ind = c.querySelector(IND_SEL);
      var tel = c.querySelector('a[href^="tel:" i]'), mail = c.querySelector('a[href^="mailto:" i]');
      var site = c.querySelector('a[href^="http"]:not([href*="linkedin" i]):not([href*="facebook" i]):not([href*="twitter" i])');
      recs.push({
        name: name, industry: ind ? stripLabel(text(ind)) : '', address: addr ? stripLabel(text(addr)) : '',
        phone: tel ? text(tel) || tel.getAttribute('href').replace(/^tel:/i, '') : '',
        email: mail ? mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0] : '',
        website: site ? abs(site.getAttribute('href'), base) : '', description: '', src: 'listing'
      });
    });
    // Page-level microdata / heuristics
    var mb = doc.querySelector('[itemtype*="schema.org/LocalBusiness" i],[itemtype*="schema.org/Organization" i],[itemtype*="schema.org/Corporation" i]');
    if (mb && !cards.some(function (c) { return mb.contains(c); })) {
      var n2 = mb.querySelector('[itemprop="name"]');
      if (n2) recs.push({
        name: text(n2), industry: stripLabel(text(mb.querySelector(IND_SEL))), address: stripLabel(text(mb.querySelector('[itemprop="address"],address'))),
        phone: text(mb.querySelector('[itemprop="telephone"]')) || ((mb.querySelector('a[href^="tel:" i]') || { getAttribute: function () { return ''; } }).getAttribute('href') || '').replace(/^tel:/i, ''),
        email: text(mb.querySelector('[itemprop="email"]')) || (((mb.querySelector('a[href^="mailto:" i]') || { getAttribute: function () { return ''; } }).getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0]),
        website: '', description: '', src: 'microdata'
      });
    }
    if (!recs.length) {
      var site = doc.querySelector('meta[property="og:site_name"]');
      var name = (site && clean(site.getAttribute('content'))) || (doc.querySelector(CO_SEL) && text(doc.querySelector(CO_SEL))) || clean((doc.title || '').split(/[|\-–—·]/).pop());
      var addr = doc.querySelector(ADDR_SEL), ind = doc.querySelector(IND_SEL);
      var tel = doc.querySelector('a[href^="tel:" i]'), mail = doc.querySelector('a[href^="mailto:" i]');
      var hasSignal = name && (addr || ind || tel || mail);
      if (hasSignal) recs.push({
        name: name, industry: ind ? stripLabel(text(ind)) : '', address: addr ? stripLabel(text(addr)) : '',
        phone: tel ? text(tel) || tel.getAttribute('href').replace(/^tel:/i, '') : '',
        email: mail ? mail.getAttribute('href').replace(/^mailto:/i, '').split('?')[0] : '',
        website: '', description: '', src: 'page'
      });
    }
    // merge records that describe the same business (JSON-LD + HTML)
    var merged = [];
    recs.forEach(function (r) {
      var key = r.name.toLowerCase();
      var m = merged.find(function (x) { return x.name.toLowerCase() === key; });
      if (!m) { merged.push(r); return; }
      ['industry', 'address', 'phone', 'email', 'website', 'description'].forEach(function (f) { if (!m[f] && r[f]) m[f] = r[f]; });
    });
    var origin = ''; try { origin = new URL(base).origin; } catch (e) { origin = ''; }
    merged.forEach(function (r) { if (!r.website && origin && /^https?:/.test(origin)) r.website = origin; });
    return merged;
  }

  function extractBusiness(doc, base) {
    var recs = businessRecords(doc, base);
    return result(['Company', 'Industry', 'Address', 'Phone', 'Email', 'Website', 'Description'],
      recs.map(function (r) { return [r.name, r.industry, r.address, r.phone, r.email, r.website, r.description]; }));
  }

  /* -------------------------------------------------------------------- b2b */
  function matchOne(textBlob, res) {
    for (var i = 0; i < res.length; i++) { var m = textBlob.match(res[i]); if (m) return clean(m[1] || m[0]); }
    return '';
  }

  function extractB2B(doc, base) {
    var biz = businessRecords(doc, base);
    var people = extractPeople(doc, base).rows;
    var blob = clean(bodyText(doc));
    var fromClass = function (sel) { var e = doc.querySelector(sel); return e ? stripLabel(text(e)) : ''; };

    var employees = fromClass('[class*="employee" i],[class*="company-size" i],[class*="headcount" i],[class*="staff" i]') ||
      matchOne(blob, [/(\d[\d,]*\+?\s*(?:-|–|to)?\s*\d*[\d,]*\+?)\s*(?:employees|staff|team members|people|associates)/i, /(?:employees|company size|headcount|team size)\s*[:\-–]?\s*(\d[\d,]*\+?(?:\s*(?:-|–|to)\s*\d[\d,]*\+?)?)/i]);
    var revenue = fromClass('[class*="revenue" i],[class*="turnover" i]') ||
      matchOne(blob, [/(?:annual\s+)?revenue\s*(?:of|:|\-|–)?\s*((?:US)?[$€£]\s?\d[\d.,]*\s?(?:k|m|mn|b|bn|million|billion)?)/i, /((?:US)?[$€£]\s?\d[\d.,]*\s?(?:k|m|mn|b|bn|million|billion))\s*(?:in\s+)?(?:annual\s+)?revenue/i]);
    revenue = revenue.replace(/^annual revenue\s*[:\-–]?\s*/i, '');
    var founded = matchOne(blob, [/(?:founded|established|since|est\.?)\s*(?:in\s+)?((?:19|20)\d{2})/i]);

    var companies = biz.length ? biz : [{ name: clean(doc.title), industry: '', address: '', phone: '', email: '', website: '' }];
    var rows = [];
    companies.forEach(function (co) {
      var base_ = [co.name, co.industry, employees, revenue, founded, co.website, co.address, co.phone || '', co.email || ''];
      if (people.length) {
        people.forEach(function (p) { rows.push(base_.concat([p[0], p[1], p[3], p[4], p[6]])); });
      } else {
        rows.push(base_.concat(['', '', '', '', '']));
      }
    });
    return result(['Company', 'Industry', 'Employees', 'Revenue', 'Founded', 'Website', 'Address', 'Company Phone', 'Company Email',
      'Contact Name', 'Contact Title', 'Contact Email', 'Contact Phone', 'Contact Profile'], rows, { companies: companies.length, contacts: people.length });
  }

  /* --------------------------------------------------------------- registry */
  var MODES = {
    table:    { id: 'table',    label: 'Auto Table',        icon: 'table',     desc: 'Detects the largest repeating table or list on the page.', view: 'table' },
    email:    { id: 'email',    label: 'Email Extractor',   icon: 'mail',      desc: 'Finds every email address in text, mailto links and obfuscated forms.', view: 'list', primary: 0, secondary: 1, run: extractEmails },
    phone:    { id: 'phone',    label: 'Phone Extractor',   icon: 'phone',     desc: 'Pulls phone numbers from page text and tel: links.', view: 'list', primary: 0, secondary: 1, run: extractPhones },
    links:    { id: 'links',    label: 'Links Extractor',   icon: 'link',      desc: 'Collects unique absolute links with their anchor text.', view: 'list', primary: 0, secondary: 1, run: extractLinks },
    images:   { id: 'images',   label: 'Image Downloader',  icon: 'image',     desc: 'Lists every image (img, srcset, CSS backgrounds) and zips the ones you pick.', view: 'images', run: extractImages },
    text:     { id: 'text',     label: 'Page Text',         icon: 'file-text', desc: 'Clean readable text without scripts, navigation or footers.', view: 'text', run: extractText },
    reviews:  { id: 'reviews',  label: 'Reviews / Ratings', icon: 'star',      desc: 'Reviewer, star rating, date and review body.', view: 'reviews', run: extractReviews },
    people:   { id: 'people',   label: 'People',            icon: 'user',      desc: 'Names, job titles, emails, phones and profile links.', view: 'table', run: extractPeople },
    business: { id: 'business', label: 'Business',          icon: 'building',  desc: 'Company name, industry, address and contact details.', view: 'table', run: extractBusiness },
    social:   { id: 'social',   label: 'Social',            icon: 'globe',     desc: 'Facebook, X/Twitter, Instagram, LinkedIn, YouTube and TikTok profiles.', view: 'list', primary: 2, secondary: 0, run: extractSocial },
    b2b:      { id: 'b2b',      label: 'B2B',               icon: 'briefcase', desc: 'Company + contacts + size, revenue and founding year in one lead row.', view: 'table', run: extractB2B }
  };

  /** Landing/catalog presets (?preset=...) → mode ids */
  var PRESETS = { email: 'email', phone: 'phone', business: 'business', people: 'people', social: 'social', b2b: 'b2b',
    review: 'reviews', reviews: 'reviews', text: 'text', table: 'table', links: 'links', images: 'images', image: 'images' };

  Sieve.extractors = {
    MODES: MODES,
    PRESETS: PRESETS,
    ORDER: ['table', 'email', 'phone', 'links', 'images', 'text', 'reviews', 'people', 'business', 'social', 'b2b'],
    run: function (mode, doc, base) {
      var m = MODES[mode];
      if (!m || !m.run) throw new Error('Unknown extractor: ' + mode);
      return m.run(doc, base);
    },
    // exposed for tests / reuse
    util: { clean: clean, abs: abs, bodyText: bodyText, dedupeBy: dedupeBy, jsonLd: jsonLd, cols: cols, result: result },
    emails: extractEmails, phones: extractPhones, links: extractLinks, images: extractImages, text: extractText,
    reviews: extractReviews, social: extractSocial, people: extractPeople, business: extractBusiness, b2b: extractB2B
  };

})(window);
