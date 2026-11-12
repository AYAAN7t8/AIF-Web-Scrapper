/* ==========================================================================
   Sieve — bulk.js  (controller for bulk.html)
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve, util = Sieve.util, esc = util.esc;
  var $ = function (s) { return document.querySelector(s); };

  var ds = new Sieve.Dataset(), ctrl = null, running = false, urls = [], status = [], t0 = 0, timer = 0, table = null, hostFilter = null;

  function pill(st, label) { Sieve.ui.statusPill($('#pill'), st, label); }

  function readNum(id, d, min, max) { var v = parseInt($(id).value, 10); return Math.min(max, Math.max(min, isNaN(v) ? d : v)); }

  function updateCount() {
    var p = Sieve.scraper.parseUrlList($('#input').value, 500);
    var t = p.urls.length + ' URL' + (p.urls.length === 1 ? '' : 's');
    if (p.invalid.length) t += ' · ' + p.invalid.length + ' invalid';
    if (p.duplicates) t += ' · ' + p.duplicates + ' duplicate' + (p.duplicates === 1 ? '' : 's') + ' removed';
    if (p.truncated) t += ' · ' + p.truncated + ' over limit';
    $('#count').textContent = t;
    return p;
  }

  function renderUrls() {
    $('#url-card').hidden = !urls.length;
    var label = { pending: 'Pending', running: 'Running', done: 'Done', error: 'Error' };
    $('#url-rows').innerHTML = urls.map(function (u, i) {
      var s = status[i] || { st: 'pending' };
      var tail = s.st === 'done' ? s.rows : (s.st === 'error' ? '' : '');
      return '<tr><td class="n">' + (i + 1) + '</td><td class="u" title="' + esc(u + (s.error ? ' — ' + s.error : '')) + '">' + esc(u.replace(/^https?:\/\//, '')) + '</td>' +
        '<td class="rows">' + (tail !== '' ? util.fmtNum(tail) : '') + '</td>' +
        '<td class="s"><span class="status-pill" data-status="' + s.st + '" ' + (s.error ? 'data-tip="' + esc(s.error) + '"' : '') + '><span class="dot"></span><span>' + label[s.st] + '</span></span></td></tr>';
    }).join('');
    $('#retry').hidden = running || !status.some(function (s) { return s && s.st === 'error'; });
  }
  var renderUrlsSoon = util.debounce(renderUrls, 80);

  function updateSummary() {
    var done = status.filter(function (s) { return s && s.st === 'done'; }).length, err = status.filter(function (s) { return s && s.st === 'error'; }).length;
    $('#summary').hidden = !urls.length;
    $('#s-done').textContent = done; $('#s-err').textContent = err;
    $('#s-rows').textContent = util.fmtNum(ds.totalRows());
    $('#s-time').textContent = util.fmtDuration(performance.now() - t0);
    var n = ds.rowCount();
    $('#rcount').textContent = util.fmtNum(n) + ' row' + (n === 1 ? '' : 's');
    ['#exp-csv', '#exp-xlsx', '#exp-copy'].forEach(function (s) { $(s).disabled = !n; });
    var has = ds.totalRows() > 0;
    $('#table-host').hidden = !has; $('#empty').hidden = has;
  }

  function renderChips() {
    var counts = {};
    ds.rows.forEach(function (r) { var h = util.host(r.src) || r.src; counts[h] = (counts[h] || 0) + 1; });
    var hosts = Object.keys(counts);
    var box = $('#chips');
    if (hosts.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<span class="text-xs muted" style="margin-right:4px">Filter by source:</span>' +
      '<button class="chip' + (!hostFilter ? ' is-active' : '') + '" type="button" data-host="">All<span class="count">' + ds.totalRows() + '</span></button>' +
      hosts.sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 24).map(function (h) {
        return '<button class="chip' + (hostFilter === h ? ' is-active' : '') + '" type="button" data-host="' + esc(h) + '">' + esc(h) + '<span class="count">' + counts[h] + '</span></button>';
      }).join('');
  }

  function setRunning(on) {
    running = on;
    $('#run').disabled = on; $('#stop').hidden = !on;
    $('#progress').hidden = !on;
    clearInterval(timer);
    if (on) timer = setInterval(function () { $('#s-time').textContent = util.fmtDuration(performance.now() - t0); }, 200);
  }

  async function runList(indices) {
    var parsed = updateCount(), fresh = !indices;
    if (fresh) {
      if (!parsed.urls.length) { Sieve.toast('Paste at least one valid URL first.', 'warning'); return; }
      urls = parsed.urls; status = urls.map(function () { return { st: 'pending' }; });
      ds.reset(); hostFilter = null; ds.setFilter(null);
      if (parsed.truncated) Sieve.toast(parsed.truncated + ' URL(s) beyond the 500 limit were ignored.', 'warning', 5000);
    }
    var list = indices ? indices.map(function (i) { return urls[i]; }) : urls;
    ds.setDedupe($('#dedupe').checked);
    ctrl = new AbortController(); t0 = fresh ? performance.now() : t0 || performance.now();
    setRunning(true); renderUrls(); updateSummary(); pill('running', 'Running');
    var done = 0;
    var summary = await Sieve.scraper.bulk(list, $('#mode').value, {
      dataset: ds, concurrency: readNum('#conc', 3, 1, 8), delay: readNum('#delay', 500, 0, 5000), maxPages: readNum('#maxp', 1, 1, 50),
      followPagination: $('#follow').checked && readNum('#maxp', 1, 1, 50) > 1, timeout: readNum('#wait', 15000, 1000, 120000), signal: ctrl.signal, proxy: Sieve.scraper.proxy.get()
    }, { onStatus: function (k, st, info) {
      var i = indices ? indices[k] : k;
      status[i] = { st: st, rows: info.rows, error: info.error };
      if (st === 'done' || st === 'error') { done++; $('#progress').firstElementChild.style.width = Math.round(done / list.length * 100) + '%'; pill('running', done + '/' + list.length); }
      renderUrlsSoon(); updateSummary();
    } });
    setRunning(false); renderUrls(); renderChips(); updateSummary();
    var err = status.filter(function (s) { return s && s.st === 'error'; }).length;
    if (ctrl.signal.aborted) pill('skipped', 'Cancelled');
    else if (err) { pill('error', err + ' failed'); Sieve.toast(err + ' of ' + urls.length + ' URLs failed — hover a status for the reason.', 'warning', 5000); }
    else { pill('done', 'Done'); Sieve.toast('Scraped ' + urls.length + ' URLs · ' + util.fmtNum(ds.totalRows()) + ' rows.', 'success'); }
  }

  Sieve.ready(function () {
    $('#mode').innerHTML = Sieve.extractors.ORDER.map(function (id) { return '<option value="' + id + '">' + Sieve.extractors.MODES[id].label + '</option>'; }).join('');
    var p = new URLSearchParams(location.search), pre = p.get('preset');
    if (pre && Sieve.extractors.PRESETS[pre]) $('#mode').value = Sieve.extractors.PRESETS[pre];
    table = new Sieve.ui.DataTable($('#table-host'), ds, {});

    $('#input').addEventListener('input', util.debounce(updateCount, 120));
    $('#sample').addEventListener('click', function () { $('#input').value = Sieve.demo.bulkSample().join('\n'); updateCount(); });
    $('#run').addEventListener('click', function () { runList(null); });
    $('#stop').addEventListener('click', function () { if (ctrl) ctrl.abort(); });
    $('#retry').addEventListener('click', function () {
      var idx = []; status.forEach(function (s, i) { if (s && s.st === 'error') idx.push(i); });
      if (idx.length) runList(idx);
    });
    $('#dedupe').addEventListener('change', function () { ds.setDedupe($('#dedupe').checked); updateSummary(); });
    $('#chips').addEventListener('click', function (e) {
      var c = e.target.closest('[data-host]'); if (!c) return;
      hostFilter = c.getAttribute('data-host') || null;
      ds.setFilter(hostFilter ? function (r) { return (util.host(r.src) || r.src) === hostFilter; } : null);
      renderChips(); updateSummary();
    });
    ds.on(function () { updateSummary(); });
    $('#exp-csv').addEventListener('click', function () { Sieve.exporter.csv(ds.view(), 'bulk-scrape'); });
    $('#exp-xlsx').addEventListener('click', function () { Sieve.exporter.xlsx(ds.view(), 'bulk-scrape'); });
    $('#exp-copy').addEventListener('click', function () { Sieve.exporter.copy(ds.view()); });
    updateCount(); updateSummary();
    Sieve.icons.hydrate(document);
  });

})(window);
