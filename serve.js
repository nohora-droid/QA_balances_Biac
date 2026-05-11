/**
 * serve.js — Local HTTP server for the QA dashboard.
 * Usage: node serve.js
 * Then open: http://localhost:3000
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.png':  'image/png',
};

http.createServer((req, res) => {
  let url = req.url === '/' ? '/dashboard.html' : req.url;
  // Security: only allow files within ROOT
  const filePath = path.resolve(ROOT, '.' + url);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + url); return; }
    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`\n✅ Dashboard corriendo en http://localhost:${PORT}`);
  console.log('   Abre esa URL en tu navegador.\n');
});
