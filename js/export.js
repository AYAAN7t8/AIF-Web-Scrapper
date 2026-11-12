/* ==========================================================================
   Sieve — export.js
   CSV (UTF-8 BOM) · XLSX (SheetJS) · clipboard (TSV) · Google Sheets
   · TXT lists · image ZIPs (JSZip)

   ┌─ CONFIG ───────────────────────────────────────────────────────────────┐
   │ Paste the URL of your deployed Google Apps Script web app here, or set  │
   │ it from the "Export to Google Sheets" dialog (it is then remembered in  │
   │ this browser's localStorage). See docs.html#export for the script.      │
   └─────────────────────────────────────────────────────────────────────────┘
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve = global.Sieve || {};
  var util = Sieve.util;

  var GOOGLE_WEBHOOK_URL = '';          // e.g. 'https://script.google.com/macros/s/AKfy.../exec'
  var SANITIZE_FORMULAS = true;         // neutralise cells that would run as spreadsheet formulas

  var APPS_SCRIPT = [
    '// Sieve → Google Sheets webhook. Deploy as: Web app · Execute as "Me" · Access "Anyone".',
    'function doPost(e) {',
    '  var data = JSON.parse(e.postData.contents);',
    '  var ss = SpreadsheetApp.create(data.title || ("Sieve export " + new Date().toISOString()));',
    '  var sheet = ss.getActiveSheet();',
    '  var rows = [data.headers].concat(data.rows);',
    '  sheet.getRange(1, 1, rows.length, data.headers.length).setValues(rows);',
    '  sheet.setFrozenRows(1);',
    '  sheet.autoResizeColumns(1, data.headers.length);',
    '  return ContentService',
    '    .createTextOutput(JSON.stringify({ ok: true, url: ss.getUrl() }))',
    '    .setMimeType(ContentService.MimeType.JSON);',
    '}'
  ].join('\n');

  /* -------------------------------------------------------------- formatting */
  /** Prevent CSV/Sheets formula injection: "=cmd()" → "'=cmd()". Phone-like "+1 555…" is left alone. */
  function safeCell(v) {
    if (!SANITIZE_FORMULAS || typeof v !== 'string' || !v) return v;
    var c = v.charAt(0);
    if (c === '=' || c === '@' || c === '\t' || c === '\r') return "'" + v;
    if ((c === '+' || c === '-') && !/^[+-]?[\d\s().,-]+$/.test(v)) return "'" + v;
    return v;
  }

  function csvCell(v) {
    var s = String(safeCell(v == null ? '' : v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(headers, matrix) {
    var lines = [headers.map(csvCell).join(',')];
    matrix.forEach(function (r) { lines.push(r.map(csvCell).join(',')); });
    return lines.join('\r\n');
  }

  function toTsv(headers, matrix) {
    function c(v) { return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' '); }
    return [headers.map(c).join('\t')].concat(matrix.map(function (r) { return r.map(c).join('\t'); })).join('\n');
  }

  function empty(view) {
    if (!view || !view.headers.length) { Sieve.toast('No columns are enabled — turn at least one on.', 'warning'); return true; }
    if (!view.matrix.length) { Sieve.toast('Nothing to export yet — scrape something first.', 'warning'); return true; }
    return false;
  }

  function filename(ext, prefix) { return (prefix || 'scraped-data') + '-' + util.timestamp() + '.' + ext; }

  /* -------------------------------------------------------------------- CSV */
  function exportCsv(view, prefix) {
    if (empty(view)) return false;
    var blob = new Blob(['﻿' + toCsv(view.headers, view.matrix)], { type: 'text/csv;charset=utf-8' });
    var name = filename('csv', prefix);
    util.downloadBlob(blob, name);
    Sieve.toast('Exported ' + util.fmtNum(view.matrix.length) + ' rows to ' + name, 'success');
    return true;
  }

  /* ------------------------------------------------------------------- XLSX */
  function exportXlsx(view, prefix) {
    if (empty(view)) return false;
    if (!global.XLSX) {
      Sieve.toast('The XLSX library could not be loaded (offline?). Exporting CSV instead.', 'warning', 5000);
      return exportCsv(view, prefix);
    }
    var cap = function (v) { return typeof v === 'string' && v.length > 32000 ? v.slice(0, 32000) : v; };
    var aoa = [view.headers].concat(view.matrix.map(function (r) { return r.map(cap); }));
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = view.headers.map(function (h, i) {
      var w = String(h).length;
      for (var r = 0; r < Math.min(view.matrix.length, 200); r++) w = Math.max(w, String(view.matrix[r][i] == null ? '' : view.matrix[r][i]).length);
      return { wch: Math.max(8, Math.min(w + 2, 60)) };
    });
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scraped data');
    var name = filename('xlsx', prefix);
    XLSX.writeFile(wb, name);
    Sieve.toast('Exported ' + util.fmtNum(view.matrix.length) + ' rows to ' + name, 'success');
    return true;
  }

  /* -------------------------------------------------------------- clipboard */
  function copyTable(view) {
    if (empty(view)) return Promise.resolve(false);
    return util.copyText(toTsv(view.headers, view.matrix)).then(function () {
      Sieve.toast('Copied ' + util.fmtNum(view.matrix.length) + ' rows (tab-separated) — paste into Excel or Sheets.', 'success');
      return true;
    }, function () {
      Sieve.toast('Clipboard access was blocked by the browser.', 'error');
      return false;
    });
  }

  /* ------------------------------------------------------------------- text */
  function exportLines(lines, prefix, label) {
    if (!lines.length) { Sieve.toast('Nothing to download yet.', 'warning'); return false; }
    var name = filename('txt', prefix);
    util.downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }), name);
    Sieve.toast('Saved ' + util.fmtNum(lines.length) + ' ' + (label || 'lines') + ' to ' + name, 'success');
    return true;
  }

  /* ---------------------------------------------------------- Google Sheets */
  function webhookUrl() { return Sieve.store.get('gsWebhook', '') || GOOGLE_WEBHOOK_URL; }
  function validWebhook(u) { return /^https:\/\/script\.google(usercontent)?\.com\/macros\/s\/[\w-]+\/exec/.test(u || ''); }

  function sendToWebhook(url, view) {
    var payload = JSON.stringify({
      title: 'Sieve export ' + new Date().toLocaleString(),
      headers: view.headers.map(function (h) { return safeCell(String(h)); }),
      rows: view.matrix.map(function (r) { return r.map(function (c) { return safeCell(c == null ? '' : c); }); })
    });
    // text/plain keeps this a "simple" request, so no CORS preflight (Apps Script can't answer one)
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload, redirect: 'follow', credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (j) { return { confirmed: true, url: j && j.url, ok: !j || j.ok !== false, error: j && j.error }; })
      .catch(function () {
        return fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload })
          .then(function () { return { confirmed: false, ok: true }; });
      });
  }

  function exportSheets(view) {
    if (empty(view)) return;
    var current = webhookUrl();
    var html =
      '<div class="stack">' +
      '<div class="card card-pad" style="box-shadow:none"><h4 style="margin-bottom:4px">Quick way — no setup</h4>' +
      '<p class="text-sm muted">Copies your table to the clipboard and opens a blank Google Sheet. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>V</kbd> in cell A1.</p>' +
      '<button class="btn btn-primary btn-sm" type="button" id="gs-quick" style="margin-top:12px">' + Sieve.icons.svg('sheet', 16) + 'Copy &amp; open Google Sheets</button></div>' +
      '<div class="card card-pad" style="box-shadow:none"><h4 style="margin-bottom:4px">Connect Google — one-click export</h4>' +
      '<p class="text-sm muted">Deploy the Apps Script below as a web app (<em>Execute as: Me · Access: Anyone</em>), then paste its <code>/exec</code> URL. Sieve posts <code>{headers, rows}</code> to it and opens the new sheet.</p>' +
      '<div class="field" style="margin-top:12px"><label for="gs-url">Web app URL</label>' +
      '<input class="input mono" id="gs-url" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + util.esc(current) + '" spellcheck="false"></div>' +
      '<details style="margin-top:12px"><summary class="link-btn" style="cursor:pointer">Show Apps Script code</summary>' +
      '<pre style="margin-top:8px;max-height:220px"><code id="gs-code"></code></pre>' +
      '<button class="btn btn-sm" type="button" id="gs-copy-code" style="margin-top:8px">' + Sieve.icons.svg('copy', 14) + 'Copy script</button></details>' +
      '<div id="gs-result" class="text-sm" style="margin-top:12px" aria-live="polite"></div></div></div>';

    var modal = Sieve.modal.open({
      title: 'Export to Google Sheets', html: html, size: 'lg',
      footer: [
        { label: 'Close', onClick: function () { /* close */ } },
        { label: 'Send to Sheets', variant: 'primary', close: false, onClick: send }
      ]
    });
    modal.body.querySelector('#gs-code').textContent = APPS_SCRIPT;
    modal.body.querySelector('#gs-quick').addEventListener('click', function () {
      util.copyText(toTsv(view.headers, view.matrix)).then(function () {
        Sieve.toast('Table copied — paste it into the new sheet.', 'success');
        global.open('https://sheets.new', '_blank', 'noopener');
      }, function () { Sieve.toast('Clipboard access was blocked by the browser.', 'error'); });
    });
    modal.body.querySelector('#gs-copy-code').addEventListener('click', function () {
      util.copyText(APPS_SCRIPT).then(function () { Sieve.toast('Script copied.', 'success'); });
    });

    function send(api) {
      var input = modal.body.querySelector('#gs-url'), out = modal.body.querySelector('#gs-result');
      var url = input.value.trim();
      if (!validWebhook(url)) {
        out.innerHTML = '<span style="color:var(--danger)">Enter a valid <code>https://script.google.com/macros/s/…/exec</code> URL.</span>';
        input.classList.add('is-invalid'); input.focus();
        return false;
      }
      input.classList.remove('is-invalid');
      Sieve.store.set('gsWebhook', url);
      out.textContent = 'Sending ' + util.fmtNum(view.matrix.length) + ' rows…';
      sendToWebhook(url, view).then(function (r) {
        if (!r.ok) { out.innerHTML = '<span style="color:var(--danger)">The script reported an error: ' + util.esc(r.error || 'unknown') + '</span>'; return; }
        if (r.url && /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(r.url)) {
          out.innerHTML = '<span style="color:var(--success)">Done.</span> <a class="link-btn" target="_blank" rel="noopener" href="' + util.esc(r.url) + '">Open your spreadsheet →</a>';
        } else {
          out.innerHTML = r.confirmed
            ? 'Sent. The script did not return a spreadsheet URL — check your Google Drive.'
            : 'Sent. The browser cannot read Google\'s reply, so check your Google Drive for the new sheet.';
        }
      }, function () { out.innerHTML = '<span style="color:var(--danger)">Could not reach the web app. Check the URL and deployment access.</span>'; });
      return false;
    }
  }

  /* ----------------------------------------------------------- image ZIP */
  function extFromBlob(blob, url) {
    var m = /^image\/([a-z0-9+.-]+)/i.exec(blob.type || '');
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('x-icon', 'ico');
    var u = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
    return u ? u[1].toLowerCase() : 'img';
  }
  function slug(s) { return String(s || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image'; }

  function fetchBlob(url, px) {
    if (/^data:/i.test(url)) return fetch(url).then(function (r) { return r.blob(); });
    return fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .catch(function (err) {
        if (!px || !px.enabled) throw err;
        return fetch(px.url + '/api/fetch?raw=1&url=' + encodeURIComponent(url))
          .then(function (r) { if (!r.ok) throw new Error('Proxy HTTP ' + r.status); return r.blob(); });
      });
  }

  /** items: [{url, name}] → downloads sieve-images-<ts>.zip. Resolves {ok, failed}. */
  function zipImages(items, onProgress) {
    if (!global.JSZip) { Sieve.toast('The ZIP library could not be loaded (offline?).', 'error'); return Promise.resolve({ ok: 0, failed: items.length }); }
    if (!items.length) { Sieve.toast('Select at least one image.', 'warning'); return Promise.resolve({ ok: 0, failed: 0 }); }
    var px = Sieve.scraper && Sieve.scraper.proxy.get();
    var zip = new JSZip(), done = 0, ok = 0, failed = [], i = 0;
    function worker() {
      if (i >= items.length) return Promise.resolve();
      var idx = i++, it = items[idx];
      return fetchBlob(it.url, px).then(function (blob) {
        zip.file(String(idx + 1).padStart(3, '0') + '-' + slug(it.name) + '.' + extFromBlob(blob, it.url), blob);
        ok++;
      }).catch(function () { failed.push(it.url); }).then(function () {
        done++; if (onProgress) onProgress(done, items.length);
        return worker();
      });
    }
    var pool = [];
    for (var w = 0; w < 4; w++) pool.push(worker());
    return Promise.all(pool).then(function () {
      if (!ok) {
        Sieve.toast('None of the ' + items.length + ' images allowed download (CORS). Enable the proxy, or save the URL list instead.', 'error', 7000);
        return { ok: 0, failed: failed.length };
      }
      if (failed.length) zip.file('_failed.txt', 'These images could not be fetched (CORS or HTTP error):\n\n' + failed.join('\n') + '\n');
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (blob) {
        var name = filename('zip', 'sieve-images');
        util.downloadBlob(blob, name);
        Sieve.toast('Zipped ' + ok + ' image' + (ok === 1 ? '' : 's') + (failed.length ? ' (' + failed.length + ' blocked — listed in _failed.txt)' : '') + '.', failed.length ? 'warning' : 'success', 5000);
        return { ok: ok, failed: failed.length };
      });
    });
  }

  Sieve.exporter = {
    GOOGLE_WEBHOOK_URL: GOOGLE_WEBHOOK_URL,
    APPS_SCRIPT: APPS_SCRIPT,
    toCsv: toCsv,
    toTsv: toTsv,
    csv: exportCsv,
    xlsx: exportXlsx,
    copy: copyTable,
    sheets: exportSheets,
    lines: exportLines,
    zipImages: zipImages,
    safeCell: safeCell
  };

})(window);
