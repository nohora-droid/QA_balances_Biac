/**
 * explore-sheets.js
 * Discovers all tab names in the spreadsheet and samples Sheet1 structure.
 */
const https = require('https');

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, (res) => {
      if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        if (loc.includes('accounts.google.com')) {
          reject(new Error('Requires login')); return;
        }
        resolve(httpGet(loc, redirects - 1)); return;
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function getSheetNames() {
  // gviz endpoint for a sheet that doesn't exist returns error with list of valid names
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=__nonexistent__`;
  const body = await httpGet(url);
  // Extract table description from gviz JSON-like response
  const names = [];
  const re = /"sheetName":"([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) names.push(m[1]);
  return names;
}

async function sampleSheet(sheetName, rows = 5) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`;
  const body = await httpGet(url);
  return body.split('\n').slice(0, rows).map((line) => line.substring(0, 150));
}

async function main() {
  console.log('=== Descubriendo pestañas del spreadsheet ===\n');

  // Try via gviz error
  try {
    const names = await getSheetNames();
    if (names.length) {
      console.log('Pestañas encontradas:', names);
    }
  } catch (e) {
    console.log('gviz names lookup failed:', e.message);
  }

  // Also try known candidate tab names
  const candidates = [
    'Sheet1', 'enero', 'febrero', 'marzo',
    'Enero', 'Febrero', 'Marzo',
    'Balance', 'Balance Enero', 'Balance enero',
    'Jan', 'Jan 2026', 'Enero 2026',
    'TxF', 'Resumen', 'Matrices',
    'Entradas', 'Input',
  ];

  console.log('\n=== Probando pestañas candidatas ===');
  for (const name of candidates) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(name)}`;
    try {
      const body = await httpGet(url);
      const firstLine = body.split('\n')[0];
      const isHtml = firstLine.trim().startsWith('<');
      const isEmpty = body.trim().length === 0;
      if (!isHtml && !isEmpty) {
        console.log(`  ✅ "${name}" — ${body.split('\n').length} filas | Inicio: ${firstLine.substring(0, 80)}`);
      } else {
        console.log(`  ❌ "${name}" — no encontrada o redirigida`);
      }
    } catch (e) {
      console.log(`  ❌ "${name}" — error: ${e.message}`);
    }
  }

  console.log('\n=== Muestra de Sheet1 (primeras 8 filas) ===');
  try {
    const sample = await sampleSheet('Sheet1', 8);
    sample.forEach((r, i) => console.log(`  F${i + 1}: ${r}`));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
