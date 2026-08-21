const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const dataPath = path.join(root, 'characters.json');
const allowedCategories = new Set(['student', 'staff', 'civilian', 'external']);
const allowedOrganizations = new Set(['ism', 'hprf', 'wf', 'pbs', 'rtn', 'nf', 'spoiler']);
const codePattern = /^[A-Z0-9]{2,4}$/;
const sourceImagePattern = /\.(?:png|jpe?g)$/i;
const nsfwAssetCodes = Array.from({ length: 28 }, (_, index) => String(index + 101));

function fail(message) {
  throw new Error(`characters.json validation failed: ${message}`);
}

function assetExists(code, asset) {
  return fs.existsSync(path.join(root, code, 'D', `${asset}.webp`));
}

function normalizeAsset(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  return /^\d{1,3}$/.test(text) ? text.padStart(2, '0') : '';
}

function declaredMissingAssets(character, outfit = 'D') {
  const assets = character?.missingAssets?.[outfit];
  return new Set(Array.isArray(assets) ? assets.map(normalizeAsset).filter(Boolean) : []);
}

function validateAssetDirectory(name, assetOwnerCode, missingAssets, signatureAsset) {
  const characterDir = path.join(root, assetOwnerCode);
  if (!fs.existsSync(characterDir)) fail(`${name}: character directory is missing (${assetOwnerCode})`);
  for (const outfit of ['D', 'O', 'S']) {
    const outfitDir = path.join(characterDir, outfit);
    if (!fs.existsSync(outfitDir)) continue;
    const sourceImages = fs.readdirSync(outfitDir).filter(file => sourceImagePattern.test(file));
    if (sourceImages.length) {
      fail(`${name}: ${assetOwnerCode}/${outfit} contains unconverted source image(s): ${sourceImages.join(', ')}`);
    }
  }

  const mainCandidates = ['00', '01'];
  const hasMainImage = mainCandidates.some(asset => assetExists(assetOwnerCode, asset));
  const hasDeclaredMissingMainImage = mainCandidates.every(asset => missingAssets.has(asset));
  if (!hasMainImage && !hasDeclaredMissingMainImage) {
    fail(`${name}: ${assetOwnerCode}/D/00.webp or D/01.webp is required for the detail page`);
  }

  const requestedSignature = normalizeAsset(signatureAsset);
  if (signatureAsset !== undefined && !requestedSignature) {
    fail(`${name}: signatureAsset must be a 1-3 digit asset number`);
  }
  const signatureCandidates = [...new Set([requestedSignature, '02', '01'].filter(Boolean))];
  const hasSignatureImage = signatureCandidates.some(asset => assetExists(assetOwnerCode, asset));
  const hasDeclaredMissingSignatureImage = signatureCandidates.every(asset => missingAssets.has(asset));
  if (!hasSignatureImage && !hasDeclaredMissingSignatureImage) {
    fail(`${name}: no signature asset found for ${assetOwnerCode} (${signatureCandidates.join(', ')})`);
  }
}

if (!fs.existsSync(dataPath)) fail(`file not found: ${dataPath}`);

