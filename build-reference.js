/**
 * build-reference.js
 * Builds the definitive reference JSON for January 2026 balance validation.
 * Maps the sheet structure found via gviz range queries.
 *
 * Sheet layout discovered (actual gviz rows, cols A-M):
 *   COMPRAS:
 *     Regulado:
 *       F255: Contratos Regulado (compra bolsa) = 6,351,527 kWh  → col D
 *       F257: Total Regulado compra = 21,924,665 kWh
 *     No Regulado (contratos individuales, col B="No Regulado", col C=nombre):
 *       F258-F269: contratos NR individuales
 *       F270: Compra bolsa NR = 125,382,179 kWh
 *       F271: Total NR compra = 137,394,174 kWh
 *     Mayoristas:
 *       F272-F274: contratos mayoristas
 *       F276: TOTAL COMPRA = 163,318,829 kWh
 *   VENTAS:
 *     F283: Demanda Regulada  → col D=19,510,699  col G=21,678,554 (TxF)
 *     F284: Venta bolsa Reg.  → col D=246,110     col G=10,100,314
 *     F286: Demanda No Reg.   → col D=141,322,536 col G=147,210,974 (TxF)
 *     F291: TOTAL VENTA = 165,079,334 kWh
 *   BALANCE TRANSACCIONES BOLSA (cols J-M):
 *     Compra bolsa propia: 131,733,706 kWh @ $552.47 = $72,778,796,853
 *     Venta bolsa propia:  246,110 kWh    @ $509.62 = $125,423,120
 *     Neto:               -131,487,596 kWh           = -$72,653,373,733
 */

