Sieve.ready(function () {
  document.getElementById('hero-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = document.getElementById('hero-url').value.trim();
    var url = raw ? Sieve.util.normalizeUrl(raw) : '';
    if (raw && !url) { Sieve.toast('That does not look like a valid http(s) URL.', 'error'); return; }
    location.href = 'app.html' + (url ? '?autorun=1&url=' + encodeURIComponent(url) : '');
  });
});
