/**
 * extract-balance.js
 * Fetches specific cell ranges from the balance sheet using gviz range queries.
 *
 * Cell map (from user):
 *  - Demanda Regulada  : G309
 *  - Demanda No Regulada: G314
 *  - Contratos + Compras Bolsa (names): D262:D297, values in G262:G297
 *  - Ventas en Bolsa   : D310:G315 (rows 310 and 315)
 *  - Resumen Bolsa     : J298:M304
 */

const https = require('https');
const fs    = require('fs');
require('dotenv').config();

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, redirects = 8) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } },
      (res) => {
        if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
          if (redirects === 0) { reject(new Error('too many redirects')); return; }
          resolve(httpGet(res.headers.location, redirects - 1)); return;
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve(body));
      }
    ).on('error', reject);
  });
}

function parseGviz(raw) {
  const m = raw.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

async function fetchRange(range) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&range=${range}`;
  const raw = await httpGet(url);
  const data = parseGviz(raw);
  if (!data) {
    console.error(`  ❌ ${range}: parse failed. Raw: ${raw.substring(0, 200)}`);
    return null;
  }
  if (data.status !== 'ok') {
    console.error(`  ❌ ${range}: ${JSON.stringify(data.errors)}`);
    return null;
  }
  return data.table;
}

function cellValue(cell) {
  if (!cell) return null;
  if (cell.v != null) return cell.v;
  return null;
}

function tableToGrid(table) {
  if (!table) return [];
  return (table.rows || []).map(row =>
    (row.c || []).map(cell => cellValue(cell))
  );
}

async function main() {
  console.log('=== Extrayendo datos del balance de energía ===\n');

  // ── 1. Demanda Regulada (G309) ─────────────────────────────────────────
  console.log('1. Demanda Regulada (G309)...');
  const tDR = await fetchRange('G309');
  const demandaRegulada = tDR ? cellValue(tDR.rows?.[0]?.c?.[0]) : null;
  console.log(`   Valor: ${demandaRegulada}`);

  // ── 2. Demanda No Regulada (G314) ──────────────────────────────────────
  console.log('2. Demanda No Regulada (G314)...');
  const tDNR = await fetchRange('G314');
  const demandaNoRegulada = tDNR ? cellValue(tDNR.rows?.[0]?.c?.[0]) : null;
  console.log(`   Valor: ${demandaNoRegulada}`);

  // ── 3. Contratos + Compras Bolsa (D262:G297) ───────────────────────────
  console.log('3. Contratos + Compras Bolsa (D262:G297)...');
  const tContratos = await fetchRange('D262:G297');
  const grid262 = tableToGrid(tContratos);

  const contratos = [];
  const comprasBolsa = [];

  grid262.forEach((row, i) => {
    const nombre = row[0];
    const valor  = row[3]; // G column = 4th col in range D:G
    if (!nombre && valor == null) return;

    const nombreStr = String(nombre || '').trim();
    const sheetRow  = 262 + i;

    // Heuristic: "bolsa" or "Bolsa" in name → compra bolsa; else → contrato
    const isCompra = /bolsa/i.test(nombreStr) || /compra/i.test(nombreStr);

    const entry = { row: sheetRow, nombre: nombreStr, valor };
    if (isCompra) {
      comprasBolsa.push(entry);
    } else {
      contratos.push(entry);
    }
  });

  console.log(`   Contratos encontrados: ${contratos.length}`);
  contratos.forEach(c => console.log(`     F${c.row}: "${c.nombre}" = ${c.valor}`));
  console.log(`   Compras Bolsa encontradas: ${comprasBolsa.length}`);
  comprasBolsa.forEach(c => console.log(`     F${c.row}: "${c.nombre}" = ${c.valor}`));

  // ── 4. Ventas en Bolsa (D310:G315 — filas 310 y 315) ──────────────────
  console.log('4. Ventas en Bolsa (D310:G315)...');
  const tVentas = await fetchRange('D310:G315');
  const gridVentas = tableToGrid(tVentas);
  const ventasBolsa = [];
  gridVentas.forEach((row, i) => {
    const sheetRow = 310 + i;
    if (sheetRow !== 310 && sheetRow !== 315) return;
    const nombre = String(row[0] || '').trim();
    const valor  = row[3];
    ventasBolsa.push({ row: sheetRow, nombre, valor });
  });
  console.log(`   Ventas Bolsa:`);
  ventasBolsa.forEach(v => console.log(`     F${v.row}: "${v.nombre}" = ${v.valor}`));

  // ── 5. Resumen Transacciones Bolsa (J298:M304) ─────────────────────────
  console.log('5. Resumen Transacciones Bolsa (J298:M304)...');
  const tResumen = await fetchRange('J298:M304');
  const resumenHeaders = (tResumen?.cols || []).map(c => c.label || c.id);
  const resumenGrid = tableToGrid(tResumen);
  console.log(`   Headers: ${resumenHeaders.join(' | ')}`);
  resumenGrid.forEach((row, i) =>
    console.log(`   F${298 + i}: ${row.join(' | ')}`)
  );

  // ── Guardar JSON estructurado ──────────────────────────────────────────
  const output = {
    source: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    extractedAt: new Date().toISOString(),
    enero2026: {
      demandaRegulada:   { value: demandaRegulada, cell: 'G309', unit: 'GWh/mes' },
      demandaNoRegulada: { value: demandaNoRegulada, cell: 'G314', unit: 'GWh/mes' },
      contratos: contratos.map(c => ({ nombre: c.nombre, valor: c.valor, fila: c.row })),
      comprasBolsa: comprasBolsa.map(c => ({ nombre: c.nombre, valor: c.valor, fila: c.row })),
      ventasBolsa: ventasBolsa.map(v => ({ nombre: v.nombre, valor: v.valor, fila: v.row })),
      resumenBolsa: {
        headers: resumenHeaders,
        rows: resumenGrid.map((row, i) => ({ sheetRow: 298 + i, values: row })),
      },
    },
  };

  fs.writeFileSync('data-enero-balance.json', JSON.stringify(output, null, 2));
  console.log('\n✅ Guardado en data-enero-balance.json');
}

main().catch(console.error);