const https = require('https');
const fs    = require('fs');
require('dotenv').config();

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, r = 8) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get(
      { hostname: u.hostname, path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0' } },
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

function cv(cell, raw = false) {
  if (!cell) return null;
  if (!raw && cell.f != null) {
    const cleaned = String(cell.f).replace(/[$\s,]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? String(cell.f).trim() : n;
  }
  if (cell.v != null) return cell.v;
  return null;
}

async function fetchRange(range) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&range=${range}`;
  const data = parseGviz(await httpGet(url));
  if (!data || data.status !== 'ok') return null;
  // gviz header row = first row of range. Build grid with correct row numbers.
  const startRowNum = parseInt(range.match(/\d+/)[0]);
  const cols = data.table.cols.map(c => c.label || c.id);

  // Row 0 of gviz data = actual sheet row (startRowNum + 1)
  // because startRowNum was consumed as header
  const rows = (data.table.rows || []).map((row, i) => ({
    sheetRow: startRowNum + 1 + i,
    cells: (row.c || []).map(c => cv(c)),
    rawCells: (row.c || []).map(c => cv(c, true)),
  }));
  return { cols, rows, headerConsumed: startRowNum };
}

async function main() {
  console.log('=== Construyendo referencia de balance enero 2026 ===\n');

  // ── 1. Fetch COMPRAS section (rows 254-278) ────────────────────────────
  const comprasData = await fetchRange('A254:M278');
  if (!comprasData) { console.error('Error fetching compras'); process.exit(1); }

  // Parse compras
  const contratos = [];
  let compraBolsaReg = null, compraBolsaNR = null, totalCompra = null;

  for (const row of comprasData.rows) {
    const [, categ, nombre, cantidad, precio, monto] = row.cells;
    if (!nombre && cantidad == null) continue;

    const n = String(nombre || '').trim();
    const k = typeof cantidad === 'number' ? cantidad : parseFloat(String(cantidad || '0').replace(/[^0-9.-]/g, '')) || 0;

    if (n === 'TOTAL COMPRA')     { totalCompra = k; continue; }
    if (n === 'Total Regulado')   continue;
    if (n === 'Total No Regulado') continue;
    if (n === 'Total Mayorista')  continue;

    if (n === 'Compra bolsa') {
      // First occurrence = Regulado, second = No Regulado
      if (compraBolsaReg === null) { compraBolsaReg = k; }
      else                         { compraBolsaNR  = k; }
      continue;
    }

    // Regular contract
    const categStr = String(categ || '').trim();
    if (k !== 0 || n) {
      contratos.push({
        mercado: categStr || 'Regulado',
        contraparte: n,
        cantidadKwh: k,
        precioUnitario: typeof precio === 'number' ? precio : null,
        montoTotal: typeof monto === 'number' ? monto : null,
      });
    }
  }

  console.log(`Contratos encontrados: ${contratos.length}`);
  contratos.forEach(c =>
    console.log(`  [${c.mercado}] ${c.contraparte}: ${c.cantidadKwh?.toLocaleString()} kWh`)
  );
  console.log(`Compra Bolsa Regulado: ${compraBolsaReg?.toLocaleString()} kWh`);
  console.log(`Compra Bolsa No Regulado: ${compraBolsaNR?.toLocaleString()} kWh`);
  console.log(`TOTAL COMPRA: ${totalCompra?.toLocaleString()} kWh\n`);

  // ── 2. Fetch VENTAS section (rows 282-292) ─────────────────────────────
  const ventasData = await fetchRange('A282:M292');
  if (!ventasData) { console.error('Error fetching ventas'); process.exit(1); }

  let demandaRegulada = null, demandaNoRegulada = null;
  let ventaBolsaReg = null, ventaBolsaNR = null, totalVenta = null;
  let demandaReguladaTxF = null, demandaNoReguladaTxF = null;

  for (const row of ventasData.rows) {
    const [, categ, nombre, cantidad, , , colG] = row.cells;
    const n = String(nombre || '').trim();
    const k = typeof cantidad === 'number' ? cantidad : null;
    const gVal = typeof colG === 'number' ? colG : null;

    if (n === 'Demanda Regulada')    { demandaRegulada = k; demandaReguladaTxF = gVal; }
    if (n === 'Demanda No Regulada') { demandaNoRegulada = k; demandaNoReguladaTxF = gVal; }
    if (n === 'Venta bolsa') {
      if (ventaBolsaReg === null) { ventaBolsaReg = k ?? 0; }
      else                        { ventaBolsaNR  = k ?? 0; }
    }
    if (n === 'TOTAL VENTA') { totalVenta = k; }
  }

  console.log(`Demanda Regulada:    ${demandaRegulada?.toLocaleString()} kWh  (TxF: ${demandaReguladaTxF?.toLocaleString()})`);
  console.log(`Demanda No Regulada: ${demandaNoRegulada?.toLocaleString()} kWh (TxF: ${demandaNoReguladaTxF?.toLocaleString()})`);
  console.log(`Venta Bolsa Reg.:    ${ventaBolsaReg?.toLocaleString()} kWh`);
  console.log(`Venta Bolsa NR:      ${ventaBolsaNR?.toLocaleString()} kWh`);
  console.log(`TOTAL VENTA:         ${totalVenta?.toLocaleString()} kWh\n`);

  // ── 3. Fetch BALANCE TRANSACCIONES BOLSA (rows 273-279, cols J-M) ─────
  const bolsaData = await fetchRange('J273:M279');
  const resumenBolsa = { rows: [] };
  if (bolsaData) {
    for (const row of bolsaData.rows) {
      const hasContent = row.cells.some(c => c !== null && c !== '');
      if (hasContent) resumenBolsa.rows.push({ sheetRow: row.sheetRow, values: row.cells });
    }
  }
  console.log('Resumen transacciones bolsa:');
  resumenBolsa.rows.forEach(r =>
    console.log(`  F${r.sheetRow}: ${r.values.join(' | ')}`)
  );

  // ── Estructura final ───────────────────────────────────────────────────
  const compraBolsaTotal = (compraBolsaReg || 0) + (compraBolsaNR || 0);

  const output = {
    fuente: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    periodoRef: 'Enero 2026',
    version: 'TxF',
    extractedAt: new Date().toISOString(),
    unidades: 'kWh (excepto donde se indique)',

    // ── Variables clave ──
    demandaRegulada: {
      kwhMes: demandaRegulada,
      kwhMesTxF: demandaReguladaTxF,
      gwhMes: demandaRegulada ? +(demandaRegulada / 1e6).toFixed(4) : null,
    },
    demandaNoRegulada: {
      kwhMes: demandaNoRegulada,
      kwhMesTxF: demandaNoReguladaTxF,
      gwhMes: demandaNoRegulada ? +(demandaNoRegulada / 1e6).toFixed(4) : null,
    },
    contratos: contratos.map(c => ({
      ...c,
      gwhMes: c.cantidadKwh ? +(c.cantidadKwh / 1e6).toFixed(4) : null,
    })),
    totalContratosSinBolsa: {
      kwhMes: contratos.reduce((s, c) => s + (c.cantidadKwh || 0), 0),
      gwhMes: +(contratos.reduce((s, c) => s + (c.cantidadKwh || 0), 0) / 1e6).toFixed(4),
    },
    compraBolsa: {
      regulado: { kwhMes: compraBolsaReg },
      noRegulado: { kwhMes: compraBolsaNR },
      total: { kwhMes: compraBolsaTotal, gwhMes: +(compraBolsaTotal / 1e6).toFixed(4) },
    },
    ventaBolsa: {
      regulado: { kwhMes: ventaBolsaReg },
      noRegulado: { kwhMes: ventaBolsaNR },
      total: {
        kwhMes: (ventaBolsaReg || 0) + (ventaBolsaNR || 0),
        gwhMes: +((((ventaBolsaReg || 0) + (ventaBolsaNR || 0)) / 1e6).toFixed(4)),
      },
    },

    // ── Totales ──
    totalCompra: { kwhMes: totalCompra, gwhMes: totalCompra ? +(totalCompra / 1e6).toFixed(4) : null },
    totalVenta:  { kwhMes: totalVenta,  gwhMes: totalVenta  ? +(totalVenta / 1e6).toFixed(4) : null },

    // ── Resumen Bolsa ──
    resumenTransaccionesBolsa: resumenBolsa.rows,
  };

  fs.writeFileSync('data-enero-balance.json', JSON.stringify(output, null, 2));
  console.log('\n✅ Guardado en data-enero-balance.json');

  // Print summary
  console.log('\n=== RESUMEN EJECUTIVO ===');
  console.log(`Demanda Regulada:    ${(output.demandaRegulada.gwhMes)} GWh/mes`);
  console.log(`Demanda No Regulada: ${(output.demandaNoRegulada.gwhMes)} GWh/mes`);
  console.log(`Contratos (total):   ${output.totalContratosSinBolsa.gwhMes} GWh/mes (${contratos.length} contratos)`);
  console.log(`Compra Bolsa:        ${output.compraBolsa.total.gwhMes} GWh/mes`);
  console.log(`Venta Bolsa:         ${output.ventaBolsa.total.gwhMes} GWh/mes`);
  console.log(`TOTAL COMPRA:        ${output.totalCompra.gwhMes} GWh/mes`);
  console.log(`TOTAL VENTA:         ${output.totalVenta.gwhMes} GWh/mes`);
}

main().catch(console.error);
