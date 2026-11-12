'use strict';
/* Sieve service worker: runs the page capture so it survives the popup closing, and handles Stop / Cancel. */

var jobs = {};            // tabId -> { mode, autoscroll, startedAt }
var keepAlive = null;

function startKeepAlive() {
  if (keepAlive) return;
  keepAlive = setInterval(function () { chrome.runtime.getPlatformInfo(function () { /* resets the idle timer */ }); }, 20000);
}
function stopKeepAliveIfIdle() {
  if (!Object.keys(jobs).length && keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

/* Injected into the page (isolated world, self-contained). Scrolls to load lazy content, with an on-page
   control the user can use to stop or cancel at any moment, then returns the rendered HTML. */
function capturePage(autoscroll) {
  return (async function () {
    var ctl = window.__sieveCtl = { state: 'run' };
    var host = null, label = null;
    function onKey(e) { if (e.key === 'Escape') ctl.state = ctl.state === 'run' ? 'stop' : ctl.state; }
    function showOverlay() {
      host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
      var sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML =
        '<style>.b{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;background:#0f1a1f;color:#fff;border:1px solid #26383f;border-radius:12px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:8px;min-width:230px}' +
        '.t{display:flex;align-items:center;gap:8px;font-weight:600}.d{width:8px;height:8px;border-radius:50%;background:#0d7480;animation:p 1s infinite}@keyframes p{50%{opacity:.25}}' +
        '.s{color:#a1a1b0;font-weight:400;font-size:12px}.r{display:flex;gap:8px}button{font:inherit;border-radius:8px;padding:6px 10px;border:1px solid #3a3a48;background:#1a1a22;color:#fff;cursor:pointer}' +
        'button.p{background:#0d7480;border-color:#0d7480}button:hover{filter:brightness(1.15)}</style>' +
        '<div class="b"><div class="t"><span class="d"></span>Sieve is scrolling this page</div><div class="s" id="s">Loading more content…</div>' +
        '<div class="r"><button class="p" id="stop">Stop &amp; use what loaded</button><button id="cancel">Cancel</button></div><div class="s">Esc also stops</div></div>';
      label = sh.getElementById('s');
      sh.getElementById('stop').addEventListener('click', function () { ctl.state = ctl.state === 'run' ? 'stop' : ctl.state; });
      sh.getElementById('cancel').addEventListener('click', function () { ctl.state = 'cancel'; });
      document.documentElement.appendChild(host);
      window.addEventListener('keydown', onKey, true);
    }
    function sleep(ms) {   // sleeps in short slices so Stop/Cancel react immediately
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function tick() { if (ctl.state !== 'run' || Date.now() - t0 >= ms) return resolve(); setTimeout(tick, 80); })();
      });
    }
    function cleanup() { window.removeEventListener('keydown', onKey, true); if (host) host.remove(); }

    var rounds = 0, stoppedEarly = false;
    if (autoscroll) {
      showOverlay();
      var last = 0, stable = 0;
      for (var i = 0; i < 80 && stable < 3 && ctl.state === 'run'; i++) {
        // nudge up then down so lazy-loaders that listen for scroll events fire again, even when throttled
        window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight * 1.6));
        window.scrollTo(0, document.documentElement.scrollHeight);
        await sleep(900);
        var h = document.documentElement.scrollHeight;
        stable = h === last ? stable + 1 : 0;
        last = h; rounds++;
        if (label) label.textContent = 'Scroll ' + rounds + ' · page height ' + h + 'px';
      }
      window.scrollTo(0, 0);
      stoppedEarly = ctl.state === 'stop';
      if (ctl.state === 'cancel') { cleanup(); return { cancelled: true }; }
    }
    cleanup();
    delete window.__sieveCtl;
    return { url: location.href, title: document.title, html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML, rounds: rounds, stoppedEarly: stoppedEarly };
  })();
}

function setFlag(tabId, state) {
  return chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function (s) { var c = window.__sieveCtl; if (c && (c.state === 'run' || s === 'cancel')) c.state = s; },
    args: [state]
  }).catch(function () { /* tab gone */ });
}

async function scrape(msg) {
  var tabId = msg.tabId;
  jobs[tabId] = { mode: msg.mode, autoscroll: !!msg.autoscroll, startedAt: Date.now() };
  startKeepAlive();
  chrome.action.setBadgeBackgroundColor({ color: '#0D7480' });
  chrome.action.setBadgeText({ text: msg.autoscroll ? '…' : '' });
  try {
    var res = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: capturePage, args: [!!msg.autoscroll] });
    var cap = res && res[0] && res[0].result;
    if (!cap) throw new Error('no data returned');
    if (cap.cancelled) { chrome.runtime.sendMessage({ cmd: 'job-ended', tabId: tabId, cancelled: true }).catch(function () {}); return; }
    await chrome.storage.local.set({ sieveLast: { url: cap.url, title: cap.title, html: cap.html, mode: msg.mode, at: Date.now(), stoppedEarly: cap.stoppedEarly } });
    await chrome.tabs.create({ url: chrome.runtime.getURL('ext/results.html?src=last') });
    chrome.runtime.sendMessage({ cmd: 'job-ended', tabId: tabId }).catch(function () {});
  } catch (e) {
    var text = String(e && e.message || e);
    await chrome.storage.local.set({ sieveError: { text: text, at: Date.now() } });
    chrome.runtime.sendMessage({ cmd: 'job-ended', tabId: tabId, error: text }).catch(function () {});
  } finally {
    delete jobs[tabId];
    chrome.action.setBadgeText({ text: '' });
    stopKeepAliveIfIdle();
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.cmd) return false;
  if (msg.cmd === 'scrape') { scrape(msg); sendResponse({ started: true }); return false; }
  if (msg.cmd === 'stop' || msg.cmd === 'cancel') { setFlag(msg.tabId, msg.cmd).then(function () { sendResponse({ ok: true }); }); return true; }
  if (msg.cmd === 'status') { sendResponse(jobs[msg.tabId] || null); return false; }
  return false;
});
