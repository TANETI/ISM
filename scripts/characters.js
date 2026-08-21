export const CATEGORY_LABELS = Object.freeze({
  student: '아카데미생',
  staff: '아카데미 직원',
  civilian: '민간인',
  external: '외부 인물',
});

const VALID_CATEGORIES = new Set(['student', 'staff', 'civilian', 'external']);
const VALID_ORGS = new Set(['ism', 'pbs', 'hprf', 'wf', 'rtn', 'nf', 'spoiler']);
const VALID_STATUSES = new Set(['complete', 'wip', 'partial']);

export function normalizeOrgValue(value, category = '') {
  if (category === 'student' || category === 'staff') return 'ism';
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'nf';
  if (raw.includes('ism') || raw.includes('아카데미')) return 'ism';
  if (raw.includes('rtn') || raw.includes('귀향')) return 'rtn';
  if (raw.includes('pbs') || raw.includes('원혈')) return 'pbs';
  if (raw.includes('hprf') || raw.includes('인간보전')) return 'hprf';
  if (raw.includes('wf') || raw.includes('백색울타리')) return 'wf';
  if (raw === 'spoiler') return 'spoiler';
  return 'nf';
}

export function normalizeGender(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();
  if (!raw) return '';
  if (['여성', '여자', '女', 'female', 'f'].includes(raw) || ['female', 'woman', 'girl'].includes(normalized)) return '여성';
  if (['남성', '남자', '男', 'male', 'm'].includes(raw) || ['male', 'man', 'boy'].includes(normalized)) return '남성';
  if (['미정', '불명', 'unknown', 'n/a', 'na', '?'].includes(normalized) || ['미정', '불명'].includes(raw)) return '미정';
  return raw;
}

export function normalizeMissingAssets(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([outfitCode, assetCodes]) => [
        String(outfitCode || '').trim().toUpperCase(),
        new Set(Array.isArray(assetCodes) ? assetCodes.map(code => String(code)) : []),
      ])
      .filter(([outfitCode, assetCodes]) => outfitCode && assetCodes.size)
  );
}

export function isCharacterAssetMissing(character, outfitCode, assetCode) {
  return !!character?._missingAssets?.[String(outfitCode || '').toUpperCase()]?.has(String(assetCode));
}

export function normalizeCharacter(raw = {}, makeSearchMeta = () => ({ text: '', compact: '', codes: [] })) {
  const character = { ...raw };
  const gradeNumber = Number(character.grade);
  const rawCategory = String(character.category || '').trim().toLowerCase();
  if (VALID_CATEGORIES.has(rawCategory)) character.category = rawCategory;
  else if (Number.isFinite(gradeNumber) && gradeNumber >= 1) character.category = 'student';
  else if (Number.isFinite(gradeNumber) && gradeNumber === 0) character.category = 'staff';
  else character.category = 'external';

  if (Number.isFinite(gradeNumber)) character.grade = gradeNumber;
  else if (character.grade === undefined || character.grade === null) character.grade = '';

  character.code = String(character.code || '').trim().toUpperCase();
  character.org = normalizeOrgValue(
    character.org || character.affiliation || character.organization || character.faction || character.group,
    character.category
  );
  if (!VALID_ORGS.has(character.org)) character.org = ['student', 'staff'].includes(character.category) ? 'ism' : 'nf';

  const rawStatus = String(character.status || '').trim().toLowerCase();
  character.status = VALID_STATUSES.has(rawStatus) ? rawStatus : '';
  character.gender = normalizeGender(character.gender);
  character._missingAssets = normalizeMissingAssets(character.missingAssets);

  const searchMeta = makeSearchMeta(character);
  character._searchText = searchMeta.text;
  character._searchCompact = searchMeta.compact;
  character._searchCodes = searchMeta.codes;
  return character;
}

export function getCharCategory(character) {
  if (VALID_CATEGORIES.has(character?.category)) return character.category;
  if (Number(character?.grade) >= 1) return 'student';
  if (Number(character?.grade) === 0) return 'staff';
  return 'external';
}

export function getCharacterOrg(character) {
  const category = getCharCategory(character);
  if (category === 'student' || category === 'staff') return 'ism';
  return normalizeOrgValue(
    character?.org || character?.affiliation || character?.organization || character?.faction || character?.group,
    category
  );
}

export function getRosterGroupKey(character) {
  const category = getCharCategory(character);
  if (category === 'student') return 'students';
  if (category === 'staff') return 'staff';
  return getCharacterOrg(character) || 'nf';
}

export const isStudent = character => getCharCategory(character) === 'student';
export const isPublicCharacter = character => character?.spoilerOnly !== true;
export const isMale = character => normalizeGender(character?.gender) === '남성';
export const isFemale = character => normalizeGender(character?.gender) === '여성';
export const isMinorCharacter = character => character?.isMinor === true || String(character?.age || '').includes('미성년');
export const isNsfwEligibleCharacter = character => isFemale(character) && !isMinorCharacter(character);
