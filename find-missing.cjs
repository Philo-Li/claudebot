const fs = require('fs');
const path = require('path');

const prodLines = fs.readFileSync(path.join(__dirname, 'prod-deps.txt'), 'utf-8').trim().split('\n');
const prod = new Set();
for (const line of prodLines) {
  const normalized = line.trim().split('\\').join('/');
  const parts = normalized.split('/node_modules/');
  if (parts.length >= 2) {
    prod.add(parts[parts.length - 1]);
  }
}

const builtDir = path.join(__dirname, 'dist', 'win-unpacked', 'resources', 'app', 'node_modules');
const built = new Set(fs.readdirSync(builtDir));

const missing = [...prod].filter(m => !built.has(m)).sort();
console.log('Missing modules (' + missing.length + '):');
missing.forEach(m => console.log('  ' + m));
console.log('\nAs array:');
console.log(JSON.stringify(missing));
