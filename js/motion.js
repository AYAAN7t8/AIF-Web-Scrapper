'use strict';
/* Scroll motion controller for the home page.
   - splits statements into words that rise as they arrive
   - floods each band with its colour (and flips its switch) as it crosses the reading line
   - counts numbers up when their tile arrives
   Everything is started once, never replayed on scroll-up (except the band, which rewinds
   with the scroll so the page stays consistent). Reduced motion gets the finished page. */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canScrub = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'));
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- 1. words ---- */
  function wrapUnit(node, idx) {
    var w = document.createElement('span'), i = document.createElement('i');
    w.className = 'w'; i.style.setProperty('--wi', String(idx));
    node.parentNode.insertBefore(w, node); i.appendChild(node); w.appendChild(i);
  }
  function splitWords(el) {
    var n = 0;
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        var parts = node.nodeValue.split(/(\s+)/), frag = document.createDocumentFragment();
        parts.forEach(function (p) {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
          var w = document.createElement('span'), i = document.createElement('i');
          w.className = 'w'; i.style.setProperty('--wi', String(n++)); i.textContent = p; w.appendChild(i); frag.appendChild(w);
        });
        el.replaceChild(frag, node);
      } else if (node.nodeType === 1 && !node.classList.contains('w')) { wrapUnit(node, n++); }
    });
    el.setAttribute('data-words', '');
  }
  var statements = ['.band-s', '.ext-copy h2', '.why-copy h2', '.why-copy p', '.cta-form h2', '.states h2'];
  statements.forEach(function (sel) { $$(sel).forEach(splitWords); });

  /* ---- 2. one observer starts everything that is triggered ---- */
  var targets = $$('[data-words], .ext, .cta, .tile');
  $$('.ext-steps li').forEach(function (li, i) { li.style.setProperty('--li', String(i)); });
  $$('.tile').forEach(function (t, i) { t.style.setProperty('--ti', String(i)); });
  if (!canScrub) $$('.field, .tile, .row-ui, .ext-pic, .why-woman, .why-gold').forEach(function (el) { targets.push(el); });

  function countUp(el) {
    var to = parseInt(el.getAttribute('data-count'), 10);
    if (isNaN(to) || reduce) return;
    var t0 = performance.now(), dur = 1100;
    el.textContent = '0';
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = String(Math.round(to * e));
      if (p < 1) requestAnimationFrame(step); else el.textContent = String(to);
    })(t0);
  }
  function arrive(el) {
    el.classList.add('in');
    $$('em.n[data-count]', el).forEach(countUp);
  }
  if ('IntersectionObserver' in window) {
    var seen = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { arrive(e.target); seen.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -14% 0px', threshold: 0.12 });
    targets.forEach(function (el) { seen.observe(el); });
  } else targets.forEach(arrive);

  /* ---- 3. bands: the colour floods in as the band reaches the reading line ---- */
  function setBand(band, on) {
    var sw = band.querySelector('.sw');
    if (sw && (sw.getAttribute('aria-checked') === 'true') !== on) sw.click();   // home.js owns the toggle and the count-up
  }
  /* the text ink follows the flood by half a second, so it is never dark on a dark ground */
  $$('.band').forEach(function (band) {
    var timer = 0;
    function ink() { clearTimeout(timer); var on = band.getAttribute('data-on') === 'true'; timer = setTimeout(function () { band.setAttribute('data-ink', on ? 'on' : 'off'); }, on && !reduce ? 520 : 0); }
    new MutationObserver(ink).observe(band, { attributes: true, attributeFilter: ['data-on'] });
  });
  if ('IntersectionObserver' in window) {
    var line = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { setBand(e.target, true); return; }
        // off the line: passed it (stays on, even after a jump) or not reached yet (rewinds)
        setBand(e.target, e.boundingClientRect.bottom < window.innerHeight * 0.56);
      });
    }, { rootMargin: '-56% 0px -43% 0px' });
    $$('.band').forEach(function (b) { line.observe(b); });
  } else $$('.band').forEach(function (b) { setBand(b, true); });
})();
