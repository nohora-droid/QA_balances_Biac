/**
 * run-qa.js — QA Balance Energético
 * Usage: node run-qa.js <year> <month> <bearer_token>
 * Example: node run-qa.js 2026 1 "eyJhbGci..."
 *
 * Reads:   data-YYYY-MM-balance.json  (sheet reference — see build-reference.js)
 * Fetches: Olibia Energy API
 * Saves:   qa-results/YYYY-MM_TIMESTAMP.json  (nunca sobreescribe)
 *          qa-results/index.json             (índice de todas las ejecuciones)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const [,, YEAR_S, MONTH_S, TOKEN] = process.argv;
const YEAR  = parseInt(YEAR_S  || '2026');
const MONTH = parseInt(MONTH_S || '1');

if (!TOKEN) {
  console.error('Uso: node run-qa.js <año> <mes> <bearer_token>');
  console.error('Ej:  node run-qa.js 2026 1 "eyJhbGci..."');
  process.exit(1);
}

const BASE = 'https://olibia.dev.bia.app/ms-olibia-energy/v1';
const MM   = String(MONTH).padStart(2, '0');
const KEY  = `${YEAR}-${MM}`;

// ── Load sheet reference ───────────────────────────────────────────────────────
const refFile = path.join(__dirname, `data-${KEY}-balance.json`);
// Fallback to legacy name for January
const legacyFile = path.join(__dirname, 'data-enero-balance.json');

let sheet;
if (fs.existsSync(refFile)) {
  sheet = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  console.log(`✅ Sheet: ${refFile}`);
} else if (MONTH === 1 && fs.existsSync(legacyFile)) {
  sheet = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  console.log(`✅ Sheet: ${legacyFile} (legacy)`);
} else {
  console.error(`❌ No se encontró ${refFile}`);
  console.error(`   Crea el archivo de referencia para ${KEY} y vuelve a ejecutar.`);
  process.exit(1);
}

// ── HTTP helper ────────────────────────────────────────────────────────────────
function apiGet(p) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${p}`;
    const u   = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function pct(sh, api) {
  if (sh == null || api == null || sh === 0) return null;
  return ((api - sh) / sh) * 100;
}
function cmp(label, shVal, apiVal, note = '') {
  return { label, sheet_kwh: shVal, api_kwh: apiVal, pct: pct(shVal, apiVal), note };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== QA Balance Energético ${KEY} ===\n`);

  // 1. API version
  console.log('1. balance/context...');
  const ctx = await apiGet(`/balance/context?year=${YEAR}&month=${MONTH}`);
  let versionName = 'TxF';
  if (ctx.status === 200 && ctx.data) {
    const versions = Array.isArray(ctx.data) ? ctx.data : ctx.data.versions || [];
    const txf = versions.find ? versions.find(v => String(v?.version_name || v).includes('TxF')) : null;
    if (txf) versionName = typeof txf === 'string' ? txf : txf.version_name;
  }
  console.log(`   Versión: ${versionName}`);

  // 2. Matrices — demanda + dispatch_desp (contratos energía despachada)
  console.log('2. balance/matrices...');
  const mat = await apiGet(`/balance/matrices?year=${YEAR}&month=${MONTH}&version_name=${encodeURIComponent(versionName)}`);
  if (mat.status !== 200) { console.error('   ❌ Error matrices:', mat.status); process.exit(1); }
  const demTotals = {};
  (mat.data.demand || []).forEach(r => { demTotals[r.code] = (demTotals[r.code] || 0) + r.value; });
  const api_dmre = demTotals['DMRE'] || 0;
  const api_dmnr = demTotals['DMNR'] || 0;
  console.log(`   DMRE=${(api_dmre/1e6).toFixed(3)} GWh  DMNR=${(api_dmnr/1e6).toFixed(3)} GWh`);

  // dispatch_desp: contratos energía despachada — fuente usada por la app
  const dd = mat.data.dispatch_desp || [];
  const api_cttosMR  = dd.filter(r => r.market_type === 'R').reduce((s, r) => s + r.value, 0);
  const api_cttosMNR = dd.filter(r => r.market_type === 'N').reduce((s, r) => s + r.value, 0);
  const api_cttos    = api_cttosMR + api_cttosMNR;
  console.log(`   Contratos dispatch_desp: MR=${(api_cttosMR/1e6).toFixed(3)} GWh  MNR=${(api_cttosMNR/1e6).toFixed(3)} GWh`);

  // 3. Reconciliation
  console.log('3. balance/reconciliation...');
  const rec = await apiGet(`/balance/reconciliation?year=${YEAR}&month=${MONTH}&version_name=${encodeURIComponent(versionName)}`);
  if (rec.status !== 200) { console.error('   ❌ Error reconciliation:', rec.status); process.exit(1); }
  const ob = rec.data.official_balcttos;
  const api_cBolsaReg  = ob.compras_regulado_mwh;
  const api_cBolsaNR   = ob.compras_no_regulado_mwh;
  const api_compraBolsa = api_cBolsaReg + api_cBolsaNR;
  const api_vBolsaReg  = ob.ventas_regulado_mwh;
  const api_vBolsaNR   = ob.ventas_no_regulado_mwh;
  const api_ventaBolsa  = api_vBolsaReg + api_vBolsaNR;
  console.log(`   Compra bolsa: ${(api_compraBolsa/1e6).toFixed(3)} GWh  Venta bolsa: ${(api_ventaBolsa/1e6).toFixed(3)} GWh`);

  // 4. contracts/monthly — referencia adicional (no es la fuente principal)
  const compras = []; // kept for apiContracts detail in saved JSON
  console.log(`   (contracts/monthly omitido — usando dispatch_desp de matrices)`);

  // ── Sheet references ──────────────────────────────────────────────────────────
  const sh = {
    dmreTxF:    sheet.demandaRegulada.kwhMesTxF,
    dmrePlan:   sheet.demandaRegulada.kwhMes,
    dmnrTxF:    sheet.demandaNoRegulada.kwhMesTxF,
    dmnrPlan:   sheet.demandaNoRegulada.kwhMes,
    cttos:      sheet.totalContratosSinBolsa.kwhMes,
    cttosMR:    sheet.contratos.filter(c => c.mercado === 'Compra MR').reduce((s,c)=>s+(c.cantidadKwh||0),0),
    cttosMNR:   sheet.contratos.filter(c => c.mercado === 'Compra MNR').reduce((s,c)=>s+(c.cantidadKwh||0),0),
    cBolsa:     sheet.compraBolsa.total.kwhMes,
    cBolsaReg:  sheet.compraBolsa.regulado.kwhMes,
    cBolsaNR:   sheet.compraBolsa.noRegulado.kwhMes,
    vBolsa:     sheet.ventaBolsa.total.kwhMes,
    vBolsaReg:  sheet.ventaBolsa.regulado.kwhMes,
    vBolsaNR:   sheet.ventaBolsa.noRegulado.kwhMes,
  };

  // ── Build comparisons ─────────────────────────────────────────────────────────
  const comparisons = {
    demanda_regulada_txf:  cmp('Demanda Regulada (TxF)',        sh.dmreTxF,   api_dmre,  'Col G sheet vs DMRE matrices'),
    demanda_regulada_plan: cmp('Demanda Regulada (Plan)',       sh.dmrePlan,  api_dmre,  'Col D sheet vs DMRE matrices'),
    demanda_nr_txf:        cmp('Demanda NR (TxF)',              sh.dmnrTxF,   api_dmnr,  '⚠ Conceptos distintos'),
    demanda_nr_plan:       cmp('Demanda NR (Plan)',             sh.dmnrPlan,  api_dmnr,  '⚠ Conceptos distintos'),
    contratos_total:       cmp('Contratos compra (total)',      sh.cttos,     api_cttos, 'Sheet=MR+MNR+May, API=TO Compra'),
    contratos_mr:          cmp('Contratos compra MR',          sh.cttosMR,   api_cttosMR,  ''),
    contratos_mnr:         cmp('Contratos compra MNR',         sh.cttosMNR,  api_cttosMNR, ''),
    compra_bolsa_total:    cmp('Compra Bolsa TOTAL',           sh.cBolsa,    api_compraBolsa, ''),
    compra_bolsa_reg:      cmp('Compra Bolsa Regulado',        sh.cBolsaReg, api_cBolsaReg,   ''),
    compra_bolsa_nr:       cmp('Compra Bolsa No Regulado',     sh.cBolsaNR,  api_cBolsaNR,    ''),
    venta_bolsa_total:     cmp('Venta Bolsa TOTAL',            sh.vBolsa,    api_ventaBolsa,  ''),
    venta_bolsa_reg:       cmp('Venta Bolsa Regulado',         sh.vBolsaReg, api_vBolsaReg,   ''),
    venta_bolsa_nr:        cmp('Venta Bolsa No Regulado',      sh.vBolsaNR,  api_vBolsaNR,    ''),
  };

  // ── Console report ────────────────────────────────────────────────────────────
  const SEP = '═'.repeat(88);
  const sep = '─'.repeat(88);
  console.log('\n' + SEP);
  console.log(`  QA BALANCE ENERGÉTICO  │  ${KEY}  │  Versión ${versionName}`);
  console.log(SEP);
  console.log(`${'Variable'.padEnd(32)} ${'Sheet (kWh)'.padStart(14)} ${'API (kWh)'.padStart(14)} ${'Δ%'.padStart(8)}  Est`);
  console.log(sep);

  function fmtN(n) { if (n==null) return 'N/A'; return n.toLocaleString('es-CO'); }
  function icon(p)  {
    if (p==null) return '❓';
    const a=Math.abs(p);
    return a<=1?'✅':a<=5?'⚠️ ':'❌';
  }

  Object.values(comparisons).forEach(c => {
    const ps = c.pct!=null ? (c.pct>=0?'+':'')+c.pct.toFixed(2)+'%' : 'N/A';
    console.log(`${c.label.padEnd(32)} ${fmtN(c.sheet_kwh).padStart(14)} ${fmtN(c.api_kwh).padStart(14)} ${ps.padStart(8)}  ${icon(c.pct)}`);
  });
  console.log(sep);

  // ── Save result ───────────────────────────────────────────────────────────────
  const outDir = path.join(__dirname, 'qa-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const now = new Date();
  const ts  = now.toISOString().replace(/[:.]/g, '-').substring(0, 19); // 2026-05-11_14-30-22

  // Contracts from dispatch_desp — sum per contract number and market_type
  const byContract = {};
  dd.forEach(r => {
    const k = r.contract;
    if (!byContract[k]) byContract[k] = { number: k, market_type: r.market_type, kWh: 0 };
    byContract[k].kWh += r.value;
  });
  const smartContracts = Object.values(byContract).filter(c => c.kWh > 0);

  const result = {
    generatedAt: now.toISOString(),
    period: KEY,
    year: YEAR, month: MONTH,
    apiVersion: versionName,
    comparisons,
    sheetContracts: sheet.contratos || [],
    apiContracts: smartContracts,
    sheetTotals: {
      totalCompra: sheet.totalCompra?.kwhMes,
      totalVenta:  sheet.totalVenta?.kwhMes,
    },
    apiTotals: {
      dmre_kwh: api_dmre,
      dmnr_kwh: api_dmnr,
      compra_bolsa_kwh: api_compraBolsa,
      venta_bolsa_kwh:  api_ventaBolsa,
      contratos_kwh:    api_cttos,
    },
  };

  // ── Timestamped file — nunca sobreescribe ─────────────────────────────────────
  const fileName = `${KEY}_${ts}.json`;
  const outFile  = path.join(outDir, fileName);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  // ── Update index.json ─────────────────────────────────────────────────────────
  const idxFile = path.join(outDir, 'index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : { runs: [] };
  const pcts = Object.values(comparisons).map(c => c.pct).filter(p => p != null);
  const status = !pcts.length ? 'pending' : pcts.some(p => Math.abs(p) > 5) ? 'err' : pcts.some(p => Math.abs(p) > 1) ? 'warn' : 'ok';
  idx.runs.push({ key: KEY, file: fileName, timestamp: now.toISOString(), period: KEY, apiVersion: versionName, status });
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));

  console.log(`\n✅ Guardado en qa-results/${fileName}`);
  console.log(`   index.json actualizado (${idx.runs.length} ejecución/es total)`);
  console.log('   Ejecuta: node generate-report.js  para regenerar el reporte HTML\n');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
