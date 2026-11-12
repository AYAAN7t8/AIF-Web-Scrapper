'use strict';
/* Extension results page: shows a short preview of what was found, then hands the full result to the website
   when the user clicks "Click to view more". Everything is processed locally in the browser. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var params = new URLSearchParams(location.search);
  var PREVIEW_ROWS = 10, PREVIEW_COLS = 8;
  var ds = null, capture = null, presetId = 'table';

  function say(text, kind) { var h = $('#hint'); h.textContent = text || ''; h.dataset.kind = kind || ''; h.hidden = !text; }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return u || ''; } }

  function load() {
    var url = params.get('url');
    presetId = (params.get('preset') || 'table').toLowerCase();
    if (url) return Promise.resolve({ url: url, html: null, mode: presetId });          // fetch with the user's own cookies
    return new Promise(function (resolve) {
      chrome.storage.local.get('sieveLast', function (r) { resolve(r && r.sieveLast ? r.sieveLast : null); });
    });
  }

  function fail(title, text) {
    $('#title').textContent = title; $('#sub').textContent = ''; $('#loading').hidden = true;
    var e = $('#empty'); e.textContent = text; e.hidden = false;
  }

  function render() {
    var v = ds.view(), n = ds.rowCount();
    $('#loading').hidden = true;
    $('#title').textContent = n + (n === 1 ? ' result' : ' results') + ' found';
    $('#sub').textContent = hostOf(capture.url) + ' · ' + v.headers.length + ' columns' + (capture.stoppedEarly ? ' · scrolling stopped early' : '');
    if (!n) {
      var e = $('#empty');
      e.textContent = 'Nothing of this kind was found on the page. Try another extract type, scroll the page fully first, or open the full editor.';
      e.hidden = false;
      $('#actions').hidden = false; $('#csv').hidden = true; $('#more').hidden = false;
      return;
    }
    var head = $('#table thead'), body = $('#table tbody');
    head.textContent = ''; body.textContent = '';
    var cols = Math.min(v.headers.length, PREVIEW_COLS), tr = document.createElement('tr'), th;
    th = document.createElement('th'); th.textContent = '#'; tr.appendChild(th);
    for (var c = 0; c < cols; c++) { th = document.createElement('th'); th.textContent = v.headers[c]; tr.appendChild(th); }
    head.appendChild(tr);
    v.matrix.slice(0, PREVIEW_ROWS).forEach(function (row, i) {
      var r = document.createElement('tr'), td = document.createElement('td');
      td.className = 'num'; td.textContent = String(i + 1); r.appendChild(td);
      for (var k = 0; k < cols; k++) { td = document.createElement('td'); var val = String(row[k] == null ? '' : row[k]); td.textContent = val.length > 120 ? val.slice(0, 120) + '…' : val; td.title = val; r.appendChild(td); }
      body.appendChild(r);
    });
    $('#table-wrap').hidden = false;
    var note = $('#note'), extraCols = v.headers.length - cols;
    note.textContent = 'Showing ' + Math.min(PREVIEW_ROWS, n) + ' of ' + n + ' rows' + (extraCols > 0 ? ' and ' + cols + ' of ' + v.headers.length + ' columns' : '') + '. Click "Click to view more" for the full table, column editing and Excel / Google Sheets export.';
    note.hidden = false;
    $('#actions').hidden = false;
  }

  function csvDownload() {
    Sieve.exporter.csv(ds.view(), 'scraped-' + hostOf(capture.url).replace(/[^a-z0-9.-]/gi, '_'));
  }

  /* ----- hand the captured page to the website ----- */
  function deliver() {   // injected into the website tab (isolated world)
    return new Promise(function (resolve) {
      if (document.documentElement.getAttribute('data-sieve-ready') !== '1') return resolve('wait');
      chrome.storage.local.get('sieveLast', function (r) {
        var p = r && r.sieveLast;
        if (!p) return resolve('nodata');
        var done = false;
        function onAck(e) { if (e.source === window && e.data && e.data.type === 'sieve-ack') { done = true; window.removeEventListener('message', onAck); resolve('ok'); } }
        window.addEventListener('message', onAck);
        window.postMessage({ type: 'sieve-capture', payload: p }, location.origin);
        setTimeout(function () { if (!done) { window.removeEventListener('message', onAck); resolve('noack'); } }, 3000);
      });
    });
  }

  function viewMore() {
    if (!capture.html && !params.get('url')) return;
    var btn = $('#more'); btn.disabled = true;
    say('Opening Sieve… if the site was asleep this can take up to a minute.');
    // make sure the website receives exactly what is shown here (also for fetched links)
    chrome.storage.local.set({ sieveLast: { url: capture.url, title: capture.title || '', html: capture.html, mode: presetId, at: Date.now() } }, function () {
      var target = SIEVE_SITE.replace(/\/+$/, '') + '/app.html?from=ext&preset=' + encodeURIComponent(presetId);
      chrome.tabs.create({ url: target }, function (tab) {
        var started = Date.now(), finished = false;
        (function attempt() {
          if (finished) return;
          if (Date.now() - started > 150000) { btn.disabled = false; say('The website did not respond. Open it manually and use "Paste page HTML", or try again.', 'error'); return; }
          chrome.scripting.executeScript({ target: { tabId: tab.id }, func: deliver }, function (res) {
            var out = !chrome.runtime.lastError && res && res[0] && res[0].result;
            if (out === 'ok') { finished = true; btn.disabled = false; say('Sent to the website. You can close this tab.'); return; }
            setTimeout(attempt, out === 'noack' ? 1500 : 1000);
          });
        })();
      });
    });
  }

  function openEditor() {
    chrome.storage.local.set({ sievePending: { url: capture.url, html: capture.html, at: Date.now() } }, function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('app.html?ext=1&preset=' + encodeURIComponent(presetId)) });
    });
  }

  function start() {
    load().then(function (cap) {
      if (!cap) { fail('Nothing to show', 'There is no captured page. Open a page, click the Sieve icon and press "Scrape this page".'); return; }
      capture = cap;
      if (cap.mode) presetId = String(cap.mode).toLowerCase();
      var modeId = Sieve.extractors.PRESETS[presetId] || (Sieve.extractors.MODES[presetId] ? presetId : 'table');
      ds = new Sieve.Dataset();
      // fetched by link: get the HTML once (with the user's cookies) so the website can later show the same data
      var pre = cap.html ? Promise.resolve() : Sieve.scraper.fetchHtml(cap.url, {}).then(function (p) { cap.html = p.html; cap.url = p.finalUrl || cap.url; });
      pre.then(function () {
        return Sieve.scraper.crawl(cap.url, modeId, { dataset: ds, startHtml: cap.html, followPagination: false, maxPages: 1, delay: 0 }, {});
      })
        .then(render)
        .catch(function (err) {
          var msg = (err && err.message) || String(err);
          if (err && err.code === 'cors') msg = 'Chrome has not given Sieve access to this site yet. Open the Sieve popup and click "Allow site access", or open the page in a tab and press "Scrape this page".';
          else if (err && err.code === 'http' && [401, 403, 429, 503].indexOf(err.status) !== -1) msg = 'The site answered ' + err.status + ' (login expired, rate limit or a bot check). Open the page in a normal tab, pass any check yourself, then press "Scrape this page" in the Sieve popup.';
          fail('Could not read the page', msg);
        });
    });
  }

  $('#more').addEventListener('click', viewMore);
  $('#csv').addEventListener('click', csvDownload);
  $('#editor').addEventListener('click', openEditor);
  start();
})();
