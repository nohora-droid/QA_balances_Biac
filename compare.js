/**
 * compare.js  —  QA Balance Energético Enero 2026 / TxF
 *
 * Mapeo Sheet ↔ API:
 *  Demanda Regulada   → matrices DMRE / cross.demand_regulated_mwh
 *  Demanda NR         → matrices DMNR (⚠ concepto diferente al sheet: ver notas)
 *  Contratos Compra   → contracts/monthly, year=2026 month=1 day_type=TO op=Compra
 *  Compra Bolsa       → reconciliation.official_balcttos compras (reg + NR)
 *  Venta Bolsa        → reconciliation.official_balcttos ventas (reg + NR)
 */

const fs = require('fs');

const sheet        = JSON.parse(fs.readFileSync('data-enero-balance.json',    'utf8'));
const matrices     = JSON.parse(fs.readFileSync('api-matrices.json',          'utf8'));
const reconcil     = JSON.parse(fs.readFileSync('api-reconciliation.json',    'utf8'));
const contractsRaw = JSON.parse(fs.readFileSync('api-contracts-monthly.json', 'utf8'));
const cross        = JSON.parse(fs.readFileSync('api-cross.json',             'utf8'));

// ── helpers ──────────────────────────────────────────────────────────────────
function pct(sheet, api) {
  if (!sheet || !api) return null;
  return ((api - sheet) / sheet) * 100;
}
function fmtN(n, dec = 0) {
  if (n == null) return 'N/A';
  return n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function statusIcon(p) {
  if (p == null) return '❓';
  const a = Math.abs(p);
  if (a <= 1)  return '✅';
  if (a <= 5)  return '⚠️ ';
  return '❌';
}

// ── 1. Demanda (matrices / cross) ─────────────────────────────────────────────
const demTotals = {};
(matrices.demand || []).forEach(r => { demTotals[r.code] = (demTotals[r.code] || 0) + r.value; });
const api_dmre = demTotals['DMRE'] || 0;
const api_dmnr = demTotals['DMNR'] || 0;

// cross monthly sums (confirmación)
const crossTotals = {};
(cross.hourly || []).forEach(row => {
  ['demand_regulated_mwh','demand_non_regulated_mwh',
   'calc_buy_regulated_mwh','calc_sell_regulated_mwh',
   'calc_buy_non_regulated_mwh','calc_sell_non_regulated_mwh'].forEach(f => {
    crossTotals[f] = (crossTotals[f] || 0) + (row[f] || 0);
  });
});

// ── 2. Bolsa (reconciliation official_balcttos) ───────────────────────────────
const ob               = reconcil.official_balcttos;
const api_cBolsaReg    = ob.compras_regulado_mwh;
const api_cBolsaNR     = ob.compras_no_regulado_mwh;
const api_compraBolsa  = api_cBolsaReg + api_cBolsaNR;
const api_vBolsaReg    = ob.ventas_regulado_mwh;
const api_vBolsaNR     = ob.ventas_no_regulado_mwh;
const api_ventaBolsa   = api_vBolsaReg + api_vBolsaNR;

// ── 3. Contratos (monthly, Ene 2026, TO, Compra) ──────────────────────────────
const items     = Array.isArray(contractsRaw) ? contractsRaw : contractsRaw.items || [];
const janTO     = items.filter(r => r.year === 2026 && r.month === 1 && r.day_type === 'TO');
const janCompras = janTO.filter(r => r.operation === 'Compra');
const janVentas  = janTO.filter(r => r.operation === 'Venta');
const api_cttos  = janCompras.reduce((s, r) => s + (r.total_quantity || 0), 0);
const api_cttoVentas = Math.abs(janVentas.reduce((s, r) => s + (r.total_quantity || 0), 0));

// ── Sheet references ──────────────────────────────────────────────────────────
const sh = {
  dmreTxF:       sheet.demandaRegulada.kwhMesTxF,
  dmrePlan:      sheet.demandaRegulada.kwhMes,
  dmnrTxF:       sheet.demandaNoRegulada.kwhMesTxF,
  dmnrPlan:      sheet.demandaNoRegulada.kwhMes,
  cttos:         sheet.totalContratosSinBolsa.kwhMes,
  cBolsa:        sheet.compraBolsa.total.kwhMes,
  cBolsaReg:     sheet.compraBolsa.regulado.kwhMes,
  cBolsaNR:      sheet.compraBolsa.noRegulado.kwhMes,
  vBolsa:        sheet.ventaBolsa.total.kwhMes,
  vBolsaReg:     sheet.ventaBolsa.regulado.kwhMes,
  vBolsaNR:      sheet.ventaBolsa.noRegulado.kwhMes,
};

// ── REPORT ────────────────────────────────────────────────────────────────────
const SEP = '═'.repeat(90);
const sep = '─'.repeat(90);

console.log('\n' + SEP);
console.log('  QA BALANCE ENERGÉTICO  │  Enero 2026  │  Versión TxF');
console.log(SEP);
console.log(`${'Variable'.padEnd(30)} ${'Sheet (kWh)'.padStart(16)} ${'API (kWh)'.padStart(16)} ${'Δ%'.padStart(8)}  Est  Nota`);
console.log(sep);

function row(label, shVal, apiVal, note = '') {
  const p = pct(shVal, apiVal);
  const ps = p != null ? fmtN(p, 2) + '%' : 'N/A';
  console.log(`${label.padEnd(30)} ${fmtN(shVal).padStart(16)} ${fmtN(apiVal).padStart(16)} ${ps.padStart(8)}  ${statusIcon(p)}  ${note}`);
}

// Demanda
console.log('── DEMANDA ──────────────────────────────────────────────────────────────');
row('Demanda Regulada (TxF)',  sh.dmreTxF,  api_dmre,  'Sheet=col G TxF, API=DMRE matrices');
row('Demanda Regulada (Plan)', sh.dmrePlan, api_dmre,  'Sheet=col D Plan, API=DMRE matrices');
row('Demanda NR (TxF)',        sh.dmnrTxF,  api_dmnr,  '⚠ Conceptos distintos — ver notas');
row('Demanda NR (Plan)',       sh.dmnrPlan, api_dmnr,  '⚠ Conceptos distintos — ver notas');

// Contratos
console.log('── CONTRATOS ────────────────────────────────────────────────────────────');
row('Contratos Compra',        sh.cttos, api_cttos, 'Sheet=NR+Mayoristas, API=monthly TO');

// Bolsa compra
console.log('── COMPRA BOLSA (official_balcttos) ─────────────────────────────────────');
row('Compra Bolsa TOTAL',      sh.cBolsa,    api_compraBolsa, '');
row('  Compra Bolsa Regulado', sh.cBolsaReg, api_cBolsaReg,   '');
row('  Compra Bolsa NR',       sh.cBolsaNR,  api_cBolsaNR,    '');

// Bolsa venta
console.log('── VENTA BOLSA (official_balcttos) ──────────────────────────────────────');
row('Venta Bolsa TOTAL',       sh.vBolsa,    api_ventaBolsa, '');
row('  Venta Bolsa Regulado',  sh.vBolsaReg, api_vBolsaReg,   '');
row('  Venta Bolsa NR',        sh.vBolsaNR,  api_vBolsaNR,    '');

console.log(sep);

// Extra: cross calculated bolsa vs reconciliation
console.log('\n── BOLSA CALCULADA (balance/cross) vs OFFICIAL ──────────────────────────');
console.log(`  calc_buy_reg_mwh:        ${fmtN(crossTotals.calc_buy_regulated_mwh).padStart(14)} kWh   (official_reg: ${fmtN(api_cBolsaReg)})`);
console.log(`  calc_buy_NR_mwh:         ${fmtN(crossTotals.calc_buy_non_regulated_mwh).padStart(14)} kWh   (official_NR:  ${fmtN(api_cBolsaNR)})`);
console.log(`  calc_sell_reg_mwh:       ${fmtN(crossTotals.calc_sell_regulated_mwh).padStart(14)} kWh   (official_reg: ${fmtN(api_vBolsaReg)})`);
console.log(`  calc_sell_NR_mwh:        ${fmtN(crossTotals.calc_sell_non_regulated_mwh).padStart(14)} kWh   (official_NR:  ${fmtN(api_vBolsaNR)})`);

// Contratos detail
console.log('\n── DETALLE CONTRATOS API (Enero 2026 TO / Compra) ───────────────────────');
janCompras.filter(r => r.total_quantity !== 0)
  .sort((a, b) => b.total_quantity - a.total_quantity)
  .forEach(r => console.log(`  ${r.contract_number.padEnd(28)} ${r.provider.padEnd(6)} ${fmtN(r.total_quantity).padStart(14)} kWh`));

console.log('\n── DETALLE CONTRATOS SHEET ──────────────────────────────────────────────');
sheet.contratos
  .filter(c => c.cantidadKwh > 0)
  .sort((a, b) => b.cantidadKwh - a.cantidadKwh)
  .forEach(c => console.log(`  ${c.contraparte.padEnd(28)} ${c.mercado.padEnd(14)} ${fmtN(c.cantidadKwh).padStart(14)} kWh`));

// Notes
console.log('\n── NOTAS ────────────────────────────────────────────────────────────────');
console.log('1. Demanda NR: Sheet incluye TOTAL entregado a clientes NR (contratos+bolsa=~141 GWh).');
console.log('   API DMNR solo cubre la demanda PTB (posición neta en bolsa = 22 GWh).');
console.log('   → Conceptos NO comparables directamente. Requiere alineación de definiciones.');
console.log('2. Compra Bolsa NR: Sheet=125 GWh (total spot NR), API official_balcttos NR=930 MWh.');
console.log('   La diferencia sugiere que official_balcttos es un subconjunto del total de bolsa.');
console.log('   → Verificar si el app usa otra fuente para mostrar bolsa (p.ej. bolsa_trsd o ASIC).');
console.log('3. Contratos Compra: Diferencia +1.7% (~436k kWh). Revisar si el sheet incluye');
console.log('   contratos regulados que no aparecen en la API (falta sección Regulado del sheet).');
console.log('4. Demanda Regulada TxF vs DMRE: -1.4% (310k kWh). Diferencia aceptable para TxF.');

// Save
const report = {
  generatedAt: new Date().toISOString(),
  period: 'Enero 2026', version: 'TxF',
  results: {
    demanda_regulada_txf:    { sheet: sh.dmreTxF,  api: api_dmre,       pct: pct(sh.dmreTxF, api_dmre) },
    demanda_nr_txf:          { sheet: sh.dmnrTxF,  api: api_dmnr,       pct: pct(sh.dmnrTxF, api_dmnr), warning: 'conceptos diferentes' },
    contratos_compra:        { sheet: sh.cttos,    api: api_cttos,      pct: pct(sh.cttos, api_cttos) },
    compra_bolsa_total:      { sheet: sh.cBolsa,   api: api_compraBolsa, pct: pct(sh.cBolsa, api_compraBolsa) },
    venta_bolsa_total:       { sheet: sh.vBolsa,   api: api_ventaBolsa,  pct: pct(sh.vBolsa, api_ventaBolsa) },
  },
  api_contracts: janCompras.map(r => ({ number: r.contract_number, provider: r.provider, kWh: r.total_quantity })),
  sheet_contracts: sheet.contratos,
};
fs.writeFileSync('qa-report.json', JSON.stringify(report, null, 2));
console.log('\n✅ Reporte guardado en qa-report.json');
