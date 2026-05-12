/**
 * explore-resumen.js
 * Explores the "Resumen Balance" sheet tab to understand multi-month structure.
 */
const https = require('https');

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, r = 8) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' } },
      (res) => {
        if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
          if (r === 0) { reject(new Error('too many redirects')); return; }
          resolve(httpGet(res.headers.location, r - 1)); return;
        }
        let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b));
      }
    ).on('error', reject);
  });
}

function parseGviz(raw) {
  const m = raw.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function cv(cell) {
  if (!cell) return '';
  if (cell.f != null) return String(cell.f).trim().substring(0, 30);
  if (cell.v != null) return String(cell.v).trim().substring(0, 30);
  return '';
}

async function fetchRange(range, sheet = 'Resumen Balance') {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheet)}&range=${range}`;
  const raw = await httpGet(url);
  const data = parseGviz(raw);
  if (!data || data.status !== 'ok') { console.error('Error for range', range, raw.substring(0, 200)); return null; }
  const startRow = parseInt(range.match(/\d+/)[0]);
  const rows = (data.table.rows || []).map((row, i) => ({
    sheetRow: startRow + 1 + i,
    cells: (row.c || []).map(cv),
  }));
  return { cols: data.table.cols.map(c => c.label || c.id), rows };
}

async function main() {
  console.log('=== Explorando "Resumen Balance" ===\n');

  // First: get rows 1-80 to see overall structure (columns A-N to cover all 12 months + labels)
  const data = await fetchRange('A1:N80');
  if (!data) { console.error('No data'); return; }

  console.log(`Columnas: ${data.cols.join(' | ')}\n`);

  for (const row of data.rows) {
    const hasContent = row.cells.some(c => c !== '');
    if (hasContent) {
      console.log(`F${row.sheetRow}: ${row.cells.join(' | ')}`);
    }
  }

  console.log('\n=== Buscando filas 60-80 (área demandas) ===');
  const dem = await fetchRange('A60:N80');
  if (dem) {
    for (const row of dem.rows) {
      const hasContent = row.cells.some(c => c !== '');
      if (hasContent) console.log(`F${row.sheetRow}: ${row.cells.join(' | ')}`);
    }
  }
}

main().catch(console.error);
