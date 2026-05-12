/**
 * find-tabs.js
 * Fetches the spreadsheet HTML to extract real tab names and gids.
 */
const https = require('https');

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

function httpGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const options = new URL(url);
    https.get({
      hostname: options.hostname,
      path: options.pathname + options.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    }, (res) => {
      if ([301, 302, 307].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        if (loc.includes('accounts.google.com')) {
          resolve({ status: res.statusCode, body: 'REQUIRES_LOGIN' }); return;
        }
        resolve(httpGet(loc, redirects - 1)); return;
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function main() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
  console.log('Fetching spreadsheet HTML...');
  const { status, body } = await httpGet(url);
  console.log(`Status: ${status}, Body length: ${body.length}`);

  if (body === 'REQUIRES_LOGIN') {
    console.log('Sheet requires login to view tab list.');
    return;
  }

  // Extract sheet names and gids from the HTML
  // Google embeds them as: "name":"Tab Name","id":12345
  const sheetPattern = /"name":"([^"]+)","id":(\d+)/g;
  const tabs = [];
  let m;
  while ((m = sheetPattern.exec(body)) !== null) {
    tabs.push({ name: m[1], gid: m[2] });
  }

  // Also try alternate pattern used in newer versions
  const altPattern = /\["([^"]+)",null,\d+,(\d+)/g;
  while ((m = altPattern.exec(body)) !== null) {
    if (!tabs.find(t => t.gid === m[2])) {
      tabs.push({ name: m[1], gid: m[2] });
    }
  }

  if (tabs.length === 0) {
    console.log('No tabs found in HTML. First 2000 chars:');
    console.log(body.substring(0, 2000));
  } else {
    console.log(`\nPestañas encontradas (${tabs.length}):`);
    tabs.forEach(t => console.log(`  gid=${t.gid}  name="${t.name}"`));

    // Try fetching each tab by gid
    console.log('\n=== Probando acceso por gid ===');
    for (const tab of tabs.slice(0, 10)) {
      const csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${tab.gid}`;
      try {
        const { body: csv } = await httpGet(csvUrl);
        const firstLine = csv.split('\n')[0];
        const isHtml = firstLine.trim().startsWith('<');
        const rows = csv.split('\n').length;
        if (!isHtml) {
          console.log(`  ✅ gid=${tab.gid} "${tab.name}" — ${rows} filas | ${firstLine.substring(0, 80)}`);
        } else {
          console.log(`  ❌ gid=${tab.gid} "${tab.name}" — redirigida/privada`);
        }
      } catch (e) {
        console.log(`  ❌ gid=${tab.gid} "${tab.name}" — error: ${e.message}`);
      }
    }
  }
}

main().catch(console.error);
