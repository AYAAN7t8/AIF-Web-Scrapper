/* Applies the saved theme before first paint (dark by default) and marks the page as script-enabled.
   External file so extension pages, which forbid inline scripts, work too. */
try {
  var t = localStorage.getItem('sieve.theme');
  t = t ? JSON.parse(t) : 'dark';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) { document.documentElement.setAttribute('data-theme', 'dark'); }
document.documentElement.classList.add('js');
