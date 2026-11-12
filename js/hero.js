'use strict';
/* The hero's sky: a field of small points that drift slowly and twinkle, in white with a few
   of the palette's cyan, amber and coral. Nearer points move further with the pointer.
   Paused when the hero is off screen or the tab is hidden; one still frame under reduced motion. */
(function () {
  var canvas = document.getElementById('hx-sky');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d'), hero = canvas.parentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = 1, stars = [], running = false, visible = true, raf = 0, t0 = performance.now();
  var px = 0, py = 0, tx = 0, ty = 0;   // pointer offset, eased

  var TINTS = [[50, 191, 218], [252, 197, 95], [255, 94, 87]];   // cyan, amber, coral
  function dark() { return document.documentElement.getAttribute('data-theme') !== 'light'; }

  function seed() {
    var r = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round(Math.min(220, (W * H) / 7200));
    stars = [];
    for (var i = 0; i < n; i++) {
      var z = Math.random();                       // depth: 0 far, 1 near
      var tint = Math.random();
      stars.push({
        x: Math.random() * W, y: Math.random() * H, z: z,
        r: 0.5 + z * z * 1.9,
        long: Math.random() < 0.16 ? 1.8 + Math.random() * 1.6 : 1,   // a few streaks, as if caught moving
        c: tint < 0.08 ? TINTS[0] : tint < 0.13 ? TINTS[1] : tint < 0.17 ? TINTS[2] : null,
        a: 0.4 + Math.random() * 0.6,
        tw: 0.4 + Math.random() * 1.4, ph: Math.random() * 6.28
      });
    }
  }

  function draw(now) {
    var t = (now - t0) / 1000, ink = dark() ? [255, 255, 255] : [10, 10, 10];
    px += (tx - px) * 0.05; py += (ty - py) * 0.05;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (!reduce) { s.x += 0.035 + s.z * 0.11; s.y -= 0.02 + s.z * 0.05; }
      if (s.x > W + 8) s.x = -8; if (s.y < -8) s.y = H + 8;
      var x = s.x + px * (6 + s.z * 26), y = s.y + py * (6 + s.z * 26);
      var a = reduce ? s.a : s.a * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph));
      var c = s.c || ink;
      if (!dark() && !s.c) a *= 0.55;
      ctx.fillStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      if (s.long > 1) ctx.ellipse(x, y, s.r * s.long, s.r * 0.8, -0.5, 0, 6.2832);
      else ctx.arc(x, y, s.r, 0, 6.2832);
      ctx.fill();
    }
  }
  function loop(now) { draw(now); raf = running ? requestAnimationFrame(loop) : 0; }
  function update() {
    var go = visible && !document.hidden && !reduce;
    if (go && !running) { running = true; raf = requestAnimationFrame(loop); }
    else if (!go) { running = false; }
  }

  seed(); draw(performance.now());
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { seed(); draw(performance.now()); }, 120); });
  document.addEventListener('visibilitychange', update);
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; update(); }).observe(hero);
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5; ty = (e.clientY - r.top) / r.height - 0.5;
    });
    hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; });
  }
  new MutationObserver(function () { draw(performance.now()); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  update();
})();
