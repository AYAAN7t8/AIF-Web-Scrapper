# Sieve — a browser-based web scraper

Sieve is a standalone multi-page website (not a browser extension) that reproduces the *behaviour and UX* of two kinds of scraper extensions:

- a **table scraper** — heuristic detection of the largest repeating table/list on a page, pagination crawling, column rename/filter, CSV/XLSX export;
- a **one-click page scraper** — emails, phones, links, images, page text, reviews, people, business, social and B2B extraction, bulk multi-URL scraping and Google Sheets export.

It is an original implementation: no code or assets from either extension were used.

All scraping logic runs **client-side**. An optional Node proxy handles CORS-blocked and JavaScript-rendered sites.

```
node serve.js 8791     → site + scraping proxy on one origin (no install needed): http://127.0.0.1:8791
Open index.html         → demo data only; real sites need the server above (browsers block cross-site reads)
```

> **Screenshots** — placeholders, drop your own captures in `assets/screenshots/`:
> `![Landing](assets/screenshots/landing.png)` · `![Scraper workspace](assets/screenshots/app.png)` · `![Bulk scrape](assets/screenshots/bulk.png)` · `![Dark mode](assets/screenshots/dark.png)`

## Pages

| File | Purpose |
|---|---|
| `index.html` | Landing page (hero with live URL box, feature grid, built-in scraper pills, steps, use cases, CTA) |
| `app.html` | The scraper: sidebar modes/options, preview, results, crawl controls, inspector (export / schema / stats) |
| `bulk.html` | Up to 500 URLs, per-URL status, combined table, source filter chips, export |
| `scrapers.html` | Catalog of the 8 built-in scrapers (`app.html?preset=<id>`) |
| `how-it-works.html` | Visual walkthrough with hover tooltips |
| `docs.html` | Quick Start · Modes · Pagination · Bulk · Export · CORS · FAQ |
| `pricing.html`, `login.html`, `signup.html` | Marketing/auth UI. Auth is front-end only (validates, then opens the app; nothing is sent or stored) |

URL parameters for `app.html`: `?url=…&autorun=1`, `?preset=email|phone|business|people|social|b2b|review|text|links|images|table`, `?demo=1[&kind=cards]`, `?pane=bulk`.

## Feature map

| Capability | Where |
|---|---|
| Auto table detection (table scoring + repeated siblings) | `js/scraper.js` → `detectCandidates`, `tableCandidates`, `repeatCandidates` |
| "Try another table" cycling | `js/app.js` → `tryAnother` |
| Pagination detection | `js/scraper.js` → `findNext` |
| Crawl with delay / max pages / progress / stop | `js/scraper.js` → `crawl`; `js/app.js` → `scrapeNext`, `crawlAll` |
| Infinite scroll | proxy only: `proxy-server.js` → `renderPage` (banner shown when proxy is off) |
| Column rename (contenteditable) + on/off filter | `js/ui.js` → `DataTable`, `SchemaEditor`; `js/scraper.js` → `Dataset` |
| Virtualised preview (first 50 rows, "Show all" virtualises everything) | `js/ui.js` → `DataTable.renderBody` |
| Email · Phone · Links · Images · Page Text · Reviews · People · Business · Social · B2B | `js/extractors.js` |
| Bulk scrape (500 URLs, concurrency, statuses) | `js/scraper.js` → `bulk`, `parseUrlList`; `js/bulk.js` |
| CSV (BOM) · XLSX · clipboard (TSV) · Google Sheets · TXT · image ZIP | `js/export.js` |
| Demo site (`demo://shop`, `demo://cards`) + `assets/demo-table.json` | `js/demo.js` |
| Dark mode, toasts, modals, icons, nav/footer | `js/main.js` |
| Proxy: rate-limit, robots.txt, SSRF guard, Puppeteer | `proxy-server.js`, `robots-check.js` |

### A note on "ES modules"
Every file in `js/` is a `'use strict'` module that registers itself on one `Sieve` namespace, but they are loaded with classic `<script>` tags in dependency order rather than `type="module"`. Browsers block ES-module imports from `file://`, and the project must work by double-clicking `index.html`. If you serve the site over HTTP and prefer `import`/`export`, the files port directly: each IIFE exposes a single object.

## How the auto-detect heuristic works

Code: `js/scraper.js`.

