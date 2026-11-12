'use strict';
/* Home page behaviour. Vanilla JS. The motion ideas (masked line reveal, text typing, count-up, magnetic press
   feedback) are re-implemented here with transform and opacity only, and all of them stand down under
   prefers-reduced-motion. Without script the page is fully readable (every .js rule is opt-in). */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wide = function () { return window.matchMedia('(min-width: 900px)').matches; };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- 1. masked headline: starts once the font is in ---- */
  function ready() { document.documentElement.classList.add('ready'); }
  requestAnimationFrame(function () { requestAnimationFrame(ready); });   // the headline arrives at once; it never waits for fonts or the load event

  /* ---- 1b. the nav steps aside going down, returns going up ---- */
  var navEl = document.getElementById('nav'), lastY = window.scrollY;
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    if (navEl) navEl.classList.toggle('is-hidden', y > lastY && y > 160);
    lastY = y;
  }, { passive: true });

  /* ---- 2. entrances: each part of a section rises in turn, once ---- */
  var revealables = $$('[data-reveal]');
  revealables.forEach(function (el, i) { el.style.setProperty('--i', String(i % 4)); });
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    revealables.forEach(function (el) { io.observe(el); });
  } else revealables.forEach(function (el) { el.classList.add('in'); });

  /* ---- 3. the hero reel: scroll drives a vertical strip of frames ---- */
  var track = $('.hero-track'), stage = $('.hero-stage'), reel = $('#reel'), frames = $$('.frame'), tabs = $$('#reel-steps button');
  var N = frames.length, cur = 0, shown = 0, target = 0, timer = null, raf = 0;

  function setActive(i) {
    if (i === cur && frames[i].classList.contains('is-active')) return;
    cur = i;
    frames.forEach(function (f, k) { f.classList.toggle('is-active', k === i); });
    tabs.forEach(function (t, k) { t.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
  }
  function progress() {
    if (!track) return 0;
    var r = track.getBoundingClientRect(), total = track.offsetHeight - stage.offsetHeight;
    return total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
  }
  function frameLoop() {
    shown += (target - shown) * (reduce ? 1 : 0.14);
    if (Math.abs(target - shown) < 0.002) shown = target;
    reel.style.setProperty('--f', shown.toFixed(4));
    if (shown !== target) raf = requestAnimationFrame(frameLoop); else raf = 0;
  }
  function onScroll() {
    if (!wide()) return;
    target = progress() * (N - 1);
    setActive(Math.round(target));
    if (!raf) raf = requestAnimationFrame(frameLoop);
  }
  function go(i) {
    setActive(i);
    if (wide()) {
      var total = track.offsetHeight - stage.offsetHeight, top = track.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + total * (i / (N - 1)) + 2, behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  tabs.forEach(function (t) { t.addEventListener('click', function () { go(parseInt(t.getAttribute('data-go'), 10)); stopAuto(); }); });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { reel.style.setProperty('--f', wide() ? shown : 0); onScroll(); });

  /* phone: no pinned stage, the frames take turns on their own */
  function startAuto() { if (reduce || wide() || timer) return; timer = setInterval(function () { setActive((cur + 1) % N); }, 3400); }
  function stopAuto() { if (timer) { clearInterval(timer); timer = null; } }
  startAuto();
  window.addEventListener('resize', function () { if (wide()) stopAuto(); else startAuto(); });
  if (reel) { reel.addEventListener('focusin', stopAuto); reel.addEventListener('pointerdown', stopAuto); }
  onScroll();

  /* ---- 4. the frame's field types real example links until you take over ---- */
  var input = $('#hero-url'), examples = ['https://shop.example/laptops', 'https://news.example/latest', 'https://jobs.example/engineering', 'https://books.toscrape.com'];
  if (input && !reduce) {
    var ei = 0, ci = 0, dir = 1, typing = true;
    input.addEventListener('focus', function () { typing = false; input.placeholder = 'https://'; });
    (function tick() {
      if (!typing) return;
      var word = examples[ei];
      ci += dir;
      input.placeholder = word.slice(0, ci) || ' ';
      var delay = dir === 1 ? 55 : 22;
      if (dir === 1 && ci === word.length) { dir = -1; delay = 1500; }
      else if (dir === -1 && ci === 0) { dir = 1; ei = (ei + 1) % examples.length; delay = 400; }
      setTimeout(tick, delay);
    })();
  }

  /* ---- 5. switches: working toggles, with numbers that count up ---- */
  function countUp(el) {
    var to = parseInt(el.getAttribute('data-count'), 10);
    if (isNaN(to)) return;
    if (reduce) { el.textContent = String(to); return; }
    var t0 = performance.now(), dur = 900;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(to * e));
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  $$('.band').forEach(function (band) {
    var sw = $('.sw', band), num = $('[data-count]', band);
    function set(on) {
      band.setAttribute('data-on', on ? 'true' : 'false');
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on && num) countUp(num);
    }
    sw.addEventListener('click', function () { set(sw.getAttribute('aria-checked') !== 'true'); });   // buttons answer click, Space and Enter natively
    if (num && band.getAttribute('data-on') === 'true' && 'IntersectionObserver' in window && !reduce) {
      num.textContent = '0';
      var o = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { countUp(num); o.disconnect(); } }, { threshold: 0.5 });
      o.observe(band);
    }
  });

  /* ---- 6. the live row ---- */
  var chk = $('#live-check'), st = $('#live-state');
  if (chk && st) chk.addEventListener('change', function () { st.textContent = chk.checked ? 'In scraped-data.csv' : 'Tick to include'; });

  /* ---- 7. forms: tidy the link, then hand over to the scraper ---- */
  function wire(form, field) {
    if (!form) return;
    form.addEventListener('submit', function (e) {
      var raw = field.value.trim();
      if (!raw) { e.preventDefault(); field.focus(); return; }
      var norm = window.Sieve && Sieve.util && Sieve.util.normalizeUrl ? Sieve.util.normalizeUrl(raw) : raw;
      if (!norm) { e.preventDefault(); if (window.Sieve && Sieve.toast) Sieve.toast('That does not look like a valid http(s) link.', 'error'); field.focus(); return; }
      field.value = norm;
    });
  }
  wire($('#hero-form'), $('#hero-url'));
  wire($('#cta-form'), $('#cta-url'));

  /* ---- 8. one slow drift: the sieve photograph moves against the page ---- */
  var pic = $('#ext-img'), picBox = pic && pic.parentElement;
  if (pic && !reduce) {
    var ticking = false;
    var drift = function () {
      ticking = false;
      var r = picBox.getBoundingClientRect(), vh = window.innerHeight;
      var p = Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
      pic.style.transform = 'translateY(' + ((p - 0.5) * -48).toFixed(1) + 'px) scale(1.12)';
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(drift); } }, { passive: true });
    drift();
  }

  /* ---- 9. press feedback with a small magnetic pull on the main buttons (desktop pointer only) ---- */
  if (!reduce && window.matchMedia('(hover: hover)').matches) {
    $$('.hero-actions .btn, .ext-actions .btn').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        b.style.translate = ((e.clientX - r.left - r.width / 2) * 0.12).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) * 0.2).toFixed(1) + 'px';
      });
      b.addEventListener('pointerleave', function () { b.style.translate = ''; });
    });
  }
})();