let characters;
try {
  characters = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (error) {
  fail(`invalid JSON (${error.message})`);
}

if (!Array.isArray(characters)) fail('the top-level value must be an array');

const seenCodes = new Set();
for (const [index, character] of characters.entries()) {
  const position = index + 1;
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    fail(`item ${position} must be an object`);
  }

  const name = String(character.name || '').trim();
  const englishName = String(character.englishName || '').trim();
  const code = String(character.code || '').trim();
  const species = String(character.species || '').trim();
  const formalSpecies = String(character.formalSpecies || '').trim();
  const stigma = String(character.specialAbility || '').trim();
  const sigmaWeapon = String(character.sigmaWeapon || '').trim();
  const sigmaWeaponDescription = String(character.sigmaWeaponDescription || '').trim();
  if (!name) fail(`item ${position} has no name`);
  if (!englishName) fail(`${name}: englishName is required`);
  if (englishName !== character.englishName || /[\r\n]/.test(englishName)) {
    fail(`${name}: englishName cannot contain leading, trailing, or line-break whitespace`);
  }
  if (typeof character.quote === 'string' && /[\r\n]/.test(character.quote)) {
    fail(`${name}: quote must be a single line; let the detail page wrap it naturally`);
  }
  if (!codePattern.test(code)) fail(`${name}: invalid code "${code}"`);
  if (seenCodes.has(code)) fail(`${name}: duplicate code "${code}"`);
  seenCodes.add(code);

  if (!allowedCategories.has(character.category)) {
    fail(`${name}: unsupported category "${character.category}"`);
  }
  if (!allowedOrganizations.has(character.org)) {
    fail(`${name}: unsupported org "${character.org}"`);
  }
  if ((character.org === 'spoiler') !== (character.spoilerOnly === true)) {
    fail(`${name}: spoiler org and spoilerOnly must be used together`);
  }
  if (species && species !== '인간' && !stigma) {
    fail(`${name}: non-human characters require a stigma value (use "미정" when undecided)`);
  }
  if (character.formalSpecies !== undefined && (!formalSpecies || formalSpecies !== character.formalSpecies)) {
    fail(`${name}: formalSpecies cannot be empty or contain leading/trailing whitespace`);
  }
  if (sigmaWeapon && !sigmaWeaponDescription) {
    fail(`${name}: sigmaWeaponDescription is required when sigmaWeapon is set`);
  }
  if (character.category === 'student' && ![1, 2, 3].includes(Number(character.grade))) {
    fail(`${name}: student grade must be 1, 2, or 3`);
  }

  const isMinor = character.isMinor === true || String(character.age || '').includes('미성년');
  if (isMinor) {
    const missingDailyAssets = declaredMissingAssets(character);
    for (const asset of nsfwAssetCodes) {
      if (assetExists(code, asset)) fail(`${name}: minors cannot have NSFW asset D/${asset}.webp`);
      if (!missingDailyAssets.has(asset)) fail(`${name}: minor NSFW asset D/${asset}.webp must be declared missing`);
    }
  }

  if (character.trueCode && !codePattern.test(String(character.trueCode))) {
    fail(`${name}: invalid trueCode "${character.trueCode}"`);
  }
  const trueCode = String(character.trueCode || '').trim();
  if (trueCode) {
    if (seenCodes.has(trueCode)) fail(`${name}: duplicate public or true code "${trueCode}"`);
    seenCodes.add(trueCode);
  }
  if (character.trueSignatureAsset !== undefined && !trueCode) {
    fail(`${name}: trueSignatureAsset requires trueCode`);
  }
  if ((character.trueSpecialAbility !== undefined || character.trueStigmaDescription !== undefined) && !trueCode) {
    fail(`${name}: true stigma fields require trueCode`);
  }
  if (character.trueStigmaDescription && !character.trueSpecialAbility) {
    fail(`${name}: trueSpecialAbility is required when trueStigmaDescription is set`);
  }
  if (character.trueSpecies && character.trueSpecies !== '인간' && !character.trueSpecialAbility) {
    fail(`${name}: non-human true identities require a trueSpecialAbility value`);
  }
  if (character.trueFormalSpecies !== undefined && (!trueCode || !String(character.trueFormalSpecies).trim())) {
    fail(`${name}: trueFormalSpecies requires a trueCode and a non-empty value`);
  }

  for (const [missingField, assetOwnerCode] of [
    ['missingAssets', code],
    ['trueMissingAssets', String(character.trueCode || '').trim()],
  ]) {
    if (character[missingField] !== undefined) {
      if (!character[missingField] || typeof character[missingField] !== 'object' || Array.isArray(character[missingField])) {
        fail(`${name}: ${missingField} must be an object`);
      }
      if (!assetOwnerCode) fail(`${name}: ${missingField} requires trueCode`);
      for (const [outfit, assets] of Object.entries(character[missingField])) {
        if (!Array.isArray(assets)) fail(`${name}: ${missingField}.${outfit} must be an array`);
        for (const asset of assets) {
          const assetCode = String(asset);
          if (!/^\d{1,3}$/.test(assetCode)) fail(`${name}: invalid missing asset code "${assetCode}"`);
          const declaredMissingPath = path.join(root, assetOwnerCode, outfit, `${assetCode}.webp`);
          if (fs.existsSync(declaredMissingPath)) {
            fail(`${name}: ${assetOwnerCode}/${outfit}/${assetCode}.webp exists but is declared missing`);
          }
        }
      }
    }
  }

  const missingDailyAssets = declaredMissingAssets(character);
  validateAssetDirectory(name, code, missingDailyAssets, character.signatureAsset);
  if (trueCode) {
    const trueMissingDailyAssets = declaredMissingAssets({ missingAssets: character.trueMissingAssets });
    validateAssetDirectory(
      `${name} / ${character.trueName || trueCode}`,
      trueCode,
      trueMissingDailyAssets,
      character.trueSignatureAsset || character.signatureAsset
    );
  }
}

console.log(`Validated ${characters.length} characters and their detail assets.`);
