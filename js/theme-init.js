/* Applies the saved theme before first paint (external file so extension pages, which forbid inline scripts, work too). */
try {
  var t = localStorage.getItem('sieve.theme');
  t = t ? JSON.parse(t) : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* storage blocked: stay on the default theme */ }
