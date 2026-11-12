'use strict';
/* One row's journey: a pinned scroll scene.
   The three finished states in the markup (card, row, file) are measured, then hidden. One set of
   words is laid over them, and the scroll position moves each word from its place in one state to its
   place in the next: the name you read on the card is the same object that lands in the table cell and
   then in the line of the file. Words that only exist in one state fade where they stand; the price
   and the SKU hand over to their cleaned versions in place.
   Scrubbed, so the scrollbar is the clock: no smoothing, no duration. Each word sets off a little after
   the one to its left, so a state change reads left to right. Reduced motion keeps the static states. */
(function () {
  var sec = document.getElementById('row'), stage = document.getElementById('jr-stage');
  if (!sec || !stage || !window.requestAnimationFrame) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var ghosts = [0, 1, 2].map(function (i) { return stage.querySelector('[data-g="' + i + '"]'); });
  if (ghosts.some(function (g) { return !g; })) return;
  sec.classList.add('is-scene');

  var PARTNER = { price: 'price2', price2: 'price', sku: 'sku2', sku2: 'sku' };
  var layer = document.createElement('div'), box = document.createElement('div');
  layer.className = 'jr-m'; layer.setAttribute('aria-hidden', 'true');
  box.className = 'jr-box'; layer.appendChild(box); stage.appendChild(layer);

  function boxOf(g) { return g.matches('[data-k="box"]') ? g : g.querySelector('[data-k="box"]'); }
  var keys = [];
  ghosts.forEach(function (g) {
    Array.prototype.forEach.call(g.querySelectorAll('[data-k]'), function (el) {
      var k = el.getAttribute('data-k');
      if (k !== 'box' && keys.indexOf(k) < 0) keys.push(k);
    });
  });
  var els = {};
  keys.forEach(function (k) {
    var src = null;
    for (var i = 0; i < 3 && !src; i++) src = ghosts[i].querySelector('[data-k="' + k + '"]');
    var e = document.createElement('span');
    e.setAttribute('data-k', k); e.innerHTML = src.innerHTML;
    if (src.classList.contains('jr-thumb')) e.className = 'jr-thumb';
    layer.appendChild(e); els[k] = { el: e, f: 16, w: 1 };
  });

  var S = [], R = [], W = 1, H = 1;
  function measure() {
    var sr = stage.getBoundingClientRect();
    W = sr.width || 1; H = sr.height || 1;
    S = ghosts.map(function (g) {
      var o = {}, br = boxOf(g).getBoundingClientRect();
      o.box = { x: br.left - sr.left, y: br.top - sr.top, w: br.width, h: br.height };
      keys.forEach(function (k) {
        var el = g.querySelector('[data-k="' + k + '"]'), r = el && el.getBoundingClientRect();
        o[k] = r && r.width ? { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height, f: parseFloat(getComputedStyle(el).fontSize) } : null;
      });
      return o;
    });
    keys.forEach(function (k) {
      var base = S[0][k] || S[1][k] || S[2][k];
      if (!base) return;
      els[k].f = base.f; els[k].w = base.w;
      els[k].el.style.fontSize = base.f + 'px';
      if (k === 'thumb') { els[k].el.style.width = base.w + 'px'; els[k].el.style.height = base.h + 'px'; }
    });
    function scaleOf(k, v) { return k === 'thumb' ? v.w / els[k].w : v.f / els[k].f; }
    function find(i, k) {   // where a word that is missing from state i should wait: its partner here, else the nearest state that has it
      if (PARTNER[k] && S[i][PARTNER[k]]) return { v: S[i][PARTNER[k]], same: true };
      for (var d = 1; d < 3; d++) {
        var lo = S[i - d], hi = S[i + d];
        if (lo && lo[k]) return { v: lo[k] }; if (hi && hi[k]) return { v: hi[k] };
      }
      return null;
    }
    R = [0, 1, 2].map(function (i) {
      var o = { box: S[i].box };
      keys.forEach(function (k) {
        var v = S[i][k];
        if (v) { o[k] = { x: v.x, y: v.y, s: scaleOf(k, v), o: 1 }; return; }
        var n = find(i, k);
        if (!n) { o[k] = { x: 0, y: 0, s: 1, o: 0 }; return; }
        var drop = n.same ? 0 : (k === 'thumb' ? 0 : 14);
        o[k] = { x: n.v.x, y: n.v.y + drop, s: k === 'thumb' ? scaleOf(k, n.v) * 0.9 : (n.v.f ? n.v.f / els[k].f : 1), o: 0 };
      });
      return o;
    });
    frame();
  }

  /* scroll to journey position u in [0, 2], with a rest at each state */
  var STOPS = [[0, 0.14, 0, 0], [0.14, 0.42, 0, 1], [0.42, 0.58, 1, 1], [0.58, 0.86, 1, 2], [0.86, 1.01, 2, 2]];
  function journey(p) {
    for (var i = 0; i < STOPS.length; i++) {
      var s = STOPS[i];
      if (p < s[1]) return s[2] === s[3] ? s[2] : s[2] + (p - s[0]) / (s[1] - s[0]);
    }
    return 2;
  }
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function inOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }   // things that travel use an in-out curve
  function lerp(a, b, t) { return a + (b - a) * t; }

  var lastState = -1;
  function frame() {
    if (!R.length) return;
    var r = sec.getBoundingClientRect(), total = sec.offsetHeight - window.innerHeight;
    var p = total > 0 ? clamp(-r.top / total) : 0;
    var u = journey(p), a = Math.min(1, Math.floor(u)), t = clamp(u - a), b = a + 1;
    var st = u < 0.5 ? 0 : u < 1.5 ? 1 : 2;
    if (st !== lastState) { sec.setAttribute('data-state', String(st)); lastState = st; }

    var A = R[a], B = R[b], tb = inOut(clamp(t / 0.8));
    var bx = lerp(A.box.x, B.box.x, tb), by = lerp(A.box.y, B.box.y, tb), bw = lerp(A.box.w, B.box.w, tb), bh = lerp(A.box.h, B.box.h, tb);
    var rad = lerp(a === 0 ? 18 : 14, 14, tb);
    box.style.clipPath = 'inset(' + by.toFixed(1) + 'px ' + (W - bx - bw).toFixed(1) + 'px ' + (H - by - bh).toFixed(1) + 'px ' + bx.toFixed(1) + 'px round ' + rad.toFixed(1) + 'px)';

    keys.forEach(function (k) {
      var x = A[k], y = B[k];
      var delay = 0.06 + 0.22 * clamp(y.x / W);            // words set off left to right
      var tk = inOut(clamp((t - delay) / 0.72));
      var o = x.o === y.o ? x.o : y.o > x.o ? clamp((tk - 0.45) / 0.55) : 1 - clamp(tk / 0.4);
      var e = els[k].el;
      e.style.transform = 'translate3d(' + lerp(x.x, y.x, tk).toFixed(1) + 'px,' + lerp(x.y, y.y, tk).toFixed(1) + 'px,0) scale(' + lerp(x.s, y.s, tk).toFixed(4) + ')';
      e.style.opacity = o.toFixed(3);
    });
  }

  var ticking = false, onScreen = true;
  function onScroll() { if (!ticking && onScreen) { ticking = true; requestAnimationFrame(function () { ticking = false; frame(); }); } }
  window.addEventListener('scroll', onScroll, { passive: true });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; if (onScreen) frame(); }).observe(sec);
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(measure, 120); });
  measure();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);
})();
