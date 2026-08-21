const fs = require('fs');
const path = require('path');

const stylesDir = 'styles';

// Character detail rules belong exclusively to 05-character-detail.css so later
// cascade layers cannot silently override them.
const detailOwnershipForbiddenFiles = [
  'styles/10-cross-cutting.css',
  'styles/11-mobile.css',
  'styles/12-feature-refinements.css',
  'styles/13-final-theme.css',
];

// Labels and captions must not be smaller than 12px. The floor applies to every
// module, not only the late ones: the readable minimum is a site-wide rule.
const MIN_FONT_PX = 12;

function styleFiles() {
  return fs
    .readdirSync(stylesDir)
    .filter(name => name.endsWith('.css'))
    .sort()
    .map(name => path.posix.join(stylesDir, name));
}

const ROOT_FONT_PX = 16;

function absoluteLengthsPx(text) {
  return [...text.matchAll(/([0-9]*\.?[0-9]+)(px|rem)\b/g)].map(match =>
    match[2] === 'px' ? Number(match[1]) : Number(match[1]) * ROOT_FONT_PX
  );
}

// Returns the smallest size a font-size value can render at, in px, or null when
// that cannot be decided statically. A `max()` guard is not automatically safe:
// `max(0.6875rem, 11px)` still renders below the floor, so its arguments are
// evaluated rather than skipped.
function minimumRenderedPx(value) {
  const text = value.trim();

  // The --text-* tokens carry the floor in 00-tokens.css; trust them by name.
  if (/^var\(--text-[a-z]+\)$/.test(text)) return null;

  // em is relative to the parent font size and cannot be resolved from source.
  if (/[0-9](?:\.[0-9]+)?em\b/.test(text.replace(/rem\b/g, ''))) return null;

  const clampArguments = text.match(/^clamp\(([^,]+),/);
  if (clampArguments) {
    const lowerBound = clampArguments[1];
    if (/var\(--text-[a-z]+\)/.test(lowerBound)) return null;
    const [smallest] = absoluteLengthsPx(lowerBound);
    return smallest === undefined ? null : smallest;
  }

  const maxArguments = text.match(/^max\((.*)\)$/);
  if (maxArguments) {
    const lengths = absoluteLengthsPx(maxArguments[1]);
    return lengths.length ? Math.max(...lengths) : null;
  }

  const [plain] = absoluteLengthsPx(text);
  return plain === undefined ? null : plain;
}

// A comment that loses its closing */ swallows every rule down to the next */ in
// the file — silently, because the browser just reads them as comment text.
// One such truncation killed 33 rules across 200 lines and passed every check.
// CSS comments do not nest, so a /* inside a comment body means the comment that
// opened it was truncated; that, not an unterminated comment at EOF, is the tell.
function commentProblem(source) {
  const lineOf = position => source.slice(0, position).split(/\r?\n/).length;
  let cursor = 0;
  for (;;) {
    const open = source.indexOf('/*', cursor);
    if (open === -1) return null;
    const close = source.indexOf('*/', open + 2);
    if (close === -1) return { line: lineOf(open), reason: 'is never closed' };

    const stray = source.slice(open + 2, close).indexOf('/*');
    if (stray !== -1) {
      return {
        line: lineOf(open),
        reason:
          `runs past another /* at line ${lineOf(open + 2 + stray)}, so everything ` +
          'between them is commented out; its own closing */ was probably deleted',
      };
    }
    cursor = close + 2;
  }
}

const violations = [];

for (const file of styleFiles()) {
  const rawSource = fs.readFileSync(file, 'utf8');
  const comment = commentProblem(rawSource);
  if (comment) {
    violations.push(`${file}:${comment.line}: comment ${comment.reason}.`);
  }

  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '');
  const checkDetailOwnership = detailOwnershipForbiddenFiles.includes(file);

  source.split(/\r?\n/).forEach((line, index) => {
    const location = `${file}:${index + 1}`;

    if (checkDetailOwnership && (line.includes('.cdp-') || line.includes('#char-detail'))) {
      violations.push(`${location}: ${line.trim()}`);
    }

    const declaration = line.match(/font-size:\s*([^;]+)/);
    if (!declaration) return;
    const smallestPx = minimumRenderedPx(declaration[1]);
    if (smallestPx === null) return;
    if (smallestPx < MIN_FONT_PX) {
      violations.push(
        `${location}: font-size renders at ${smallestPx}px; the readable minimum is ` +
          `${MIN_FONT_PX}px. Use var(--text-label) or a larger --text-* token.`
      );
    }
  });
}

if (violations.length) {
  throw new Error(`CSS ownership/readability validation failed:\n${violations.join('\n')}`);
}

console.log(`CSS ownership and minimum font sizes are clean (${styleFiles().length} modules).`);
