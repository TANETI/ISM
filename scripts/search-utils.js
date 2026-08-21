export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function compactSearchText(value) {
  return normalizeSearchText(value).replace(/[\s·._\-'"’`/()[\],:;]+/g, '');
}

export function normalizeCodeToken(value) {
  return compactSearchText(value).toUpperCase();
}

function isCodeLikeSearchTerm(value) {
  return /^[A-Z0-9]{2,4}$/.test(normalizeCodeToken(value));
}

function searchCodeTokens(value) {
  return String(value || '')
    .split(/\s+/)
    .map(normalizeCodeToken)
    .filter(Boolean);
}

function elementHasSearchCode(element, codeToken) {
  return searchCodeTokens(element?.dataset?.searchCodes).includes(codeToken);
}

export function exactCodeSearchToken(rawTerm, elements) {
  if (!isCodeLikeSearchTerm(rawTerm)) return '';
  const codeToken = normalizeCodeToken(rawTerm);
  return elements.some(element => elementHasSearchCode(element, codeToken)) ? codeToken : '';
}

function normalizedSearchTerm(rawTerm) {
  const normalized = normalizeSearchText(rawTerm).trim();
  return {
    normalized,
    compact: compactSearchText(normalized),
  };
}

function searchTextMatches(text, rawTerm, compactText = '') {
  const term = normalizedSearchTerm(rawTerm);
  if (!term.normalized) return true;
  const source = String(text || '');
  const compactSource = compactText || compactSearchText(source);
  return source.includes(term.normalized) || compactSource.includes(term.compact);
}

export function elementMatchesSearch(element, rawTerm, exactCodeToken = '') {
  if (!rawTerm) return true;
  if (exactCodeToken) return elementHasSearchCode(element, exactCodeToken);
  return searchTextMatches(
    element?.dataset?.searchText || '',
    rawTerm,
    element?.dataset?.searchCompact || ''
  );
}
