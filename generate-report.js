/**
 * generate-report.js
 * Genera un HTML auto-contenido con todos los resultados QA disponibles.
 * Usage: node generate-report.js
 * Output: reporte-qa-2026.html  (abrir directo en cualquier navegador)
 */
const fs   = require('fs');
const path = require('path');

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Load all available results
const resultsDir = path.join(__dirname, 'qa-results');
const allResults = {};
for (let m = 1; m <= 12; m++) {
  const mm  = String(m).padStart(2, '0');
  const f   = path.join(resultsDir, `2026-${mm}.json`);
  if (fs.existsSync(f)) {
    try { allResults[`2026-${mm}`] = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch(e) { console.warn('Error reading', f, e.message); }
  }
}

const count = Object.keys(allResults).length;
if (!count) { console.error('No hay resultados en qa-results/. Ejecuta run-qa.js primero.'); process.exit(1); }
console.log(`Procesando ${count} mes(es): ${Object.keys(allResults).join(', ')}`);

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtN(n, dec = 0) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtPct(p) {
  if (p == null || isNaN(p)) return 'N/A';
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}
function statusOf(p) {
  if (p == null) return 'na';
  const a = Math.abs(p);
  return a <= 1 ? 'ok' : a <= 5 ? 'warn' : 'err';
}
function icon(p) {
  const s = statusOf(p);
  return s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : s === 'err' ? '❌' : '—';
}
function overallStatus(res) {
  if (!res) return 'pending';
  const pcts = Object.values(res.comparisons || {}).map(c => c.pct).filter(p => p != null);
  if (!pcts.length) return 'pending';
  if (pcts.some(p => Math.abs(p) > 5)) return 'err';
  if (pcts.some(p => Math.abs(p) > 1)) return 'warn';
  return 'ok';
}

// ── Generate month section HTML ────────────────────────────────────────────────
function monthSection(key, res) {
  const m = parseInt(key.split('-')[1]);
  const name = MONTHS[m - 1];
  const st   = overallStatus(res);
  const stIcon = st === 'ok' ? '✅' : st === 'warn' ? '⚠️' : st === 'err' ? '❌' : '—';
  const cmp  = res.comparisons || {};

  const counts = { ok: 0, warn: 0, err: 0 };
  Object.values(cmp).forEach(c => {
    if (c.pct == null) return;
    const a = Math.abs(c.pct);
    if (a <= 1) counts.ok++; else if (a <= 5) counts.warn++; else counts.err++;
  });

  function row(label, c, note = '') {
    const cls = `st-${statusOf(c?.pct)}`;
    return `<tr>
      <td>${label}${note ? `<small class="note"> ${note}</small>` : ''}</td>
      <td class="num">${fmtN(c?.sheet_kwh)}</td>
      <td class="num">${fmtN(c?.api_kwh)}</td>
      <td class="pct ${cls}">${icon(c?.pct)} ${fmtPct(c?.pct)}</td>
    </tr>`;
  }

  const contractsSheet = (res.sheetContracts || [])
    .filter(c => c.cantidadKwh > 0)
    .sort((a,b) => b.cantidadKwh - a.cantidadKwh)
    .map(c => `<tr><td>${c.contraparte}</td><td class="mkt">${c.mercado}</td><td class="num">${fmtN(c.cantidadKwh)}</td></tr>`)
    .join('');

  const contractsApi = (res.apiContracts || [])
    .filter(c => (c.kWh||0) > 0)
    .sort((a,b) => b.kWh - a.kWh)
    .map(c => `<tr><td>${c.number||'—'}</td><td class="mkt">${c.provider||''}</td><td class="num">${fmtN(c.kWh)}</td></tr>`)
    .join('');

  return `
<section class="month-section" id="month-${key}">
  <div class="month-header st-bg-${st}">
    <div>
      <span class="month-title">${stIcon} ${name} 2026</span>
      <span class="month-meta">Versión ${res.apiVersion || 'TxF'} · ${(res.generatedAt||'').substring(0,10)}</span>
    </div>
    <div class="badge-row">
      <span class="badge ok">${counts.ok} ✅</span>
      <span class="badge warn">${counts.warn} ⚠️</span>
      <span class="badge err">${counts.err} ❌</span>
    </div>
  </div>

  <!-- Demanda -->
  <div class="table-block">
    <div class="table-title">DEMANDA</div>
    <table>
      <thead><tr><th>Variable</th><th>Sheet (kWh)</th><th>API (kWh)</th><th>Δ%</th></tr></thead>
      <tbody>
        ${row('Demanda Regulada (TxF)', cmp.demanda_regulada_txf, 'Col G vs DMRE')}
        ${row('Demanda Regulada (Plan)', cmp.demanda_regulada_plan)}
        ${row('Demanda NR (TxF)', cmp.demanda_nr_txf, '⚠ Conceptos distintos')}
        ${row('Demanda NR (Plan)', cmp.demanda_nr_plan, '⚠ Conceptos distintos')}
      </tbody>
    </table>
  </div>

  <!-- Contratos -->
  <div class="table-block">
    <div class="table-title">CONTRATOS COMPRA</div>
    <table>
      <thead><tr><th>Variable</th><th>Sheet (kWh)</th><th>API (kWh)</th><th>Δ%</th></tr></thead>
      <tbody>
        ${row('Total contratos (sin bolsa)', cmp.contratos_total, 'API usa day_type inteligente')}
      </tbody>
    </table>
  </div>

  <!-- Bolsa -->
  <div class="two-col">
    <div class="table-block">
      <div class="table-title">COMPRA BOLSA (official_balcttos)</div>
      <table>
        <thead><tr><th>Variable</th><th>Sheet (kWh)</th><th>API (kWh)</th><th>Δ%</th></tr></thead>
        <tbody>
          ${row('TOTAL', cmp.compra_bolsa_total)}
          ${row('Regulado', cmp.compra_bolsa_reg)}
          ${row('No Regulado', cmp.compra_bolsa_nr)}
        </tbody>
      </table>
    </div>
    <div class="table-block">
      <div class="table-title">VENTA BOLSA (official_balcttos)</div>
      <table>
        <thead><tr><th>Variable</th><th>Sheet (kWh)</th><th>API (kWh)</th><th>Δ%</th></tr></thead>
        <tbody>
          ${row('TOTAL', cmp.venta_bolsa_total)}
          ${row('Regulado', cmp.venta_bolsa_reg)}
          ${row('No Regulado', cmp.venta_bolsa_nr)}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Contratos detalle -->
  <div class="two-col">
    <div class="table-block">
      <div class="table-title">CONTRATOS — SHEET</div>
      <table><thead><tr><th>Nombre</th><th>Mercado</th><th>kWh</th></tr></thead>
      <tbody>${contractsSheet}</tbody></table>
    </div>
    <div class="table-block">
      <div class="table-title">CONTRATOS — API</div>
      <table><thead><tr><th>Contrato</th><th>Prov.</th><th>kWh</th></tr></thead>
      <tbody>${contractsApi}</tbody></table>
    </div>
  </div>

  <!-- Totales -->
  <div class="totals-row">
    <div class="total-card">
      <div class="tc-label">TOTAL COMPRA — Sheet</div>
      <div class="tc-val">${fmtN(res.sheetTotals?.totalCompra)} kWh</div>
    </div>
    <div class="total-card">
      <div class="tc-label">TOTAL VENTA — Sheet</div>
      <div class="tc-val">${fmtN(res.sheetTotals?.totalVenta)} kWh</div>
    </div>
    <div class="total-card">
      <div class="tc-label">DMRE API</div>
      <div class="tc-val">${fmtN(res.apiTotals?.dmre_kwh)} kWh</div>
    </div>
    <div class="total-card">
      <div class="tc-label">Contratos API</div>
      <div class="tc-val">${fmtN(res.apiTotals?.contratos_kwh)} kWh</div>
    </div>
  </div>
</section>`;
}

// ── Summary table ──────────────────────────────────────────────────────────────
function summaryTable() {
  const rows = Object.entries(allResults).map(([key, res]) => {
    const m  = parseInt(key.split('-')[1]);
    const st = overallStatus(res);
    const c  = res.comparisons || {};
    return `<tr>
      <td><a href="#month-${key}">${MONTHS[m-1]}</a></td>
      <td class="pct st-${statusOf(c.demanda_regulada_txf?.pct)}">${fmtPct(c.demanda_regulada_txf?.pct)}</td>
      <td class="pct st-${statusOf(c.demanda_nr_txf?.pct)}">${fmtPct(c.demanda_nr_txf?.pct)}</td>
      <td class="pct st-${statusOf(c.contratos_total?.pct)}">${fmtPct(c.contratos_total?.pct)}</td>
      <td class="pct st-${statusOf(c.compra_bolsa_total?.pct)}">${fmtPct(c.compra_bolsa_total?.pct)}</td>
      <td class="pct st-${statusOf(c.venta_bolsa_total?.pct)}">${fmtPct(c.venta_bolsa_total?.pct)}</td>
      <td class="pct st-${st}">${st==='ok'?'✅':st==='warn'?'⚠️':st==='err'?'❌':'—'}</td>
    </tr>`;
  }).join('');

  const pendingRows = [];
  for (let m = 1; m <= 12; m++) {
    const key = `2026-${String(m).padStart(2,'0')}`;
    if (!allResults[key]) pendingRows.push(`<tr><td>${MONTHS[m-1]}</td><td colspan="6" style="color:#a0aec0">Pendiente</td></tr>`);
  }

  return `
  <div class="table-block">
    <div class="table-title">RESUMEN ANUAL 2026</div>
    <table>
      <thead><tr><th>Mes</th><th>Dem.Reg TxF</th><th>Dem.NR TxF</th><th>Contratos</th><th>Compra Bolsa</th><th>Venta Bolsa</th><th>Estado</th></tr></thead>
      <tbody>${rows}${pendingRows.join('')}</tbody>
    </table>
  </div>`;
}

// ── Full HTML ──────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA Balance Energético 2026 — BIA</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#f0f4f8;color:#1a202c;font-size:13px}
  .header{background:linear-gradient(135deg,#1a365d,#2b6cb0);color:#fff;padding:18px 32px;display:flex;align-items:center;gap:14px}
  .header h1{font-size:1.3rem;font-weight:700}
  .header p{font-size:0.8rem;opacity:0.85;margin-top:2px}
  .content{max-width:1200px;margin:24px auto;padding:0 20px}
  .month-section{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:32px;overflow:hidden}
  .month-header{padding:14px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
  .st-bg-ok{background:#f0fff4;border-left:6px solid #48bb78}
  .st-bg-warn{background:#fffff0;border-left:6px solid #ecc94b}
  .st-bg-err{background:#fff5f5;border-left:6px solid #fc8181}
  .st-bg-pending{background:#f7fafc;border-left:6px solid #cbd5e0}
  .month-title{font-size:1.1rem;font-weight:700;margin-right:12px}
  .month-meta{font-size:0.75rem;color:#718096}
  .badge-row{display:flex;gap:8px}
  .badge{padding:3px 10px;border-radius:99px;font-size:0.75rem;font-weight:600}
  .badge.ok{background:#c6f6d5;color:#22543d}
  .badge.warn{background:#fefcbf;color:#744210}
  .badge.err{background:#fed7d7;color:#742a2a}
  .table-block{padding:0 20px 16px}
  .table-title{font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#718096;padding:12px 0 6px}
  table{width:100%;border-collapse:collapse;font-size:0.8rem}
  th{background:#edf2f7;padding:7px 10px;text-align:right;font-weight:600;color:#4a5568;font-size:0.72rem;white-space:nowrap}
  th:first-child{text-align:left}
  td{padding:7px 10px;border-bottom:1px solid #f7fafc;text-align:right}
  td:first-child{text-align:left;font-weight:500}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#f7fafc}
  .num{font-variant-numeric:tabular-nums}
  .pct{font-weight:700}
  .st-ok{color:#276749}.st-warn{color:#975a16}.st-err{color:#c53030}.st-na{color:#a0aec0}
  .note{color:#a0aec0;font-weight:400;font-size:0.72rem}
  .mkt{color:#718096;font-size:0.72rem}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:0 20px;padding:0 20px}
  @media(max-width:700px){.two-col{grid-template-columns:1fr}}
  .totals-row{display:flex;gap:12px;flex-wrap:wrap;padding:12px 20px 20px}
  .total-card{flex:1;min-width:140px;background:#f7fafc;border-radius:8px;padding:10px 14px}
  .tc-label{font-size:0.68rem;text-transform:uppercase;letter-spacing:.05em;color:#718096;margin-bottom:4px}
  .tc-val{font-size:0.95rem;font-weight:700}
  .notas{background:#fffbeb;border:1px solid #fbd38d;border-radius:8px;padding:14px 18px;margin:0 20px 20px;font-size:0.78rem;color:#744210}
  .notas strong{display:block;margin-bottom:6px}
  a{color:#2b6cb0;text-decoration:none}a:hover{text-decoration:underline}
  @media print{.header,.toc{background:white!important;color:black!important}body{background:white}}
</style>
</head>
<body>
<div class="header">
  <div style="font-size:2rem">⚡</div>
  <div>
    <h1>QA Balance Energético 2026 — BIA</h1>
    <p>Validación Sheet (TxF) vs API Olibia Energy · Generado: ${new Date().toISOString().replace('T',' ').substring(0,19)}</p>
  </div>
</div>

<div class="content">
  <!-- Summary -->
  ${summaryTable()}

  <!-- Per-month sections -->
  ${Object.entries(allResults).map(([key,res]) => monthSection(key,res)).join('\n')}

  <!-- Notes -->
  <div class="notas">
    <strong>⚠️ Notas metodológicas</strong>
    <p><strong>Demanda NR:</strong> Sheet = entrega total clientes NR (contratos+bolsa ≈ 22 GWh TxF). API DMNR = demanda PTB (posición neta bolsa). Conceptos distintos, diferencia esperada.</p>
    <p><strong>Bolsa (official_balcttos):</strong> Coincide exactamente con "BALANCE TRANSACCIONES DE BOLSA — Propio" del sheet. No es el total spot del mercado.</p>
    <p><strong>Contratos API:</strong> Algunos contratos del sheet no aparecen en <code>contracts/monthly</code> (EPM, Esprod Marco, Isagen, Proenergy, etc. ≈ 10.7 GWh). Verificar si están en otro endpoint o pendientes de carga.</p>
  </div>
</div>
</body>
</html>`;

const outFile = path.join(__dirname, 'reporte-qa-2026.html');
fs.writeFileSync(outFile, html);
console.log(`✅ Reporte generado: reporte-qa-2026.html`);
console.log(`   Abre el archivo directamente en cualquier navegador.`);
