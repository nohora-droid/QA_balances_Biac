/**
 * fetch-gviz.js
 * Uses the gviz/tq endpoint (works for public sheets without API key)
 * to read balance data. Also tries to list available sheets.
 */
const https = require('https');
const fs = require('fs');

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

function parseGviz(raw) {
  // gviz response: google.visualization.Query.setResponse({...})
  const match = raw.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)\s*;?\s*$/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (e) { return null; }
}

async function fetchGvizSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const raw = await httpGet(url);
  return parseGviz(raw);
}

async function main() {
  // Try gviz with no sheet name (first sheet)
  console.log('=== gviz: primera hoja (sin nombre) ===');
  const raw0 = await httpGet(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`
  );
  const d0 = parseGviz(raw0);
  if (d0) {
    const cols = d0.table.cols.map(c => c.label || c.id);
    const rows = d0.table.rows || [];
    console.log(`Columnas (${cols.length}): ${cols.slice(0, 10).join(', ')}`);
    console.log(`Filas: ${rows.length}`);
    if (rows.length > 0) {
      console.log('Fila 1:', rows[0].c.slice(0, 6).map(c => c && c.v).join(' | '));
      console.log('Fila 2:', rows[1] ? rows[1].c.slice(0, 6).map(c => c && c.v).join(' | ') : '-');
    }
  } else {
    console.log('No se pudo parsear gviz:', raw0.substring(0, 300));
  }

  // Try specific variable names as sheets
  const sheetCandidates = ['Enero', 'enero', 'Balance', 'Resumen', 'Matrices', 'Resultados'];
  for (const name of sheetCandidates) {
    console.log(`\n=== gviz: sheet="${name}" ===`);
    const data = await fetchGvizSheet(name);
    if (data && data.status === 'ok') {
      const cols = data.table.cols.map(c => c.label || c.id);
      const rows = data.table.rows || [];
      console.log(`  Columnas: ${cols.slice(0, 8).join(', ')} ...`);
      console.log(`  Filas: ${rows.length}`);
      if (rows.length > 0 && rows[0].c) {
        console.log(`  Fila 1: ${rows[0].c.slice(0, 6).map(c => c && c.v != null ? c.v : '').join(' | ')}`);
      }
      // Save full data for enero
      if (name.toLowerCase() === 'enero') {
        fs.writeFileSync('gviz-enero.json', JSON.stringify(data, null, 2));
        console.log('  Guardado en gviz-enero.json');
      }
    } else if (data) {
      console.log(`  Error: ${data.errors ? JSON.stringify(data.errors) : data.status}`);
    } else {
      const raw = await httpGet(
        `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(name)}`
      );
      console.log(`  Raw: ${raw.substring(0, 200)}`);
    }
  }

  // Save raw first-sheet gviz for deep inspection
  fs.writeFileSync('gviz-sheet1.json', raw0);
  console.log('\nGuardado gviz-sheet1.json para inspección');
}

main().catch(console.error);
