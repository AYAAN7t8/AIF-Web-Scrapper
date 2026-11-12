'use strict';
/* Sieve toolbar popup (Manifest V3). The heavy work runs in background.js so closing this popup is safe. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var MODES = [
    ['table', 'Auto table / list'], ['email', 'Emails'], ['phone', 'Phone numbers'], ['links', 'Links'], ['images', 'Images'],
    ['text', 'Page text'], ['review', 'Reviews / ratings'], ['people', 'People'], ['business', 'Business'], ['social', 'Social profiles'], ['b2b', 'B2B']
  ];
  var ORIGINS = ['http://*/*', 'https://*/*'];
  var sel = $('#mode'), activeTabId = null;
  MODES.forEach(function (m) { var o = document.createElement('option'); o.value = m[0]; o.textContent = m[1]; sel.appendChild(o); });

  function say(text, kind) { var el = $('#msg'); el.textContent = text; el.dataset.kind = kind || ''; el.hidden = !text; }
  function running(on) { $('#running').hidden = !on; $('#scrape').disabled = !!on; }

  chrome.storage.local.get(['sieveMode', 'sieveAutoscroll', 'sieveError'], function (r) {
    if (r.sieveMode) sel.value = r.sieveMode;
    $('#autoscroll').checked = !!r.sieveAutoscroll;
    if (r.sieveError && Date.now() - r.sieveError.at < 120000) { say('Last scrape failed: ' + r.sieveError.text + '. Try reloading the tab.', 'error'); chrome.storage.local.remove('sieveError'); }
  });
  function remember() { chrome.storage.local.set({ sieveMode: sel.value, sieveAutoscroll: $('#autoscroll').checked }); }

  function refreshPermission() {
    chrome.permissions.contains({ origins: ORIGINS }, function (ok) {
      $('#allow').hidden = !!ok;
      $('#perm-note').textContent = ok ? 'Site access is on: links are fetched with your own login cookies.' : 'Fetching a link uses your own login cookies and needs one-time site access.';
    });
  }
  refreshPermission();

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tab = tabs && tabs[0]; activeTabId = tab && tab.id;
    if (activeTabId != null) chrome.runtime.sendMessage({ cmd: 'status', tabId: activeTabId }, function (job) {
      void chrome.runtime.lastError;
      if (job) { running(true); say('A scrape of this tab is still running. You can stop it here or on the page.'); }
    });
  });

  $('#scrape').addEventListener('click', function () {
    remember();
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !/^https?:/i.test(tab.url || '')) { say('Open a normal web page (http/https) in this tab first. Browser pages and the Chrome Web Store cannot be read.', 'error'); return; }
      activeTabId = tab.id;
      var auto = $('#autoscroll').checked;
      chrome.runtime.sendMessage({ cmd: 'scrape', tabId: tab.id, mode: sel.value, autoscroll: auto }, function () {
        void chrome.runtime.lastError;
        if (auto) { running(true); say('Scrolling the page. Use Stop to use what has loaded, or Cancel. You may close this popup.'); }
        else { say('Reading the page…'); setTimeout(function () { window.close(); }, 400); }
      });
    });
  });

  $('#stop').addEventListener('click', function () { chrome.runtime.sendMessage({ cmd: 'stop', tabId: activeTabId }); say('Stopping…'); });
  $('#cancel').addEventListener('click', function () { chrome.runtime.sendMessage({ cmd: 'cancel', tabId: activeTabId }); say('Cancelling…'); });
  chrome.runtime.onMessage.addListener(function (m) {
    if (!m || m.cmd !== 'job-ended') return;
    running(false);
    if (m.cancelled) say('Cancelled.');
    else if (m.error) say('Could not read this page: ' + m.error, 'error');
    else window.close();
  });

  function fetchLink() {
    remember();
    var v = $('#link').value.trim();
    if (!/^https?:\/\//i.test(v)) { say('Enter a full link starting with http:// or https://', 'error'); return; }
    chrome.permissions.contains({ origins: ORIGINS }, function (ok) {
      if (!ok) { say('Click "Allow site access" first so Sieve can fetch with your login.', 'error'); return; }
      chrome.tabs.create({ url: chrome.runtime.getURL('ext/results.html?preset=' + encodeURIComponent(sel.value) + '&url=' + encodeURIComponent(v)) }, function () { window.close(); });
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
