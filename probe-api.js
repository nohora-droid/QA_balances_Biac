const https = require('https');

function get(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'X-User-ID': 'local', 'X-User-Email': 'tech@bia.app' } }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'] || '', body: b.substring(0, 150) }));
    });
    req.on('error', e => resolve({ status: 'ERR', ct: '', body: e.message }));
    req.setTimeout(6000, () => { req.destroy(); resolve({ status: 'TIMEOUT', ct: '', body: '' }); });
  });
}

async function main() {
  const candidates = [
    'https://api.olibia-energy.dev.bia.app/ms-olibia-energy/v1/health',
    'https://ms-olibia-energy.dev.bia.app/ms-olibia-energy/v1/health',
    'https://ms-olibia-energy.dev.bia.app/v1/health',
    'https://backend.olibia-energy.dev.bia.app/ms-olibia-energy/v1/health',
    'https://olibia-energy-api.dev.bia.app/ms-olibia-energy/v1/health',
    'https://olibia-energy.dev.bia.app/ms-olibia-energy/v1/health',
  ];

  for (const u of candidates) {
    const r = await get(u);
    const isJson = r.ct.includes('json');
    console.log(`${r.status}  ${isJson ? '[JSON]' : '[HTML]'}  ${u}`);
    if (isJson) console.log('  ->', r.body);
  }
}

main().catch(console.error);
