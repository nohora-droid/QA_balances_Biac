const https = require('https');
const fs = require('fs');
const SHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function fetchCSV(sheetName, range) {
  return new Promise((resolve, reject) => {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName) + '&range=' + range;
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseVal(s) {
  if (!s) return 0;
  const clean = s.replace(/"/g, '').replace(/,/g, '').replace(/\s/g, '');
  if (!clean || clean === '-' || clean === '--') return 0;
  const v = parseFloat(clean);
  return isNaN(v) ? 0 : v;
}

function parseCsvRow(line) {
  const r = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { r.push(cur); cur = ''; }
    else cur += c;
  }
  r.push(cur);
  return r;
}

async function fetchSheetDays(sheetName, startRow, endRow) {
  const raw = await fetchCSV(sheetName, 'A' + startRow + ':AC' + endRow);
  const days = [];
  for (const line of raw.split('\n')) {
    const cells = parseCsvRow(line);
    const dc = (cells[2] || '').replace(/"/g, '').trim();
    const m = dc.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) continue;
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push(parseVal(cells[3 + h] || ''));
    const dayTotal = hours.reduce((s, v) => s + v, 0);
    days.push({ day: parseInt(m[2]), total: +dayTotal.toFixed(2), hours });
  }
  return days;
}

function parsePlatformCSV(content) {
  const days = [];
  for (const line of content.split('\n')) {
    const cells = line.split(';');
    const d = parseInt(cells[0]);
    if (isNaN(d)) continue;
    const hours = [];
    for (let h = 1; h <= 24; h++) {
      const v = parseFloat((cells[h] || '').replace(',', '.').trim());
      hours.push(isNaN(v) ? 0 : v);
    }
    const dayTotal = hours.reduce((s, v) => s + v, 0);
    days.push({ day: d, total: +dayTotal.toFixed(2), hours });
  }
  return days;
}

async function main() {
  const BASE = 'C:/Users/User/Documents/Nohora BIA/Automatización/QA Balances';

  // 1. Expand ranges for Feb/Mar/Apr
  const expanded = [
    { name: 'Febrero2026', f: 'matriz_2.csv', sr: 379, er: 425 },
    { name: 'Marzo2026',   f: 'matriz_3.csv', sr: 379, er: 430 },
    { name: 'Abril2026',   f: 'matriz_4.csv', sr: 379, er: 435 },
  ];

  for (const cfg of expanded) {
    const sheetDays = await fetchSheetDays(cfg.name, cfg.sr, cfg.er);
    const platContent = fs.readFileSync(BASE + '/' + cfg.f, 'utf8');
    const platDays = parsePlatformCSV(platContent);
    console.log('\n=== ' + cfg.name + ' ===');
    console.log('Sheet days: ' + sheetDays.length + '  Platform days: ' + platDays.length);

    // Show comparison
    for (const pd of platDays) {
      const sd = sheetDays.find(d => d.day === pd.day);
      if (!sd) { console.log('  Day ' + pd.day + ': MISSING in sheet'); continue; }
      const delta = +(sd.total - pd.total).toFixed(2);
      const icon = Math.abs(delta) < 1 ? 'OK' : '!!';
      console.log('  Day' + String(pd.day).padStart(3) + ': sheet=' + String(sd.total).padStart(14) + '  plat=' + String(pd.total).padStart(14) + '  delta=' + String(delta).padStart(12) + ' ' + icon);
    }
    // Monthly totals
    const sheetMonthly = sheetDays.reduce((s, d) => s + d.total, 0);
    const platMonthly  = platDays.reduce((s, d) => s + d.total, 0);
    console.log('  MONTHLY TOTAL: sheet=' + sheetMonthly.toFixed(2) + '  plat=' + platMonthly.toFixed(2) + '  delta=' + (sheetMonthly - platMonthly).toFixed(2));
  }

  // 2. Show April platform file first few rows to understand scale
  console.log('\n=== Abril platform sample ===');
  const apr = fs.readFileSync(BASE + '/matriz_4.csv', 'utf8');
  const aprLines = apr.split('\n').filter(l => l.trim()).slice(0, 5);
  aprLines.forEach(l => {
    const c = l.split(';');
    console.log('Day ' + c[0] + ' | H1=' + c[1] + ' H2=' + c[2] + ' | Total=' + c[25]);
  });

  // 3. Compare Jan sheet monthly total vs platform
  console.log('\n=== Enero monthly totals ===');
  const enSheet = await fetchSheetDays('Enero2026', 383, 420);
  const en1 = fs.readFileSync(BASE + '/matriz_1.csv', 'utf8');
  const enPlat = parsePlatformCSV(en1);
  console.log('Sheet: ' + enSheet.reduce((s, d) => s + d.total, 0).toFixed(2));
  console.log('Plat:  ' + enPlat.reduce((s, d) => s + d.total, 0).toFixed(2));
}

main().catch(e => console.error(e.message));
