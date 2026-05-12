/**
 * check-gids.js - Follow all redirects and compare CSV content per gid.
 */
const https = require('https');

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, redirects = 8) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, (res) => {
      if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
        if (redirects === 0) { reject(new Error('too many redirects')); return; }
        resolve(httpGet(res.headers.location, redirects - 1)); return;
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function main() {
  // These are all GIDs found in the HTML — test a sample
  const gids = [0, 1778402135, 45736426, 45759550, 45765567, 45755088, 45776074, 45681910, 45702908, 45662509, 45734741];

  // Use first row of each CSV as fingerprint
  const seen = new Map();
  console.log('GID       | Filas | Col-A fila 2         | Col-C fila 2');
  console.log('----------|-------|----------------------|------------------');

  for (const gid of gids) {
    try {
      const csv = await httpGet(
        `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`
      );
      const rows = csv.split('\n');
      const f2 = rows[1] ? rows[1].split(',').slice(0, 5) : [];
      const fingerprint = rows[0].substring(0, 30);
      const isNew = !seen.has(fingerprint);
      seen.set(fingerprint, gid);
      const marker = isNew ? '(NEW)' : '(dup)';
      console.log(`${String(gid).padEnd(10)}| ${String(rows.length).padEnd(6)}| ${(f2[0]||'').substring(0,20).padEnd(22)}| ${(f2[2]||'').substring(0,18)} ${marker}`);
    } catch (e) {
      console.log(`${String(gid).padEnd(10)}| ERR   | ${e.message}`);
    }
  }

  console.log(`\nSheets únicas encontradas: ${seen.size}`);
}

main().catch(console.error);
