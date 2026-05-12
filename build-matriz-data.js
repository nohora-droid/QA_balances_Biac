/**
 * build-matriz-data.js
 * Reads platform CSVs + fetches sheet data for all 4 months
 * Outputs: matriz-data.json (embedded into dashboard)
 */
const https = require('https');
const fs    = require('fs');
const SHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';
const BASE_DIR  = 'C:/Users/User/Documents/Nohora BIA/Automatización/QA Balances';

function fetchCSV(sheetName, range) {
  return new Promise((resolve, reject) => {
    const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
      '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName) + '&range=' + range;
    const u = new URL(url);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b));
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout ' + sheetName)); });
  });
}

function parseVal(s) {
  if (!s) return 0;
  const c = s.replace(/"/g,'').replace(/,/g,'').replace(/\s/g,'');
  if (!c || c === '-' || c === '--') return 0;
  const v = parseFloat(c);
  return isNaN(v) ? 0 : v;
}

function parseCsvRow(line) {
  const r = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { r.push(cur); cur = ''; }
    else cur += ch;
  }
  r.push(cur);
  return r;
}

async function fetchSheetDays(sheetName, startRow, endRow, targetMonth) {
  const raw = await fetchCSV(sheetName, 'A' + startRow + ':AC' + endRow);
  const days = [];
  for (const line of raw.split('\n')) {
    const cells = parseCsvRow(line);
    const dc = (cells[2] || '').replace(/"/g,'').trim();
    const m  = dc.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) continue;
    const mo = parseInt(m[1]), dy = parseInt(m[2]);
    if (mo !== targetMonth) continue;          // only this month's rows
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push(parseVal(cells[3 + h] || ''));
    days.push({ day: dy, hours });
  }
  return days;
}

function parsePlatform(content) {
  const days = [];
  for (const line of content.split('\n')) {
    const cells = line.split(';');
    const d = parseInt(cells[0]);
    if (isNaN(d)) continue;
    const hours = [];
    for (let h = 1; h <= 24; h++) {
      const v = parseFloat((cells[h] || '').replace(',','.').trim());
      hours.push(isNaN(v) ? 0 : v);
    }
    days.push({ day: d, hours });
  }
  return days;
}

async function main() {
  const months = [
    { label:'Enero 2026',   sheetName:'Enero2026',   file:'matriz_1.csv', targetMonth:1,  sr:383, er:420 },
    { label:'Febrero 2026', sheetName:'Febrero2026', file:'matriz_2.csv', targetMonth:2,  sr:379, er:420 },
    { label:'Marzo 2026',   sheetName:'Marzo2026',   file:'matriz_3.csv', targetMonth:3,  sr:379, er:425 },
    { label:'Abril 2026',   sheetName:'Abril2026',   file:'matriz_4.csv', targetMonth:4,  sr:379, er:430 },
  ];

  const output = {};

  for (const cfg of months) {
    console.log('Building', cfg.label, '...');
    const sheetDays   = await fetchSheetDays(cfg.sheetName, cfg.sr, cfg.er, cfg.targetMonth);
    const platContent = fs.readFileSync(BASE_DIR + '/' + cfg.file, 'utf8');
    const platDays    = parsePlatform(platContent);

    console.log('  Sheet days:', sheetDays.length, '  Platform days:', platDays.length);

    const days = [];
    for (const pd of platDays) {
      const sd = sheetDays.find(d => d.day === pd.day);
      const hours = [];
      for (let h = 0; h < 24; h++) {
        const sv = sd ? (sd.hours[h] || 0) : null;
        const pv = pd.hours[h] || 0;
        hours.push({
          h: h + 1,
          sheet: sv !== null ? +sv.toFixed(4) : null,
          plat:  +pv.toFixed(4),
          delta: sv !== null ? +(sv - pv).toFixed(4) : null,
        });
      }
      const sheetTotal = sd ? +sd.hours.reduce((s,v)=>s+v,0).toFixed(2) : null;
      const platTotal  = +pd.hours.reduce((s,v)=>s+v,0).toFixed(2);
      days.push({
        day:        pd.day,
        sheetTotal,
        platTotal,
        delta:      sheetTotal !== null ? +(sheetTotal - platTotal).toFixed(2) : null,
        missing:    !sd,
        hours,
      });
    }

    const sheetMonthly = days.filter(d=>d.sheetTotal!==null).reduce((s,d)=>s+d.sheetTotal,0);
    const platMonthly  = days.reduce((s,d)=>s+d.platTotal,0);
    const allOk        = days.every(d => d.delta === null || Math.abs(d.delta) < 1);
    const warnDays     = days.filter(d => d.delta !== null && Math.abs(d.delta) >= 1).length;

    output[cfg.sheetName] = {
      label:         cfg.label,
      sheetMonthly:  +sheetMonthly.toFixed(2),
      platMonthly:   +platMonthly.toFixed(2),
      monthlyDelta:  +(sheetMonthly - platMonthly).toFixed(2),
      status:        warnDays > 0 ? 'err' : 'ok',
      warnDays,
      days,
    };
    console.log('  Status:', output[cfg.sheetName].status,
                '  Warn days:', warnDays,
                '  Monthly delta:', output[cfg.sheetName].monthlyDelta.toFixed(0));
  }

  fs.writeFileSync('matriz-data.json', JSON.stringify(output, null, 2));
  console.log('\nSaved matriz-data.json');
}

main().catch(e => { console.error(e.message); process.exit(1); });
