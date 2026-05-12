/**
 * inspect-range.js
 * Dumps raw content of rows 258-320, columns A-M to understand the exact layout.
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
  if (cell.f != null) return String(cell.f).trim();
  if (cell.v != null) return String(cell.v).trim();
  return '';
}

async function dumpRange(range, startRow) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&range=${range}`;
  const raw = await httpGet(url);
  const data = parseGviz(raw);
  if (!data || data.status !== 'ok') {
    console.log(`❌ ${range}: ${raw.substring(0, 200)}`);
    return;
  }

  const cols = data.table.cols.map(c => c.label || c.id);
  // gviz uses the first row of the range as header → it's actually sheet row `startRow`
  const headerRow = cols;

  console.log(`\n=== Range ${range} (gviz header = sheet row ${startRow}) ===`);
  console.log(`Cols: ${headerRow.map((h, i) => `[${i}]${h}`).join('  ')}`);

  // Print "header row" values (these are the actual cells of startRow)
  console.log(`\nFila ${startRow} (usada como cabecera): ${headerRow.join(' | ')}`);

  // Data rows start at startRow + 1
  (data.table.rows || []).forEach((row, i) => {
    const sheetRow = startRow + 1 + i;
    const cells = (row.c || []).map(cv);
    const hasContent = cells.some(c => c !== '');
    if (hasContent) {
      console.log(`F${sheetRow}: ${cells.join(' | ')}`);
    }
  });
}

async function main() {
  // Wide view: all columns A-M for the relevant row range
  // Split into two fetches to avoid gviz row limits
  await dumpRange('A258:M280', 258);
  await dumpRange('A280:M320', 280);
}

main().catch(console.error);