1. **Fetch and parse** the page (`fetchHtml` → `DOMParser`). Scripts never run.
2. **Score every `<table>`** (`tableCandidates`):
   `score = rows × avgCols × (stickyHeader ? 1.2 : 1)` where *stickyHeader* means a `<thead>`, an all-`<th>` first row, or a "sticky" class/style. Nested layout tables and tables with fewer than 2 columns are skipped.
3. **Pick the winner**: the best table wins if `score > TABLE_THRESHOLD` (10).
4. **Otherwise find repeated siblings** (`repeatCandidates`): for every element, children are grouped by `tagName + sorted className` signature (dynamic classes such as `active`, `odd`, `is-*` are ignored). Each group of ≥3 is scored `members × avgLeafTextNodes`; menus (one short text each) and content inside `nav/header/footer/aside` are penalised. The top 12 groups are then refined by actually extracting them and weighting by column coverage.
5. **Rows and columns**: each sibling is a row; every leaf element with its own text, every `<img>` and every `<a href>` inside it becomes a field keyed by its structural path (`div.card > h3.title[0]`). Paths present in ≥35% of rows become columns, named from their class (`price`, `title`, …). Constant link labels ("View details") are dropped; link and image columns get `… URL` / `… Image` companions.
6. **Tables** become columns from `<thead>` (or an all-`<th>`/bold first row), with colspan expanded and URL/image companion columns when ≥50% of a column's cells contain links/images.
7. **Cross-page consistency** — each candidate has a `signature`; during a crawl the same signature is preferred on every page and values are aligned to the first page's columns by key.
8. The full ranked list is kept so the UI can offer **Try another table (n/N)**.

### Pagination (`findNext`)
In priority order: `<link rel=next>`/`a[rel~=next]` → `aria-label~="next"` → pagination wrappers (`.next`, or the item after the active page) → short link text matching `next | → | » | siguiente | suivant | weiter | …`. Disabled items, the current URL, already-visited URLs and other domains are skipped. A "Next" `<button>` without an href is reported as *needs JavaScript*.

## Chrome extension: scrape what *you* see, including logged-in pages

A website can never read your logged-in session on another site (browsers forbid it, and a server never has your cookies). A browser extension can, because it runs inside your own browser. This repo is **both** the website and a Manifest V3 extension (`manifest.json` at the root, popup in `ext/`).

**Install (unpacked, ~1 minute)**

1. Chrome → `chrome://extensions` → switch on **Developer mode**.
2. **Load unpacked** → choose this repository folder (the one containing `manifest.json`).
3. Pin the **Sieve** icon.

**Use it**

- **Scrape this page**: log in to the site as usual, open the page you want, click the Sieve icon, pick *Auto table*, *Emails*, … and press **Scrape this page**. Sieve reads the page exactly as rendered in your tab (so JavaScript-built pages and anything behind your login work).
- **Results show in the extension first**: a preview of the first rows, **Download CSV**, and **Click to view more**, which opens the website (`SIEVE_SITE` in `ext/config.js`, default `https://aif-web-scrapper.onrender.com`) with the full table, column editing and CSV/XLSX/Sheets export. The page is handed over in your browser via `postMessage`; it is never uploaded to a server. *Open full editor here* does the same inside the extension, and there pagination crawling and Bulk keep using your login (the website cannot, because its server has no cookies).
- **Scroll to the bottom first** loads infinite feeds. A panel on the page offers **Stop & use what loaded** and **Cancel** (Esc also stops), and the popup has the same two buttons. The work runs in a background worker, so closing the popup is safe.
- **Fetch a link**: paste a URL in the popup and press Fetch. Click **Allow site access** once; after that Sieve fetches the link with *your own cookies*.

**Download:** the home page has a *Download the extension* button (`downloads/sieve-extension.zip`, rebuilt by `npm run build:ext`, and on every Render deploy).

**What it does not do:** it does not solve CAPTCHAs or bot checks, and it does not log in for you. If a site shows a check or a login wall, pass it yourself in a normal tab, then use *Scrape this page*. Only scrape pages and data you are allowed to use.

Privacy: everything is processed in your browser. Permissions are `activeTab`, `scripting`, `storage`, and optional site access that you grant yourself.

## Deploy on Render

The repo includes `render.yaml`, and the server needs **no dependencies**, so it deploys as a plain Node web service.

1. Push this folder to GitHub.
2. Render dashboard → **New → Blueprint** (or **New → Web Service**) → pick the repo.
3. If you chose Web Service: Runtime *Node*, Build `npm install`, Start `npm start`, Health check path `/api/health`.
4. Open the Render URL. The site and the scraping proxy share one origin, so scraping works with no extra setup.

