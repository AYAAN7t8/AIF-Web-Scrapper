'use strict';
/** node serve.js [port] — serves the site AND the scraping proxy on one origin (zero dependencies). */
require('./proxy-server').start(parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 8080);
