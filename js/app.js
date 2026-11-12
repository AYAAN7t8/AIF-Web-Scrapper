/* ==========================================================================
   Sieve — app.js  (controller for app.html)
   Wires the URL bar, mode sidebar, options, preview, results views, crawl
   controls, bulk tab, exports and the inspector together.
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve, util = Sieve.util, esc = util.esc;
  var MODES = Sieve.extractors.MODES, ORDER = Sieve.extractors.ORDER;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var UNIT = { table: 'rows', email: 'emails', phone: 'phone numbers', links: 'links', images: 'images', text: 'text blocks',
    reviews: 'reviews', people: 'people', business: 'businesses', social: 'profiles', b2b: 'leads' };
  var SINGULAR = { table: 'row', email: 'email', phone: 'phone number', links: 'link', images: 'image', text: 'text block',
    reviews: 'review', people: 'person', business: 'business', social: 'profile', b2b: 'lead' };
  var VIEW_LABEL = { list: 'List', images: 'Gallery', text: 'Reader', reviews: 'Reviews' };
  var NONE_HINT = {
    table: 'No table or repeating list was detected in the HTML we received. If the page builds its content with JavaScript, enable the proxy (rendered mode) or paste the rendered HTML.',
    email: 'No email addresses appear on this page. Contact details are often on a /contact or /about page — try that URL.',
    phone: 'No phone numbers were found. Try the site\'s /contact page.',
    links: 'No usable links were found on this page.',
    images: 'No images were found in the HTML. Lazy-loaded galleries may need the proxy (rendered mode).',
    text: 'No readable text was found. The page may be rendered client-side — try the proxy or paste rendered HTML.',
    reviews: 'No reviews or ratings were detected. Reviews are often loaded by JavaScript or an embedded widget.',
    people: 'No people were detected. Sieve looks for repeated cards that contain a name and a job title / role.',
    business: 'No business details were found (company name with an address, industry or phone).',
    social: 'No social profile links were found on this page.',
    b2b: 'No company details were found. Try the About or Contact page of the site.'
  };

  var S = {
    mode: 'table', pane: 'single', view: 'primary',
    ds: new Sieve.Dataset(),
    ctrl: null, running: false,
    first: null, lastPage: null, visited: new Set(), template: null, pages: 0, candIdx: 0,
    started: 0, elapsed: 0, timer: 0,
    table: null, schema: null, grid: null, altRaf: 0
  };

  /* ------------------------------------------------------------ option state */
  function readOpts() {
    var num = function (id, d, min, max) { var v = parseInt($(id).value, 10); if (isNaN(v)) v = d; return Math.min(max || 1e9, Math.max(min == null ? 0 : min, v)); };
    return {
      delay: num('#opt-delay', 1000, 0, 60000), maxPages: num('#opt-max', 10, 1, 500), timeout: num('#opt-wait', 15000, 1000, 120000),
      follow: $('#opt-follow').checked, scroll: $('#opt-scroll').checked, dedupe: $('#opt-dedupe').checked
    };
  }
  function saveOpts() {
    var o = readOpts();
    Sieve.store.set('opts', { delay: $('#opt-delay').value, max: $('#opt-max').value, wait: $('#opt-wait').value, follow: o.follow, scroll: o.scroll, dedupe: o.dedupe });
  }
  function loadOpts() {
    var o = Sieve.store.get('opts', null);
    if (o) {
      $('#opt-delay').value = o.delay; $('#opt-max').value = o.max; $('#opt-wait').value = o.wait;
      $('#opt-follow').checked = !!o.follow; $('#opt-scroll').checked = !!o.scroll; $('#opt-dedupe').checked = o.dedupe !== false;
    }
    var p = Sieve.scraper.proxy.get();
    $('#proxy-on').checked = p.enabled; $('#proxy-url').value = p.url;
    if (!window.__proxyUiSynced) { window.__proxyUiSynced = true; Sieve.scraper.proxy.ready.then(function () { var q = Sieve.scraper.proxy.get(); $('#proxy-on').checked = q.enabled; $('#proxy-url').value = q.url; }); }
    S.ds.dedupe = $('#opt-dedupe').checked;
  }

  /* ---------------------------------------------------------------- UI state */
  function setStatus(status, label) { Sieve.ui.statusPill($('#status-pill'), status, label); }

  function setState(name) {
    $$('#results-card [data-state]').forEach(function (el) { el.hidden = el.getAttribute('data-state') !== name; });
    if (name === 'data') scheduleAlt();
    $('#results-card').setAttribute('data-state-now', name);
    updateViewChrome();
  }

  function showLoading() {
    $('[data-state=loading]').innerHTML = Sieve.ui.skeletonTable(6, 9);
    setState('loading');
  }

  function showError(err, url) {
    var m = {
      cors: ['Couldn\'t read that page', err.message + ' Use the demo data, paste the page\'s HTML, or run the local proxy (it fetches server-side, so CORS does not apply).'],
      timeout: ['That took too long', err.message],
      http: ['The site returned an error', err.message],
      type: ['Not an HTML page', err.message],
      proxy: ['Proxy problem', err.message],
      robots: ['Blocked by robots.txt', err.message],
      'invalid-url': ['Check the URL', err.message]
    }[err.code] || ['Something went wrong', err.message || String(err)];
    if (err.code === 'http' && [401, 403, 429, 503].indexOf(err.status) !== -1) {
      m = ['This site blocks automated scraping', (err.status === 429 ? 'The site says too many requests. Wait a while and retry with a longer delay. ' : 'The site answered ' + err.status + ': it uses bot protection or needs a login, and Sieve does not evade that. ') +
        'Open the page in your own browser, then use "Paste page HTML" (View Source, copy, paste) to extract the data you can already see. Or use the site\x27s official API/export.'];
    }
    $('#err-title').textContent = m[0];
    $('#err-msg').textContent = m[1];
    var open = $('#err-open');
    if (/^https?:/i.test(url || '')) { open.href = url; open.hidden = false; } else open.hidden = true;
    setState('error');
    setStatus('error', 'Error');
  }

  function updateViewChrome() {
    var def = MODES[S.mode], hasData = S.ds.totalRows() > 0;
    // view tabs
    var tabs = $('#view-tabs');
    if (def.view !== 'table' && hasData) {
      var cur = effectiveView();
      tabs.hidden = false;
      tabs.innerHTML = '<button class="tab" role="tab" type="button" data-view="primary" aria-selected="' + (cur === 'primary') + '">' + VIEW_LABEL[def.view] + '</button>' +
        '<button class="tab" role="tab" type="button" data-view="table" aria-selected="' + (cur === 'table') + '">Table</button>';
    } else { tabs.hidden = true; tabs.innerHTML = ''; }
    // try-another
    var tbtn = $('#try-another'), cands = S.first && S.first.res.meta.candidates;
    if (S.mode === 'table' && cands && cands.length > 1 && hasData && !S.running) {
      tbtn.hidden = false; $('#try-label').textContent = 'Try another table (' + (S.candIdx + 1) + '/' + cands.length + ')';
    } else tbtn.hidden = true;
    renderViewActions();
    $('#results-title').textContent = 'Results';
    var n = S.ds.rowCount();
    $('#results-count').textContent = util.fmtNum(n) + ' ' + (n === 1 ? SINGULAR[S.mode] : UNIT[S.mode]);
  }

  function effectiveView() { return MODES[S.mode].view === 'table' ? 'table' : S.view; }

  function renderViewActions() {
    var host = $('#view-actions'), def = MODES[S.mode], view = effectiveView(), hasData = S.ds.rowCount() > 0;
    var html = '';
    if (hasData && view === 'primary') {
      if (def.view === 'list') {
        html = '<button class="btn btn-xs" type="button" data-act="copy-all">' + Sieve.icons.svg('copy', 14) + 'Copy all</button>' +
          '<button class="btn btn-xs" type="button" data-act="txt">' + Sieve.icons.svg('download', 14) + 'Download .txt</button>';
      } else if (def.view === 'images') {
        var n = S.grid ? S.grid.selected.size : 0;
        html = '<button class="btn btn-xs" type="button" data-act="sel-all">Select all</button><button class="btn btn-xs" type="button" data-act="sel-none">Select none</button>' +
          '<button class="btn btn-xs btn-primary" type="button" data-act="zip"' + (n ? '' : ' disabled') + '>' + Sieve.icons.svg('download', 14) + 'Download Selected (ZIP)' + (n ? ' · ' + n : '') + '</button>' +
          '<button class="btn btn-xs" type="button" data-act="img-urls">' + Sieve.icons.svg('list', 14) + 'Save URL list</button>' +
          '<span class="meta" id="zip-progress"></span>';
      } else if (def.view === 'text') {
        html = '<button class="btn btn-xs" type="button" data-act="copy-text">' + Sieve.icons.svg('copy', 14) + 'Copy text</button>' +
          '<button class="btn btn-xs" type="button" data-act="txt-text">' + Sieve.icons.svg('download', 14) + 'Download .txt</button>';
      }
    }
    host.hidden = !html;
    if (html && host._html !== html) { host.innerHTML = html; host._html = html; }
    else if (!html) host._html = '';
  }

  /* Alternate (non-table) result views */
  function scheduleAlt() {
    if (S.altRaf) return;
    S.altRaf = requestAnimationFrame(function () { S.altRaf = 0; renderAlt(); });
  }
  function renderAlt() {
    var def = MODES[S.mode], alt = $('#alt-host'), tbl = $('#table-host'), view = effectiveView();
    var showAlt = def.view !== 'table' && view === 'primary';
    alt.hidden = !showAlt; tbl.hidden = showAlt;
    if (!showAlt) return;
    if (def.view === 'list') Sieve.ui.renderList(alt, S.ds, def);
    else if (def.view === 'images') {
      if (!S.grid) {                                   // fresh child host so listeners never stack
        alt.innerHTML = '';
        var gh = document.createElement('div');
        alt.appendChild(gh);
        S.grid = new Sieve.ui.ImageGrid(gh, S.ds, { onSelect: function () { renderViewActions(); } });
      } else S.grid.render();
    }
    else if (def.view === 'text') Sieve.ui.renderText(alt, S.ds);
    else if (def.view === 'reviews') Sieve.ui.renderReviews(alt, S.ds);
  }

  /* ----------------------------------------------------------------- stats */
  function updateStats() {
    var n = S.ds.rowCount(), total = S.ds.totalRows();
    $('#st-rows').textContent = util.fmtNum(n);
    $('#st-cols').textContent = util.fmtNum(S.ds.columns.filter(function (c) { return c.enabled; }).length);
    $('#st-pages').textContent = util.fmtNum(S.pages);
    $('#st-time').textContent = util.fmtDuration(S.elapsed);
    $('#sb-rows').textContent = util.fmtNum(n) + ' row' + (n === 1 ? '' : 's') + (total > n ? ' · ' + util.fmtNum(total - n) + ' duplicate' + (total - n === 1 ? '' : 's') + ' hidden' : '');
    var srcs = S.ds.sourceCount();
    $('#sb-src').textContent = srcs > 1 ? srcs + ' sources' : (S.pages > 1 ? S.pages + ' pages' : '');
    var has = n > 0;
    ['exp-csv', 'exp-xlsx', 'exp-copy', 'exp-sheets'].forEach(function (id) { $('#' + id).disabled = !has; });
  }

  function startTimer() {
    S.started = performance.now(); S.elapsed = 0;
    clearInterval(S.timer);
    S.timer = setInterval(function () { S.elapsed = performance.now() - S.started; $('#st-time').textContent = util.fmtDuration(S.elapsed); }, 150);
  }
  function stopTimer() { clearInterval(S.timer); S.elapsed = performance.now() - S.started; updateStats(); }

  function setRunning(on) {
    S.running = on;
    $('#fetch-label').textContent = on ? 'Stop' : 'Fetch';
    $('#fetch-btn').firstElementChild.setAttribute('data-icon', on ? 'square' : 'play');
    $('#fetch-btn').firstElementChild.innerHTML = Sieve.icons.svg(on ? 'square' : 'play', 16);
    $('#btn-stop').hidden = !on;
    $('#bulk-stop').hidden = !on || S.pane !== 'bulk';
    $('#bulk-run').disabled = on;
    updateCrawlButtons();
  }

  function setProgress(pct, indeterminate) {
    var p = $('#crawl-progress');
    p.hidden = pct == null && !indeterminate;
    p.classList.toggle('is-indeterminate', !!indeterminate);
    if (pct != null) p.firstElementChild.style.width = Math.round(pct * 100) + '%';
  }

  function updateCrawlButtons() {
    var o = readOpts(), next = S.lastPage && S.lastPage.next;
    var hasNext = !!(next && next.url);
    $('#crawl-label').textContent = 'Crawl All Pages (' + o.maxPages + ')';
    $('#btn-next').disabled = S.running || !hasNext || S.pane !== 'single';
    $('#btn-crawl').disabled = S.running || S.pane !== 'single' || (!!S.lastPage && !hasNext);
    $('#crawl-tools').hidden = S.pane !== 'single';
    var meta = $('#crawl-meta');
    if (S.running) return;
    if (!S.lastPage) meta.textContent = '';
    else if (hasNext) meta.textContent = 'Next page found via ' + next.via;
    else if (next && next.needsJs) meta.textContent = 'Next page needs JavaScript (' + next.via + ') — enable the proxy.';
    else meta.textContent = 'No further pages detected.';
  }

  function updateBanners() {
    var o = readOpts(), p = Sieve.scraper.proxy.get(), host = $('#banners'), html = '';
    if (o.scroll && !p.enabled) {
      html += '<div class="banner banner-warning" role="status">' + Sieve.icons.svg('scroll', 16) + '<div><strong>Infinite scroll needs the optional proxy — see README.</strong> Without it Sieve only reads the first screenful of HTML the server sends.</div>' +
        '<div class="banner-actions"><button class="btn btn-xs" type="button" data-action="proxy-help">Set up proxy</button></div></div>';
    }
    host.innerHTML = html;
  }

  /* ----------------------------------------------------------- preview iframe */
  function setPreview(r, cand) {
    var frame = $('#preview-iframe'), ph = $('#preview-ph'), badge = $('#preview-badge');
    if (!r) { frame.hidden = true; ph.hidden = false; badge.textContent = 'no page'; frame.removeAttribute('srcdoc'); return; }
    try {
      frame.srcdoc = Sieve.scraper.previewHtml(r.doc, r.page.finalUrl, cand);
      frame.hidden = false; ph.hidden = true;
      badge.textContent = (r.page.via === 'demo' ? 'demo page' : util.host(r.page.finalUrl) || 'pasted HTML') + ' · ' + util.fmtNum(Math.round(r.page.html.length / 1024)) + ' KB';
    } catch (e) { frame.hidden = true; ph.hidden = false; badge.textContent = 'preview unavailable'; }
  }

  /* ------------------------------------------------------------------ running */
  function resetRun() {
    S.ds.reset();
    S.first = null; S.lastPage = null; S.visited = new Set(); S.template = null; S.pages = 0; S.candIdx = 0; S.grid = null;
    S.view = 'primary';
    $('#alt-host').innerHTML = '';
  }

  function onPage(info) {
    S.pages = info.page;
    S.lastPage = info.result;
    if (!S.first) {
      S.first = info.result;
      setPreview(info.result, info.result.res.meta.candidate);
      if (info.rows) { setState('data'); }
    }
    setProgress(info.max > 1 ? info.page / info.max : null, info.max <= 1);
    $('#crawl-meta').textContent = 'Page ' + info.page + (info.max > 1 ? ' of ' + info.max : '') + ' · ' + util.fmtNum(info.total) + ' rows';
    setStatus('fetching', 'Page ' + info.page);
    updateStats(); updateViewChrome();
  }

  function finishUi(result, startedAt, opts) {
    stopTimer(); setRunning(false); setProgress(null);
    var n = S.ds.rowCount();
    if (!n) {
      var def = MODES[S.mode];
      $('#none-title').textContent = 'No ' + (UNIT[S.mode] || 'results') + ' found';
      $('#none-msg').textContent = NONE_HINT[S.mode];
      setState('none'); setStatus('success', 'No data');
    } else {
      setState('data');
      setStatus('success', util.fmtNum(n) + ' ' + (n === 1 ? SINGULAR[S.mode] : UNIT[S.mode]));
    }
    if (result && result.stopped === 'needs-js') Sieve.toast('Next page is a JavaScript button — enable the proxy to follow it.', 'warning', 5000);
    if (result && result.stopped === 'error') Sieve.toast('Crawl stopped early — see the message under the table.', 'warning');
    updateStats(); updateViewChrome(); updateCrawlButtons();
  }

  /**
   * Fetch (and optionally crawl) the URL in the input.
   * ov: { url, html, follow }
   */
  async function run(ov) {
    ov = ov || {};
    if (S.running) { stopRun(); return; }
    var raw = ov.url != null ? ov.url : $('#url-input').value;
    var url = util.normalizeUrl(raw);
    if (!url) { showError({ code: 'invalid-url', message: raw ? 'That does not look like a valid http(s) URL. Example: https://example.com/products' : 'Enter a URL first, or load the demo data.' }, ''); $('#url-input').focus(); return; }
    $('#url-input').value = ov.html != null ? $('#url-input').value || url : url;
    setPane('single');
    var o = readOpts();
    resetRun(); S.ds.setDedupe(o.dedupe);
    S.ctrl = new AbortController();
    setRunning(true); startTimer(); showLoading(); setStatus('fetching', 'Fetching…'); setPreview(null);
    setProgress(null, true); $('#crawl-meta').textContent = 'Fetching…';
    updateStats();
    var follow = ov.follow != null ? ov.follow : o.follow;
    var px = Sieve.scraper.proxy.get();
    try {
      var r = await Sieve.scraper.crawl(url, S.mode, {
        dataset: S.ds, followPagination: follow, maxPages: o.maxPages, delay: o.delay, timeout: o.timeout,
        scroll: o.scroll && px.enabled, maxScrolls: 30, signal: S.ctrl.signal, startHtml: ov.html, proxy: px, candidateIndex: 0
      }, { onPage: onPage, onLog: function (m) { $('#crawl-meta').textContent = m; } });
      S.template = r.template; S.visited = r.visited; if (r.last) S.lastPage = r.last;
      finishUi(r);
    } catch (err) {
      stopTimer(); setRunning(false); setProgress(null);
      if (err.code === 'aborted') { setState(S.ds.rowCount() ? 'data' : 'empty'); setStatus('idle', 'Cancelled'); updateViewChrome(); updateCrawlButtons(); return; }
      showError(err, url);
      updateCrawlButtons();
    }
  }

  function stopRun() {
    if (S.ctrl) S.ctrl.abort();
  }

  /** Scrape the next page and append its rows. */
  async function scrapeNext(follow) {
    var next = S.lastPage && S.lastPage.next;
    if (!next || !next.url || S.running) return;
    var o = readOpts();
    var remaining = o.maxPages - S.pages;
    if (follow && remaining <= 0) { Sieve.toast('Max pages (' + o.maxPages + ') reached — raise it in Options to keep going.', 'warning', 5000); return; }
    S.ctrl = new AbortController();
    setRunning(true); setStatus('fetching', 'Page ' + (S.pages + 1));
    var t0 = performance.now() - S.elapsed; S.started = t0; clearInterval(S.timer);
    S.timer = setInterval(function () { S.elapsed = performance.now() - S.started; $('#st-time').textContent = util.fmtDuration(S.elapsed); }, 150);
    setProgress(follow ? S.pages / o.maxPages : null, !follow);
    try {
      var r = await Sieve.scraper.crawl(next.url, S.mode, {
        dataset: S.ds, followPagination: !!follow, maxPages: follow ? remaining : 1, delay: o.delay, timeout: o.timeout,
        signal: S.ctrl.signal, proxy: Sieve.scraper.proxy.get(), template: S.template, visited: S.visited, pageOffset: S.pages
      }, { onPage: function (info) {
        S.pages = info.page; S.lastPage = info.result;
        setProgress(follow ? info.page / (S.pages + Math.max(0, o.maxPages - info.page)) : null, !follow);
        $('#crawl-meta').textContent = 'Page ' + info.page + (follow ? ' of ' + o.maxPages : '') + ' · ' + util.fmtNum(info.total) + ' rows';
        setStatus('fetching', 'Page ' + info.page); updateStats(); updateViewChrome();
      }, onLog: function (m) { $('#crawl-meta').textContent = m; } });
      if (r.last) S.lastPage = r.last;
      finishUi(r);
    } catch (err) {
      stopTimer(); setRunning(false); setProgress(null);
      if (err.code !== 'aborted') { Sieve.toast(err.message, 'error', 6000); setStatus('error', 'Error'); }
      else setStatus('idle', 'Cancelled');
      updateCrawlButtons(); updateViewChrome();
    }
  }

  async function crawlAll() {
    if (S.running) return;
    if (!S.lastPage) { run({ follow: true }); return; }
    scrapeNext(true);
  }

  /** Re-extract the already-fetched first page with another mode (no network). */
  function reextract() {
    if (!S.first || S.pane !== 'single' || S.running) return false;
    var doc = S.first.doc, base = S.first.base, url = S.first.page.finalUrl;
    S.ds.reset(); S.grid = null; $('#alt-host').innerHTML = ''; S.view = 'primary'; S.candIdx = 0;
    var res;
    try { res = Sieve.scraper.extractPage(S.mode, doc, base, {}); } catch (e) { Sieve.toast(e.message, 'error'); return false; }
    S.first = { page: S.first.page, doc: doc, base: base, res: res, next: S.first.next };
    S.lastPage = S.first; S.visited = new Set([Sieve.scraper.normUrl(url)]); S.template = res.meta.signature; S.pages = 1;
    if (res.rows.length) S.ds.addRows(res.columns, res.rows, { source_url: url, page_index: 1 });
    setPreview(S.first, res.meta.candidate);
    finishUi(null);
    return true;
  }

  function tryAnother() {
    var cands = S.first && S.first.res.meta.candidates;
    if (!cands || cands.length < 2 || S.running) return;
    S.candIdx = (S.candIdx + 1) % cands.length;
    var cand = cands[S.candIdx], data = cand.extract(), url = S.first.page.finalUrl;
    S.ds.reset();
    S.ds.addRows(data.columns, data.rows, { source_url: url, page_index: 1 });
    S.template = cand.signature; S.pages = 1; S.visited = new Set([Sieve.scraper.normUrl(url)]); S.lastPage = S.first;
    setPreview(S.first, cand);
    setState('data'); setStatus('success', util.fmtNum(S.ds.rowCount()) + ' rows');
    updateStats(); updateViewChrome(); updateCrawlButtons();
    Sieve.toast('Showing ' + cand.label, 'info', 2600);
  }

  /* -------------------------------------------------------------------- modes */
  function buildModeList() {
    var groups = [['Detect', ['table']], ['Extract', ['email', 'phone', 'links', 'images', 'text', 'reviews']], ['Leads', ['people', 'business', 'social', 'b2b']]];
    $('#mode-list').innerHTML = groups.map(function (g) {
      return '<div class="side-label" style="padding-top:8px">' + g[0] + '</div>' + g[1].map(function (id) {
        var m = MODES[id];
        return '<label class="mode-item"><input type="radio" name="mode" value="' + id + '"' + (id === S.mode ? ' checked' : '') + '><span>' + Sieve.icons.svg(m.icon, 16) + m.label + '</span></label>';
      }).join('');
    }).join('');
  }

  function setMode(id, opts) {
    if (!MODES[id]) return;
    var changed = id !== S.mode;
    S.mode = id;
    var radio = $('input[name=mode][value=' + id + ']'); if (radio) radio.checked = true;
    var def = MODES[id];
    $('#mode-icon').innerHTML = Sieve.icons.svg(def.icon, 20);
    $('#mode-title').textContent = def.label; $('#mode-desc').textContent = def.desc;
    Sieve.store.set('mode', id);
    if (changed && !(opts && opts.silent)) {
      if (S.first && S.pane === 'single' && !S.running) {
        if (reextract()) Sieve.toast('Re-extracted the fetched page as "' + def.label + '".', 'info', 2400);
      } else if (!S.running) { S.ds.reset(); S.grid = null; $('#alt-host').innerHTML = ''; if (S.pane === 'single' && $('#results-card').getAttribute('data-state-now') === 'data') setState('empty'); }
    }
    updateViewChrome(); scheduleAlt();
  }

  function setPane(p) {
    S.pane = p;
    $$('.tab[data-pane]').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-pane') === p)); });
    $('#pane-single').hidden = p !== 'single';
    $('#pane-bulk').hidden = p !== 'bulk';
    updateCrawlButtons();
  }

  /* ----------------------------------------------------------------- bulk tab */
  function updateBulkCount() {
    var parsed = Sieve.scraper.parseUrlList($('#bulk-input').value, 500);
    var t = parsed.urls.length + ' URL' + (parsed.urls.length === 1 ? '' : 's');
    if (parsed.invalid.length) t += ' · ' + parsed.invalid.length + ' invalid';
    if (parsed.truncated) t += ' · ' + parsed.truncated + ' over the 500 limit';
    $('#bulk-count').textContent = t;
    return parsed;
  }

  async function runBulk() {
    if (S.running) return;
    var parsed = updateBulkCount();
    if (!parsed.urls.length) { Sieve.toast('Paste at least one valid URL first.', 'warning'); return; }
    if (parsed.truncated) Sieve.toast(parsed.truncated + ' URL(s) beyond the 500 limit were ignored.', 'warning', 5000);
    var o = readOpts();
    resetRun(); S.ds.setDedupe(o.dedupe);
    S.ctrl = new AbortController();
    setRunning(true); startTimer(); showLoading(); setStatus('fetching', '0/' + parsed.urls.length);
    var prog = $('#bulk-progress'); prog.hidden = false; prog.firstElementChild.style.width = '0%';
    var done = 0, errs = [], total = parsed.urls.length;
    var summary = await Sieve.scraper.bulk(parsed.urls, S.mode, {
      dataset: S.ds, concurrency: 3, delay: Math.min(o.delay, 1500), maxPages: o.maxPages, followPagination: o.follow, timeout: o.timeout, signal: S.ctrl.signal, proxy: Sieve.scraper.proxy.get()
    }, { onStatus: function (i, st, info) {
      if (st === 'done' || st === 'error') {
        done++; if (st === 'error') errs.push(parsed.urls[i] + ' — ' + info.error);
        prog.firstElementChild.style.width = Math.round(done / total * 100) + '%';
        $('#bulk-meta').textContent = done + ' / ' + total + ' done' + (errs.length ? ' · ' + errs.length + ' failed' : '');
        setStatus('fetching', done + '/' + total);
        S.pages = S.ds.sourceCount();
        if (S.ds.totalRows() && $('#results-card').getAttribute('data-state-now') !== 'data') setState('data');
        updateStats(); updateViewChrome();
      }
    } });
    stopTimer(); setRunning(false); prog.hidden = true;
    S.pages = S.ds.sourceCount();
    finishUi(null);
    if (S.ctrl.signal.aborted) { setStatus('idle', 'Cancelled'); $('#bulk-meta').textContent += ' · cancelled'; }
    else if (errs.length) {
      Sieve.toast(errs.length + ' of ' + total + ' URLs failed.', 'warning', 5000);
      $('#bulk-meta').innerHTML = esc($('#bulk-meta').textContent) + ' · <a href="#" class="link-btn" id="bulk-errs">view errors</a>';
      var l = $('#bulk-errs'); if (l) l.addEventListener('click', function (e) { e.preventDefault(); Sieve.modal.open({ title: 'Failed URLs', html: '<pre style="white-space:pre-wrap;max-height:320px"></pre>' }).body.querySelector('pre').textContent = errs.join('\n'); });
    } else Sieve.toast('Scraped ' + total + ' URLs into one table.', 'success');
    updateCrawlButtons();
  }

  /* -------------------------------------------------------------- dialogs */
  function pasteHtmlDialog() {
    var html = '<p class="text-sm muted" style="margin-bottom:12px">Open the page in your browser, choose <em>View page source</em> (or copy the DOM from DevTools), and paste it here. Sieve processes it locally — nothing is uploaded.</p>' +
      '<div class="field"><label for="ph-url">Page URL <span class="muted">(optional — resolves relative links)</span></label><input class="input" id="ph-url" type="url" placeholder="https://example.com/products"></div>' +
      '<div class="field" style="margin-top:12px"><label for="ph-html">HTML</label><textarea class="textarea mono" id="ph-html" style="min-height:200px" placeholder="&lt;!doctype html&gt;…" spellcheck="false" data-autofocus></textarea></div>' +
      '<div style="margin-top:12px"><label class="btn btn-sm" style="cursor:pointer"><span data-icon="file-up" data-size="16"></span>Load .html file<input type="file" id="ph-file" accept=".html,.htm,text/html" hidden></label></div>';
    var m = Sieve.modal.open({
      title: 'Paste page HTML', html: html, size: 'lg',
      footer: [{ label: 'Cancel' }, { label: 'Scrape this HTML', variant: 'primary', close: false, onClick: function (api) {
        var h = $('#ph-html', m.body).value;
        if (h.trim().length < 20) { Sieve.toast('Paste the page HTML first.', 'warning'); return false; }
        var u = util.normalizeUrl($('#ph-url', m.body).value) || 'https://pasted.invalid/';
        api.close();
        if (u !== 'https://pasted.invalid/') $('#url-input').value = u;
        run({ url: u, html: h });
        return false;
      } }]
    });
    $('#ph-file', m.body).addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { $('#ph-html', m.body).value = String(rd.result); };
      rd.readAsText(f);
    });
  }

  function proxyHelp() {
    var m = Sieve.modal.open({
      title: 'Run the optional proxy', size: 'lg',
      html: '<p>Browsers block pages from reading most other sites (CORS) and cannot execute a site\'s JavaScript on your behalf. The proxy is a tiny Node.js server that runs on <em>your</em> machine, fetches pages for you, and can render JavaScript and scroll to the bottom of infinite feeds.</p>' +
        '<pre style="margin-top:12px"><code>npm install\nnode proxy-server.js     # listens on http://localhost:8787</code></pre>' +
        '<p class="text-sm muted" style="margin-top:12px">It honours robots.txt, limits itself to 1 request per second per domain and sends a descriptive User-Agent. See <a class="link-btn" href="docs.html#cors">the docs</a> for details.</p>',
      footer: [{ label: 'Close' }, { label: 'I started it — enable & test', variant: 'primary', close: false, onClick: function (api) {
        $('#proxy-on').checked = true; saveProxy(); testProxy().then(function (ok) { if (ok) api.close(); });
        return false;
      } }]
    });
  }

  function saveProxy() {
    Sieve.scraper.proxy.set({ enabled: $('#proxy-on').checked, url: $('#proxy-url').value.trim() || Sieve.config.defaultProxy });
    updateBanners();
  }
  function testProxy() {
    var st = $('#proxy-status'); st.textContent = 'Testing…'; st.style.color = '';
    return Sieve.scraper.proxy.test().then(function (j) {
      st.textContent = 'Connected' + (j && j.puppeteer ? ' · rendering on' : ' · fetch only'); st.style.color = 'var(--success)';
      return true;
    }, function () {
      st.textContent = 'Not reachable'; st.style.color = 'var(--danger)';
      Sieve.toast('Could not reach the proxy at ' + $('#proxy-url').value + '. Start it with "node proxy-server.js".', 'error', 5000);
      return false;
    });
  }

  /* ------------------------------------------------------------------- demo */
  function loadDemo(kind) {
    var url = Sieve.demo.URLS[kind || 'table'] || Sieve.demo.URLS.table;
    $('#url-input').value = url;
    run({ url: url });
  }

  /* ---------------------------------------------------------------- bindings */
  function bind() {
    $('#url-form').addEventListener('submit', function (e) { e.preventDefault(); run(); });
    $('#fetch-btn').addEventListener('click', function (e) { if (S.running) { e.preventDefault(); stopRun(); } });
    $('#demo-link').addEventListener('click', function () { loadDemo('table'); });
    $('#btn-stop').addEventListener('click', stopRun);
    $('#bulk-stop').addEventListener('click', stopRun);
    $('#btn-next').addEventListener('click', function () { scrapeNext(false); });
    $('#btn-crawl').addEventListener('click', crawlAll);
    $('#try-another').addEventListener('click', tryAnother);
    $('#paste-html').addEventListener('click', pasteHtmlDialog);
    $('#clear-results').addEventListener('click', function () {
      if (S.running) stopRun();
      resetRun(); setState('empty'); setStatus('idle', 'Idle'); setPreview(null); $('#crawl-meta').textContent = ''; S.pages = 0; S.elapsed = 0; updateStats(); updateViewChrome(); updateCrawlButtons();
    });
    $('#report-issue').addEventListener('click', function (e) { e.preventDefault(); location.href = Sieve.config.issueUrl; });

    // delegated actions anywhere in the workspace
    document.addEventListener('click', function (e) {
      var d = e.target.closest('[data-demo]'); if (d) { loadDemo(d.getAttribute('data-demo')); return; }
      var a = e.target.closest('[data-action]');
      if (a) {
        var act = a.getAttribute('data-action');
        if (act === 'paste-html') pasteHtmlDialog();
        else if (act === 'proxy-help') proxyHelp();
      }
      var v = e.target.closest('[data-view]');
      if (v) { S.view = v.getAttribute('data-view'); updateViewChrome(); renderAlt(); }
      var act2 = e.target.closest('#view-actions [data-act]');
      if (act2) viewAction(act2.getAttribute('data-act'));
    });

    // pane tabs
    $$('.tab[data-pane]').forEach(function (t) { t.addEventListener('click', function () { setPane(t.getAttribute('data-pane')); }); });

    // mode radios
    $('#mode-list').addEventListener('change', function (e) {
      if (e.target.name === 'mode') { setMode(e.target.value); if (matchMedia('(max-width: 768px)').matches) sidebar.close(); }
    });

    // options
    ['#opt-delay', '#opt-max', '#opt-wait', '#opt-follow', '#opt-scroll', '#opt-dedupe'].forEach(function (s) {
      $(s).addEventListener('change', function () { saveOpts(); updateBanners(); updateCrawlButtons(); });
    });
    $('#opt-dedupe').addEventListener('change', function () { S.ds.setDedupe($('#opt-dedupe').checked); updateStats(); updateViewChrome(); });
    $('#opt-max').addEventListener('input', updateCrawlButtons);

    // proxy
    $('#proxy-on').addEventListener('change', saveProxy);
    $('#proxy-url').addEventListener('change', saveProxy);
    $('#proxy-test').addEventListener('click', function () { saveProxy(); testProxy(); });

    // bulk
    $('#bulk-input').addEventListener('input', util.debounce(updateBulkCount, 120));
    $('#bulk-sample').addEventListener('click', function () { $('#bulk-input').value = Sieve.demo.bulkSample().join('\n'); updateBulkCount(); });
    $('#bulk-run').addEventListener('click', runBulk);

    // preview collapse
    $('#preview-toggle').addEventListener('click', function () {
      var f = $('#preview-frame'), collapsed = f.classList.toggle('preview-collapse');
      this.lastElementChild.textContent = collapsed ? 'Expand' : 'Collapse';
      this.firstElementChild.innerHTML = Sieve.icons.svg(collapsed ? 'chevron-right' : 'chevron-down', 14);
    });

    // exports
    $('#exp-csv').addEventListener('click', function () { Sieve.exporter.csv(S.ds.view(), MODES[S.mode].id === 'table' ? 'scraped-data' : 'scraped-' + S.mode); });
    $('#exp-xlsx').addEventListener('click', function () { Sieve.exporter.xlsx(S.ds.view(), MODES[S.mode].id === 'table' ? 'scraped-data' : 'scraped-' + S.mode); });
    $('#exp-copy').addEventListener('click', function () { Sieve.exporter.copy(S.ds.view()); });
    $('#exp-sheets').addEventListener('click', function () { Sieve.exporter.sheets(S.ds.view()); });
    $('#cols-all').addEventListener('click', function () { S.ds.setAllEnabled(true); });
    $('#cols-none').addEventListener('click', function () { S.ds.setAllEnabled(false); });

    // keyboard: "/" focuses the URL bar
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); $('#url-input').focus(); $('#url-input').select(); }
    });

    // dataset → UI
    S.ds.on(function (ev) {
      updateStats();
      if (ev.type !== 'rename') { scheduleAlt(); }
      if (ev.type === 'rows' || ev.type === 'columns' || ev.type === 'reset' || ev.type === 'toggle') updateViewChrome();
    });
  }

  function viewAction(act) {
    var def = MODES[S.mode], ds = S.ds;
    var kp = ds.columns[def.primary || 0] ? ds.columns[def.primary || 0].key : null;
    if (act === 'copy-all' || act === 'txt') {
      var vals = ds.columnValues(kp).filter(Boolean);
      if (act === 'copy-all') util.copyText(vals.join('\n')).then(function () { Sieve.toast('Copied ' + vals.length + ' ' + UNIT[S.mode], 'success'); });
      else Sieve.exporter.lines(vals, 'sieve-' + S.mode, UNIT[S.mode]);
    } else if (act === 'copy-text') {
      util.copyText(Sieve.ui.plainText(ds)).then(function () { Sieve.toast('Page text copied', 'success'); });
    } else if (act === 'txt-text') {
      var t = Sieve.ui.plainText(ds);
      if (!t) return;
      util.downloadBlob(new Blob([t + '\n'], { type: 'text/plain;charset=utf-8' }), 'sieve-page-text-' + util.timestamp() + '.txt');
      Sieve.toast('Saved page text', 'success');
    } else if (S.grid) {
      if (act === 'sel-all') S.grid.selectAll(true);
      else if (act === 'sel-none') S.grid.selectAll(false);
      else if (act === 'img-urls') Sieve.exporter.lines(S.grid.items().map(function (i) { return i.url; }).filter(function (u) { return !/^data:/i.test(u); }), 'sieve-image-urls', 'image URLs');
      else if (act === 'zip') {
        var items = S.grid.selectedItems(), prog = $('#zip-progress');
        Sieve.exporter.zipImages(items, function (d, n) { if (prog) prog.textContent = 'Fetching ' + d + ' / ' + n + '…'; }).then(function () { if (prog) prog.textContent = ''; });
      }
    }
  }

  /* -------------------------------------------------------------------- boot */
  var sidebar, inspector, scrim;

  Sieve.ready(function () {
    buildModeList();
    loadOpts();
    bind();

    scrim = $('#scrim');
    sidebar = new Sieve.ui.Drawer($('#sidebar'), scrim);
    inspector = new Sieve.ui.Drawer($('#inspector'), scrim);
    $('#open-sidebar').addEventListener('click', function () { sidebar.open(); });
    $('#close-inspector').addEventListener('click', function () { inspector.close(); });
    $('#toggle-inspector').addEventListener('click', function () {
      if (matchMedia('(max-width: 1100px)').matches) inspector.toggle();
      else {
        var c = $('#shell').classList.toggle('inspector-collapsed');
        Sieve.store.set('inspectorCollapsed', c);
      }
    });
    if (Sieve.store.get('inspectorCollapsed', false)) $('#shell').classList.add('inspector-collapsed');

    S.table = new Sieve.ui.DataTable($('#table-host'), S.ds, {});
    S.schema = new Sieve.ui.SchemaEditor($('#schema-host'), S.ds);
    Sieve.icons.hydrate(document);

    var params = new URLSearchParams(location.search);
    var preset = params.get('preset');
    var modeId = (preset && Sieve.extractors.PRESETS[preset.toLowerCase()]) || Sieve.store.get('mode', 'table');
    S.mode = '';                                     // force a refresh of title/icon
    setMode(MODES[modeId] ? modeId : 'table', { silent: true });

    setState('empty'); setStatus('idle', 'Idle');
    updateBanners(); updateStats(); updateCrawlButtons(); updateViewChrome(); updateBulkCount();

    var u = params.get('url');
    if (params.get('demo') === '1') loadDemo(params.get('kind') === 'cards' ? 'cards' : 'table');
    else if (u) {
      $('#url-input').value = u;
      if (params.get('autorun') === '1') run({ url: u });
    }
    if (params.get('pane') === 'bulk') setPane('bulk');
  });

  Sieve.app = { state: S, run: run, setMode: setMode };

})(window);
