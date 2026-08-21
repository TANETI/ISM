const fs = require('fs');
const path = require('path');

const START_MARKER = '<!-- CSS_MODULES_START -->';
const END_MARKER = '<!-- CSS_MODULES_END -->';
const BUNDLE_HREF = './assets/ism.css?__VERSION__';

function stripCssComments(css) {
  let result = '';
  let quote = null;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (quote) {
      result += char;
      if (char === '\\') {
        result += next || '';
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = css.indexOf('*/', index + 2);
      if (end === -1) throw new Error('Unterminated CSS comment.');
      index = end + 1;
      continue;
    }

    result += char;
  }

  return result;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const sourceRoot = path.resolve(readOption('--source-root') || '.');
const indexPath = path.resolve(readOption('--index') || 'dist/index.html');
const outputPath = path.resolve(readOption('--out') || 'dist/assets/ism.css');

if (!fs.existsSync(indexPath)) {
  throw new Error(`index.html not found: ${indexPath}`);
}

let html = fs.readFileSync(indexPath, 'utf8');
const start = html.indexOf(START_MARKER);
const end = html.indexOf(END_MARKER);

if (start === -1 || end === -1 || end <= start) {
  throw new Error('CSS module markers were not found in the expected order.');
}

const moduleBlock = html.slice(start + START_MARKER.length, end);
const modulePaths = [...moduleBlock.matchAll(/href="\.\/(styles\/[^"?]+\.css)\?__VERSION__"/g)]
  .map(match => match[1]);

if (modulePaths.length === 0) {
  throw new Error('No versioned CSS modules were found between the markers.');
}
if (new Set(modulePaths).size !== modulePaths.length) {
  throw new Error('Duplicate CSS module links were found.');
}

const bundleParts = modulePaths.map(relativePath => {
  const sourcePath = path.resolve(sourceRoot, relativePath);
  const stylesRoot = path.resolve(sourceRoot, 'styles') + path.sep;
  if (!sourcePath.startsWith(stylesRoot) || !fs.existsSync(sourcePath)) {
    throw new Error(`CSS module not found or outside styles directory: ${relativePath}`);
  }
  return stripCssComments(fs.readFileSync(sourcePath, 'utf8')).trim();
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${bundleParts.join('\n\n')}\n`, 'utf8');

const bundleBlock = `${START_MARKER}\n<link rel="stylesheet" href="${BUNDLE_HREF}">\n${END_MARKER}`;
html = `${html.slice(0, start)}${bundleBlock}${html.slice(end + END_MARKER.length)}`;
fs.writeFileSync(indexPath, html, 'utf8');

console.log(`Bundled ${modulePaths.length} CSS modules into ${outputPath}`);
