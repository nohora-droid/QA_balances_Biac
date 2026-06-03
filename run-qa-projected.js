/**
 * run-qa-projected.js — QA Balance Proyectado (Jun–Dic 2026)
 * Usage: node run-qa-projected.js <year> <month> [apiKey]
 * Example: node run-qa-projected.js 2026 6
 *
 * Reads:   Google Sheet (gviz API, balance summary section)
 * Fetches: Olibia Energy API con Api-key
 * Saves:   qa-results/YYYY-MM_TIMESTAMP.json  (nunca sobreescribe)
 *          qa-results/index.json
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const [,, YEAR_S, MONTH_S, KEY_ARG] = process.argv;
const YEAR  = parseInt(YEAR_S  || '2026');
const MONTH = parseInt(MONTH_S || '6');
const PERCENTILE = 'p50';

const API_KEY = KEY_ARG
  || process.env.OLIBIA_API_KEY
  || 'bia_4f9c2a81d7e6b3f0a5c8e14d92ab6731f5e807c2d4a9b61e38f7c5a0d2b4e91c7f63a5d1e8b40c29a7d6f31b5e9c0842d7a16c5b3f8e04d91ab67c2e5f3408a';

const BASE     = 'https://integrations.bia.app/ms-olibia-energy/v1';
const SHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';
const MM   = String(MONTH).padStart(2, '0');
const KEY  = `${YEAR}-${MM}`;

const TAB_NAMES = {
  1: 'Enero2026',  2: 'Febrero2026',  3: 'Marzo2026',
  4: 'Abril2026',  5: 'Mayo2026',     6: 'Junio2026',
  7: 'Julio2026',  8: 'Agosto2026',   9: 'Septiembre2026',
  10: 'Octubre2026', 11: 'Noviembre2026', 12: 'Diciembre2026',
};

const tabName = TAB_NAMES[MONTH];
if (!tabName) { console.error('Mes no soportado:', MONTH); process.exit(1); }

// ── HTTP helpers ───────────────────────────────────────────────────────────────
function apiGet(p) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${p}`;
    const u   = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Api-key': API_KEY,
        'X-User-Email': 'integrations@bia.app',
        'X-User-ID': '1',
        'Accept': 'application/json',
      },
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function gvizGet(range) {
  return new Promise((resolve, reject) => {
    const encodedTab = encodeURIComponent(tabName);
    const encodedRange = encodeURIComponent(range);
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodedTab}&range=${encodedRange}`;
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        const m = b.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\)/);
        if (!m) { reject(new Error('gviz parse error: ' + b.substring(0, 100))); return; }
        try { resolve(JSON.parse(m[1])); }
        catch (e) { reject(e); }
      });
    }).on('error', reject).setTimeout(20000, function() { this.destroy(); reject(new Error('gviz timeout')); });
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function pct(sh, api) {
  if (sh == null || api == null || sh === 0) return null;
  return ((api - sh) / sh) * 100;
}
function cmp(label, shVal, apiVal, note = '') {
  return { label, sheet_kwh: shVal ?? null, api_kwh: apiVal ?? null, pct: pct(shVal, apiVal), note };
}
function parseFormattedNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[,$\s]/g, ''));
  return isNaN(n) ? null : n;
}

// ── Parse Google Sheet balance summary ────────────────────────────────────────
async function readSheetSummary() {
  console.log('   Leyendo balance summary del sheet...');
  // The balance summary table is consistently at rows 258-325 across projected months
  const gviz = await gvizGet('A258:AZ330');
  const rows = gviz.table.rows || [];

  const sheet = {
    dmre: null,
    dmnr: null,
    contratos_mr: null,
    contratos_mnr: null,
    compra_bolsa_mr: null,
    compra_bolsa_mnr: null,
    venta_bolsa_mr: null,
    venta_bolsa_mnr: null,
    total_compra: null,
    total_venta: null,
    contracts_mr: [],    // [{name, kwh}]
    contracts_mnr: [],   // [{name, kwh}]
    contracts_venta_nr: [],
  };

  rows.forEach((r, i) => {
    const c = r.c || [];
    const get = (idx) => c[idx] && c[idx].v != null ? c[idx].v : null;
    const row = 258 + i;

    const c0 = get(0);  // mercado (Compra MR, Compra MNR, Venta MR, Venta MNR, etc.)
    const c1 = get(1);  // subtipo (Sicep, No Regulado, etc.)
    const c2 = get(2);  // nombre contrato / etiqueta
    const c3 = get(3);  // kWh
    const c6 = get(6);  // usado para DMNR y totals extras
    const c7 = get(7);  // MR label / extra info
    const c8 = get(8);  // contratos_mr en algunas filas
    const c9 = get(9);  // DMRE como string formateado en algunas filas

    // ── Individual MR contracts
    if (c0 === 'Compra MR' && c1 === 'Sicep' && c2 && c3 != null) {
      sheet.contracts_mr.push({ name: c2, kwh: c3 });
    }

    // ── Individual MNR contracts
    if (c0 === 'Compra MNR' && c1 === 'No Regulado' && c2 && c3 != null) {
      sheet.contracts_mnr.push({ name: c2, kwh: c3 });
    }
    // BIAG restante H0, BIAG naos, BIAG otro (different c0 but still NR compra)
    if ((c2 === 'BIAG restante H0' || c2 === 'BIAG naos' || c2 === 'BIAG otro') && c3 != null) {
      sheet.contracts_mnr.push({ name: c2, kwh: c3 });
    }

    // ── MR bolsa (Compra MR + Compra bolsa)
    if (c0 === 'Compra MR' && c2 === 'Compra bolsa' && c3 != null) {
      sheet.compra_bolsa_mr = c3;
    }

    // ── NR bolsa (Compra Mayoristas + Compra bolsa)
    if (c0 === 'Compra Mayoristas' && c2 === 'Compra bolsa' && c3 != null) {
      sheet.compra_bolsa_mnr = c3;
    }

    // ── Total Regulado (MR contratos + bolsa MR)
    if (c2 === 'Total Regulado' && c0 !== 'Venta MNR' && c3 != null) {
      sheet.total_regulado = c3;
      // DMRE is embedded as formatted string in c9 on this row (or next NR row)
      if (c9 != null) {
        const v = parseFormattedNum(c9);
        if (v && v > 1000000) sheet.dmre = v;
      }
      // contratos_mr = total_regulado - compra_bolsa_mr (calculated after)
    }

    // ── Total No Regulado (NR contratos + bolsa NR)
    if (c0 === 'Compra Mayoristas' && c2 === 'Total No Regulado' && c3 != null) {
      sheet.total_nr = c3;
    }

    // ── DMRE also appears in the first NR contract row (AESP) and others
    if (c0 === 'Compra MNR' && c9 != null && sheet.dmre == null) {
      const v = parseFormattedNum(c9);
      if (v && v > 1000000) sheet.dmre = v;
    }

    // ── DMRE also appears as c6 on Venta MR Agentes row (C0='Venta MR', C1='Agentes')
    if (c0 === 'Venta MR' && c1 === 'Agentes' && c6 != null && c6 > 10000000 && sheet.dmre == null) {
      sheet.dmre = c6;
    }

    // ── Compra MR total (c8 on "Total Regulado" row or AESP row)
    if (c7 === 'MR' && c8 != null && c8 > 1000000) {
      if (sheet.contratos_mr == null || c8 > sheet.contratos_mr) {
        sheet.contratos_mr = c8;
      }
    }

    // ── DMNR: appears as c6 on the first Venta NR contract row that has c6 > 10M
    // Pattern: C0='Venta MNR' | C1='No Regulado' | C2=contract_name | C6=DMNR
    // The specific contract row varies by month (BIAG, Spectrum, Nitro, BTG...)
    if ((c0 === 'Venta MNR' || (c0 == null && c1 === 'No Regulado'))
        && c6 != null && c6 > 10000000 && sheet.dmnr == null) {
      sheet.dmnr = c6;
    }

    // ── TOTAL COMPRA
    if (c2 === 'TOTAL COMPRA' && c3 != null) {
      sheet.total_compra = c3;
    }

    // ── TOTAL VENTA
    if (c2 === 'TOTAL VENTA' && c3 != null) {
      sheet.total_venta = c3;
    }

    // ── Venta bolsa regulado (Venta MNR | Regulado | Venta bolsa)
    if (c0 === 'Venta MNR' && c1 === 'Regulado' && c2 === 'Venta bolsa' && c3 != null) {
      sheet.venta_bolsa_mr = c3;
    }

    // ── Venta contratos NR (for reference)
    // Rows can have C0='Venta MNR' or empty C0 (Nitro row has C0='') when following a Venta MNR context
    if ((c0 === 'Venta MNR' || (c0 == null && c1 === 'No Regulado'))
        && c2 && c3 != null && c3 > 0
        && c2 !== 'Venta bolsa' && c2 !== 'Total No Regulado' && c2 !== 'Total Regulado') {
      sheet.contracts_venta_nr.push({ name: c2, kwh: c3 });
    }

    // ── Venta bolsa NR: row where C2='Venta bolsa' after 'Demanda No Regulada' row
    // This row has C0='Venta Mayoristas' or null, comes AFTER venta bolsa MR is already set
    if (c2 === 'Venta bolsa' && c3 != null && sheet.venta_bolsa_mr != null && sheet.venta_bolsa_mnr == null) {
      // Make sure it's not the same row as MR (NR bolsa value is larger typically)
      if (c3 !== sheet.venta_bolsa_mr) {
        sheet.venta_bolsa_mnr = c3;
      }
    }
  });

  // Derive contratos_mnr = total_nr - compra_bolsa_mnr
  if (sheet.total_nr != null && sheet.compra_bolsa_mnr != null) {
    sheet.contratos_mnr = sheet.total_nr - sheet.compra_bolsa_mnr;
  }
  // Derive contratos_mr from total_regulado - compra_bolsa_mr
  if (sheet.contratos_mr == null && sheet.total_regulado != null && sheet.compra_bolsa_mr != null) {
    sheet.contratos_mr = sheet.total_regulado - sheet.compra_bolsa_mr;
  }

  return sheet;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'═'.repeat(88)}`);
  console.log(`  QA BALANCE PROYECTADO  │  ${KEY}  │  percentil ${PERCENTILE}`);
  console.log(`${'═'.repeat(88)}\n`);

  // 1. Verify projected status
  console.log('1. balance/context...');
  const ctx = await apiGet(`/balance/context?year=${YEAR}&month=${MONTH}`);
  if (ctx.status !== 200) { console.error('   ❌ Error context:', ctx.status, ctx.data); process.exit(1); }
  if (ctx.data.available_status !== 'proyectado') {
    console.warn(`   ⚠ available_status = "${ctx.data.available_status}" (esperado: "proyectado")`);
  }
  const projDays = (ctx.data.projected_days || []).length;
  console.log(`   Status: ${ctx.data.available_status}  |  Días proyectados: ${projDays}`);
  console.log(`   Percentiles: ${(ctx.data.forecast_percentiles || []).join(', ')}`);

  // 2. Contracts catalog (for Venta NR identification)
  console.log('2. contracts catalog...');
  const ctCat = await apiGet(`/contracts?limit=500&offset=0`);
  const items = (ctCat.status === 200 && ctCat.data.items) ? ctCat.data.items : [];
  const VENTA_NR_FALLBACK = new Set(['88305','88963','88734','88503','88867']);
  let ventaNRCodes;
  if (items.length > 0) {
    ventaNRCodes = new Set(
      items.filter(c => c.operation === 'Venta' && c.type === 'NO REGULADO' && c.sic_code)
           .map(c => c.sic_code)
    );
    console.log(`   Venta NR sic_codes: ${[...ventaNRCodes].join(', ')}`);
  } else {
    ventaNRCodes = VENTA_NR_FALLBACK;
    console.log(`   Catálogo vacío — usando fallback (${ventaNRCodes.size})`);
  }

  // 3. Matrices (demand + dispatch_desp)
  console.log('3. balance/matrices p50...');
  const mat = await apiGet(`/balance/matrices?year=${YEAR}&month=${MONTH}&version_name=${PERCENTILE}`);
  if (mat.status !== 200) { console.error('   ❌ Error matrices:', mat.status, JSON.stringify(mat.data).substring(0,200)); process.exit(1); }

  // Demand totals
  const demMap = {};
  (mat.data.demand || []).forEach(r => { demMap[r.code] = (demMap[r.code] || 0) + r.value; });
  const api_dmre = demMap['DMRE'] || 0;
  const api_dmnr = demMap['DMNR'] || 0;
  console.log(`   DMRE=${(api_dmre/1e6).toFixed(3)} GWh  DMNR=${(api_dmnr/1e6).toFixed(3)} GWh`);

  // Contracts from dispatch_desp
  const dd = mat.data.dispatch_desp || [];
  const normalizeType = (t) => {
    if (!t) return '';
    if (t === 'R' || t.toUpperCase() === 'REGULADO') return 'REGULADO';
    if (t === 'N' || t.toUpperCase().includes('NO REG')) return 'NO REGULADO';
    return t;
  };
  const api_cttosMR  = dd.filter(r => normalizeType(r.market_type) === 'REGULADO').reduce((s,r) => s+r.value, 0);
  const api_cttosMNR = dd.filter(r => normalizeType(r.market_type) === 'NO REGULADO' && !ventaNRCodes.has(r.contract)).reduce((s,r) => s+r.value, 0);
  const api_ventaNR  = dd.filter(r => ventaNRCodes.has(r.contract)).reduce((s,r) => s+r.value, 0);
  console.log(`   dispatch_desp: MR=${(api_cttosMR/1e6).toFixed(3)} GWh  MNR(compra)=${(api_cttosMNR/1e6).toFixed(3)} GWh  VentaNR=${(api_ventaNR/1e6).toFixed(3)} GWh`);

  // bolsa_trsd net
  const trsdData = mat.data.bolsa_trsd || [];
  let trsdNet = trsdData.reduce((s, r) => s + r.value, 0);
  console.log(`   bolsa_trsd net=${Math.round(trsdNet).toLocaleString()} kWh (${trsdNet >= 0 ? 'venta neta' : 'compra neta'})`);

  // 4. Reconciliation
  console.log('4. balance/reconciliation p50...');
  const rec = await apiGet(`/balance/reconciliation?year=${YEAR}&month=${MONTH}&version_name=${PERCENTILE}`);
  if (rec.status !== 200) { console.error('   ❌ Error reconciliation:', rec.status); process.exit(1); }
  const calc = rec.data.calculated || {};
  const api_cBolsaMR  = calc.buy_regulated_mwh    || 0;  // kWh (despite _mwh suffix)
  const api_cBolsaMNR = calc.buy_non_regulated_mwh || 0;
  const api_vBolsaMR  = calc.sell_regulated_mwh   || 0;
  const api_vBolsaMNR = calc.sell_non_regulated_mwh|| 0;
  const api_cBolsa    = api_cBolsaMR + api_cBolsaMNR;
  const api_vBolsa    = api_vBolsaMR + api_vBolsaMNR;
  console.log(`   Compra bolsa: MR=${(api_cBolsaMR/1e3).toFixed(1)} MWh  NR=${(api_cBolsaMNR/1e3).toFixed(1)} MWh  Total=${(api_cBolsa/1e3).toFixed(1)} MWh`);
  console.log(`   Venta bolsa:  MR=${(api_vBolsaMR/1e3).toFixed(1)} MWh  NR=${(api_vBolsaMNR/1e3).toFixed(1)} MWh  Total=${(api_vBolsa/1e3).toFixed(1)} MWh`);

  // 5. Google Sheet reference
  console.log('5. Google Sheet (balance summary)...');
  let sh;
  try {
    sh = await readSheetSummary();
    console.log(`   DMRE sheet=${sh.dmre?.toLocaleString() || 'N/A'} kWh  DMNR sheet=${sh.dmnr?.toLocaleString() || 'N/A'} kWh`);
    console.log(`   Contratos MR=${sh.contratos_mr?.toLocaleString() || 'N/A'} kWh  NR(compra)=${sh.contratos_mnr?.toLocaleString() || 'N/A'} kWh`);
    console.log(`   Compra bolsa MR=${sh.compra_bolsa_mr?.toLocaleString() || 'N/A'}  NR=${sh.compra_bolsa_mnr?.toLocaleString() || 'N/A'}`);
    console.log(`   Venta bolsa MR=${sh.venta_bolsa_mr?.toLocaleString() || 'N/A'}  NR=${sh.venta_bolsa_mnr?.toLocaleString() || 'N/A'}`);
  } catch (e) {
    console.error('   ❌ Error leyendo sheet:', e.message);
    sh = { dmre: null, dmnr: null, contratos_mr: null, contratos_mnr: null,
           compra_bolsa_mr: null, compra_bolsa_mnr: null,
           venta_bolsa_mr: null, venta_bolsa_mnr: null,
           contracts_mr: [], contracts_mnr: [], contracts_venta_nr: [] };
  }

  // ── Build comparisons ─────────────────────────────────────────────────────────
  const comparisons = {
    demanda_regulada:    cmp('Demanda Regulada (DMRE)',   sh.dmre,           api_dmre,      'demand → DMRE matrices vs sheet'),
    demanda_nr:          cmp('Demanda No Regulada (DMNR)',sh.dmnr,           api_dmnr,      'demand → DMNR matrices vs sheet'),
    contratos_mr:        cmp('Contratos compra MR',       sh.contratos_mr,   api_cttosMR,   'dispatch_desp REGULADO vs sheet'),
    contratos_mnr:       cmp('Contratos compra MNR',      sh.contratos_mnr,  api_cttosMNR,  'dispatch_desp NO_REG (excl venta) vs sheet'),
    contratos_venta_nr:  cmp('Contratos venta NR',        sh.contracts_venta_nr.reduce((s,c)=>s+c.kwh,0)||null,
                                                            api_ventaNR,      'venta NR contratos'),
    compra_bolsa_mr:     cmp('Compra Bolsa MR',           sh.compra_bolsa_mr,  api_cBolsaMR,  '⚠ metodologías distintas (proj vs calc)'),
    compra_bolsa_mnr:    cmp('Compra Bolsa NR',           sh.compra_bolsa_mnr, api_cBolsaMNR, '⚠ metodologías distintas'),
    venta_bolsa_mr:      cmp('Venta Bolsa MR',            sh.venta_bolsa_mr,   api_vBolsaMR,  '⚠ metodologías distintas'),
    venta_bolsa_mnr:     cmp('Venta Bolsa NR',            sh.venta_bolsa_mnr,  api_vBolsaMNR, '⚠ metodologías distintas'),
  };

  // ── Console report ────────────────────────────────────────────────────────────
  const SEP = '═'.repeat(90);
  const sep = '─'.repeat(90);
  console.log('\n' + SEP);
  console.log(`  COMPARACIÓN  │  ${KEY}  │  ${tabName}  │  API ${PERCENTILE.toUpperCase()}`);
  console.log(SEP);
  console.log(`${'Variable'.padEnd(30)} ${'Sheet (kWh)'.padStart(14)} ${'API (kWh)'.padStart(14)} ${'Δ%'.padStart(8)}  Est  Nota`);
  console.log(sep);

  function fmtN(n) { if (n==null) return 'N/A'; return Math.round(n).toLocaleString('es-CO'); }
  function icon(p, note) {
    if (note && note.includes('⚠')) return 'ℹ️ ';
    if (p == null) return '❓ ';
    const a = Math.abs(p);
    return a <= 1 ? '✅' : a <= 5 ? '⚠️' : '❌';
  }

  Object.values(comparisons).forEach(c => {
    const ps = c.pct != null ? (c.pct >= 0 ? '+' : '') + c.pct.toFixed(2) + '%' : 'N/A';
    const ico = icon(c.pct, c.note);
    console.log(`${c.label.padEnd(30)} ${fmtN(c.sheet_kwh).padStart(14)} ${fmtN(c.api_kwh).padStart(14)} ${ps.padStart(8)}  ${ico}  ${c.note || ''}`);
  });
  console.log(sep);

  // ── Per-contract comparison ───────────────────────────────────────────────────
  console.log('\n── Contratos MR (sheet vs API dispatch_desp) ──────────────────────────────────');
  const apiMRByCtto = {};
  dd.filter(r => normalizeType(r.market_type) === 'REGULADO').forEach(r => {
    apiMRByCtto[r.contract] = (apiMRByCtto[r.contract] || 0) + r.value;
  });
  const shMR = sh.contracts_mr;
  shMR.forEach(sc => {
    // Find API contract that might match by name
    console.log(`  Sheet: ${sc.name.padEnd(20)} ${fmtN(sc.kwh).padStart(12)} kWh`);
  });
  console.log(`  API totales MR:`);
  Object.entries(apiMRByCtto).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => {
    if (v > 0) console.log(`    sic=${c.padEnd(8)} ${fmtN(v).padStart(12)} kWh`);
  });

  console.log('\n── Contratos MNR compra (sheet vs API dispatch_desp) ──────────────────────────');
  const apiNRByCtto = {};
  dd.filter(r => normalizeType(r.market_type) === 'NO REGULADO' && !ventaNRCodes.has(r.contract))
    .forEach(r => { apiNRByCtto[r.contract] = (apiNRByCtto[r.contract] || 0) + r.value; });
  sh.contracts_mnr.forEach(sc => {
    console.log(`  Sheet: ${sc.name.padEnd(24)} ${fmtN(sc.kwh).padStart(12)} kWh`);
  });
  console.log(`  API totales NR compra:`);
  Object.entries(apiNRByCtto).sort((a,b)=>b[1]-a[1]).forEach(([c,v]) => {
    if (v > 0) console.log(`    sic=${c.padEnd(8)} ${fmtN(v).padStart(12)} kWh`);
  });

  // ── Save result ───────────────────────────────────────────────────────────────
  const outDir = path.join(__dirname, 'qa-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  const now  = new Date();
  const ts   = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fileName = `${KEY}_${ts}_p50.json`;
  const outFile  = path.join(outDir, fileName);

  // Build API contracts list
  const byCtto = {};
  dd.forEach(r => {
    if (!byCtto[r.contract]) byCtto[r.contract] = { number: r.contract, market_type: normalizeType(r.market_type), kWh: 0 };
    byCtto[r.contract].kWh += r.value;
  });

  const result = {
    generatedAt: now.toISOString(),
    period: KEY,
    year: YEAR, month: MONTH,
    percentile: PERCENTILE,
    available_status: ctx.data.available_status,
    projected_days: projDays,
    comparisons,
    sheetContracts: {
      mr:      sh.contracts_mr,
      mnr:     sh.contracts_mnr,
      venta_nr: sh.contracts_venta_nr,
    },
    apiContracts: Object.values(byCtto).filter(c => c.kWh > 0),
    sheetTotals: {
      dmre: sh.dmre, dmnr: sh.dmnr,
      contratos_mr: sh.contratos_mr, contratos_mnr: sh.contratos_mnr,
      compra_bolsa_mr: sh.compra_bolsa_mr, compra_bolsa_mnr: sh.compra_bolsa_mnr,
      venta_bolsa_mr: sh.venta_bolsa_mr, venta_bolsa_mnr: sh.venta_bolsa_mnr,
    },
    apiTotals: {
      dmre_kwh: api_dmre, dmnr_kwh: api_dmnr,
      contratos_mr_kwh: api_cttosMR, contratos_mnr_kwh: api_cttosMNR,
      contratos_venta_nr_kwh: api_ventaNR,
      compra_bolsa_mr_kwh: api_cBolsaMR, compra_bolsa_mnr_kwh: api_cBolsaMNR,
      venta_bolsa_mr_kwh: api_vBolsaMR, venta_bolsa_mnr_kwh: api_vBolsaMNR,
      bolsa_trsd_net_kwh: trsdNet,
    },
  };

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`\n✅ Resultado guardado: ${outFile}`);

  // ── Update index ───────────────────────────────────────────────────────────────
  const idxFile = path.join(outDir, 'index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : { runs: [] };

  const worstPct = Math.max(...Object.values(comparisons)
    .filter(c => c.pct != null && !c.note?.includes('⚠'))
    .map(c => Math.abs(c.pct)));
  const status = worstPct <= 1 ? 'ok' : worstPct <= 5 ? 'warn' : 'err';

  idx.runs.push({
    key: KEY, file: fileName,
    timestamp: now.toISOString(),
    period: KEY,
    percentile: PERCENTILE,
    status,
  });
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  console.log(`   Status: ${status}  (máx Δ% sin bolsa: ${worstPct.toFixed(2)}%)`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
