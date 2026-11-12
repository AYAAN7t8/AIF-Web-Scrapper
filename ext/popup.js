'use strict';
/* Sieve toolbar popup (Manifest V3). Runs in the extension's own page. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var MODES = [
    ['table', 'Auto table / list'], ['email', 'Emails'], ['phone', 'Phone numbers'], ['links', 'Links'], ['images', 'Images'],
    ['text', 'Page text'], ['review', 'Reviews / ratings'], ['people', 'People'], ['business', 'Business'], ['social', 'Social profiles'], ['b2b', 'B2B']
  ];
  var ORIGINS = ['http://*/*', 'https://*/*'];

  var sel = $('#mode');
  MODES.forEach(function (m) { var o = document.createElement('option'); o.value = m[0]; o.textContent = m[1]; sel.appendChild(o); });

  function say(text, kind) {
    var el = $('#msg');
    el.textContent = text; el.dataset.kind = kind || ''; el.hidden = !text;
  }

  chrome.storage.local.get(['sieveMode', 'sieveAutoscroll'], function (r) {
    if (r.sieveMode) sel.value = r.sieveMode;
    $('#autoscroll').checked = !!r.sieveAutoscroll;
  });
  function remember() { chrome.storage.local.set({ sieveMode: sel.value, sieveAutoscroll: $('#autoscroll').checked }); }

  function refreshPermission() {
    chrome.permissions.contains({ origins: ORIGINS }, function (ok) {
      $('#allow').hidden = !!ok;
      $('#perm-note').textContent = ok ? 'Site access is on: links are fetched with your own login cookies.' : 'Fetching a link uses your own login cookies and needs one-time site access.';
    });
  }
  refreshPermission();

  /* Injected into the page. Must be self-contained. */
  function capturePage(autoscroll) {
    return (async function () {
      if (autoscroll) {
        var last = 0, stable = 0;
        for (var i = 0; i < 40 && stable < 2; i++) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise(function (r) { setTimeout(r, 800); });
          var h = document.documentElement.scrollHeight;
          stable = h === last ? stable + 1 : 0;
          last = h;
        }
        window.scrollTo(0, 0);
      }
      return { url: location.href, title: document.title, html: '<!DOCTYPE html>\n' + document.documentElement.outerHTML };
    })();
  }

  function openApp(query) {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html?' + query) }, function () { window.close(); });
  }

  $('#scrape').addEventListener('click', function () {
    remember();
    var btn = $('#scrape');
    btn.disabled = true; say($('#autoscroll').checked ? 'Scrolling and reading the page…' : 'Reading the page…');
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !/^https?:/i.test(tab.url || '')) { btn.disabled = false; say('Open a normal web page (http/https) in this tab first. Browser pages and the Chrome Web Store cannot be read.', 'error'); return; }
      chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage, args: [$('#autoscroll').checked] }, function (res) {
        btn.disabled = false;
        if (chrome.runtime.lastError || !res || !res[0] || !res[0].result) {
          say('Could not read this page: ' + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'no data returned') + '. Try reloading the tab.', 'error');
          return;
        }
        var cap = res[0].result;
        chrome.storage.local.set({ sievePending: { url: cap.url, title: cap.title, html: cap.html, at: Date.now() } }, function () {
          if (chrome.runtime.lastError) { say('The page is too large to hand over: ' + chrome.runtime.lastError.message, 'error'); return; }
          openApp('ext=1&preset=' + encodeURIComponent(sel.value));
        });
      });
    });
  });

  function fetchLink() {
    remember();
    var v = $('#link').value.trim();
    if (!/^https?:\/\//i.test(v)) { say('Enter a full link starting with http:// or https://', 'error'); return; }
    chrome.permissions.contains({ origins: ORIGINS }, function (ok) {
      if (!ok) { say('Click "Allow site access" first so Sieve can fetch with your login.', 'error'); return; }
      openApp('preset=' + encodeURIComponent(sel.value) + '&autorun=1&url=' + encodeURIComponent(v));
    });
  }
  $('#fetch').addEventListener('click', fetchLink);
  $('#link').addEventListener('keydown', function (e) { if (e.key === 'Enter') fetchLink(); });

  $('#allow').addEventListener('click', function () {
    chrome.permissions.request({ origins: ORIGINS }, function (granted) {
      refreshPermission();
      say(granted ? 'Site access granted.' : 'Access was not granted.', granted ? 'ok' : 'error');
    });
  });
  sel.addEventListener('change', remember);
})();
