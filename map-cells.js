/**
 * map-cells.js
 * Fetches a single wide range A255:M320 (no header ambiguity) to map
 * every row and confirm exact cell locations the user referenced.
 */
const https = require('https');
const fs    = require('fs');

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, redirects = 8) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0' } },
      (res) => {
        if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
          if (redirects === 0) { reject(new Error('redirects')); return; }
          resolve(httpGet(res.headers.location, redirects - 1)); return;
        }
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve(b));
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
  if (cell.f != null) return String(cell.f).trim().substring(0, 22);
  if (cell.v != null) return String(cell.v).trim().substring(0, 22);
  return '';
}

async function main() {
  // Fetch A255:M320 — use row 255 as anchor so gviz "header" is a real data row
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&range=A255:M320`;
  const raw = await httpGet(url);
  const data = parseGviz(raw);

  if (!data || data.status !== 'ok') {
    console.error('Error:', raw.substring(0, 300)); return;
  }

  const cols = data.table.cols.map(c => c.label || c.id);
  console.log('Columnas gviz:', cols.join(' | '));
  console.log('');

  // gviz header row = sheet row 255
  // gviz data row 0 = sheet row 256
  const HEADER_SHEET_ROW = 255;
  // Print the header (row 255) separately
  console.log(`Fila 255 (cabecera gviz): ${cols.join(' | ')}\n`);

  // Print all non-empty data rows with their real sheet row number
  const rows = data.table.rows || [];
  rows.forEach((row, i) => {
    const sheetRow = HEADER_SHEET_ROW + 1 + i;
    const cells = (row.c || []).map(cv);
    const hasContent = cells.some(c => c !== '');
    if (hasContent) {
      // Highlight user-specified rows
      const stars = [309, 310, 314, 315].includes(sheetRow) ? ' <<<' : '';
      console.log(`F${sheetRow}${stars}: ${cells.join(' | ')}`);
    }
  });

  // Save full structured data for reference
  const allRows = rows.map((row, i) => {
    const sheetRow = HEADER_SHEET_ROW + 1 + i;
    const cells = (row.c || []).map(cv);
    return { sheetRow, cells };
  }).filter(r => r.cells.some(c => c !== ''));

  fs.writeFileSync('map-cells-output.json', JSON.stringify(allRows, null, 2));
  console.log('\nGuardado en map-cells-output.json');
}

main().catch(console.error);
