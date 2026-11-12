/* ==========================================================================
   Sieve — demo.js
   Demo data + a tiny virtual website so every mode, pagination and bulk
   scraping can be tried offline or when a real site blocks CORS.

   Virtual URLs (fetched through the exact same pipeline as real pages):
     demo://shop?page=1..3    product catalogue rendered as a <table>
     demo://cards?page=1..3   same products as a grid of <article> cards (no table)
   Both pages also contain contact info, social links, team members, reviews,
   a business profile and images, so the 11 modes all have something to find.

   assets/demo-table.json holds the catalogue rows. If it can't be loaded
   (e.g. opened from file://) the identical copy generated below is used.
   ========================================================================== */
(function (global) {
  'use strict';

  var Sieve = global.Sieve = global.Sieve || {};
  var esc = function (s) { return Sieve.util.esc(s); };

  var PER_PAGE = 12;
  var PRODUCTS = [
    ['Aero Desk Lamp', 'Lighting', 39.00, 4.6, 'In stock'],
    ['Birch Monitor Riser', 'Desk', 54.50, 4.4, 'In stock'],
    ['Cedar Cable Tray', 'Organization', 18.90, 4.2, 'In stock'],
    ['Dune Ergonomic Mouse', 'Peripherals', 47.00, 4.7, 'Low stock'],
    ['Ember Task Light', 'Lighting', 62.00, 4.5, 'In stock'],
    ['Fjord Standing Mat', 'Wellness', 71.25, 4.3, 'In stock'],
    ['Grove Desk Plant Pot', 'Decor', 22.00, 4.1, 'In stock'],
    ['Harbor Laptop Stand', 'Desk', 58.00, 4.8, 'In stock'],
    ['Iris Webcam Cover Set', 'Peripherals', 9.50, 4.0, 'In stock'],
    ['Juniper Notebook A5', 'Stationery', 12.75, 4.6, 'In stock'],
    ['Kelp Wool Desk Pad', 'Desk', 44.00, 4.9, 'Backorder'],
    ['Lumen Floor Lamp', 'Lighting', 129.00, 4.5, 'In stock'],
    ['Maple Pen Cup', 'Organization', 16.00, 4.2, 'In stock'],
    ['Nimbus Wrist Rest', 'Wellness', 26.40, 4.4, 'In stock'],
    ['Onyx Mechanical Keyboard', 'Peripherals', 149.00, 4.8, 'Low stock'],
    ['Pebble Cable Clips', 'Organization', 7.80, 4.0, 'In stock'],
    ['Quartz Desk Clock', 'Decor', 34.00, 4.3, 'In stock'],
    ['Reed Headphone Hook', 'Desk', 19.50, 4.6, 'In stock'],
    ['Sage Monitor Light Bar', 'Lighting', 79.00, 4.7, 'In stock'],
    ['Tundra Foot Rest', 'Wellness', 52.00, 4.2, 'Backorder'],
    ['Umber Leather Mousepad', 'Desk', 38.00, 4.5, 'In stock'],
    ['Vale Whiteboard Tile', 'Stationery', 29.90, 4.1, 'In stock'],
    ['Willow Desk Organizer', 'Organization', 33.00, 4.6, 'In stock'],
    ['Xenon USB-C Hub', 'Peripherals', 64.00, 4.7, 'In stock'],
    ['Yarrow Sticky Note Set', 'Stationery', 8.40, 4.0, 'In stock'],
    ['Zephyr Desk Fan', 'Wellness', 36.50, 4.3, 'Low stock'],
    ['Alder Bookends', 'Decor', 27.00, 4.4, 'In stock'],
    ['Basalt Phone Dock', 'Desk', 31.00, 4.5, 'In stock'],
    ['Coral Highlighter Pack', 'Stationery', 6.90, 3.9, 'In stock'],
    ['Delta Surge Strip', 'Peripherals', 41.00, 4.6, 'In stock'],
    ['Elm Document Tray', 'Organization', 24.50, 4.2, 'In stock'],
    ['Flint Desk Lamp Mini', 'Lighting', 28.00, 4.1, 'In stock'],
    ['Glacier Water Bottle', 'Wellness', 21.00, 4.8, 'In stock'],
    ['Hazel Cork Coasters', 'Decor', 14.20, 4.3, 'In stock'],
    ['Indigo Fountain Pen', 'Stationery', 45.00, 4.9, 'Low stock'],
    ['Jade Desk Succulent Kit', 'Decor', 19.00, 4.2, 'In stock']
  ];
  var HEADERS = ['SKU', 'Product', 'Category', 'Price', 'Rating', 'Availability'];

  function buildTable() {
    return {
      name: 'Fernwood Supply — product catalogue',
      source_url: 'demo://shop',
      per_page: PER_PAGE,
      pages: Math.ceil(PRODUCTS.length / PER_PAGE),
      headers: HEADERS,
      rows: PRODUCTS.map(function (p, i) {
        return ['FW-' + (1001 + i), p[0], p[1], '$' + p[2].toFixed(2), p[3].toFixed(1), p[4]];
      })
    };
  }

  var cache = null;
  function loadTable() {
    if (cache) return Promise.resolve(cache);
    var fallback = buildTable();
    if (!global.fetch || global.location.protocol === 'file:') { cache = fallback; return Promise.resolve(cache); }
    return fetch('assets/demo-table.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { cache = (j && j.rows && j.rows.length) ? j : fallback; return cache; })
      .catch(function () { cache = fallback; return cache; });
  }

  function svgImg(bg, fg, label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">' +
      '<rect width="480" height="360" fill="' + bg + '"/><circle cx="240" cy="150" r="70" fill="' + fg + '" opacity=".85"/>' +
      '<rect x="150" y="250" width="180" height="14" rx="7" fill="' + fg + '" opacity=".5"/>' +
      '<text x="240" y="318" font-family="sans-serif" font-size="26" text-anchor="middle" fill="' + fg + '">' + label + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  var REVIEWS = [
    ['Dana K.', 5, '2026-03-02', 'Sturdy and quiet', 'The monitor riser fits my setup perfectly and the birch finish looks great. Arrived in two days.'],
    ['Marcus L.', 4, '2026-02-18', 'Good value', 'Nice lamp for the price. The base is a little light but the brightness range is excellent.'],
    ['Sofia R.', 5, '2026-02-09', 'Best desk pad I have owned', 'Wool pad is soft, does not slide, and has survived three coffee spills so far.'],
    ['Imran T.', 3, '2026-01-27', 'Okay, shipping was slow', 'Product is fine but the courier took nine days. Support replied quickly though.'],
    ['Hannah W.', 5, '2026-01-14', 'Worth every cent', 'The mechanical keyboard feels fantastic. Hot-swappable switches were a pleasant surprise.'],
    ['Leo P.', 4, '2025-12-30', 'Solid hub', 'All ports work and it stays cool. I wish the cable were a bit longer.']
  ];

  function stars(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }

  function reviewsHtml(page) {
    var a = REVIEWS[(page - 1) * 2 % REVIEWS.length], b = REVIEWS[((page - 1) * 2 + 1) % REVIEWS.length];
    return '<section class="reviews" id="reviews"><h2>Customer reviews</h2>' +
      '<div itemscope itemtype="https://schema.org/Review" class="review-card">' +
      '<span class="review-author" itemprop="author">' + esc(a[0]) + '</span> ' +
      '<span itemprop="reviewRating" itemscope itemtype="https://schema.org/Rating"><meta itemprop="ratingValue" content="' + a[1] + '"><span class="stars" aria-label="' + a[1] + ' out of 5 stars">' + stars(a[1]) + '</span></span> ' +
      '<time itemprop="datePublished" datetime="' + a[2] + '">' + a[2] + '</time>' +
      '<h4 class="review-title" itemprop="name">' + esc(a[3]) + '</h4><p class="review-text" itemprop="reviewBody">' + esc(a[4]) + '</p></div>' +
      '<div class="review-card"><span class="review-author">' + esc(b[0]) + '</span> ' +
      '<span class="stars" aria-label="' + b[1] + ' out of 5 stars">' + stars(b[1]) + '</span> ' +
      '<time datetime="' + b[2] + '">' + b[2] + '</time>' +
      '<h4 class="review-title">' + esc(b[3]) + '</h4><p class="review-text">' + esc(b[4]) + '</p></div></section>';
  }

  function teamHtml() {
    var people = [
      ['Maya Okafor', 'Head of Partnerships', 'maya.okafor@fernwood.example', 'https://www.linkedin.com/in/maya-okafor-demo', 'Portland, OR'],
      ['Lukas Brandt', 'Operations Lead', 'lukas.brandt@fernwood.example', 'https://www.linkedin.com/in/lukas-brandt-demo', 'Portland, OR'],
      ['Priya Raman', 'Customer Success Manager', 'priya.raman@fernwood.example', 'https://www.linkedin.com/in/priya-raman-demo', 'Austin, TX'],
      ['Tomás Herrera', 'Supply Chain Manager', 'tomas.herrera@fernwood.example', 'https://www.linkedin.com/in/tomas-herrera-demo', 'Reno, NV']
    ];
    return '<section class="team" id="team"><h2>Meet the team</h2><div class="team-grid">' + people.map(function (p) {
      return '<div class="team-card"><h4 class="person-name">' + esc(p[0]) + '</h4><p class="job-title">' + esc(p[1]) + '</p>' +
        '<p class="person-location">' + esc(p[4]) + '</p>' +
        '<a href="mailto:' + p[2] + '">' + p[2] + '</a> <a href="' + p[3] + '">LinkedIn</a></div>';
    }).join('') + '</div></section>';
  }

  function companyHtml() {
    return '<section class="company-info" id="about" itemscope itemtype="https://schema.org/LocalBusiness">' +
      '<h2 class="company-name" itemprop="name">Fernwood Supply Co.</h2>' +
      '<p class="company-industry">Industry: Home &amp; Office Equipment</p>' +
      '<address class="company-address" itemprop="address">418 Alder Street, Portland, OR 97209, USA</address>' +
      '<p class="company-size">120+ employees</p>' +
      '<p class="company-revenue">Annual revenue: $14M</p>' +
      '<p>Founded in 2011 by two former furniture designers, Fernwood Supply builds calm, durable workspace gear.</p>' +
      '<p>Call us on <a href="tel:+15550142290">+1 (555) 014-2290</a> or <span class="phone">+1 (555) 014-2291</span>. ' +
      'Email <a href="mailto:hello@fernwood.example">hello@fernwood.example</a>, ' +
      'billing@fernwood.example, or sales [at] fernwood [dot] example.</p>' +
      '<p class="social"><a href="https://www.facebook.com/fernwoodsupply">Facebook</a> · ' +
      '<a href="https://twitter.com/fernwoodsupply">Twitter</a> · ' +
      '<a href="https://x.com/fernwood_news">X</a> · ' +
      '<a href="https://www.instagram.com/fernwood.supply/">Instagram</a> · ' +
      '<a href="https://www.linkedin.com/company/fernwood-supply-demo">LinkedIn</a> · ' +
      '<a href="https://www.youtube.com/@fernwoodsupply">YouTube</a> · ' +
      '<a href="https://www.tiktok.com/@fernwoodsupply">TikTok</a> · ' +
      '<a href="https://www.facebook.com/sharer/sharer.php?u=demo">Share</a></p></section>';
  }

  function galleryHtml() {
    var imgs = [
      [svgImg('#E8E8FF', '#5B5BFF', 'Desk setup'), 'Desk setup with lamp'],
      [svgImg('#E0F8F0', '#00A577', 'Workspace plants'), 'Workspace with plants'],
      [svgImg('#FFF3DC', '#D97706', 'Warm lighting'), 'Warm lighting detail'],
      [svgImg('#FDE8E8', '#DC2626', 'Keyboard'), 'Mechanical keyboard']
    ];
    return '<section class="gallery" id="gallery"><h2>Gallery</h2><div class="gallery-grid">' +
      imgs.map(function (i) { return '<img src="' + i[0] + '" alt="' + esc(i[1]) + '" width="480" height="360">'; }).join('') +
      '<picture><source srcset="' + svgImg('#EFEFF5', '#374151', 'Studio 2x') + ' 2x"><img src="' + svgImg('#EFEFF5', '#374151', 'Studio') + '" alt="Studio shot" width="480" height="360"></picture>' +
      '<div class="banner-img" style="width:480px;height:120px;background-image:url(\'' + svgImg('#F3F4F6', '#6B7280', 'Banner') + '\')" role="img" aria-label="Banner"></div>' +
      '</div></section>';
  }

  function pagerHtml(kind, page, pages) {
    var items = '';
    for (var i = 1; i <= pages; i++) {
      items += i === page
        ? '<li class="page-item active"><span aria-current="page">' + i + '</span></li>'
        : '<li class="page-item"><a href="demo://' + kind + '?page=' + i + '">' + i + '</a></li>';
    }
    var prev = page > 1 ? '<li class="page-item"><a rel="prev" href="demo://' + kind + '?page=' + (page - 1) + '">← Previous</a></li>' : '<li class="page-item disabled"><span>← Previous</span></li>';
    var next = page < pages ? '<li class="page-item"><a rel="next" class="next" href="demo://' + kind + '?page=' + (page + 1) + '">Next →</a></li>' : '<li class="page-item disabled"><span>Next →</span></li>';
    return '<nav class="pagination" aria-label="Pagination"><ul>' + prev + items + next + '</ul></nav>';
  }

  function pageShell(title, kind, page, pages, main) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<meta property="og:site_name" content="Fernwood Supply Co.">' +
      '<meta property="og:image" content="' + svgImg('#E8E8FF', '#5B5BFF', 'Fernwood') + '">' +
      '<link rel="canonical" href="demo://' + kind + '?page=' + page + '">' +
      (page < pages ? '<link rel="next" href="demo://' + kind + '?page=' + (page + 1) + '">' : '') +
      '<script type="application/ld+json">' + JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Organization', name: 'Fernwood Supply Co.',
        url: 'https://fernwood.example', telephone: '+1 555 014 2290', email: 'hello@fernwood.example',
        sameAs: ['https://www.pinterest.com/fernwoodsupply', 'https://www.facebook.com/fernwoodsupply'],
        address: { '@type': 'PostalAddress', streetAddress: '418 Alder Street', addressLocality: 'Portland', addressRegion: 'OR', postalCode: '97209', addressCountry: 'US' }
      }) + '</script>' +
      '<style>body{font-family:system-ui,sans-serif;max-width:980px;margin:0 auto;padding:24px;color:#1f2937}table{border-collapse:collapse;width:100%}' +
      'th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left}th{background:#f3f4f6}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}' +
      '.product-card,.team-card,.review-card{border:1px solid #e5e7eb;border-radius:8px;padding:12px}.pagination ul{display:flex;gap:6px;list-style:none;padding:0}' +
      '.page-item a,.page-item span{padding:4px 10px;border:1px solid #e5e7eb;border-radius:6px;display:block}.page-item.active span{background:#5b5bff;color:#fff}' +
      '.team-grid,.gallery-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.gallery-grid img{width:100%;height:auto}</style></head><body>' +
      '<header><h1>Fernwood Supply</h1><nav><ul class="menu"><li><a href="demo://shop?page=1">Shop</a></li><li><a href="#team">Team</a></li><li><a href="#reviews">Reviews</a></li><li><a href="#about">About</a></li><li><a href="#gallery">Gallery</a></li></ul></nav></header>' +
      '<main><h2>Workspace essentials — page ' + page + ' of ' + pages + '</h2>' +
      '<p>Thoughtfully made desk gear that keeps your workspace calm. Free shipping on orders over $75, and every product ships with a 2-year guarantee.</p>' +
      main + pagerHtml(kind, page, pages) + companyHtml() + teamHtml() + reviewsHtml(page) + galleryHtml() +
      '</main><footer><p>© 2026 Fernwood Supply Co. · <a href="#">Privacy</a> · <a href="#">Terms</a></p></footer></body></html>';
  }

  function shippingTable() {
    return '<h3>Shipping rates</h3><table class="shipping"><thead><tr><th>Zone</th><th>Days</th><th>Cost</th></tr></thead><tbody>' +
      '<tr><td>West</td><td>2</td><td>$5.00</td></tr><tr><td>Central</td><td>3</td><td>$6.50</td></tr><tr><td>East</td><td>4</td><td>$8.00</td></tr></tbody></table>';
  }

  function parseUrl(url) {
    var m = /^demo:\/\/([a-z-]+)(?:\/[^?#]*)?(?:\?([^#]*))?/i.exec(url || '');
    if (!m) return null;
    var page = 1;
    var q = /(?:^|&)page=(\d+)/.exec(m[2] || '');
    if (q) page = parseInt(q[1], 10);
    return { kind: m[1].toLowerCase(), page: page };
  }

  function buildHtml(url) {
    var p = parseUrl(url);
    if (!p || (p.kind !== 'shop' && p.kind !== 'cards')) {
      var err = new Error('404 Not Found (demo site has only demo://shop and demo://cards)');
      err.code = 'http';
      return Promise.reject(err);
    }
    return loadTable().then(function (t) {
      var per = t.per_page || PER_PAGE;
      var pages = Math.max(1, Math.ceil(t.rows.length / per));
      var page = Math.min(Math.max(1, p.page), pages);
      var rows = t.rows.slice((page - 1) * per, page * per);
      var main;
      if (p.kind === 'shop') {
        main = '<table class="catalog" id="catalog"><thead><tr>' + t.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c, i) {
              return i === 1 ? '<td><a href="demo://shop/product/' + esc(r[0]) + '">' + esc(c) + '</a></td>' : '<td>' + esc(c) + '</td>';
            }).join('') + '</tr>';
          }).join('') + '</tbody></table>' + shippingTable();
      } else {
        main = '<div class="grid">' + rows.map(function (r) {
          return '<article class="product-card"><h3 class="title">' + esc(r[1]) + '</h3><span class="category">' + esc(r[2]) + '</span> ' +
            '<span class="price">' + esc(r[3]) + '</span> <span class="rating">' + esc(r[4]) + ' ★</span> ' +
            '<span class="stock">' + esc(r[5]) + '</span> <a class="buy" href="demo://cards/product/' + esc(r[0]) + '">View details</a></article>';
        }).join('') + '</div>';
      }
      return pageShell('Fernwood Supply — ' + (p.kind === 'shop' ? 'Shop' : 'Cards') + ' (page ' + page + ')', p.kind, page, pages, main);
    });
  }

  Sieve.demo = {
    PER_PAGE: PER_PAGE,
    URLS: { table: 'demo://shop?page=1', cards: 'demo://cards?page=1' },
    isDemo: function (url) { return /^demo:\/\//i.test(url || ''); },
    buildTable: buildTable,
    loadTable: loadTable,
    buildHtml: buildHtml,
    bulkSample: function () {
      return [
        'demo://shop?page=1', 'demo://shop?page=2', 'demo://shop?page=3',
        'demo://cards?page=1', 'demo://cards?page=2', 'demo://missing'
      ];
    }
  };

})(window);
