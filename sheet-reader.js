/**
 * sheet-reader.js
 * Reads energy balance data from the Google Sheet.
 *
 * Auth modes (in order of precedence):
 *  1. GOOGLE_SERVICE_ACCOUNT_JSON env var → service account credentials JSON string
 *  2. GOOGLE_API_KEY env var              → API key (sheet must be shared "anyone with link")
 *  3. Public CSV export                   → no credentials (sheet must be public)
 */

const { google } = require('googleapis');
const https = require('https');
require('dotenv').config();

const SPREADSHEET_ID = '1VcpYek6pGS45nhofob1TyP04wRtBqLFyjCbLpjnDkmA';

const KEY_VARIABLES = [
  'Demanda Regulado',
  'Demanda No Regulado',
  'Contratos',
  'Compra Bolsa',
  'Venta Bolsa',
];

// --- Auth helpers ---

function getAuthClient() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  return null; // fallback to API key or public CSV
}

// --- Data fetching ---

async function fetchViaApi(sheetName) {
  const authClient = getAuthClient();
  const sheetsOptions = { version: 'v4' };
  if (authClient) sheetsOptions.auth = authClient;

  const sheets = google.sheets(sheetsOptions);

  const params = {
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:Z500`,
  };
  if (process.env.GOOGLE_API_KEY && !authClient) {
    params.key = process.env.GOOGLE_API_KEY;
  }

  const response = await sheets.spreadsheets.values.get(params);
  return response.data.values || [];
}

function httpGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
        const loc = res.headers.location;
        if (loc.includes('accounts.google.com')) {
          reject(new Error('Redirigido a login de Google — el sheet sigue siendo privado.'));
          return;
        }
        if (redirectsLeft === 0) {
          reject(new Error('Demasiados redirects'));
          return;
        }
        resolve(httpGet(loc, redirectsLeft - 1));
        return;
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        reject(new Error(`HTTP ${res.statusCode}: Sheet privado. Provee credenciales.`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function parseCsvBody(body) {
  // Simple CSV parser that handles quoted fields with commas inside
  return body.split('\n').map((line) => {
    const cells = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  });
}

async function fetchCsv(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`;
  const { body } = await httpGet(url);
  return parseCsvBody(body);
}

async function fetchSheetData(sheetName) {
  // Try API first (handles both service account and API key)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_API_KEY) {
    console.log('  Auth: usando credenciales de entorno');
    return fetchViaApi(sheetName);
  }
  // Fallback to public CSV
  console.log('  Auth: intentando exportación CSV pública');
  return fetchCsv(sheetName);
}

// --- Parsing ---

function parseEnergyData(rawRows) {
  const result = {};

  for (const row of rawRows) {
    if (!row || row.length === 0) continue;
    const label = (row[0] || '').trim();
    const matched = KEY_VARIABLES.find(
      (v) => label.toLowerCase() === v.toLowerCase()
    );
    if (matched) {
      const values = row.slice(1).map((cell) => {
        const cleaned = String(cell).replace(/,/g, '.').replace(/\s/g, '').replace(/[^\d.-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
      });
      result[matched] = values;
    }
  }

  return result;
}

function summarize(data) {
  const summary = {};
  for (const [variable, values] of Object.entries(data)) {
    const nonNull = values.filter((v) => v !== null);
    summary[variable] = {
      count: nonNull.length,
      total: nonNull.reduce((a, b) => a + b, 0),
      min: nonNull.length ? Math.min(...nonNull) : null,
      max: nonNull.length ? Math.max(...nonNull) : null,
      avg: nonNull.length ? nonNull.reduce((a, b) => a + b, 0) / nonNull.length : null,
      values,
    };
  }
  return summary;
}

// --- Main ---

async function main() {
  const sheetName = process.argv[2] || 'enero';
  console.log(`\n=== Leyendo hoja: "${sheetName}" ===\n`);

  let rawRows;
  try {
    rawRows = await fetchSheetData(sheetName);
  } catch (err) {
    console.error(`❌ No se pudo leer el sheet: ${err.message}`);
    console.error('\nOpciones para habilitar acceso:');
    console.error('  A) Compartir el sheet como "Cualquiera con el enlace puede ver"');
    console.error('  B) Agregar GOOGLE_API_KEY=... al archivo .env');
    console.error('  C) Agregar GOOGLE_SERVICE_ACCOUNT_JSON=... al archivo .env');
    process.exit(1);
  }

  console.log(`Filas totales leídas: ${rawRows.length}`);

  console.log('\n--- Primeras 6 filas (muestra de estructura) ---');
  rawRows.slice(0, 6).forEach((row, i) => {
    const preview = row.slice(0, 10).join(' | ');
    console.log(`  Fila ${i + 1}: [${preview}${row.length > 10 ? ' ...' : ''}]`);
  });

  const data = parseEnergyData(rawRows);

  if (Object.keys(data).length === 0) {
    console.log('\n⚠️  Variables clave no encontradas. Etiquetas en columna A:');
    rawRows.forEach((row, i) => {
      if (row[0] && row[0].trim()) {
        console.log(`  Fila ${i + 1}: "${row[0].trim()}"`);
      }
    });
    process.exit(0);
  }

  console.log('\n--- Resumen por variable ---');
  const summary = summarize(data);
  for (const [variable, stats] of Object.entries(summary)) {
    console.log(`\n${variable}:`);
    console.log(`  Períodos : ${stats.count}`);
    console.log(`  Total    : ${stats.total.toFixed(2)}`);
    console.log(`  Min      : ${stats.min?.toFixed(2)}`);
    console.log(`  Max      : ${stats.max?.toFixed(2)}`);
    console.log(`  Promedio : ${stats.avg?.toFixed(2)}`);
  }

  const fs = require('fs');
  const output = {
    spreadsheetId: SPREADSHEET_ID,
    tab: sheetName,
    extractedAt: new Date().toISOString(),
    variables: data,
    summary,
  };
  const outFile = `data-${sheetName}.json`;
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n✅ Datos guardados en ${outFile}`);
}

main();
