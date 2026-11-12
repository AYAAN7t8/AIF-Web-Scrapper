/* ==========================================================================
   Sieve — ui.js
   Rendering + interaction components shared by app.html and bulk.html:
   • DataTable   — virtualized preview, editable headers, column on/off checkboxes
   • SchemaEditor— live column list with rename inputs + filter toggles
   • Result views— list (emails/phones/links/social), image grid, page text, reviews
   • Drawer      — sidebar / inspector slide-over for small screens
   • helpers     — skeletons, status pill
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve = global.Sieve || {};
  var util = Sieve.util, esc = util.esc, icon = function (n, s) { return Sieve.icons.svg(n, s || 16); };

  var ROW_H = 34;
  var HEAD_H = 38;
  var PREVIEW_LIMIT = 50;

  /* ----------------------------------------------------------------- helpers */
  function statusPill(el, status, label) {
    if (!el) return;
    el.setAttribute('data-status', status);
    el.innerHTML = '<span class="dot"></span><span>' + esc(label || status) + '</span>';
  }

  function skeletonTable(cols, rows) {
    cols = cols || 5; rows = rows || 8;
    var tpl = 'grid-template-columns:repeat(' + cols + ',1fr)';
    var head = '<div class="sk-row sk-head" style="' + tpl + '">' + new Array(cols + 1).join('<div class="skeleton"></div>') + '</div>';
    var body = '';
    for (var r = 0; r < rows; r++) body += '<div class="sk-row" style="' + tpl + '">' + new Array(cols + 1).join('<div class="skeleton" style="opacity:' + (1 - r * 0.08).toFixed(2) + '"></div>') + '</div>';
    return '<div class="skeleton-table" aria-busy="true" aria-label="Loading">' + head + body + '</div>';
  }

  function isLinkable(v) { return /^https?:\/\/[^\s]+$/i.test(v); }

  function cellHtml(v) {
    if (v == null || v === '') return '<td class="empty"></td>';
    var s = String(v);
    if (/^data:/i.test(s)) return '<td title="' + esc(s.slice(0, 80)) + '…">[inline data · ' + util.fmtNum(s.length) + ' chars]</td>';
    if (isLinkable(s)) return '<td title="' + esc(s) + '"><a href="' + esc(s) + '" target="_blank" rel="noopener noreferrer">' + esc(s) + '</a></td>';
    return '<td title="' + esc(s.length > 60 ? s : '') + '">' + esc(s) + '</td>';
  }

  /* --------------------------------------------------------------- DataTable */
  function DataTable(host, ds, opts) {
    opts = opts || {};
    var self = this;
    this.host = host; this.ds = ds; this.showAll = false; this.limit = opts.previewLimit || PREVIEW_LIMIT;
    this.onShowAllChange = opts.onShowAllChange;
    host.innerHTML =
      '<div class="table-wrap" data-role="wrap" tabindex="0" role="region" aria-label="Data preview"><table class="data-table"><thead></thead><tbody></tbody></table></div>' +
      '<div class="table-tools" data-role="note" style="border-top:1px solid var(--border)"></div>';
    this.wrap = host.querySelector('[data-role=wrap]');
    this.thead = host.querySelector('thead');
    this.tbody = host.querySelector('tbody');
    this.note = host.querySelector('[data-role=note]');
    this._raf = 0; this._rows = []; this._cols = [];

    this.wrap.addEventListener('scroll', function () {
      if (self._raf) return;
      self._raf = requestAnimationFrame(function () { self._raf = 0; self.renderBody(); });
    }, { passive: true });

    this.thead.addEventListener('change', function (e) {
      var cb = e.target.closest('input[data-key]');
      if (cb) ds.setEnabled(cb.getAttribute('data-key'), cb.checked, 'table');
    });
    this.thead.addEventListener('keydown', function (e) {
      var n = e.target.closest('.th-name');
      if (!n) return;
      if (e.key === 'Enter') { e.preventDefault(); n.blur(); }
      else if (e.key === 'Escape') { n.textContent = n.getAttribute('data-orig'); n.blur(); }
    });
    this.thead.addEventListener('paste', function (e) {
      if (!e.target.closest('.th-name')) return;
      e.preventDefault();
      var t = (e.clipboardData || global.clipboardData).getData('text').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, t);
    });
    this.thead.addEventListener('focusin', function (e) {
      var n = e.target.closest('.th-name');
      if (!n) return;
      n.setAttribute('data-orig', n.textContent);
      var r = document.createRange(); r.selectNodeContents(n);
      var s = global.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    this.thead.addEventListener('focusout', function (e) {
      var n = e.target.closest('.th-name');
      if (!n) return;
      var key = n.closest('th').getAttribute('data-key'), val = n.textContent.replace(/\s+/g, ' ').trim();
      if (!val) { n.textContent = n.getAttribute('data-orig'); return; }
      n.textContent = val;
      ds.rename(key, val, 'table');
    });
    this.note.addEventListener('click', function (e) {
      if (e.target.closest('[data-toggle-all]')) { self.setShowAll(!self.showAll); }
    });

    this._unsub = ds.on(function (ev) { self.onChange(ev); });
    this.refresh();
  }

  DataTable.prototype.setShowAll = function (v) {
    this.showAll = !!v;
    this.wrap.scrollTop = 0;
    this.renderBody(); this.renderNote();
    if (this.onShowAllChange) this.onShowAllChange(this.showAll);
  };

  DataTable.prototype.onChange = function (ev) {
    if (ev.type === 'reset' || ev.type === 'columns') this.refresh();
    else if (ev.type === 'rows') { this._rows = this.ds.visibleRows(); this.renderBody(); this.renderNote(); }
    else if (ev.type === 'toggle') { this.syncHead(); this.refreshRows(); }
    else if (ev.type === 'rename') {
      if (ev.origin !== 'table') this.syncHead();
    }
  };

  DataTable.prototype.shownCols = function () {
    return this.ds.allColumns().filter(function (c) { return !c.meta || c.enabled; });
  };

  DataTable.prototype.refresh = function () {
    this._cols = this.shownCols();
    this._rows = this.ds.visibleRows();
    this.renderHead(); this.renderBody(); this.renderNote();
  };
  DataTable.prototype.refreshRows = function () {
    this._cols = this.shownCols();
    this._rows = this.ds.visibleRows();
    this.renderHead(); this.renderBody(); this.renderNote();
  };

  DataTable.prototype.renderHead = function () {
    var cols = this._cols;
    this.thead.innerHTML = '<tr><th class="rownum" scope="col">#</th>' + cols.map(function (c) {
      return '<th scope="col" data-key="' + esc(c.key) + '" class="' + (c.enabled ? '' : 'is-off') + '"><div class="th-inner">' +
        '<input class="check" type="checkbox" data-key="' + esc(c.key) + '"' + (c.enabled ? ' checked' : '') + ' aria-label="Include column ' + esc(c.name) + '">' +
        '<span class="th-name" contenteditable="true" spellcheck="false" role="textbox" aria-label="Column name" data-tip="Click to rename">' + esc(c.name) + '</span></div></th>';
    }).join('') + '</tr>';
  };

  /** Update checkbox/name state without rebuilding (keeps focus while typing). */
  DataTable.prototype.syncHead = function () {
    var cols = this.shownCols(), same = cols.length === this._cols.length && cols.every(function (c, i) { return c.key === this._cols[i].key; }, this);
    if (!same) { this._cols = cols; this.renderHead(); this.renderBody(); return; }
    this._cols = cols;
    var ths = this.thead.querySelectorAll('th[data-key]');
    cols.forEach(function (c, i) {
      var th = ths[i]; if (!th) return;
      th.classList.toggle('is-off', !c.enabled);
      var cb = th.querySelector('input'); if (cb) cb.checked = c.enabled;
      var nm = th.querySelector('.th-name');
      if (nm && document.activeElement !== nm && nm.textContent !== c.name) nm.textContent = c.name;
    });
  };

  DataTable.prototype.renderBody = function () {
    var cols = this._cols, rows = this._rows;
    var total = rows.length;
    var visibleCount = this.showAll ? total : Math.min(total, this.limit);
    var span = cols.length + 1;
    if (!visibleCount) {
      this.tbody.innerHTML = '<tr><td colspan="' + span + '" style="height:80px;text-align:center;color:var(--muted);font-family:var(--font-sans)">No rows to show yet.</td></tr>';
      return;
    }
    var viewH = this.wrap.clientHeight || 400;
    var scroll = Math.max(0, this.wrap.scrollTop - HEAD_H);
    var start = Math.max(0, Math.floor(scroll / ROW_H) - 8);
    var end = Math.min(visibleCount, start + Math.ceil(viewH / ROW_H) + 18);
    var html = '';
    if (start > 0) html += '<tr class="spacer-row" aria-hidden="true"><td colspan="' + span + '" style="height:' + (start * ROW_H) + 'px"></td></tr>';
    for (var i = start; i < end; i++) {
      var r = rows[i], tds = '';
      for (var c = 0; c < cols.length; c++) {
        var col = cols[c], v = col.key === '__source_url' ? r.src : col.key === '__page_index' ? r.page : r.v[col.key];
        var cell = cellHtml(v);
        if (!col.enabled) cell = cell.replace('<td', '<td class="is-off"').replace('class="is-off" class="empty"', 'class="is-off empty"');
        tds += cell;
      }
      html += '<tr><td class="rownum">' + (i + 1) + '</td>' + tds + '</tr>';
    }
    if (end < visibleCount) html += '<tr class="spacer-row" aria-hidden="true"><td colspan="' + span + '" style="height:' + ((visibleCount - end) * ROW_H) + 'px"></td></tr>';
    this.tbody.innerHTML = html;
  };

  DataTable.prototype.renderNote = function () {
    var total = this._rows.length;
    if (!total) { this.note.innerHTML = '<span class="meta">No rows yet</span>'; return; }
    if (total <= this.limit) { this.note.innerHTML = '<span class="meta">Showing all ' + util.fmtNum(total) + ' row' + (total === 1 ? '' : 's') + '</span>'; return; }
    this.note.innerHTML = this.showAll
      ? '<span class="meta">Showing all ' + util.fmtNum(total) + ' rows (virtualized)</span><span class="spacer"></span><button class="btn btn-xs" type="button" data-toggle-all>Show first ' + this.limit + '</button>'
      : '<span class="meta">Previewing first ' + this.limit + ' of ' + util.fmtNum(total) + ' rows — exports include every row</span><span class="spacer"></span><button class="btn btn-xs" type="button" data-toggle-all>Show all ' + util.fmtNum(total) + '</button>';
  };

  DataTable.prototype.destroy = function () { this.host.innerHTML = ''; };

  /* ------------------------------------------------------------ SchemaEditor */
  function SchemaEditor(host, ds) {
    var self = this;
    this.host = host; this.ds = ds;
    host.addEventListener('input', function (e) {
      var inp = e.target.closest('input.input[data-key]');
      if (inp && inp.value.trim()) ds.rename(inp.getAttribute('data-key'), inp.value, 'schema');
    });
    host.addEventListener('focusout', function (e) {
      var inp = e.target.closest('input.input[data-key]');
      if (!inp) return;
      var c = ds.allColumns().find(function (x) { return x.key === inp.getAttribute('data-key'); });
      if (c && !inp.value.trim()) inp.value = c.name;
    });
    host.addEventListener('change', function (e) {
      var cb = e.target.closest('input.check[data-key]');
      if (cb) ds.setEnabled(cb.getAttribute('data-key'), cb.checked, 'schema');
    });
    ds.on(function (ev) {
      if (ev.type === 'reset' || ev.type === 'columns') self.render();
      else if (ev.type === 'toggle' || (ev.type === 'rename' && ev.origin !== 'schema')) self.sync();
    });
    this.render();
  }
  SchemaEditor.prototype.render = function () {
    var cols = this.ds.allColumns();
    var dataCols = this.ds.columns;
    if (!dataCols.length) {
      this.host.innerHTML = '<p class="text-sm muted">Columns show up here after you scrape. Rename them or switch them off — the preview and every export follow instantly.</p>';
      return;
    }
    this.host.innerHTML = '<div class="schema-list">' + cols.map(function (c, i) {
      return '<div class="schema-row' + (c.enabled ? '' : ' is-off') + '" data-row="' + esc(c.key) + '"><span class="idx">' + (i + 1) + '</span>' +
        '<input class="check" type="checkbox" data-key="' + esc(c.key) + '"' + (c.enabled ? ' checked' : '') + ' aria-label="Include ' + esc(c.name) + '">' +
        '<input class="input input-sm' + (c.meta ? ' mono' : '') + '" type="text" data-key="' + esc(c.key) + '" value="' + esc(c.name) + '" aria-label="Column name" spellcheck="false"></div>';
    }).join('') + '</div>';
  };
  SchemaEditor.prototype.sync = function () {
    var self = this;
    this.ds.allColumns().forEach(function (c) {
      var row = self.host.querySelector('[data-row="' + (global.CSS && CSS.escape ? CSS.escape(c.key) : c.key) + '"]');
      if (!row) return;
      row.classList.toggle('is-off', !c.enabled);
      row.querySelector('input.check').checked = c.enabled;
      var inp = row.querySelector('input.input');
      if (document.activeElement !== inp) inp.value = c.name;
    });
  };

  /* ------------------------------------------------------------- Result views */
  function keyFor(ds, idx) { return ds.columns[idx] ? ds.columns[idx].key : null; }

  function findKey(ds, re) {
    var c = ds.columns.find(function (x) { return re.test(x.key); });
    return c ? c.key : null;
  }

  function copyButton(value, label) {
    return '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-copy="' + esc(value) + '" aria-label="' + esc(label || 'Copy') + '" data-tip="Copy">' + icon('copy', 15) + '</button>';
  }

  function bindCopy(host) {
    if (host._copyBound) return;
    host._copyBound = true;
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy]');
      if (!b) return;
      util.copyText(b.getAttribute('data-copy')).then(function () {
        Sieve.toast('Copied', 'success', 1400);
        b.innerHTML = icon('check', 15);
        setTimeout(function () { b.innerHTML = icon('copy', 15); }, 1200);
      }, function () { Sieve.toast('Clipboard blocked by the browser', 'error'); });
    });
  }

  /** emails / phones / links / social */
  function renderList(host, ds, def) {
    bindCopy(host);
    var pk = keyFor(ds, def.primary || 0), sk = def.secondary != null ? keyFor(ds, def.secondary) : null;
    var rows = ds.visibleRows();
    if (!rows.length) { host.innerHTML = ''; return; }
    var CAP = 600, slice = rows.slice(0, CAP);
    host.innerHTML = '<div class="result-list">' + slice.map(function (r) {
      var v = r.v[pk] || '', sub = sk ? (r.v[sk] || '') : '';
      if (def.id === 'social') sub = (r.v[keyFor(ds, 0)] || '') + ' · @' + (r.v[keyFor(ds, 1)] || '');
      var shown = isLinkable(v) ? '<a href="' + esc(v) + '" target="_blank" rel="noopener noreferrer">' + esc(v) + '</a>' : esc(v);
      return '<div class="result-item"><div class="val" title="' + esc(v) + '">' + shown + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</div>' + copyButton(v) + '</div>';
    }).join('') + '</div>' + (rows.length > CAP ? '<div class="table-tools"><span class="meta">Showing first ' + CAP + ' of ' + util.fmtNum(rows.length) + ' — switch to Table view or export for all.</span></div>' : '');
  }

  /** images grid with selection */
  function ImageGrid(host, ds, opts) {
    var self = this;
    this.host = host; this.ds = ds; this.selected = new Set(); this.onSelect = opts && opts.onSelect;
    this.cap = 240;
    host.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var card = e.target.closest('.img-card');
      if (!card) return;
      var url = card.getAttribute('data-url');
      if (e.target.closest('input')) { self.toggle(url, e.target.checked, card); return; }
      if (e.target.closest('.img-thumb')) self.toggle(url, !self.selected.has(url), card);
      if (e.target.closest('[data-more]')) { self.cap += 240; self.render(); }
    });
    host.addEventListener('error', function (e) {
      var img = e.target;
      if (img && img.tagName === 'IMG') {
        var th = img.closest('.img-thumb');
        if (th) th.innerHTML = '<span class="muted text-xs" style="padding:8px;text-align:center">Preview blocked<br>(still downloadable)</span>';
      }
    }, true);
    this.render();
  }
  ImageGrid.prototype.keys = function () {
    var ds = this.ds;
    return { url: keyFor(ds, 0), alt: keyFor(ds, 1), type: findKey(ds, /^type$/), w: findKey(ds, /^width$/), h: findKey(ds, /^height$/) };
  };
  ImageGrid.prototype.items = function () {
    var k = this.keys();
    return this.ds.visibleRows().map(function (r) { return { url: r.v[k.url] || '', alt: r.v[k.alt] || '', type: r.v[k.type] || '', w: r.v[k.w] || '', h: r.v[k.h] || '' }; })
      .filter(function (i) { return i.url; });
  };
  ImageGrid.prototype.toggle = function (url, on, card) {
    if (on) this.selected.add(url); else this.selected.delete(url);
    if (card) { card.classList.toggle('is-selected', on); var cb = card.querySelector('input'); if (cb) cb.checked = on; }
    if (this.onSelect) this.onSelect(this.selected);
  };
  ImageGrid.prototype.selectAll = function (on) {
    var self = this;
    this.items().forEach(function (i) { if (on) self.selected.add(i.url); else self.selected.delete(i.url); });
    this.render();
    if (this.onSelect) this.onSelect(this.selected);
  };
  ImageGrid.prototype.selectedItems = function () {
    var sel = this.selected;
    return this.items().filter(function (i) { return sel.has(i.url); }).map(function (i, n) { return { url: i.url, name: i.alt || ('image-' + (n + 1)) }; });
  };
  ImageGrid.prototype.render = function () {
    var items = this.items(), self = this;
    if (!items.length) { this.host.innerHTML = ''; return; }
    var slice = items.slice(0, this.cap);
    this.host.innerHTML = '<div class="img-grid">' + slice.map(function (i) {
      var sel = self.selected.has(i.url);
      var dims = i.w && i.h ? ' · ' + i.w + '×' + i.h : '';
      return '<div class="img-card' + (sel ? ' is-selected' : '') + '" data-url="' + esc(i.url) + '">' +
        '<input class="check" type="checkbox"' + (sel ? ' checked' : '') + ' aria-label="Select image">' +
        '<div class="img-thumb" role="button" tabindex="-1"><img src="' + esc(i.url) + '" alt="' + esc(i.alt) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>' +
        '<div class="img-meta" title="' + esc(i.alt || i.url) + '">' + esc((i.type || 'img').toUpperCase() + dims + (i.alt ? ' · ' + i.alt : '')) + '</div></div>';
    }).join('') + '</div>' +
      (items.length > this.cap ? '<div class="table-tools"><span class="meta">Showing ' + this.cap + ' of ' + util.fmtNum(items.length) + ' images.</span><span class="spacer"></span><button class="btn btn-xs" type="button" data-more>Show more</button></div>' : '');
  };

  /** clean page text */
  function renderText(host, ds) {
    var kSec = findKey(ds, /^section$/), kTxt = findKey(ds, /^text$/);
    var rows = ds.visibleRows();
    if (!rows.length) { host.innerHTML = ''; return; }
    var html = '', last = null, words = 0;
    rows.forEach(function (r) {
      var sec = r.v[kSec] || '', t = r.v[kTxt] || '';
      words += t ? t.split(/\s+/).length : 0;
      if (sec !== last && sec) { last = sec; if (t === sec) { html += '<h4 style="margin:18px 0 6px;color:var(--text)">' + esc(sec) + '</h4>'; return; } html += '<h4 style="margin:18px 0 6px;color:var(--text)">' + esc(sec) + '</h4>'; }
      html += '<p style="margin:0 0 8px">' + esc(t) + '</p>';
    });
    host.innerHTML = '<div class="text-view" style="white-space:normal">' + html + '</div><div class="table-tools"><span class="meta">' + util.fmtNum(words) + ' words · ' + util.fmtNum(rows.length) + ' blocks</span></div>';
  }
  function plainText(ds) {
    var kTxt = findKey(ds, /^text$/);
    return ds.visibleRows().map(function (r) { return r.v[kTxt] || ''; }).filter(Boolean).join('\n\n');
  }

  function starsHtml(n) {
    var v = parseFloat(n);
    if (isNaN(v)) return '';
    var full = Math.max(0, Math.min(5, Math.round(v)));
    return '<span class="stars" aria-label="' + v + ' out of 5">' + '★'.repeat(full) + '<span style="opacity:.3">' + '★'.repeat(5 - full) + '</span></span> <span class="muted text-sm">' + v + '</span>';
  }

  function renderReviews(host, ds) {
    var k = { a: findKey(ds, /^author$/), r: findKey(ds, /^rating$/), t: findKey(ds, /^title$/), d: findKey(ds, /^date$/), b: findKey(ds, /^review$/) };
    var rows = ds.visibleRows();
    if (!rows.length) { host.innerHTML = ''; return; }
    var nums = rows.map(function (r) { return parseFloat(r.v[k.r]); }).filter(function (n) { return !isNaN(n); });
    var avg = nums.length ? (nums.reduce(function (a, b) { return a + b; }, 0) / nums.length) : null;
    var head = '<div class="table-tools" style="border-top:0;background:transparent"><span class="meta"><b style="color:var(--text)">' + rows.length + '</b> reviews' +
      (avg != null ? ' · average <b style="color:var(--text)">' + avg.toFixed(2) + '</b> / 5' : '') + '</span></div>';
    host.innerHTML = head + rows.slice(0, 300).map(function (r) {
      return '<div class="review-card"><div class="row" style="gap:10px;flex-wrap:wrap">' + (starsHtml(r.v[k.r]) || '<span class="muted text-sm">no rating</span>') +
        '<strong style="font-size:14px">' + esc(r.v[k.a] || 'Anonymous') + '</strong><span class="muted text-sm">' + esc(r.v[k.d] || '') + '</span></div>' +
        (r.v[k.t] ? '<div style="font-weight:600;font-size:14px">' + esc(r.v[k.t]) + '</div>' : '') +
        '<p class="text-sm" style="color:var(--text-2)">' + esc(r.v[k.b] || '') + '</p></div>';
    }).join('');
  }

  /* ---------------------------------------------------------------- Drawers */
  /** Slide-over used for the mobile sidebar and the inspector. */
  function Drawer(el, scrim) {
    var self = this;
    this.el = el; this.scrim = scrim;
    this.isOpen = false;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.isOpen) self.close(); });
    if (scrim) scrim.addEventListener('click', function () { self.close(); });
  }
  Drawer.prototype.open = function () { this.isOpen = true; this.el.classList.add('is-open'); if (this.scrim) this.scrim.classList.add('is-open'); };
  Drawer.prototype.close = function () { this.isOpen = false; this.el.classList.remove('is-open'); if (this.scrim) this.scrim.classList.remove('is-open'); };
  Drawer.prototype.toggle = function () { this.isOpen ? this.close() : this.open(); };

  Sieve.ui = {
    DataTable: DataTable,
    SchemaEditor: SchemaEditor,
    ImageGrid: ImageGrid,
    Drawer: Drawer,
    renderList: renderList,
    renderText: renderText,
    renderReviews: renderReviews,
    plainText: plainText,
    bindCopy: bindCopy,
    skeletonTable: skeletonTable,
    statusPill: statusPill,
    PREVIEW_LIMIT: PREVIEW_LIMIT
  };

})(window);
