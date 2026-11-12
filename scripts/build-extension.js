'use strict';
/* Builds downloads/sieve-extension.zip: the Chrome extension, ready to unzip and "Load unpacked".
   Run: npm run build:ext   (also runs on Render at build time). Uses the bundled JSZip, no installs. */
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip.min.js');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'downloads');
const OUT = path.join(OUT_DIR, 'sieve-extension.zip');
const FOLDER = 'sieve-extension';                      // everything is placed inside this folder in the zip

const INSTALL = [
  'Sieve Web Scraper: Chrome extension',
  '====================================',
  '',
  '1. Unzip this file. You get a folder called "sieve-extension".',
  '2. In Chrome open  chrome://extensions  and turn on "Developer mode" (top right).',
  '3. Click "Load unpacked" and choose the "sieve-extension" folder (the one containing manifest.json).',
  '4. Click the puzzle icon in the toolbar and pin "Sieve".',
  '',
  'Use it',
  '- Log in to any site as usual, open the page you want, click the Sieve icon, pick what to extract,',
  '  and press "Scrape this page". Tick "Scroll to the bottom first" for infinite feeds.',
  '- Results appear in the extension. "Click to view more" opens the full table on the Sieve website.',
  '',
  'Sieve reads pages in your own browser with your own login. It does not solve CAPTCHAs or bot checks,',
  'and it never logs in for you. Only scrape pages and data you are allowed to use.',
  ''
].join('\r\n');

function walk(dir, filter, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, filter, acc);
    else if (filter(path.relative(ROOT, full).split(path.sep).join('/'))) acc.push(full);
  });
  return acc;
}

const files = [];
files.push(path.join(ROOT, 'manifest.json'));
fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).forEach((f) => files.push(path.join(ROOT, f)));
// the large museum photographs belong to the website only; the extension does not need them
['ext', 'css', 'js', 'assets', 'vendor'].forEach((d) => walk(path.join(ROOT, d), (rel) => !/\.(jpe?g|webp)$|credits\.json$/.test(rel), files));

const zip = new JSZip();
const fixedDate = new Date(Date.UTC(2026, 0, 1));
files.forEach((f) => {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  zip.file(FOLDER + '/' + rel, fs.readFileSync(f), { date: fixedDate });
});
zip.file(FOLDER + '/INSTALL.txt', INSTALL, { date: fixedDate });

zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }).then((buf) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log('Wrote ' + path.relative(ROOT, OUT) + ' (' + files.length + ' files, ' + Math.round(buf.length / 1024) + ' KB)');
});
