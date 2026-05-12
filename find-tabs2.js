/**
 * find-tabs2.js - Extract gids from spreadsheet HTML using multiple patterns.
 */
const https = require('https');
const fs = require('fs');

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function main() {
  const { body } = await httpGet(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);

  // Save HTML for inspection
  fs.writeFileSync('sheet-html-snippet.txt', body.substring(0, 50000));
  console.log('Saved first 50KB to sheet-html-snippet.txt');

  // Try multiple gid patterns in the HTML
  const patterns = [
    /gid[=:](\d{5,})/g,
    /\bsheet_id[=:](\d{5,})/g,
    /"sheetId":(\d+)/g,
    /\[(\d{7,}),/g,
    /tab-strip.*?(\d{5,})/g,
  ];

  const gids = new Set();
  for (const pat of patterns) {
    let m;
    pat.lastIndex = 0;
    while ((m = pat.exec(body)) !== null) {
      gids.add(m[1]);
    }
  }

  console.log(`\nGIDs encontrados: ${[...gids].join(', ') || 'ninguno'}`);

  // Also search for sheet names near "name" occurrences around gid pattern
  const nameGidPattern = /"([^"]{2,50})","[^"]*",\d+,(\d+)/g;
  let m2;
  const candidates = [];
  while ((m2 = nameGidPattern.exec(body)) !== null) {
    candidates.push({ name: m2[1], gid: m2[2] });
  }
  if (candidates.length) {
    console.log('\nCandidatos nombre+gid:');
    candidates.slice(0, 20).forEach(c => console.log(`  "${c.name}" gid=${c.gid}`));
  }

  // Try fetching by gid 0 (first sheet always exists)
  console.log('\n=== Probando gids 0 y los encontrados ===');
  const toTry = ['0', ...gids].slice(0, 15);
  for (const gid of toTry) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}`;
    const { status, body: csv, headers } = await httpGet(url);
    if (headers.location) {
      const loc = headers.location;
      if (loc.includes('accounts.google.com')) {
        console.log(`  gid=${gid}: requiere login`);
      } else {
        console.log(`  gid=${gid}: redirect -> ${loc.substring(0, 80)}`);
      }
    } else {
      const first = csv.split('\n')[0];
      const isHtml = first.trim().startsWith('<');
      if (!isHtml) {
        console.log(`  gid=${gid} OK: ${csv.split('\n').length} filas | ${first.substring(0, 80)}`);
      } else {
        console.log(`  gid=${gid}: respuesta HTML (privada o no existe)`);
      }
    }
  }
}

main().catch(console.error);
