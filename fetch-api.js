/**
 * fetch-api.js
 * Calls the Olibia Energy API and saves responses for QA comparison.
 * Usage: node fetch-api.js <bearer_token>
 */
const https = require('https');
const fs    = require('fs');

const BASE   = 'https://olibia.dev.bia.app/ms-olibia-energy/v1';
const TOKEN  = process.argv[2];
const YEAR   = 2026;
const MONTH  = 1;

if (!TOKEN) { console.error('Usage: node fetch-api.js <bearer_token>'); process.exit(1); }

function get(path) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}${path}`;
    const u   = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      }
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log(`=== Olibia API — Balance ${YEAR}-${String(MONTH).padStart(2,'0')} ===\n`);

  // 1. Balance context → get available versions
  console.log('1. balance/context...');
  const ctx = await get(`/balance/context?year=${YEAR}&month=${MONTH}`);
  console.log(`   Status: ${ctx.status}`);
  if (ctx.status === 200) {
    console.log(`   Versiones: ${JSON.stringify(ctx.data).substring(0, 300)}`);
    fs.writeFileSync('api-context.json', JSON.stringify(ctx.data, null, 2));
  } else {
    console.log('   Error:', JSON.stringify(ctx.data).substring(0, 200));
  }

  // Determine version_name (TxF preferred)
  let versionName = 'TxF';
  if (ctx.status === 200 && ctx.data) {
    const versions = Array.isArray(ctx.data) ? ctx.data
      : ctx.data.versions ? ctx.data.versions
      : ctx.data.version_name ? [ctx.data.version_name]
      : [];
    const txf = versions.find ? versions.find(v => String(v).includes('TxF') || (v && v.version_name && v.version_name.includes('TxF'))) : null;
    if (txf) versionName = typeof txf === 'string' ? txf : txf.version_name;
    console.log(`   version_name usado: ${versionName}`);
  }

  // 2. Balance matrices
  console.log('\n2. balance/matrices...');
  const mat = await get(`/balance/matrices?year=${YEAR}&month=${MONTH}&version_name=${encodeURIComponent(versionName)}`);
  console.log(`   Status: ${mat.status}`);
  if (mat.status === 200) {
    const keys = Array.isArray(mat.data) ? `array[${mat.data.length}]` : Object.keys(mat.data || {}).join(', ');
    console.log(`   Keys: ${keys}`);
    fs.writeFileSync('api-matrices.json', JSON.stringify(mat.data, null, 2));
    console.log('   Guardado en api-matrices.json');
  } else {
    console.log('   Error:', JSON.stringify(mat.data).substring(0, 300));
  }

  // 3. Balance reconciliation
  console.log('\n3. balance/reconciliation...');
  const rec = await get(`/balance/reconciliation?year=${YEAR}&month=${MONTH}&version_name=${encodeURIComponent(versionName)}`);
  console.log(`   Status: ${rec.status}`);
  if (rec.status === 200) {
    fs.writeFileSync('api-reconciliation.json', JSON.stringify(rec.data, null, 2));
    console.log('   Guardado en api-reconciliation.json');
    console.log('   Preview:', JSON.stringify(rec.data).substring(0, 400));
  } else {
    console.log('   Error:', JSON.stringify(rec.data).substring(0, 300));
  }

  // 4. Contracts monthly (all)
  console.log('\n4. contracts/monthly...');
  const contracts = await get(`/contracts/monthly?limit=1000&offset=0`);
  console.log(`   Status: ${contracts.status}`);
  if (contracts.status === 200) {
    const items = Array.isArray(contracts.data) ? contracts.data : contracts.data?.items || contracts.data?.data || [];
    console.log(`   Contratos: ${items.length}`);
    fs.writeFileSync('api-contracts-monthly.json', JSON.stringify(contracts.data, null, 2));
    console.log('   Guardado en api-contracts-monthly.json');
    // Show first 3
    items.slice(0, 3).forEach(c =>
      console.log(`   - ${c.contract_number || c.provider || JSON.stringify(c).substring(0, 80)}`)
    );
  } else {
    console.log('   Error:', JSON.stringify(contracts.data).substring(0, 300));
  }

  // 5. Balance cross
  console.log('\n5. balance/cross...');
  const cross = await get(`/balance/cross?year=${YEAR}&month=${MONTH}&version_name=${encodeURIComponent(versionName)}`);
  console.log(`   Status: ${cross.status}`);
  if (cross.status === 200) {
    fs.writeFileSync('api-cross.json', JSON.stringify(cross.data, null, 2));
    console.log('   Guardado en api-cross.json');
    console.log('   Preview:', JSON.stringify(cross.data).substring(0, 400));
  } else {
    console.log('   Error:', JSON.stringify(cross.data).substring(0, 300));
  }

  console.log('\n✅ Listo. Archivos guardados en energy-qa/');
}

main().catch(console.error);