Environment variables (all optional): `RATE_LIMIT_PER_MIN` (default 120 fetches per IP per minute), `IGNORE_ROBOTS=1` (only with permission), `ALLOWED_ORIGINS`, `USER_AGENT`.
Because the deployment fetches pages for visitors, it refuses private/loopback addresses, honours robots.txt and rate-limits per IP and per domain. Puppeteer (JavaScript rendering) is not installed on Render by default.

## Using the proxy locally

```bash
npm install                 # express + robots-parser (+ puppeteer, optional)
node proxy-server.js        # http://localhost:8787
```

Then switch on **Use local proxy** in the app sidebar and press **Test connection**.

- `GET /api/fetch?url=…` → `{ ok, html, finalUrl, status, rendered }`
- `&render=1` renders with Puppeteer; `&scroll=1&maxScrolls=30` scrolls until the page height stops growing (infinite scroll)
- `&raw=1` returns raw bytes (used to zip images that block CORS)
- `GET /api/health` → `{ ok, puppeteer }`

Rails: robots.txt check (`robots-parser`, cached), **1 request/second/domain**, public User-Agent (`USER_AGENT` env to change), binds to `127.0.0.1`, CORS limited to localhost, `file://` and `ALLOWED_ORIGINS`, private/loopback targets refused (re-checked on redirects), 8 MB HTML cap. If Puppeteer is not installed the proxy still serves static HTML; render/scroll requests return a clear error. `node robots-check.js <url>` checks a URL on its own.

## Google Sheets export

- **No setup**: *Copy & open Google Sheets* copies a TSV and opens `sheets.new` — paste into A1.
- **Webhook**: deploy the Apps Script shown in the export dialog (also in `docs.html#export`) and paste its `/exec` URL there, or set `GOOGLE_WEBHOOK_URL` at the top of `js/export.js`. Sieve POSTs `{ title, headers, rows }` as `text/plain` (no CORS pre-flight) and shows an *Open your spreadsheet* link from the script's reply.

CSV/Sheets output neutralises cells that begin with `=`, `@` or look like `+cmd` (formula injection). Switch off with `SANITIZE_FORMULAS` in `js/export.js`.

## Scraping ethics

- Only scrape sites you have **permission** to scrape; read their Terms of Service.
- Respect **robots.txt** (the proxy enforces it; the browser-only path cannot read it cross-origin, so check it yourself).
- Be gentle: keep the delay setting, low concurrency and sensible page caps. The proxy enforces 1 req/sec/domain.
- Don't collect personal data without a lawful basis (GDPR/CCPA etc.), and don't use extracted contacts for spam.
- Don't bypass logins, paywalls or bot-protection.
- This is not legal advice.

## Known limitations

- **CORS** — most large sites block cross-origin reads. Use the proxy, *Paste page HTML*, or the demo data.
- **JavaScript-rendered pages** — a plain fetch sees only server HTML; empty results usually mean client-side rendering. Use the proxy with Puppeteer, or paste rendered HTML from DevTools.
- **Infinite scroll / "Load more" buttons** — proxy only; JS-button pagination is reported, not clicked.
- **Cookies/logins** — requests are sent without credentials.
- **rowspan** is not expanded in tables (colspan is).
- Heuristics are heuristics: unusual layouts may need *Try another table*; People/Business/Reviews work best on conventional class names or schema.org markup.
- The preview iframe renders the fetched HTML with scripts disabled; sites that depend on JS for styling will look unstyled.
- The Puppeteer rendering path of the proxy was written to spec but is the least exercised; the static path, SSRF/origin guards and health endpoint were tested.
- Pro/Teams pricing and login/signup are UI only.
- XLSX and ZIP rely on the SheetJS and JSZip CDN builds (cdnjs); offline, XLSX falls back to CSV and the ZIP button reports the missing library. Fonts load from Google Fonts with system fallbacks.

## Project layout

```
index.html app.html bulk.html scrapers.html how-it-works.html docs.html pricing.html login.html signup.html
css/   base.css (tokens, reset, type) · components.css · pages.css
js/    main.js · demo.js · extractors.js · scraper.js · export.js · ui.js · app.js · bulk.js
assets/ logo.svg · demo-table.json · icons/ (SVG set)
proxy-server.js · robots-check.js · serve.js · package.json
```
