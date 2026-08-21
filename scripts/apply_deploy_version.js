const fs = require('fs');
const path = require('path');

const indexPath = path.resolve(process.argv[2] || 'dist/index.html');
const version = (process.argv[3] || process.env.GITHUB_SHA || 'dev').slice(0, 8);

if (!fs.existsSync(indexPath)) {
  throw new Error(`index.html not found: ${indexPath}`);
}

let html = fs.readFileSync(indexPath, 'utf8');
html = html
  .replaceAll('__VERSION__', `v=${version}`)
  .replaceAll('__VERSION_VALUE__', version);

if (html.includes('__VERSION__') || html.includes('__VERSION_VALUE__')) {
  throw new Error('Version placeholder replacement failed.');
}

fs.writeFileSync(indexPath, html, 'utf8');
console.log(`Applied deploy version ${version} to ${indexPath}`);
