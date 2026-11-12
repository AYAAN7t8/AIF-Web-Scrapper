/* ==========================================================================
   Sieve — main.js
   Shared runtime: namespace, storage, utilities, icon registry, theme,
   toasts, modals, site chrome (navbar / footer / mobile menu), scroll-spy.

   NOTE ON MODULES: every file in /js is a 'use strict' module wrapped in an
   IIFE that registers itself on the single global `Sieve` namespace. They are
   loaded with classic <script> tags (in dependency order) instead of
   <script type="module"> so the site works when index.html is opened straight
   from disk (file://), where browsers block ES-module imports.
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve = global.Sieve || {};

  Sieve.config = {
    appName: 'Sieve',
    issueUrl: 'mailto:hello@sieve.example?subject=Sieve%20issue%20report',
    defaultProxy: 'http://localhost:8787',
    ns: 'sieve.'
  };

  /* ----------------------------------------------------------------- store */
  Sieve.store = {
    get: function (key, fallback) {
      try {
        var raw = global.localStorage.getItem(Sieve.config.ns + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { global.localStorage.setItem(Sieve.config.ns + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove: function (key) {
      try { global.localStorage.removeItem(Sieve.config.ns + key); } catch (e) { /* ignore */ }
    }
  };

  /* ------------------------------------------------------------------ util */
  var util = Sieve.util = {};

  util.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  util.debounce = function (fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  util.sleep = function (ms, signal) {
    return new Promise(function (resolve, reject) {
      if (signal && signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      var t = setTimeout(done, ms);
      function done() { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }
      function onAbort() { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  util.fmtNum = function (n) { return Number(n || 0).toLocaleString('en-US'); };

  util.fmtDuration = function (ms) {
    ms = Math.max(0, ms || 0);
    if (ms < 1000) return Math.round(ms) + ' ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + ' s';
    var m = Math.floor(s / 60);
    return m + 'm ' + String(Math.round(s - m * 60)).padStart(2, '0') + 's';
  };

  util.timestamp = function () {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  };

  util.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  util.copyText = function (text) {
    function legacy() {
      return new Promise(function (resolve, reject) {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        ok ? resolve() : reject(new Error('Copy failed'));
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText && global.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(legacy);
    }
    return legacy();
  };

  util.host = function (url) {
    var d = /^demo:\/\/([^/?#]+)/i.exec(url || '');
    if (d) return 'demo:' + d[1];
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  };

  /** Accepts "example.com/a" and returns "https://example.com/a"; keeps demo:// intact. */
  util.normalizeUrl = function (input) {
    var v = String(input || '').trim();
    if (!v) return '';
    if (/^demo:\/\//i.test(v)) return v;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'https://' + v;
    try {
      var u = new URL(v);
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.href;
    } catch (e) { return ''; }
  };

  util.uid = function () { return Math.random().toString(36).slice(2, 10); };

  /** Escape a string for use inside a RegExp. */
  util.reEscape = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  /* ----------------------------------------------------------------- icons */
  var P = {
    'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    'table': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    'phone': '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
    'link': '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>',
    'file-text': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    'star': '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    'users': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    'building': '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
    'globe': '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    'briefcase': '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    'download': '<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>',
    'upload': '<path d="M12 16V5M7 9l5-5 5 5M4 20h16"/>',
    'copy': '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2"/>',
    'check': '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    'x': '<path d="M6 6l12 12M18 6 6 18"/>',
    'chevron-right': '<path d="m9 6 6 6-6 6"/>',
    'chevron-left': '<path d="m15 6-6 6 6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'play': '<path d="M7 4.5v15l12-7.5z"/>',
    'square': '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    'refresh': '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    'moon': '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    'menu': '<path d="M4 7h16M4 12h16M4 17h16"/>',
    'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    'lock': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    'shield': '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    'zap': '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    'repeat': '<path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"/>',
    'layers': '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    'sheet': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8 13h8M8 17h8M12 11v8"/>',
    'sliders': '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    'alert': '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17.5v.01"/>',
    'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>',
    'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    'circle-x': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    'trash': '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>',
    'external': '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    'code': '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    'book': '<path d="M5 4a1 1 0 0 1 1-1h13v15H6a1 1 0 0 0-1 1z"/><path d="M5 19a2 2 0 0 0 2 2h12v-3"/>',
    'cart': '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 8H6"/>',
    'bar-chart': '<path d="M4 20h16M7 20v-7M12 20V5M17 20v-10"/>',
    'flask': '<path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3M7.5 15h9"/>',
    'trending': '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
    'target': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    'sparkles': '<path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    'scroll': '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/>',
    'eye': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'filter': '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    'columns': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    'edit': '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    'clipboard': '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
    'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    'at-sign': '<circle cx="12" cy="12" r="4"/><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7"/>',
    'map-pin': '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    'share': '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>',
    'list': '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    'grid': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'bug': '<path d="M8 8h8v6a4 4 0 0 1-8 0z"/><path d="M9 5l1.5 2M15 5l-1.5 2M4 13h4M16 13h4M5 19l3-2M19 19l-3-2"/>',
    'database': '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    'server': '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    'cursor': '<path d="m5 3 14 7-6 2-2 6z"/>',
    'file-up': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9.5 14.5 12 12l2.5 2.5"/>'
  };

  Sieve.icons = {
    svg: function (name, size, cls) {
      var body = P[name] || P['info'];
      size = size || 18;
      return '<svg class="icon' + (cls ? ' ' + cls : '') + '" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        body + '</svg>';
    },
    hydrate: function (root) {
      (root || document).querySelectorAll('[data-icon]:not([data-hydrated])').forEach(function (el) {
        el.innerHTML = Sieve.icons.svg(el.getAttribute('data-icon'), parseInt(el.getAttribute('data-size'), 10) || 16);
        el.setAttribute('data-hydrated', '1');
      });
    },
    has: function (name) { return !!P[name]; }
  };

  /* ----------------------------------------------------------------- theme */
  Sieve.theme = {
    current: function () { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; },
    set: function (t) {
      document.documentElement.setAttribute('data-theme', t);
      Sieve.store.set('theme', t);
    },
    toggle: function () { Sieve.theme.set(Sieve.theme.current() === 'dark' ? 'light' : 'dark'); }
  };
  (function initTheme() {
    var saved = Sieve.store.get('theme', null);
    var t = saved || (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
  })();

  /* ----------------------------------------------------------------- toasts */
  var toastStack;
  Sieve.toast = function (message, type, duration) {
    type = type || 'info';
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.className = 'toast-stack';
      toastStack.setAttribute('role', 'region');
      toastStack.setAttribute('aria-live', 'polite');
      toastStack.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(toastStack);
    }
    var icon = { success: 'circle-check', error: 'circle-x', warning: 'alert', info: 'info' }[type] || 'info';
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = Sieve.icons.svg(icon, 16) + '<div class="toast-msg"></div>' +
      '<button class="toast-close" type="button" aria-label="Dismiss">' + Sieve.icons.svg('x', 14) + '</button>';
    el.querySelector('.toast-msg').textContent = message;
    toastStack.appendChild(el);
    while (toastStack.children.length > 4) toastStack.firstChild.remove();
    var timer;
    function close() {
      clearTimeout(timer);
      if (!el.parentNode) return;
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 170);
    }
    el.querySelector('.toast-close').addEventListener('click', close);
    timer = setTimeout(close, duration || (type === 'error' ? 6000 : 3500));
    return close;
  };

  /* ------------------------------------------------------------------ modal */
  /**
   * Sieve.modal.open({ title, html | node, size: 'lg', footer: [{label, variant, close, onClick}] })
   * Returns { el, body, close }.
   */
  Sieve.modal = {
    open: function (opts) {
      opts = opts || {};
      var prevFocus = document.activeElement;
      var back = document.createElement('div');
      back.className = 'modal-backdrop';
      var titleId = 'modal-title-' + util.uid();
      back.innerHTML =
        '<div class="modal ' + (opts.size === 'lg' ? 'modal-lg' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
        '<div class="modal-head"><h3 id="' + titleId + '"></h3>' +
        '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-close aria-label="Close">' + Sieve.icons.svg('x', 16) + '</button></div>' +
        '<div class="modal-body"></div>' +
        (opts.footer && opts.footer.length ? '<div class="modal-foot"></div>' : '') +
        '</div>';
      back.querySelector('h3').textContent = opts.title || '';
      var body = back.querySelector('.modal-body');
      if (opts.node) body.appendChild(opts.node); else body.innerHTML = opts.html || '';
      Sieve.icons.hydrate(body);

      var closed = false;
      function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        back.classList.remove('is-open');
        setTimeout(function () { back.remove(); }, 190);
        document.body.style.overflow = '';
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) { /* ignore */ } }
        if (opts.onClose) opts.onClose();
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
        if (e.key !== 'Tab') return;
        var f = back.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
      back.querySelector('[data-close]').addEventListener('click', close);

      if (opts.footer && opts.footer.length) {
        var foot = back.querySelector('.modal-foot');
        opts.footer.forEach(function (b) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn ' + (b.variant ? 'btn-' + b.variant : '');
          btn.textContent = b.label;
          btn.addEventListener('click', function () {
            var r = b.onClick ? b.onClick(api) : undefined;
            if (b.close !== false && r !== false) close();
          });
          foot.appendChild(btn);
        });
      }

      document.body.appendChild(back);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(function () {
        back.classList.add('is-open');
        var focusEl = back.querySelector('[data-autofocus]') || back.querySelector('input, textarea, select, .modal-foot .btn-primary') || back.querySelector('[data-close]');
        if (focusEl) focusEl.focus();
      });
      var api = { el: back, body: body, close: close };
      return api;
    },
    /** Simple confirm dialog -> Promise<boolean> */
    confirm: function (title, message, okLabel, variant) {
      return new Promise(function (resolve) {
        var done = false;
        Sieve.modal.open({
          title: title,
          html: '<p>' + util.esc(message) + '</p>',
          footer: [
            { label: 'Cancel', onClick: function () { done = true; resolve(false); } },
            { label: okLabel || 'Confirm', variant: variant || 'primary', onClick: function () { done = true; resolve(true); } }
          ],
          onClose: function () { if (!done) resolve(false); }
        });
      });
    }
  };

  /* ------------------------------------------------------------ site chrome */
  var LOGO = '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#32BFDA"/><path d="M7.5 8.5h17l-6.4 7.4V22l-4.2 2v-8.1z" fill="none" stroke="#0A0A0A" stroke-width="2.2" stroke-linejoin="round"/><circle cx="9.2" cy="24.2" r="2.1" fill="#FF5E57"/><circle cx="23.4" cy="24.4" r="2.1" fill="#FCC55F"/></svg>';
    '<path d="M8 9h16l-6 7.2V23l-4 2v-8.8z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
    '<circle cx="23.5" cy="23.5" r="2.2" fill="#00C48C"/></svg>';
  Sieve.logoSvg = LOGO;

  var NAV = [
    ['app.html', 'Scraper', 'app'],
    ['scrapers.html', 'Built-in Scrapers', 'scrapers'],
    ['bulk.html', 'Bulk Scrape', 'bulk'],
    ['how-it-works.html', 'How It Works', 'how'],
    ['docs.html', 'Docs', 'docs'],
    ['index.html#extension', 'Extension', 'ext']
  ];

  function themeButton() {
    return '<button class="btn btn-ghost btn-icon theme-toggle" type="button" data-theme-toggle aria-label="Toggle dark mode">' +
      '<span class="icon-sun" data-icon="sun" data-size="18"></span><span class="icon-moon" data-icon="moon" data-size="18"></span></button>';
  }
  Sieve.themeButtonHtml = themeButton;

  function mountChrome() {
    var page = document.body.getAttribute('data-page') || '';
    var navHost = document.getElementById('site-nav');
    if (navHost) {
      var links = NAV.map(function (n) {
        return '<a href="' + n[0] + '"' + (n[2] === page ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
      }).join('');
      navHost.outerHTML =
        '<header class="nav" id="nav"><div class="container nav-inner">' +
        '<a class="brand" href="index.html" aria-label="Sieve home">' + LOGO + 'Sieve</a>' +
        '<nav class="nav-links" aria-label="Primary">' + links + '</nav>' +
        '<div class="nav-actions">' +
        themeButton() +
        '<a class="btn btn-primary hide-mobile" href="app.html">Launch App</a>' +
        '<button class="btn btn-ghost btn-icon nav-burger" type="button" id="nav-burger" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu"><span data-icon="menu" data-size="20"></span></button>' +
        '</div></div></header>' +
        '<div class="mobile-menu" id="mobile-menu">' + links +
        '<a class="btn btn-primary" href="app.html">Launch App</a></div>';
    }
    var footHost = document.getElementById('site-footer');
    if (footHost) {
      footHost.outerHTML =
        '<footer class="footer">' +
        '<div class="foot-line"><span>Sieve: scrape what you see</span>' +
        '<nav aria-label="Footer"><a href="app.html">Scraper</a><a href="docs.html">Docs</a><a href="index.html#extension">Extension</a><a href="' + Sieve.config.issueUrl + '">Report an issue</a></nav>' +
        '<span>&copy; 2026 &middot; <a href="docs.html#cors">Privacy</a></span></div></footer>';
    }
    Sieve.icons.hydrate(document);

    var nav = document.getElementById('nav');
    if (nav) {
      var onScroll = function () { nav.classList.toggle('is-scrolled', global.scrollY > 4); };
      onScroll();
      global.addEventListener('scroll', onScroll, { passive: true });
    }
    var burger = document.getElementById('nav-burger');
    var menu = document.getElementById('mobile-menu');
    if (burger && menu) {
      burger.addEventListener('click', function () {
        var open = menu.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', String(open));
      });
      menu.addEventListener('click', function (e) { if (e.target.closest('a')) menu.classList.remove('is-open'); });
    }
  }

  /** Delegated handler: any [data-theme-toggle] button flips the theme. */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (t) Sieve.theme.toggle();
  });

  /* -------------------------------------------------------------- scroll-spy */
  Sieve.scrollSpy = function (navSelector) {
    var nav = document.querySelector(navSelector);
    if (!nav || !('IntersectionObserver' in global)) return;
    var map = {};
    nav.querySelectorAll('a[href^="#"]').forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var ids = Object.keys(map);
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          Object.keys(map).forEach(function (k) { map[k].classList.toggle('is-active', k === en.target.id); });
        }
      });
    }, { rootMargin: '-80px 0px -65% 0px', threshold: 0 });
    ids.forEach(function (id) { var s = document.getElementById(id); if (s) obs.observe(s); });
  };

  Sieve.ready = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  };

  Sieve.ready(function () {
    mountChrome();
    Sieve.icons.hydrate(document);
  });

})(window);
