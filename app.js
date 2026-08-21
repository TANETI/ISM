import { UI_TIMING_MS, createAppState } from './scripts/app-state.js?__VERSION__';
import {
  compactSearchText,
  elementMatchesSearch,
  exactCodeSearchToken,
  normalizeCodeToken,
  normalizeSearchText,
} from './scripts/search-utils.js?__VERSION__';
import { createDetailScrollController } from './scripts/detail-scroll.js?__VERSION__';
import {
  CHARACTER_SCOPES,
  SECTION_IDS,
  activateSection,
  bindNavigationEvents,
  createSectionScrollController,
  stateFromLocation,
} from './scripts/navigation.js?__VERSION__';
import {
  CATEGORY_LABELS,
  getCharCategory,
  getCharacterOrg,
  getRosterGroupKey,
  isCharacterAssetMissing,
  isFemale,
  isMale,
  isNsfwEligibleCharacter,
  isPublicCharacter,
  isStudent,
  normalizeCharacter,
  normalizeMissingAssets,
  normalizeOrgValue,
} from './scripts/characters.js?__VERSION__';
import {
  createGallerySidebarTools,
  normalizeLightboxAssets,
} from './scripts/gallery.js?__VERSION__';
import { initMainFactionSwitcher } from './scripts/main-factions.js?__VERSION__';
import { createCommandPalette } from './scripts/command-palette.js?__VERSION__';

/* ──────────────────────────────────────────────────
   ▶ 상수 — 이미지 경로 & 에셋 목록
   BASE: GitHub Pages 기본 경로
   EMOTIONS: 감정 코드 00(명함)~19
   NSFW_SITUATIONS: NSFW 상황 코드 101~128
   이미지 경로 형식:
     감정: {BASE}/{캐릭터코드}/D/{감정코드}.webp
     NSFW:  {BASE}/{캐릭터코드}/D/{상황코드}.webp
   사이트 표기는 감정/NSFW를 분리하지만, 실제 에셋은 D 의상코드 폴더에 통합한다.
────────────────────────────────────────────────── */
const BASE = '.';
const MIN_LOADING_SCREEN_MS = 450;
const appBootStartedAt = performance.now();

/* ▶ 감정 에셋 목록 — 코드와 한국어 이름
   추가/삭제 시 이 배열만 수정하세요 */
const EMOTIONS = [
  {code:'00',name:'명함'},
  {code:'01',name:'기본'},   {code:'02',name:'미소'},   {code:'03',name:'행복'},
  {code:'04',name:'슬픔'},   {code:'05',name:'분노'},   {code:'06',name:'놀람'},
  {code:'07',name:'부끄러움'},{code:'08',name:'공포'},   {code:'09',name:'경멸'},
  {code:'10',name:'우쭐'},   {code:'11',name:'의문'},   {code:'12',name:'피곤'},
  {code:'13',name:'포옹'},   {code:'14',name:'키스'},   {code:'15',name:'유혹'},
  {code:'16',name:'한심'},   {code:'17',name:'머리 쓰다듬기'}, {code:'18',name:'볼 당기기'},
  {code:'19',name:'전투'},
];

/* ▶ NSFW 상황 에셋 목록 — 코드와 이름(미정 시 빈 문자열)
   main prompt의 NSFW 상황表와 일치시킬 것 */
const BATTLE_ASSET_CODE = '19';
const WIDE_EMOTION_ASSET_CODES = Object.freeze(new Set(['00', BATTLE_ASSET_CODE]));

const NSFW_SITUATIONS = [
  {code:'101',name:'자위 (弱)'}, {code:'102',name:'자위 (强)'}, {code:'103',name:'핑거링'},
  {code:'104',name:'대딸 (弱)'}, {code:'105',name:'대딸 (射)'}, {code:'106',name:'파이즈리 (弱)'},
  {code:'107',name:'파이즈리 (射)'}, {code:'108',name:'펠라 (弱)'}, {code:'109',name:'펠라 (强)'},
  {code:'110',name:'펠라 (射)'}, {code:'111',name:'정상위 (弱)'}, {code:'112',name:'정상위 (强)'},
  {code:'113',name:'정상위 (射)'}, {code:'114',name:'후배위 (弱)'}, {code:'115',name:'후배위 (强)'},
  {code:'116',name:'후배위 (射)'}, {code:'117',name:'기승위약 (弱)'}, {code:'118',name:'기승위강 (强)'},
  {code:'119',name:'기승위사 (射)'}, {code:'120',name:'측위 (弱)'}, {code:'121',name:'측위 (射)'},
  {code:'122',name:'대면좌위 (弱)'}, {code:'123',name:'대면좌위 (射)'}, {code:'124',name:'배면좌위 (弱)'},
  {code:'125',name:'배면좌위 (射)'}, {code:'126',name:'아마존프레스 (弱)'}, {code:'127',name:'아마존프레스 (射)'},
  {code:'128',name:'필로우토크'},
];
const NSFW_FULL_ASSET_SET = Object.freeze(new Set(NSFW_SITUATIONS.map(({ code }) => code)));
const EMPTY_ASSET_SET = Object.freeze(new Set());
const NSFW_POSE_RESTRICTED_SPECIES = Object.freeze(['라미아', '시로헤비']);
const NSFW_POSE_RESTRICTED_CODES = Object.freeze(new Set(['114', '115', '116', '124', '125']));

/* ──────────────────────────────────────────────────
   ▶ 보조 데이터 — 조직별 공개 준비 명부
   실제 인물 추가 시 characters.json의 표준 소속 필드는 org를 사용하세요.
   affiliation/organization/faction/group은 기존 데이터 호환용 fallback입니다.
────────────────────────────────────────────────── */
const ORG_PLACEHOLDERS = Object.freeze({
  pbs: [{category:'external', org:'pbs', name:'추가 예정', species:'미정', role:'원혈회'}],
  hprf: [{category:'external', org:'hprf', name:'추가 예정', species:'미정', role:'인간보전전선'}],
  wf: [{category:'external', org:'wf', name:'추가 예정', species:'미정', role:'백색울타리'}],
  rtn: [{category:'external', org:'rtn', name:'추가 예정', species:'미정', role:'귀향파'}],
  nf: [{category:'civilian', org:'nf', name:'추가 예정', species:'미정', role:'무소속'}],
});

const BUILD_VERSION = (() => {
  const version = document.documentElement.dataset.version;
  // GitHub Pages receives a stable commit version during deployment. Local
  // development keeps the placeholder, so use a fresh value to avoid stale
  // characters.json while editing data.
  if (!version || version === '__VERSION_VALUE__') return `dev-${Date.now()}`;
  return version;
})();

/* ──────────────────────────────────────────────────
   ▶ 전역 상태
────────────────────────────────────────────────── */
const appState = createAppState();
const missingDetailImageCodes = new Set();
const missingAssetUrls = new Set();
const assetAvailabilityChecks = new Map();

function isMissingAssetUrl(url) {
  return missingAssetUrls.has(String(url || ''));
}

function markMissingAssetUrl(url) {
  if (url) missingAssetUrls.add(String(url));
}

function hasAvailableAsset(url) {
  const source = String(url || '');
  if (!source) return Promise.resolve(false);
  if (missingAssetUrls.has(source)) return Promise.resolve(false);
  if (assetAvailabilityChecks.has(source)) return assetAvailabilityChecks.get(source);

  const check = new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => {
      markMissingAssetUrl(source);
      resolve(false);
    };
    image.src = source;
  });
  assetAvailabilityChecks.set(source, check);
  return check;
}


/* ──────────────────────────────────────────────────
   ▶ 모바일/오버레이 공통 스크롤 잠금
   body overflow만 쓰면 모바일 브라우저에서 배경 스크롤·주소창 변화로 위치가 흔들린다.
   여러 오버레이가 동시에 열려도 reason 단위로 안전하게 관리한다.
────────────────────────────────────────────────── */
const pageScrollLocks = new Set();
let pageScrollLockY = 0;
const pageInteractionLocks = new Set();
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function lockPageScroll(reason = 'default') {
  if (!reason) reason = 'default';
  if (pageScrollLocks.has(reason)) return;

  if (pageScrollLocks.size === 0) {
    pageScrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${pageScrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.classList.add('page-scroll-locked');
  }

  pageScrollLocks.add(reason);
}

function unlockPageScroll(reason = 'default', options = {}) {
  if (!reason) reason = 'default';
  // Popstate and explicit close controls can reconcile the same overlay twice.
  // A second unlock must be a no-op or it would restore the page to scrollY = 0.
  const hadLock = pageScrollLocks.delete(reason);
  if (!hadLock || pageScrollLocks.size > 0) return;

  const restore = options.restore !== false;
  const scrollY = pageScrollLockY;
  document.body.classList.remove('page-scroll-locked');
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  pageScrollLockY = 0;

  if (restore) window.scrollTo({ top: scrollY, behavior: 'auto' });
}

function setPageInteractionLock(reason, locked) {
  if (locked) pageInteractionLocks.add(reason);
  else pageInteractionLocks.delete(reason);
  const inert = pageInteractionLocks.size > 0;
  document.querySelectorAll('.scroll-index, .section').forEach(element => {
    element.inert = inert;
  });
}

function focusableElementsWithin(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => {
    const style = getComputedStyle(element);
    return !element.hidden && !element.inert && style.display !== 'none' &&
      style.visibility !== 'hidden' && element.getClientRects().length > 0;
  });
}

function focusElementSafely(element) {
  if (!element?.focus) return false;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
  return document.activeElement === element;
}

function focusFirstWithin(container, preferredSelector = '') {
  const preferred = preferredSelector ? container?.querySelector(preferredSelector) : null;
  if (preferred && focusableElementsWithin(container).includes(preferred)) {
    return focusElementSafely(preferred);
  }
  return focusElementSafely(focusableElementsWithin(container)[0] || container);
}

function scheduleFocusWithin(container, preferredSelector = '') {
  setTimeout(() => focusFirstWithin(container, preferredSelector), 0);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => focusFirstWithin(container, preferredSelector));
  });
}

function scheduleFocusElement(element) {
  setTimeout(() => {
    if (element?.isConnected) focusElementSafely(element);
  }, 0);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (element?.isConnected) focusElementSafely(element);
    });
  });
}

function restoreOverlayFocus(element) {
  if (!element?.isConnected) return false;
  const restored = focusElementSafely(element);
  // Layout, history reconciliation, and scroll restoration can briefly steal focus.
  // Keep the immediate restoration for users and retain the scheduled fallback.
  scheduleFocusElement(element);
  return restored;
}

function activeFocusTrap() {
  // 열람 색인은 다른 오버레이 위에 열릴 수 있으므로 먼저 확인한다.
  const palette = document.getElementById('command-palette');
  if (palette && !palette.hidden) return palette;
  const lightbox = document.getElementById('lightbox');
  if (lightbox?.classList.contains('open')) return lightbox;
  const detail = document.getElementById('char-detail');
  if (detail?.classList.contains('open')) return detail;
  return null;
}

function trapTabFocus(event, container) {
  if (event.key !== 'Tab' || !container) return false;
  const focusable = focusableElementsWithin(container);
  if (!focusable.length) {
    event.preventDefault();
    event.stopPropagation();
    focusElementSafely(container);
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  // 컨테이너 안이지만 초점 목록에 없는 곳(패널·그림 같은 비초점 요소)에 초점이
  // 있으면, 브라우저 기본 이동에 맡기는 순간 트랩 밖으로 새어 나간다.
  // 목록의 양 끝으로 명시적으로 데려간다.
  if (container.contains(active) && !focusable.includes(active)) {
    event.preventDefault();
    event.stopPropagation();
    focusElementSafely(event.shiftKey ? last : first);
    return true;
  }
  if (!container.contains(active)) {
    event.preventDefault();
    event.stopPropagation();
    focusElementSafely(event.shiftKey ? last : first);
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    event.stopPropagation();
    focusElementSafely(last);
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    event.stopPropagation();
    focusElementSafely(first);
    return true;
  }
  return false;
}

function isMobileAssetsLayout() {
  return window.matchMedia?.('(max-width: 700px)').matches || window.innerWidth <= 700;
}

function scrollAssetViewerIntoView(viewerOrSidebar) {
  if (!isMobileAssetsLayout()) return;
  const root = typeof viewerOrSidebar === 'string'
    ? document.getElementById(viewerOrSidebar)?.closest('.assets-layout')
    : viewerOrSidebar?.closest?.('.assets-layout');
  const main = root?.querySelector('.assets-main');
  if (!main) return;
  setTimeout(() => {
    main.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, UI_TIMING_MS.focusFallback);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function finishInitialLoading() {
  const elapsed = performance.now() - appBootStartedAt;
  const remaining = Math.max(0, MIN_LOADING_SCREEN_MS - elapsed);
  if (remaining > 0) await wait(remaining);
  requestAnimationFrame(() => {
    document.body.classList.remove('js-loading');
  });
}

/* 이미지 URL 생성 헬퍼 */
const DEFAULT_OUTFIT_CODE = 'D';
const imgUrl = (code, emo) => `${BASE}/${code}/${DEFAULT_OUTFIT_CODE}/${emo}.webp`;
const nsfwImgUrl = (code, sit) => imgUrl(code, sit);
const cardImgUrl = code => imgUrl(code, '01');
const hasCharacterPortrait = c => !!c?.code &&
  !isCharacterAssetMissing(c, DEFAULT_OUTFIT_CODE, '01');
const cardImgAttrs = (c, alt) => {
  const src = cardImgUrl(c.code);
  return `src="${src}" alt="${escapeHTML(alt)}" width="832" height="1216" loading="lazy" decoding="async" sizes="(max-width: 640px) 320px, 240px"`;
};

function imageDimensionsForAsset(assetCode, url = '') {
  const code = String(assetCode || '');
  const source = String(url || '');

  /* 00(명함), 19(전투)는 가로형 에셋이다.
     width/height 힌트가 실제 비율과 어긋나면 상세 모달/라이트박스에서 CLS와 비율 왜곡이 생길 수 있다. */
  if (
    WIDE_EMOTION_ASSET_CODES.has(code) ||
    /\/D\/(?:00|19)\.webp(?:[?#].*)?$/.test(source)
  ) {
    return { width: 1216, height: 832 };
  }

  return { width: 832, height: 1216 };
}

function imageSizeAttrsForAsset(assetCode, url = '') {
  const { width, height } = imageDimensionsForAsset(assetCode, url);
  return `width="${width}" height="${height}"`;
}

function showImagePlaceholder(img, label = 'IMAGE MISSING') {
  if (!img) return;
  const wrap = img.closest?.('.char-card-img, .assets-char-item-img, .emo-asset-img, .nsfw-asset-img');
  if (!wrap || wrap.querySelector('.no-img')) return;

  img.hidden = true;
  wrap.classList.add('img-loaded', 'is-missing-image');

  const placeholder = document.createElement('div');
  placeholder.className = 'no-img';

  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '◌';

  const text = document.createElement('p');
  text.textContent = label;

  placeholder.append(mark, text);
  wrap.appendChild(placeholder);
}

function bindImageLoadState(img, wrap, { hideOnError = true } = {}) {
  if (!img || !wrap) return;

  const markLoaded = () => wrap.classList.add('img-loaded');
  if (img.complete && img.naturalWidth > 0) markLoaded();
  else img.addEventListener('load', markLoaded, { once: true });

  img.addEventListener('error', () => {
    markLoaded();
    if (hideOnError) showImagePlaceholder(img);
  }, { once: true });
}

/* ──────────────────────────────────────────────────
   ▶ 효과음 — Web Audio API, 외부 파일 없음
   크리스탈 링: 고음 사인파 두 음 짧게 겹치기
   첫 클릭 시 AudioContext 생성 (브라우저 autoplay 정책 대응)
────────────────────────────────────────────────── */
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playCrystalClick() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    /* 짧고 부드러운 UI 클릭음 */
    const notes = [
      { freq: 980,  delay: 0,     dur: 0.20, gain: 0.075 },
      { freq: 1320, delay: 0.025, dur: 0.16, gain: 0.045 },
    ];

    notes.forEach(({ freq, delay, dur, gain }) => {
      const osc  = ctx.createOscillator();
      const env  = ctx.createGain();
      /* 부드러운 배음 — 사인파 */
      osc.type      = 'sine';
      osc.frequency.value = freq;

      /* 어택 없이 즉시 → 지수 감쇠 */
      const t0 = ctx.currentTime + delay;
      env.gain.setValueAtTime(gain, t0);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.01);
    });
  } catch { /* 오디오 미지원 환경 무시 */ }
}

/* characters.json의 텍스트를 HTML에 안전하게 표시 */
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function normalizeSiteTerminology(value) {
  const stigmaToken = '__SITE_STIGMA_LABEL__';
  const sigmaToken = '__SITE_SIGMA_LABEL__';
  return String(value ?? '')
    .replace(/스티그마\s*\([Ϛϛ]\)/g, stigmaToken)
    .replace(/시그마 웨폰\s*(?:\(\s*Σ\s*\)|[=:]\s*Σ|`Σ`)/g, sigmaToken)
    .replace(/[Ϛϛ]/g, stigmaToken)
    .replace(/Σ/g, sigmaToken)
    .replaceAll(stigmaToken, '스티그마')
    .replaceAll(sigmaToken, '시그마 웨폰');
}

function escapeHTML(value) {
  return normalizeSiteTerminology(value).replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}

function textWithBreaks(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  return escapeHTML(text).replace(/\n/g, '<br>');
}

function splitListText(value) {
  return String(value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function debounce(fn, delay = 120) {
  let timer = null;
  return (...args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
}

function hasSpoilerIdentity(c) {
  return !!(c?.spoilerName && c.trueName && c.trueCode);
}

function makeSpoilerAssetEntry(c) {
  if (!hasSpoilerIdentity(c)) return null;
  const missingAssets = c.trueMissingAssets || {};
  const trueAge = Object.prototype.hasOwnProperty.call(c, 'trueAge') ? c.trueAge : c.age;
  return {
    ...c,
    code: c.trueCode,
    name: c.trueName,
    englishName: c.trueEnglishName || c.trueName,
    age: trueAge,
    species: c.trueSpecies || c.species,
    formalSpecies: c.trueFormalSpecies || c.formalSpecies,
    personality: c.truePersonality || c.personality,
    desc: c.trueDesc || c.desc,
    specialAbility: c.trueSpecialAbility || c.specialAbility,
    stigmaDescription: c.trueStigmaDescription || c.stigmaDescription,
    signatureAsset: c.trueSignatureAsset || c.signatureAsset,
    missingAssets,
    _missingAssets: normalizeMissingAssets(missingAssets),
    sourceCode: c.code,
    isSpoilerAsset: true,
  };
}

function assetCharacterList({ includeSpoilers = false } = {}) {
  if (!includeSpoilers) return appState.characters.filter(isPublicCharacter);
  const list = [];
  appState.characters.forEach(c => {
    if (c.spoilerOnly) {
      list.push({ ...c, isSpoilerAsset: true });
      return;
    }
    list.push(c);
    const spoilerEntry = makeSpoilerAssetEntry(c);
    if (spoilerEntry) list.push(spoilerEntry);
  });
  return list;
}

function rebuildCharacterMaps() {
  appState.characterByCode = new Map(appState.characters.filter(c => c.code && isPublicCharacter(c)).map(c => [c.code, c]));
  appState.assetCharacterByCode = new Map(
    assetCharacterList({ includeSpoilers: true })
      .filter(c => c?.code)
      .map(c => [c.code, c])
  );
}

function getAssetCharacter(code) {
  return appState.assetCharacterByCode.get(code) || null;
}

function getDisplayName(c, options = {}) {
  if (options.spoilerRevealed && hasSpoilerIdentity(c)) return c.trueName;
  return c?.name || '';
}

const CARD_NAME_FULL_LIMIT = 7;

function visibleNameLength(name = '') {
  return String(name).replace(/\s+/g, '').length;
}

function givenNameOnly(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[0] : String(name || '');
}

function getCardDisplayName(c) {
  const shortNames = {
    HB: '에르베스',
    FL: '플뢰르',
    AR: '아르브',
    CS: '카시안',
  };
  const name = shortNames[c?.code] || c?.name || '';
  return visibleNameLength(name) > CARD_NAME_FULL_LIMIT ? givenNameOnly(name) : name;
}

function setElementSearchDataset(element, character, displayName = '') {
  if (!element || !character) return;
  const meta = ensureCharacterSearchMeta(character, displayName);
  element.dataset.searchText = meta.text;
  element.dataset.searchCompact = meta.compact;
  element.dataset.searchCodes = meta.codes;
}

function isCardVisibleByFilters(card) {
  return card?.dataset?.globalSearchVisible !== '0'
    && card?.dataset?.studentFilterVisible !== '0';
}

function updateCardDisplayFromFilters(card) {
  if (!card) return;
  card.style.display = isCardVisibleByFilters(card) ? '' : 'none';
}

function setCardVisibilityFlag(card, flagName, visible) {
  if (!card || !flagName) return;
  card.dataset[flagName] = visible ? '1' : '0';
  updateCardDisplayFromFilters(card);
}

function restartElementFlash(el, timer = null, className = 'count-flash', duration = UI_TIMING_MS.countFlash) {
  if (!el) return timer;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  if (timer !== null) clearTimeout(timer);
  return setTimeout(() => {
    el.classList.remove(className);
  }, duration);
}

function makeTextElement(tagName, className, text) {
  const el = document.createElement(tagName);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function makeButtonElement({ className = '', text = '', type = 'button', onClick = null } = {}) {
  const btn = document.createElement('button');
  btn.type = type;
  if (className) btn.className = className;
  btn.textContent = text;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

function setRosterGroupCollapsed(section, collapsed, wrap = null) {
  if (!section) return;
  section.classList.toggle('is-collapsed', collapsed);
  section.querySelector('.roster-group-toggle')?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const body = section.querySelector('.roster-group-body');
  if (body) body.hidden = collapsed;
  if (wrap) wrap.style.maxHeight = '';
}

function rememberAndOpenRosterGroup(section, wrap, datasetKey = 'preSearchCollapsed') {
  if (!section) return;
  if (section.dataset[datasetKey] === undefined) {
    section.dataset[datasetKey] = section.classList.contains('is-collapsed') ? '1' : '0';
  }
  setRosterGroupCollapsed(section, false, wrap);
}

function restoreRememberedRosterGroup(section, wrap, datasetKey = 'preSearchCollapsed') {
  if (!section || section.dataset[datasetKey] === undefined) return;
  setRosterGroupCollapsed(section, section.dataset[datasetKey] === '1', wrap);
  delete section.dataset[datasetKey];
}

function bindSearchEvents(input, handler) {
  if (!input || !handler) return () => {};
  let composing = false;
  const onCompositionStart = () => { composing = true; };
  const onCompositionEnd = event => {
    composing = false;
    handler(event);
  };
  const onInput = event => {
    if (!composing) handler(event);
  };
  input.addEventListener('compositionstart', onCompositionStart);
  input.addEventListener('compositionend', onCompositionEnd);
  input.addEventListener('input', onInput);
  input.addEventListener('search', handler);
  return () => {
    input.removeEventListener('compositionstart', onCompositionStart);
    input.removeEventListener('compositionend', onCompositionEnd);
    input.removeEventListener('input', onInput);
    input.removeEventListener('search', handler);
  };
}

function isTypingField(target) {
  if (!(target instanceof Element)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]') ||
    !!target.closest('[contenteditable="true"]');
}

function gradeSearchLabel(c) {
  const grade = Number(c?.grade);
  return Number.isFinite(grade) && grade > 0 ? `${grade}학년` : '';
}

const ORG_SEARCH_LABELS = Object.freeze({
  ism: 'ism ISM 아카데미 academy',
  pbs: 'pbs 원혈회 pureblood society 적월극장 casino purered',
  hprf: 'hprf 인간보전전선 human preservation front',
  wf: 'wf 백색울타리 white fence',
  rtn: 'rtn 귀향파 return faction',
  nf: 'nf 무소속 언론 민간 GBN press civilian unaffiliated',
});

function orgSearchLabel(value) {
  const org = normalizeOrgValue(value);
  return ORG_SEARCH_LABELS[org] || '';
}

function characterSearchText(c, displayName = '') {
  return normalizeSearchText([
    displayName,
    c?.name,
    c?.englishName,
    c?.code,
    c?.trueName,
    c?.trueEnglishName,
    c?.trueCode,
    c?.species,
    c?.formalSpecies,
    c?.trueSpecies,
    c?.trueFormalSpecies,
    orgSearchLabel(c?.org || c?.affiliation || c?.organization || c?.faction || c?.group),
    c?.org,
    c?.affiliation,
    c?.organization,
    c?.faction,
    c?.group,
    gradeSearchLabel(c),
  ].filter(Boolean).join(' '));
}

function characterSearchCodes(c) {
  return [c?.code, c?.trueCode, c?.sourceCode]
    .map(normalizeCodeToken)
    .filter(Boolean)
    .join(' ');
}

function makeCharacterSearchMeta(c, displayName = '') {
  const text = characterSearchText(c, displayName || getCardDisplayName(c));
  return {
    text,
    compact: compactSearchText(text),
    codes: characterSearchCodes(c),
  };
}

function ensureCharacterSearchMeta(c, displayName = '') {
  if (!c) return { text: '', compact: '', codes: '' };
  if (!c._searchText || displayName) {
    const meta = makeCharacterSearchMeta(c, displayName);
    if (!displayName || displayName === getCardDisplayName(c)) {
      c._searchText = meta.text;
      c._searchCompact = meta.compact;
      c._searchCodes = meta.codes;
    }
    return meta;
  }
  return {
    text: c._searchText,
    compact: c._searchCompact || compactSearchText(c._searchText),
    codes: c._searchCodes || characterSearchCodes(c),
  };
}

function getDisplayCode(c, options = {}) {
  if (options.spoilerRevealed && hasSpoilerIdentity(c)) return c.trueCode;
  return c?.code || '';
}

function getDisplayEnglishName(c, options = {}) {
  if (options.spoilerRevealed && hasSpoilerIdentity(c)) {
    return c.trueEnglishName || c.trueName || '';
  }
  return c?.englishName || '';
}

function simplifySpeciesName(formalSpecies, fallbackSpecies = '') {
  const fallback = String(fallbackSpecies || '').trim();
  const formal = String(formalSpecies || '').trim();
  if (!formal) return fallback;

  let label = fallback && formal === `${fallback}종`
    ? fallback
    : formal.replace(/(?:아종|종)$/, '');
  if (label === '천사' && fallback === '천사족') return fallback;
  if (label.endsWith('수인')) {
    label = label.replace(/수인$/, ' 수인').replace(/\s+/g, ' ').trim();
  }
  return label || fallback;
}

function getDisplaySpecies(c, options = {}) {
  const spoilerIdentity = options.spoilerRevealed && hasSpoilerIdentity(c);
  const species = spoilerIdentity && c.trueSpecies ? c.trueSpecies : c?.species;
  const formalSpecies = spoilerIdentity && c.trueFormalSpecies
    ? c.trueFormalSpecies
    : c?.formalSpecies;
  return simplifySpeciesName(formalSpecies, species);
}

/* 명부 필터용 종족 대분류.
   카드와 상세에는 확정 종족명을 그대로 쓰고, 필터 버튼만 묶는다.
   세부 종족이 스무 개 가까이 되어 버튼이 필터 역할을 못 하기 때문이다.
   분류는 docs/세계관 의 계통(아인계·동물계·용린계·사령계·무정형계)을
   따르되, 사이트에서 쓰는 통칭으로 이름을 붙였다. */
const SPECIES_GROUPS = Object.freeze([
  ['수인', ['고양이 수인', '곰 수인', '늑대 수인', '토끼 수인', '박쥐 수인', '독수리 수인',
            '여우 수인', '산양 수인', '황소 수인', '흰 쥐 수인', '흑표범 수인', '수인']],
  ['하피', ['하피']],
  ['용족', ['백룡', '화룡', '라미아', '시로헤비', '용족']],
  ['흡혈귀', ['흡혈귀']],
  ['언데드', ['듀라한', '리치']],
  ['악마족', ['임프', '몽마']],
  ['천사족', ['천사', '천사족']],
  ['엘프', ['하이엘프', '우드엘프', '엘프']],
  ['요괴', ['설녀', '오니', '카라스텐구', '요호', '요괴']],
  ['슬라임', ['슬라임']],
  ['인간', ['인간']],
]);

const SPECIES_GROUP_ORDER = Object.freeze(SPECIES_GROUPS.map(([group]) => group));

const SPECIES_GROUP_BY_NAME = Object.freeze(
  SPECIES_GROUPS.reduce((map, [group, members]) => {
    members.forEach(member => { map[member] = group; });
    return map;
  }, {})
);

function speciesGroupOf(c, options = {}) {
  const label = String(getDisplaySpecies(c, options) || '').trim();
  if (!label) return '';
  if (SPECIES_GROUP_BY_NAME[label]) return SPECIES_GROUP_BY_NAME[label];
  // 표에 없는 새 종족은 수인 계열만 접미사로 흡수하고, 나머지는 그대로 둔다.
  if (label.endsWith('수인')) return '수인';
  return label;
}

function getDisplayPersonality(c, options = {}) {
  if (options.spoilerRevealed && hasSpoilerIdentity(c) && c.truePersonality) return c.truePersonality;
  return c?.personality || '';
}

function getDisplayDesc(c, options = {}) {
  if (options.spoilerRevealed && hasSpoilerIdentity(c) && c.trueDesc) return c.trueDesc;
  return c?.desc || '';
}

function withUnit(value, unit) {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (text.includes(unit)) return text;
  if (/^\d+(\.\d+)?$/.test(text)) return `${text}${unit}`;
  return text;
}

function appearanceSummary(c) {
  const parts = splitListText(c.desc);
  if (!parts.length) return '';

  // 2026-08-06에 컵 표기를 빈유·평유·거유·폭유로 바꿨다. 옛 표기도 함께 걸러 낸다.
  const cupPattern = /^(빈유|평유|거유|폭유|(AA|A|B|C|D|E|F\+|unknown)컵)$/i;
  const cupIndex = isMale(c)
    ? -1
    : parts.findIndex(part => cupPattern.test(part) || (c.cup && (part === c.cup || part === `${c.cup}컵`)));
  const appearanceParts = cupIndex >= 0 ? parts.slice(0, cupIndex) : parts;
  return appearanceParts.join(', ');
}

function detailInfoFields(c, { displaySpecies = '' } = {}) {
  const gradeOrRole = isStudent(c)
    ? ['학년', item => Number(item.grade) > 0 ? `${item.grade}학년` : '']
    : ['직책', item => item.role];
  const species = String(displaySpecies || c.species || '').trim();
  return [
    ['생일', item => item.birthday],
    ['나이', item => item.age],
    ['성별', item => item.gender],
    ['종족', () => species],
    ['신장', item => withUnit(item.height, 'cm')],
    ['체중', item => withUnit(item.weight, 'kg')],
    isFemale(c) ? ['가슴', item => item.cup] : null,
    ['MBTI', item => item.mbti],
    ['에니어그램', item => item.enneagram],
    gradeOrRole,
  ].filter(Boolean);
}

function detailStat(label, value) {
  if (!value || value === '-') return '';
  const roleClass = label === '직책' ? ' cdp-stat--role' : '';
  return `
      <div class="cdp-stat${roleClass}">
        <div class="cdp-stat-label">${escapeHTML(label)}</div>
        <div class="cdp-stat-val">${escapeHTML(value)}</div>
      </div>
    `;
}

function detailSection(label, value, extraClass = '') {
  if (!value) return '';
  const className = extraClass ? ` cdp-section--${extraClass}` : '';
  return `<div class="cdp-section${className}"><div class="cdp-section-label">${escapeHTML(label)}</div><div class="cdp-section-val">${textWithBreaks(value)}</div></div>`;
}

function detailTagSection(label, value, extraClass = '') {
  const tags = splitListText(value);
  if (!tags.length) return '';
  const className = extraClass ? ` cdp-section--${extraClass}` : '';
  const tagHTML = tags
    .map(tag => `<span class="cdp-tag">${escapeHTML(tag)}</span>`)
    .join('');
  return `<div class="cdp-section cdp-section--tag-list${className}"><div class="cdp-section-label">${escapeHTML(label)}</div><div class="cdp-tag-list">${tagHTML}</div></div>`;
}

function detailPowerSection(kind, value, description = '') {
  if (!value) return '';
  const isSigmaWeapon = kind === 'sigma';
  const label = isSigmaWeapon ? '시그마 웨폰' : '스티그마';
  const descriptionHTML = description
    ? `<div class="cdp-power-description">${textWithBreaks(description)}</div>`
    : '';

  return `
    <section class="cdp-power-section cdp-power-section--${isSigmaWeapon ? 'sigma' : 'stigma'}">
      <div class="cdp-power-heading">
        <div>
          <div class="cdp-power-label">${label}</div>
          <div class="cdp-power-name">${textWithBreaks(value)}</div>
        </div>
      </div>
      ${descriptionHTML}
    </section>
  `;
}

const COMPOUND_SURNAME_PREFIXES = new Set(['드', '반']);

function detailNameParts(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const surnameIndex = parts.findIndex((part, index) => (
    index > 0
    && index < parts.length - 1
    && COMPOUND_SURNAME_PREFIXES.has(part)
  ));

  if (surnameIndex < 0) return parts;
  return [...parts.slice(0, surnameIndex), parts.slice(surnameIndex).join(' ')];
}

function detailNameHTML(name) {
  return detailNameParts(name)
    .map(part => `<span class="cdp-profile-name-part">${escapeHTML(part)}</span>`)
    .join(' ');
}

function detailRecordSections(c, { displayDesc = '', displayPersonality = '', appearance = '', spoilerRevealed = false } = {}) {
  const sections = [
    detailPowerSection('stigma', c.specialAbility, c.stigmaDescription),
    detailPowerSection('sigma', c.sigmaWeapon, c.sigmaWeaponDescription),
    c.category === 'external' || spoilerRevealed ? detailSection('기록 설명', displayDesc, 'wide') : '',
    detailSection('외형 요약', appearance, 'wide'),
    detailSection('특기', c.ability),
    detailSection('성격 & 특성', displayPersonality),
    detailTagSection('좋아하는 것', c.likes, 'likes'),
    detailTagSection('싫어하는 것', c.dislikes, 'dislikes'),
  ];
  return sections.join('');
}

function normalizeDetailAssetCode(value, fallback = '02') {
  const text = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(text)) return fallback;
  return text.padStart(2, '0');
}

function detailAssetCandidates(character, requestedCode) {
  const candidates = [normalizeDetailAssetCode(requestedCode), '02', '01'];
  return [...new Set(candidates)].filter(assetCode =>
    !isCharacterAssetMissing(character, DEFAULT_OUTFIT_CODE, assetCode)
  );
}

function signatureTiltClass(code) {
  const checksum = String(code || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return checksum % 2 === 0 ? 'is-tilted-right' : 'is-tilted-left';
}

function detailImageSources({ code, displayCode, isSarielReveal, character }) {
  const usePortraitAsMain = isSarielReveal ||
    isCharacterAssetMissing(character, DEFAULT_OUTFIT_CODE, '00');
  const cardAssetCode = usePortraitAsMain ? '01' : '00';
  const signatureAssetCodes = detailAssetCandidates(character, character.signatureAsset);
  const signatureImageMissing = signatureAssetCodes.length === 0;
  const signatureAssetCode = signatureAssetCodes[0] || '01';
  const signatureFallbackSources = signatureAssetCodes
    .slice(1)
    .map(assetCode => imgUrl(displayCode, assetCode));
  if (isSarielReveal) signatureFallbackSources.push(imgUrl(code, '01'));
  return {
    cardAssetCode,
    portraitAssetCode: '01',
    cardImgSrc: usePortraitAsMain
      ? imgUrl(usePortraitAsMain && isSarielReveal ? displayCode : code, '01')
      : imgUrl(displayCode, '00'),
    portraitImgSrc: imgUrl(displayCode, '01'),
    fallbackPortraitImgSrc: imgUrl(code, '01'),
    signatureAssetCode,
    signatureImgSrc: imgUrl(displayCode, signatureAssetCode),
    signatureFallbackSources: [...new Set(signatureFallbackSources)],
    signatureImageMissing,
    signatureTiltClass: signatureTiltClass(displayCode),
  };
}

/* Navigation */
window.getISMCurrentSection = () => appState.navigation.currentSection;
window.getISMCurrentDetailCode = () => appState.detail.currentCode;

function normalizeCharacterFilters(filters = {}) {
  const scope = CHARACTER_SCOPES.includes(filters.scope) ? filters.scope : 'all';
  const grades = [...new Set((filters.grades || [])
    .map(Number)
    .filter(grade => Number.isInteger(grade) && KNOWN_GRADES.includes(grade)))]
    .sort((a, b) => a - b);
  const species = [...new Set((filters.species || [])
    .map(value => String(value).trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  return {
    q: String(filters.q || ''),
    scope,
    grades,
    species,
  };
}

function currentCharacterFilters() {
  const previous = normalizeCharacterFilters(appState.navigation.characterFilters);
  const searchContext = appState.navigation.characterSearchContext;
  const studentContext = appState.navigation.studentFilterContext;
  return normalizeCharacterFilters({
    q: searchContext?.searchTerm ?? previous.q,
    scope: searchContext?.activeScope ?? previous.scope,
    grades: studentContext ? [...studentContext.activeGrades] : previous.grades,
    species: studentContext ? [...studentContext.activeSpecies] : previous.species,
  });
}

window.ISMAppDiagnostics = Object.freeze({
  // 화면에 실제로 그려지는 목록을 돌려준다. 스포일러를 켜면 그 인물까지 포함되며,
  // 검사는 이 수와 카드 수가 맞을 때 렌더가 끝난 것으로 본다.
  getCharacters: () => rosterCharacterList(),
  getCurrentDetailCode: () => appState.detail.currentCode,
  getCurrentNsfwCode: () => appState.gallery.currentNsfwCode,
  getRosterGroupKey: character => getRosterGroupKey(character),
  focusableElementsWithin: container => focusableElementsWithin(container),
  trapTabFocus: (event, container) => trapTabFocus(event, container),
  openCharacterDetail: (code, skipTransition, options) => openCharDetail(code, skipTransition, options),
  closeCharacterDetail: options => closeCharDetail(options),
  selectEmotionCharacter: (code, element, options) => selectEmoChar(code, element, options),
  selectNsfwCharacter: (code, element, options) => selectNsfwChar(code, element, options),
  rebuildEmotionSidebar: () => buildEmoSidebar(),
  nsfwAssetsFor: code => nsfwAssetsFor(code),
  isCharacterAssetMissing: (character, outfitCode, assetCode) =>
    isCharacterAssetMissing(character, outfitCode, assetCode),
  detailAssetCandidates: (character, requestedCode) => detailAssetCandidates(character, requestedCode),
  getCharacterFilters: () => currentCharacterFilters(),
  defaultOutfitCode: DEFAULT_OUTFIT_CODE,
});

function writeHistoryState(state, mode = 'push') {
  if (!appState.navigation.historyReady || appState.navigation.isApplyingHistory) return;
  const characterFilters = normalizeCharacterFilters(
    state.characterFilters ?? currentCharacterFilters()
  );
  const normalized = {
    section: SECTION_IDS.includes(state.section) ? state.section : 'main',
    detail: state.detail || null,
    lightbox: !!state.lightbox,
    lightboxUrl: state.lightboxUrl || null,
    lightboxLabel: state.lightboxLabel || '',
    lightboxAssets: normalizeLightboxAssets(state.lightboxAssets),
    lightboxIndex: Number.isInteger(state.lightboxIndex) ? state.lightboxIndex : -1,
    characterFilters,
  };
  const suffix = normalized.detail ? `/${encodeURIComponent(normalized.detail)}` : '';
  const lightboxSuffix = normalized.lightbox ? '/lightbox' : '';
  const params = new URLSearchParams();
  if (normalized.section === 'characters') {
    if (characterFilters.q) params.set('q', characterFilters.q);
    if (characterFilters.scope !== 'all') params.set('scope', characterFilters.scope);
    characterFilters.grades.forEach(grade => params.append('grade', String(grade)));
    characterFilters.species.forEach(species => params.append('species', species));
  }
  if (normalized.lightbox) {
    if (normalized.lightboxUrl) params.set('src', normalized.lightboxUrl);
    if (normalized.lightboxLabel) params.set('label', normalized.lightboxLabel);
  }
  const query = params.toString();
  const url = `#${normalized.section}${suffix}${lightboxSuffix}${query ? `?${query}` : ''}`;
  history[mode === 'replace' ? 'replaceState' : 'pushState'](normalized, '', url);
}

function applyHistoryState(state) {
  appState.navigation.isApplyingHistory = true;
  const next = state || { section: 'main', detail: null, lightbox: false };
  const section = SECTION_IDS.includes(next.section) ? next.section : 'main';
  const previousSection = appState.navigation.currentSection;
  appState.navigation.characterFilters = normalizeCharacterFilters(next.characterFilters);

  scrollToSection(section, { history: false, closeOverlays: false, instant: true });
  applyCharacterFilterStateToUI(appState.navigation.characterFilters);

  if (next.detail) {
    openCharDetail(next.detail, true);
  } else {
    closeCharDetail({ history: false, restoreFocus: section === previousSection });
  }

  if (next.lightbox && next.lightboxUrl) {
    openLightbox(next.lightboxUrl, next.lightboxLabel || '', {
      history: false,
      assets: next.lightboxAssets,
      index: next.lightboxIndex,
    });
  } else {
    closeLightbox({ history: false, restoreFocus: section === previousSection });
  }

  appState.navigation.isApplyingHistory = false;
}

function scrollToSection(id, options = {}) {
  const targetId = SECTION_IDS.includes(id) ? id : 'main';
  const shouldWriteHistory = options.history !== false;
  const historyMode = options.replaceHistory ? 'replace' : 'push';
  const target = document.getElementById(`section-${targetId}`);

  /* 열린 오버레이/라이트박스 먼저 닫기 */
  if (options.closeOverlays !== false) {
    closeLightbox({ history: false, restoreScroll: false, restoreFocus: false });
    closeCharDetail({ history: false, restoreScroll: false, restoreFocus: false });
  }

  activateSection(targetId);
  appState.navigation.currentSection = targetId;
  if (targetId === 'gallery') ensureGalleryPrepared();

  if (target) {
    const targetTop = target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: options.instant || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
    target.classList.add('is-scroll-visible');
  }

  if (shouldWriteHistory) {
    writeHistoryState({ section: targetId, detail: null, lightbox: false }, historyMode);
  }
}

/* 세계관은 한 번에 한 장만 편다. 여덟을 한 줄기로 펼쳐 두었더니 구간 하나가
   8000px가 되어 어디가 어디인지 알 수 없었다. 대신 잃는 것이 둘 있다 —
   숨은 일곱 장은 Ctrl+F로 찾히지 않고, 무엇이 있는지 탭 이름으로만 알 수 있다.
   그래서 탭 이름을 항목 그대로 두고 여덟 개를 모두 한 화면에 보이게 한다.

   한 장만 보이므로 시맨틱은 목차가 아니라 탭이다. aria-selected와 로빙
   tabindex를 쓰고, 화살표로 옮긴다. */
function markActiveWorldTocEntry(panelId, options = {}) {
  const root = document.getElementById('section-world');
  if (!root) return;
  root.querySelectorAll('[data-world-panel-target]').forEach(button => {
    const active = button.dataset.worldPanelTarget === panelId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    // 로빙 tabindex — 탭 묶음은 Tab 한 번으로 들어오고 나간다.
    button.tabIndex = active ? 0 : -1;
    if (active && options.focusTab) button.focus({ preventScroll: true });
  });
}

function showOnlyWorldPanel(root, panelId) {
  root.querySelectorAll('.world-panel').forEach(panel => {
    const active = panel.id === panelId;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
    panel.inert = !active;
  });
}

function activateWorldPanel(panelId, options = {}) {
  const root = document.getElementById('section-world');
  const targetPanel = document.getElementById(panelId);
  if (!root || !targetPanel?.classList.contains('world-panel')) return false;

  showOnlyWorldPanel(root, panelId);
  markActiveWorldTocEntry(panelId, options);

  if (options.scrollPanel) {
    // 탭이 화면 위에 붙어 있어야 다음 항목을 바로 고를 수 있다. 패널이 아니라
    // 탭 줄을 기준으로 맞춘다.
    const anchor = root.querySelector('.world-index') || targetPanel;
    requestAnimationFrame(() => anchor.scrollIntoView({
      block: 'start',
      behavior: options.instant || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    }));
  }
  return true;
}

/* ──────────────────────────────────────────────────
   ▶ 열람 색인 (Ctrl/⌘ + K)
   ISM은 기록을 관리하는 기관이고 이 사이트는 그 기록을 읽는 곳이다.
   색인은 그 설정을 조작으로 옮긴 것으로, 인물·섹션·세계관 패널을
   한 입력창에서 찾아 기존 해시 라우팅으로 이동시킨다.
────────────────────────────────────────────────── */
const PALETTE_SECTIONS = Object.freeze([
  { id: 'main', label: '메인', sub: '섹션' },
  { id: 'factions', label: '세력 소개', sub: '섹션' },
  { id: 'world', label: '세계관', sub: '섹션' },
  { id: 'schedule', label: '일정', sub: '섹션' },
  { id: 'characters', label: '캐릭터 명부', sub: '섹션' },
]);

/* 갤러리는 구간이 아니라 별도 페이지가 됐지만 색인에서 빠지면 안 된다.
   이 사이트에서 무언가를 찾는 사람은 그것이 같은 문서에 있는지 다른 문서에
   있는지를 알 이유가 없다. */
const PALETTE_PAGES = Object.freeze([
  { href: './gallery.html', label: '인물 에셋 갤러리', sub: '페이지' },
]);

const PALETTE_ORG_NAMES = Object.freeze({
  ism: 'ISM 아카데미',
  pbs: '원혈회',
  hprf: '인간보전전선',
  wf: '백색울타리',
  rtn: '귀향파',
  nf: '무소속',
});

/* 아카데미가 이 사이트의 본체이므로 동점일 때 먼저 나온다. */
function paletteWeight(character) {
  const category = getCharCategory(character);
  if (category === 'student') return 0;
  if (category === 'staff') return 1;
  return 2;
}

function paletteCharacterSub(c) {
  const org = getCharacterOrg(c);
  const species = getDisplaySpecies(c);
  const standing = isStudent(c) ? gradeLabel(c) : PALETTE_ORG_NAMES[org] || '';
  return [standing, species].filter(Boolean).join(' · ');
}

function buildPaletteEntries() {
  const entries = [];
  let order = 0;

  appState.characters.filter(isPublicCharacter).forEach(c => {
    if (!c?.code) return;
    const label = getCardDisplayName(c);
    const meta = ensureCharacterSearchMeta(c, label);
    entries.push({
      id: `character:${c.code}`,
      kind: 'character',
      code: getDisplayCode(c),
      label,
      sub: paletteCharacterSub(c),
      accent: idAccentColorForCharacter(c),
      target: c.code,
      weight: paletteWeight(c),
      order: order++,
      search: {
        label: normalizeSearchText(label),
        text: meta.text,
        compact: meta.compact,
        codes: String(meta.codes || '').split(' ').filter(Boolean),
      },
    });
  });

  PALETTE_SECTIONS.forEach(section => {
    entries.push({
      id: `section:${section.id}`,
      kind: 'section',
      code: '',
      label: section.label,
      sub: section.sub,
      accent: 'var(--gold2)',
      target: section.id,
      weight: 3,
      order: order++,
      search: {
        label: normalizeSearchText(section.label),
        text: normalizeSearchText(`${section.label} ${section.id}`),
        compact: compactSearchText(section.label),
        codes: [],
      },
    });
  });

  PALETTE_PAGES.forEach(page => {
    entries.push({
      id: `page:${page.href}`,
      kind: 'page',
      code: '',
      label: page.label,
      sub: page.sub,
      accent: 'var(--gold2)',
      target: page.href,
      weight: 3,
      order: order++,
      search: {
        label: normalizeSearchText(page.label),
        text: normalizeSearchText(`${page.label} gallery 갤러리 에셋`),
        compact: compactSearchText(page.label),
        codes: [],
      },
    });
  });

  document.querySelectorAll('#section-world [data-world-panel-target]').forEach(tab => {
    const label = tab.textContent.trim();
    if (!label) return;
    entries.push({
      id: `world:${tab.dataset.worldPanelTarget}`,
      kind: 'world',
      code: '',
      label,
      sub: '세계관',
      accent: 'var(--gold)',
      target: tab.dataset.worldPanelTarget,
      weight: 4,
      order: order++,
      search: {
        label: normalizeSearchText(label),
        text: normalizeSearchText(`${label} world 세계관`),
        compact: compactSearchText(label),
        codes: [],
      },
    });
  });

  return entries;
}

function setupCommandPalette() {
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const palette = createCommandPalette({
    reducedMotionQuery,
    normalizeText: normalizeSearchText,
    compactText: compactSearchText,
    getEntries: buildPaletteEntries,
    onOpen: () => lockPageScroll('command-palette'),
    onClose: () => unlockPageScroll('command-palette'),
    onSelect: entry => {
      if (entry.kind === 'character') {
        openCharDetail(entry.target);
        return;
      }
      if (entry.kind === 'world') {
        activateWorldPanel(entry.target);
        scrollToSection('world');
        return;
      }
      if (entry.kind === 'page') {
        window.location.href = entry.target;
        return;
      }
      scrollToSection(entry.target);
    },
  });
  if (!palette) return null;

  document.addEventListener('keydown', event => {
    if (event.key !== 'k' && event.key !== 'K') return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.altKey) return;
    event.preventDefault();
    palette.toggle();
  });

  return palette;
}

function setupWorldLoreTabs(root = document.getElementById('section-world')) {
  if (!root) return;
  const tabs = [...root.querySelectorAll('[data-world-panel-target]')];
  if (!tabs.length) return;

  tabs.forEach((button, index) => {
    if (button.dataset.worldTabBound === '1') return;
    button.dataset.worldTabBound = '1';
    button.addEventListener('click', () => {
      activateWorldPanel(button.dataset.worldPanelTarget, { scrollPanel: true });
    });
    // 탭 묶음의 표준 조작 — 좌우로 옮기고, Home/End로 양 끝으로 간다.
    button.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      let next = null;
      if (step) next = tabs[(index + step + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs.at(-1);
      if (!next) return;
      event.preventDefault();
      activateWorldPanel(next.dataset.worldPanelTarget, { focusTab: true });
    });
  });

  const first = tabs.find(tab => tab.classList.contains('active')) || tabs[0];
  showOnlyWorldPanel(root, first.dataset.worldPanelTarget);
  markActiveWorldTocEntry(first.dataset.worldPanelTarget);
}

/* 이미지 복사 방지. CSS가 드래그와 길게 누르기를 막고, 여기서 오른쪽 클릭
   메뉴와 드래그 시작을 막는다. 완전한 보호는 아니다 — 개발자 도구로는
   언제든 가져갈 수 있다. 무심코 끌어다 저장하는 경로만 닫는 울타리다.
   이미지 위에서만 막는다. 페이지 전체의 오른쪽 클릭을 막으면 "뒤로 가기"나
   "새 탭에서 열기" 같은 정상적인 조작까지 함께 사라진다. */
function bindImageCopyGuard() {
  const isProtectedImage = target =>
    target?.tagName === 'IMG' || (target?.closest?.('picture') && target.tagName === 'IMG');

  document.addEventListener('contextmenu', event => {
    if (isProtectedImage(event.target)) event.preventDefault();
  });

  document.addEventListener('dragstart', event => {
    if (isProtectedImage(event.target)) event.preventDefault();
  });
}

/* 좁은 화면의 접이식 색인.

   점 6개를 44px 터치 크기로 늘 펼쳐 두면 60×286px, 화면의 15%×34%를 차지한다.
   그것이 화면 세로 한가운데 떠 있어서 모든 구간에서 본문을 덮었고, 세계관 목차·
   초기화·소속 선택처럼 눌러야 하는 것까지 가렸다. 평소에는 단추 하나로 접어
   두고 필요할 때만 펼친다. 넓은 화면은 그대로 둔다 — 가릴 것이 없다. */
function bindScrollIndexToggle() {
  const rail = document.querySelector('.scroll-index');
  const toggle = rail?.querySelector('.scroll-index-toggle');
  if (!rail || !toggle) return;

  const setOpen = open => {
    rail.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '페이지 색인 닫기' : '페이지 색인 열기');
  };

  toggle.addEventListener('click', event => {
    event.stopPropagation();
    setOpen(!rail.classList.contains('is-open'));
  });

  // 구간을 고르면 볼일이 끝났으므로 접는다.
  rail.addEventListener('click', event => {
    if (event.target.closest('.scroll-index-dot')) setOpen(false);
  });

  document.addEventListener('click', event => {
    if (!rail.contains(event.target)) setOpen(false);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && rail.classList.contains('is-open')) setOpen(false);
  });
}

/* 접힌 단추에 "지금 몇 번째 구간인지"를 적어 준다. 펼치지 않아도 위치를 알 수
   있어야 접어 둔 것이 손해가 아니다. */
function updateScrollIndexToggleCount() {
  const rail = document.querySelector('.scroll-index');
  const count = rail?.querySelector('.scroll-index-toggle-count');
  if (!count) return;
  const dots = [...rail.querySelectorAll('.scroll-index-dot')];
  const index = dots.findIndex(dot => dot.classList.contains('active'));
  count.textContent = index === -1 ? '' : `${index + 1}/${dots.length}`;
}

function bindStaticEvents() {
  bindImageCopyGuard();
  bindScrollIndexToggle();
  setupCardHoverPanelDirection();
  setupWorldLoreTabs();
  bindNavigationEvents({ navigate: scrollToSection });

  const characterSection = document.getElementById('section-characters');
  characterSection?.addEventListener('click', event => {
    const card = event.target.closest('.char-card[data-code]');
    if (!card) return;
    // A tabindex card is not focused consistently by synthetic/pointer clicks in every browser.
    // Focus it explicitly so modal close can restore focus to the exact opener.
    focusElementSafely(card);
    playCrystalClick();
    openCharDetail(card.dataset.code, false, { returnFocus: card, spoilerRevealed: card.dataset.spoilerRevealed === 'true' });
  });
  characterSection?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.char-card[data-code]');
    if (!card) return;
    event.preventDefault();
    focusElementSafely(card);
    playCrystalClick();
    openCharDetail(card.dataset.code, false, { returnFocus: card, spoilerRevealed: card.dataset.spoilerRevealed === 'true' });
  });

  document.querySelectorAll('.org-select-card[data-org]').forEach(btn => {
    btn.addEventListener('click', () => switchCharacterOrg(btn.dataset.org));
  });
  updateCharacterSectionBackground(document.querySelector('.org-select-card.active')?.dataset.org || 'ism');
  setupRosterGroupToggles(document);

  document.querySelectorAll('.assets-sub-btn[data-assets-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchAssetsTab(btn.dataset.assetsTab, btn));
  });

  document.getElementById('char-detail-overlay')?.addEventListener('click', requestCloseCharDetail);

  document.querySelectorAll('[data-detail-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.detail.navigate?.(Number(btn.dataset.detailNav));
    });
  });

  document.querySelector('[data-lightbox-close]')?.addEventListener('click', requestCloseLightbox);
  document.querySelectorAll('[data-lightbox-nav]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      navigateLightbox(Number(btn.dataset.lightboxNav));
    });
  });
}

/* ▶ world-you 페이드인 — WORLD 탭 진입 시 트리거 */
const wyObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    e.target.classList.toggle('visible', e.isIntersecting);
  });
}, { threshold: 0.2 });

/* ──────────────────────────────────────────────────
   ▶ CHARACTERS — 조직 명부 전환
────────────────────────────────────────────────── */
function applyCharacterOrgSwitch(org) {
  document.querySelectorAll('.org-roster').forEach(panel => panel.classList.remove('active'));
  document.querySelectorAll('.org-select-card').forEach(card => {
    const active = card.dataset.org === org;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('org-' + org)?.classList.add('active');
  updateCharacterSectionBackground(org);
}

function switchCharacterOrg(org) {
  const section = document.getElementById('section-characters');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!section || reducedMotion) {
    applyCharacterOrgSwitch(org);
    return;
  }

  window.clearTimeout(appState.organizationTransitionTimer);
  section.classList.add('is-org-transitioning');
  appState.organizationTransitionTimer = window.setTimeout(() => {
    applyCharacterOrgSwitch(org);
    window.requestAnimationFrame(() => section.classList.remove('is-org-transitioning'));
  }, UI_TIMING_MS.organizationTransition);
}

function updateCharacterSectionBackground(org = 'ism') {
  const section = document.getElementById('section-characters');
  if (!section) return;

  section.classList.remove('char-bg-academy', 'char-bg-civilian', 'char-bg-external');
  if (org === 'external') {
    section.classList.add('char-bg-external');
  } else {
    section.classList.add('char-bg-academy');
  }
}

function setupRosterGroupToggles(root = document) {
  root.querySelectorAll('.roster-group-toggle').forEach(button => {
    const group = button.closest('.roster-group');
    if (!group) return;
    setRosterGroupCollapsed(group, group.classList.contains('is-collapsed'));
    if (button.dataset.toggleBound === '1') return;
    button.dataset.toggleBound = '1';

    button.addEventListener('click', () => {
      setRosterGroupCollapsed(group, !group.classList.contains('is-collapsed'));
    });
  });
}

function setupFactionWordmarkFallbacks(root = document) {
  function showFallback(img) {
    if (img.getAttribute('src')) {
      img.dataset.brokenSrc = img.getAttribute('src');
      img.removeAttribute('src');
    }
    img.hidden = true;
    img.closest('.roster-group-title--wordmark')?.classList.add('wordmark-failed');
  }

  root.querySelectorAll('.faction-wordmark').forEach(img => {
    if (img.dataset.wordmarkFallbackBound === '1') return;
    img.dataset.wordmarkFallbackBound = '1';
    img.addEventListener('error', () => showFallback(img));
    if (img.complete && img.naturalWidth === 0) showFallback(img);
  });
}

/* ──────────────────────────────────────────────────
   ▶ 캐릭터 카드 생성
   c: characters.json의 캐릭터 객체
   isDummy: 더미 카드 여부 (WIP 표시)
────────────────────────────────────────────────── */
function expandRosterGroupForCharacter(c) {
  const org = getCharacterOrg(c);
  const topOrg = org === 'ism' ? 'ism' : 'external';
  switchCharacterOrg(topOrg);

  const key = getRosterGroupKey(c);
  const group = document.querySelector(`.roster-group[data-roster-group="${key}"]`);
  if (!group) return;

  setRosterGroupCollapsed(group, false);
}

function emotionAssetDisplayName(emotion) {
  return emotion?.name || '';
}

function emotionAssetCardClass(emotion) {
  return WIDE_EMOTION_ASSET_CODES.has(emotion?.code) ? 'emo-asset-card--wide' : '';
}

function nsfwAssetsFor(code) {
  const char = appState.characterByCode.get(code);
  return isNsfwEligibleCharacter(char)
    ? NSFW_FULL_ASSET_SET
    : EMPTY_ASSET_SET;
}

function hasRestrictedNsfwPoseSpecies(c) {
  const species = String(c?.species || c?.trueSpecies || '').trim();
  return NSFW_POSE_RESTRICTED_SPECIES.some(name => species.includes(name));
}

function gradeLabel(c) {
  if (!isStudent(c)) return '';
  const grade = Number(c.grade);
  if (grade >= 1) return `${grade}학년`;
  return '';
}

const KNOWN_GRADES = [1, 2, 3];
const GRADE_COLORS = { 1: 'var(--grade1)', 2: 'var(--grade2)', 3: 'var(--grade3)' };
const GRADE_NAMES = { 1: '1학년', 2: '2학년', 3: '3학년' };

const getGradeColor = grade => GRADE_COLORS[grade] || 'var(--silver2)';
const getGradeName = grade => GRADE_NAMES[grade] || `${grade}학년`;

function seededCardRotation(seed = '') {
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 999;
  return (normalized * 5 - 2.5).toFixed(2);
}

function seededTilt(seed = '', range = 0.8) {
  const str = String(seed || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 999;
  return (normalized * range * 2 - range).toFixed(2);
}

/* 명부 카드의 좌측 구조선 색.
   아카데미는 학년(넥타이) 색을, 외부 인물은 소속 세력의 고유색을 쓴다.
   두 체계가 같은 자리를 나눠 써서 명부를 훑을 때 소속이 색으로 먼저 읽힌다. */
const ORG_ACCENT_COLORS = Object.freeze({
  ism: 'var(--navy-accent)',
  pbs: 'var(--faction-pbs-accent)',
  hprf: 'var(--faction-hprf-accent)',
  wf: 'var(--faction-wf-accent)',
  rtn: 'var(--faction-rtn-accent)',
  nf: 'var(--faction-nf-accent)',
});

function idAccentColorForCharacter(c) {
  if (isStudent(c)) {
    const grade = Number(c.grade);
    return GRADE_COLORS[grade] || 'var(--grade0)';
  }
  if (getCharCategory(c) === 'staff') return 'var(--navy-accent)';
  return ORG_ACCENT_COLORS[getCharacterOrg(c)] || 'var(--gold2)';
}

function civilianPinColorForCharacter(c) {
  return getCharCategory(c) === 'civilian' || getCharCategory(c) === 'external' ? 'var(--gold)' : 'var(--navy-accent)';
}

function makeGradeBadge(c) {
  const label = gradeLabel(c);
  if (!label) return '';

  const gradeNumber = Number(c.grade);
  if (KNOWN_GRADES.includes(gradeNumber)) {
    return `<span class="badge badge-grade${gradeNumber}">${escapeHTML(label)}</span>`;
  }

  return `<span class="badge badge-grade-fallback">${escapeHTML(label)}</span>`;
}

function makeCategoryBadge(c) {
  const category = getCharCategory(c);
  if (category === 'student' || category === 'staff') return '';
  const label = CATEGORY_LABELS[category] || category;
  return `<span class="badge badge-category badge-category-${escapeHTML(category)}">${escapeHTML(label)}</span>`;
}

function setupCardHoverPanelDirection(root = document) {
  root.addEventListener('pointerover', event => {
    const card = event.target.closest('.char-card');
    if (!card || card.contains(event.relatedTarget)) return;

    const rect = card.getBoundingClientRect();
    const panel = card.querySelector('.char-hover-card');
    if (!panel) return;
    const panelWidth = panel?.offsetWidth || 180;
    const gap = 16;
    const safeRight = window.innerWidth - 12;
    const overflowRight = rect.right + panelWidth + gap > safeRight;
    card.classList.toggle('hover-panel-left', overflowRight);
  });
}

function safeObjectPosition(value, fallback) {
  const position = String(value || '').trim();
  const token = '(?:left|center|right|top|bottom|(?:100|[0-9]{1,2})%)';
  const pattern = new RegExp(`^${token}(?:\\s+${token})?$`, 'i');
  return pattern.test(position) ? position : fallback;
}

function safeCardImageScale(value, fallback = 1) {
  const scale = Number(value);
  return Number.isFinite(scale) ? Math.min(Math.max(scale, 1), 1.5) : fallback;
}

function characterCardViewModel(c, isDummy = false, index = 0) {
  /* 스포일러가 켜져 있고 정체가 따로 있는 인물이면 카드도 그 정체로 선다.
     정 실바노 카드가 사리엘이 되는 자리다. 코드·종족·에셋이 함께 바뀌므로
     그리기용 인물을 따로 잡고, 데이터셋과 클릭 경로는 원래 코드를 유지한다. */
  const spoilerRevealed = appState.spoilers.revealed && hasSpoilerIdentity(c);
  const displayCode = getDisplayCode(c, { spoilerRevealed });
  const displayCharacter = spoilerRevealed ? (getAssetCharacter(displayCode) || c) : c;
  const category = getCharCategory(c);
  const org = getCharacterOrg(c);
  const cardName = getCardDisplayName(spoilerRevealed ? { ...displayCharacter, code: displayCode } : c);
  const seed = c.code || `${c.name || 'unknown'}-${index}`;
  const cardRotation = category === 'civilian' || category === 'external'
    ? Number(seededCardRotation(seed))
    : 0;
  const idTilt = category === 'student' || category === 'staff'
    ? Number(seededTilt(seed, 0.8))
    : 0;

  return { category, org, cardName, seed, cardRotation, idTilt, spoilerRevealed, displayCode, displayCharacter };
}

function applyCharacterCardFrame(div, c, vm) {
  div.className = `char-card char-card--${vm.category}`;
  if (vm.org) div.classList.add(`char-card--org-${vm.org}`);
  div.style.setProperty('--card-rotate', `${vm.cardRotation.toFixed(2)}deg`);
  div.style.setProperty('--paper-rotate', `${(vm.cardRotation * -0.38).toFixed(2)}deg`);
  div.style.setProperty('--id-tilt', `${vm.idTilt.toFixed(2)}deg`);
  div.style.setProperty('--id-accent', idAccentColorForCharacter(c));
  div.style.setProperty('--pin-color', civilianPinColorForCharacter(c));
  div.style.setProperty('--portrait-position', safeObjectPosition(c.cardPosition, '50% 0%'));
  div.style.setProperty('--portrait-scale', String(safeCardImageScale(c.cardScale)));
  div.style.setProperty('--hover-portrait-position', safeObjectPosition(c.hoverPortraitPosition, '50% 15%'));
}

function applyCharacterCardDataset(div, c, cardName) {
  if (!c?.code) return;
  div.dataset.code = c.code;
  if (c.name) div.dataset.name = c.name;
  const speciesLabel = getDisplaySpecies(c);
  if (speciesLabel) div.dataset.species = speciesLabel;
  const speciesGroup = speciesGroupOf(c);
  if (speciesGroup) div.dataset.speciesGroup = speciesGroup;
  if (c.grade !== undefined && c.grade !== null && c.grade !== '') div.dataset.grade = c.grade;
  div.dataset.category = getCharCategory(c);
  div.dataset.org = getCharacterOrg(c);
  setElementSearchDataset(div, c, cardName);
}

function dummyCardHTML(c, vm) {
  const fileLabel = vm.category === 'civilian' ? 'OBSERVATION NOTE' : 'ARCHIVE RECORD';
  const headBrand = vm.category === 'civilian' ? fileLabel : 'EXTERNAL FILE';
  const headLabel = fileLabel;
  const speciesBadge = `<span class="badge badge-species">${escapeHTML(getDisplaySpecies(c) || '미정')}</span>`;

  return `
    <div class="char-card-id-head">
      <span>${escapeHTML(headBrand)}</span>
      <b>${escapeHTML(headLabel)}</b>
    </div>
    <div class="char-card-img">
      <div class="no-img"><span>◌</span><p>ARCHIVE</p></div>
    </div>
    <div class="char-card-info">
      <div class="char-card-code">${escapeHTML(characterCardCodeLine(c, vm))}</div>
      <div class="char-card-name" title="${escapeHTML(c.name || '')}">${escapeHTML(vm.cardName || '???')}</div>
      <div class="char-badges">
        ${speciesBadge}
      </div>
    </div>
  `;
}

function characterRecordLabel(org) {
  const orgRecordLabels = {
    pbs: 'PBS RECORD',
    hprf: 'HPRF RECORD',
    wf: 'WHITE FENCE',
    rtn: 'RETURNIST FILE',
    nf: 'UNAFFILIATED',
  };
  return orgRecordLabels[org] || 'EXTERNAL FILE';
}

/* 명함 머리글의 아랫줄. 윗줄이 발급 주체라면 아랫줄은 "이게 무슨 증서인가"다.
   아카데미가 ISM ACADEMY + ACADEMY ID CARD로 짝을 이루는데 외부 인물만 같은
   말을 두 번 찍고 있었다. 세력마다 실제로 발급할 법한 증서 이름을 준다.
   원혈회는 상세 명함 그림에 이미 "Membership card"라고 적혀 있어 그대로 맞췄다. */
function characterDocumentLabel(org) {
  const orgDocumentLabels = {
    pbs: 'MEMBERSHIP CARD',
    hprf: 'CREDENTIAL',
    wf: 'FIELD PERMIT',
    rtn: 'CONTACT CARD',
    nf: 'PRESS PASS',
  };
  return orgDocumentLabels[org] || 'OBSERVATION NOTE';
}

/* 명함 에셋(00)이 없는 인물은 명함 틀을 씌우지 않는다. 미피는 서류상 존재하지
   않는 아랫마을 출신이고, 아자키엘과 사리엘은 기록에서 지워졌거나 애초에 없다.
   없는 증서의 이름을 찍는 대신 발급된 것이 없다는 사실을 그대로 적는다.
   머플·타우로스처럼 명함이 있어야 하는데 파일만 빠진 경우와 섞이므로,
   판단 기준은 세력이 아니라 에셋의 실제 유무다. */
function hasIdentityCard(c) {
  return !isCharacterAssetMissing(c, DEFAULT_OUTFIT_CODE, '00');
}

function characterCardHeader(c, vm) {
  const isAcademy = vm.category === 'student' || vm.category === 'staff';
  // 카드 폭이 좁아 라벨은 한 단어로 둔다. NO CREDENTIAL은 CREDENTIAL이 줄에 안 들어가 잘렸다.
  if (!hasIdentityCard(c)) return { headBrand: 'UNREGISTERED', headLabel: 'UNISSUED' };
  const headBrand = isAcademy ? 'ISM ACADEMY' : characterRecordLabel(vm.org);
  const headLabel = isAcademy ? 'ACADEMY ID CARD' : characterDocumentLabel(vm.org);

  return { headBrand, headLabel };
}

function characterCardSubline(c) {
  const speciesLabel = getDisplaySpecies(c);
  return speciesLabel ? `<span>${escapeHTML(speciesLabel)}</span>` : '';
}

function setCharacterDetailOverlayState(isOpen) {
  document.body.classList.toggle('char-detail-open', isOpen);
  document.getElementById('section-characters')?.classList.toggle('detail-overlay-open', isOpen);
}

function characterCardCodeLine(c, vm) {
  const code = vm.displayCode || c.code || 'Record';
  if (vm.org === 'nf' && c.affiliation === 'GBN') return `GBN · ${code}`;
  const org = (vm.org || '').toUpperCase();
  return org && org !== 'ISM' ? `${org} · ${code}` : code;
}

function characterHoverCardConfig(c, vm) {
  const speciesLabel = getDisplaySpecies(c);
  if (vm.org === 'ism') {
    return {
      skin: 'ism',
      organization: 'ISM ACADEMY',
      document: 'ACADEMY ID',
      role: vm.category === 'student' ? `${gradeLabel(c)} 아카데미생` : (c.role || '아카데미 직원'),
      meta: [['SPECIES', speciesLabel || '미정'], ['CODE', c.code || '']]
    };
  }
  if (vm.org === 'pbs') {
    return {
      skin: 'pbs',
      organization: 'PUREBLOOD SOCIETY',
      document: 'MEMBERSHIP RECORD',
      role: c.role || '회원 기록',
      meta: [['SPECIES', speciesLabel || '미정'], ['CODE', c.code || '']]
    };
  }
  if (vm.org === 'hprf') {
    return {
      skin: 'hprf',
      organization: 'HUMAN PRESERVATION FRONT',
      document: 'EXECUTIVE CREDENTIAL',
      role: c.role || '공식 기록',
      meta: [['CODE', c.code || ''], ['STATUS', c.species === '인간' ? 'HUMAN' : (speciesLabel || 'PUBLIC')]]
    };
  }
  if (vm.org === 'wf') {
    return {
      skin: 'wf',
      organization: 'WHITE FENCE',
      document: 'FIELD IDENTIFICATION TAG',
      role: c.role || 'FIELD OPERATIVE',
      meta: [['SPECIES', speciesLabel || 'UNLISTED'], ['CODE', c.code || '']]
    };
  }
  if (vm.org === 'nf' && c.hoverCardType === 'press') {
    return {
      skin: 'press',
      organization: c.affiliation || 'PRESS',
      document: 'FIELD REPORTER',
      role: c.role || '기록자',
      meta: [['SPECIES', speciesLabel || '미정'], ['CODE', c.code || '']]
    };
  }
  return {
    skin: 'archive',
    organization: characterRecordLabel(vm.org),
    document: 'OBSERVATION NOTE',
    role: c.role || '외부 인물',
    meta: [['SPECIES', speciesLabel || '미정'], ['CODE', c.code || '']]
  };
}

function hoverPortraitHTML(c) {
  if (!hasCharacterPortrait(c)) {
    return '<div class="char-hover-portrait is-missing" aria-hidden="true"><span>◌</span></div>';
  }
  return `
    <div class="char-hover-portrait">
      <img src="${cardImgUrl(c.code)}" alt="" width="832" height="1216" loading="lazy" decoding="async">
    </div>`;
}

function characterHoverCardHTML(c, vm) {
  const config = characterHoverCardConfig(c, vm);
  const organizationClass = config.skin === 'pbs' ? ' char-hover-organization--wordmark' : '';
  const metaRows = config.meta.map(([label, value]) => `
    <div class="char-hover-meta-row">
      <span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong>
    </div>`).join('');
  return `
    <div class="char-card-hover-overlay char-hover-card char-hover-card--${config.skin}" aria-hidden="true">
      <div class="char-hover-kicker"><span class="char-hover-organization${organizationClass}">${escapeHTML(config.organization)}</span><b>${escapeHTML(config.document)}</b></div>
      <div class="char-hover-card-head">
        ${hoverPortraitHTML(c)}
        <div class="char-hover-primary">
          <div class="char-hover-name">${escapeHTML(vm.cardName)}</div>
          <div class="char-hover-role">${escapeHTML(config.role)}</div>
        </div>
      </div>
      <div class="char-hover-meta">${metaRows}</div>
    </div>`;
}

function realCardHTML(c, vm) {
  const shown = vm.displayCharacter || c;
  const hasCardImage = hasCharacterPortrait(shown);
  const gradeBadge = makeGradeBadge(c);
  const categoryBadge = makeCategoryBadge(c);
  const { headBrand, headLabel } = characterCardHeader(shown, vm);

  return `
    <div class="char-card-id-head">
      <span>${escapeHTML(headBrand)}</span>
      <b>${escapeHTML(headLabel)}</b>
    </div>
    <div class="char-card-img" id="cimg-${c.code}">
      ${hasCardImage
        ? `<img ${cardImgAttrs(shown, vm.cardName)}>`
        : '<div class="no-img"><span>◌</span><p>ARCHIVE</p></div>'}
    </div>
    <div class="char-card-info">
      <div class="char-card-code">${escapeHTML(characterCardCodeLine(shown, vm))}</div>
      <div class="char-card-name" title="${escapeHTML(shown.name || '')}">${escapeHTML(vm.cardName)}</div>
      <div class="char-card-subline">${characterCardSubline(shown)}</div>
      <!-- STATUS 행과 종족 배지는 지웠다. 둘 다 카드 안에서 같은 사실을 두 번
           말하고 있었다 — STATUS는 학년·소속 배지와 같은 값이고, 종족 배지는
           바로 윗줄 subline과 똑같이 getDisplaySpecies(c)를 쓴다.
           카드 하나에서 약 60px이 빠지고 잃는 정보는 없다. -->
      <div class="char-badges">${categoryBadge}${gradeBadge}</div>
    </div>
    ${characterHoverCardHTML(c, vm)}
  `;
}

function makeCharCard(c, isDummy = false, index = 0) {
  const div = document.createElement('div');
  const vm = characterCardViewModel(c, isDummy, index);
  applyCharacterCardFrame(div, c, vm);
  if (!isDummy) applyCharacterCardDataset(div, c, vm.cardName);

  if (!isDummy) {
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', `${vm.cardName || c.name} 상세 보기`);
    if (vm.spoilerRevealed) div.dataset.spoilerRevealed = 'true';
  }

  div.innerHTML = isDummy ? dummyCardHTML(c, vm) : realCardHTML(c, vm);

  if (!isDummy) {
    const img = div.querySelector('img');
    const imgWrap = div.querySelector('.char-card-img');
    bindImageLoadState(img, imgWrap);
    bindHoverPortraitFallback(div);
  }

  return div;
}

function bindHoverPortraitFallback(card) {
  const portrait = card.querySelector('.char-hover-portrait');
  const image = portrait?.querySelector('img');
  if (!portrait || !image) return;

  const showFallback = () => {
    if (portrait.classList.contains('is-missing')) return;
    markMissingAssetUrl(image.currentSrc || image.src);
    portrait.classList.add('is-missing');
    image.remove();
    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '◌';
    portrait.appendChild(mark);
  };

  if (image.complete && image.naturalWidth === 0) showFallback();
  else image.addEventListener('error', showFallback, { once: true });
}

function makeCharCardSafely(c, isDummy = false, index = 0) {
  try {
    return makeCharCard(c, isDummy, index);
  } catch (error) {
    console.error('캐릭터 카드 렌더링 실패:', c?.code || c?.name || 'unknown', error);
    const fallback = document.createElement('div');
    fallback.className = 'char-card char-card--external';
    fallback.innerHTML = `
      <div class="char-card-id-head"><span>ARCHIVE RECORD</span><b>RENDER ERROR</b></div>
      <div class="char-card-img"><div class="no-img"><span>◌</span><p>ARCHIVE</p></div></div>
      <div class="char-card-info">
        <div class="char-card-code">RECORD</div>
        <div class="char-card-name">기록을 표시할 수 없습니다.</div>
      </div>
    `;
    return fallback;
  }
}


function applyCardRenderTiming(card, index) {
  card.dataset.index = index;
  card.style.setProperty('--card-delay', `${Math.min(index * 45, 720)}ms`);
}

/* ──────────────────────────────────────────────────
   ▶ 캐릭터 상세 오버레이
   code: 캐릭터 코드 (예: 'YU', 'SH')
   새 필드(weight, mbti, gender)도 자동 표시됩니다.
────────────────────────────────────────────────── */
function detailViewModel(code, options = {}) {
  /* 스포일러 인물은 공개 지도(characterByCode)에 없다. 토글을 켠 뒤에만 찾는다 —
     주소로 코드를 직접 넣어도 토글이 꺼져 있으면 열리지 않는다. */
  const c = appState.characterByCode.get(code)
    || (appState.spoilers.revealed ? appState.characters.find(x => x.code === code && x.spoilerOnly) : null);
  if (!c) return null;

  const spoilerRevealed = !!options.spoilerRevealed && hasSpoilerIdentity(c);
  const detailDisplay = { spoilerRevealed };
  const displayName = getDisplayName(c, detailDisplay);
  const displayEnglishName = getDisplayEnglishName(c, detailDisplay);
  const displayCode = getDisplayCode(c, detailDisplay);
  const displaySpecies = getDisplaySpecies(c, detailDisplay);
  const displayPersonality = getDisplayPersonality(c, detailDisplay);
  const displayDesc = getDisplayDesc(c, detailDisplay);
  const isSarielReveal = spoilerRevealed && displayCode === 'SR';
  const displayCharacter = spoilerRevealed ? (getAssetCharacter(displayCode) || c) : c;
  const displayOrg = getCharacterOrg(c);
  const appearance = c.category === 'external' ? '' : appearanceSummary(c);
  const metaParts = [
    displayCode,
    displaySpecies,
    Number(c.grade) > 0 ? `${c.grade}학년` : (c.role || null),
  ].filter(Boolean).map(escapeHTML).join(' · ');
  const infoRows = detailInfoFields(displayCharacter, { displaySpecies })
    .map(([label, getValue]) => detailStat(label, getValue(displayCharacter)))
    .join('');
  const detailSections = detailRecordSections(displayCharacter, {
    displayDesc,
    displayPersonality,
    appearance,
    spoilerRevealed,
  });
  const imageSources = detailImageSources({ code, displayCode, isSarielReveal, character: displayCharacter });
  const detailImageMissing =
    ['00', '01'].every(assetCode => isCharacterAssetMissing(displayCharacter, DEFAULT_OUTFIT_CODE, assetCode)) ||
    missingDetailImageCodes.has(displayCode);

  return {
    c,
    code,
    spoilerRevealed,
    displayName,
    displayEnglishName,
    displayCode,
    displaySpecies,
    displayPersonality,
    displayDesc,
    isSarielReveal,
    displayOrg,
    appearance,
    metaParts,
    infoRows,
    detailSections,
    ...imageSources,
    detailImageMissing,
  };
}

function renderDetailContentHTML(vm) {
  const mainSrcAttr = vm.detailImageMissing ? '' : ` src="${vm.cardImgSrc}"`;
  const signatureSrcAttr = vm.signatureImageMissing ? '' : ` src="${vm.signatureImgSrc}"`;
  const mainSizeAttrs = imageSizeAttrsForAsset(vm.cardAssetCode, vm.cardImgSrc);
  const signatureSizeAttrs = imageSizeAttrsForAsset(vm.signatureAssetCode, vm.signatureImgSrc);
  const missingAttr = vm.detailImageMissing ? ' hidden' : '';
  const themeClass = ['ism', 'pbs', 'hprf', 'wf', 'rtn', 'nf'].includes(vm.displayOrg)
    ? vm.displayOrg
    : 'nf';
  const englishName = vm.displayEnglishName && vm.displayEnglishName !== vm.displayName
    ? `<div class="cdp-profile-english-name cdp-reveal cdp-reveal--name">${escapeHTML(vm.displayEnglishName)}</div>`
    : '';
  const spoilerButton = hasSpoilerIdentity(vm.c)
    ? `<button class="cdp-spoiler-toggle${vm.spoilerRevealed ? ' is-revealed' : ''}" type="button" data-spoiler-toggle aria-pressed="${vm.spoilerRevealed ? 'true' : 'false'}">
        ${vm.spoilerRevealed ? '거짓된 모습' : '진실의 모습(스포일러)'}
      </button>`
    : '';
  const sarielWarning = vm.isSarielReveal
    ? `<div class="cdp-identity-seal" aria-hidden="true">
        <span>CLASSIFIED RECORD</span>
        <strong>IDENTITY REVEALED</strong>
      </div>`
    : '';

  return `
    <article class="character-profile-page character-profile-page--${themeClass}${vm.isSarielReveal ? ' is-sariel-reveal' : ''}">
      <section class="cdp-page cdp-page--business-card" aria-label="${escapeHTML(vm.displayName)} 명함">
        <div class="cdp-page-controls">
          <button class="cdp-back" type="button">← 목록으로</button>
        </div>

        <div class="cdp-business-card-stage${vm.detailImageMissing ? ' is-missing-image' : ''}" id="cdp-img-panel">
          <img id="cdp-main-img" class="cdp-business-card-image"${mainSrcAttr} ${mainSizeAttrs} alt="${escapeHTML(vm.displayName)} 명함 이미지" loading="eager" fetchpriority="high" decoding="async"${missingAttr}>
          <span class="cdp-image-placeholder" aria-hidden="true">기록 이미지 준비 중</span>
          ${sarielWarning}
        </div>
        <button class="cdp-scroll-guide" type="button" aria-label="프로필 정보로 스크롤">
          <span aria-hidden="true">⌄</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </section>

      <section class="cdp-page cdp-page--profile" data-detail-profile-page>
        <div class="cdp-profile-inner">
          <div class="cdp-profile-hero">
            <header class="cdp-profile-heading">
              <div class="cdp-profile-meta cdp-reveal cdp-reveal--meta">${vm.metaParts}</div>
              <h1 class="cdp-profile-name cdp-reveal cdp-reveal--name">${detailNameHTML(vm.displayName)}</h1>
              ${englishName}
              ${vm.c.quote ? `
              <blockquote class="cdp-profile-quote cdp-reveal cdp-reveal--quote">
                ${textWithBreaks(vm.c.quote)}
              </blockquote>` : ''}
              <div class="cdp-profile-actions cdp-reveal cdp-reveal--quote">
                ${spoilerButton}
                <button class="cdp-assets-btn" type="button">갤러리로 이동 →</button>
              </div>
            </header>

            <figure class="cdp-signature-asset ${vm.signatureTiltClass} cdp-reveal cdp-reveal--signature${vm.signatureImageMissing ? ' is-missing-image' : ''}">
              <img id="cdp-signature-img"${signatureSrcAttr} ${signatureSizeAttrs} alt="${escapeHTML(vm.displayName)} 시그니처 표정" loading="eager" decoding="async"${vm.signatureImageMissing ? ' hidden' : ''}>
              <span class="cdp-image-placeholder" aria-hidden="true">시그니처 이미지 준비 중</span>
              <figcaption>Signature · ${escapeHTML(vm.displayCode)}</figcaption>
            </figure>
          </div>

          ${(vm.infoRows || vm.detailSections) ? `
          <div class="cdp-profile-information cdp-reveal cdp-reveal--information">
            ${vm.infoRows ? `<div class="cdp-stat-grid">${vm.infoRows}</div>` : ''}
            ${vm.detailSections ? `<div class="cdp-sections">${vm.detailSections}</div>` : ''}
          </div>` : ''}

          ${vm.c.tmi ? `
          <aside class="cdp-profile-tmi cdp-reveal cdp-reveal--tmi">
            <div class="cdp-tmi-label">TMI</div>
            <div class="cdp-tmi-body">${textWithBreaks(vm.c.tmi)}</div>
          </aside>` : ''}
        </div>
      </section>
    </article>
  `;
}

function bindDetailContentEvents(contentEl, vm) {
  contentEl.querySelector('.cdp-back')?.addEventListener('click', requestCloseCharDetail);
  setupDetailScrollFeedback(contentEl);
  contentEl.querySelector('.cdp-assets-btn')?.addEventListener('click', () => goToCharAssets(vm.spoilerRevealed ? vm.displayCode : vm.code));
  contentEl.querySelector('[data-spoiler-toggle]')?.addEventListener('click', event => {
    event.stopPropagation();
    openCharDetail(vm.code, true, { spoilerRevealed: !vm.spoilerRevealed });
  });
  bindDetailImageFallbacks(contentEl, vm);
}

function cleanupDetailScrollFeedback() {
  appState.detail.scrollController?.dispose();
  appState.detail.scrollController = null;
}

function moveDetailToProfilePage() {
  const modal = document.getElementById('char-detail');
  if (!modal?.classList.contains('open')) return false;
  return appState.detail.scrollController?.moveToProfile() || false;
}

function setupDetailScrollFeedback(contentEl) {
  cleanupDetailScrollFeedback();
  const modal = document.getElementById('char-detail');
  const guide = contentEl.querySelector('.cdp-scroll-guide');
  const profilePage = contentEl.querySelector('[data-detail-profile-page]');
  if (!modal || !guide || !profilePage) return;

  appState.detail.scrollController = createDetailScrollController({
    modal,
    profilePage,
    guide,
    reduceMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  });
}

function bindDetailImageFallbacks(contentEl, vm) {
  const mainImg = contentEl.querySelector('#cdp-main-img');
  if (mainImg) {
    const mainFallbacks = [...new Set([vm.portraitImgSrc, vm.fallbackPortraitImgSrc])]
      .filter(src => src && src !== vm.cardImgSrc);
    mainImg.addEventListener('error', () => {
      const nextSrc = mainFallbacks.shift();
      if (nextSrc) {
        const { width, height } = imageDimensionsForAsset(vm.portraitAssetCode, vm.portraitImgSrc);
        mainImg.width = width;
        mainImg.height = height;
        mainImg.src = nextSrc;
      } else {
        missingDetailImageCodes.add(vm.displayCode);
        mainImg.hidden = true;
        contentEl.querySelector('.cdp-business-card-stage')?.classList.add('is-missing-image');
      }
    });
  }

  const signatureImg = contentEl.querySelector('#cdp-signature-img');
  const signatureFrame = signatureImg?.closest('.cdp-signature-asset');
  if (signatureImg && signatureFrame) {
    const fallbacks = [...vm.signatureFallbackSources];
    signatureImg.addEventListener('error', () => {
      const nextSrc = fallbacks.shift();
      if (nextSrc) {
        signatureImg.width = 832;
        signatureImg.height = 1216;
        signatureImg.src = nextSrc;
        return;
      }
      signatureImg.hidden = true;
      signatureFrame.classList.add('is-missing-image');
    });
  }
}

function openCharDetail(code, skipTransition = false, options = {}) {
  const vm = detailViewModel(code, options);
  if (!vm) return;
  if (appState.navigation.currentSection === 'characters') expandRosterGroupForCharacter(vm.c);

  const modalEl = document.getElementById('char-detail');
  const overlayEl = document.getElementById('char-detail-overlay');
  const contentEl = document.getElementById('cdp-content');
  if (!modalEl || !overlayEl || !contentEl) return;

  const wasOpen = modalEl.classList.contains('open');
  if (!wasOpen) {
    const requestedReturnFocus = options.returnFocus;
    modalEl._returnFocus = requestedReturnFocus instanceof HTMLElement
      ? requestedReturnFocus
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  if (appState.detail.closeTimer) {
    clearTimeout(appState.detail.closeTimer);
    appState.detail.closeTimer = null;
  }
  modalEl.classList.remove('closing');
  overlayEl.classList.remove('closing');
  appState.detail.currentCode = code;

  cleanupDetailScrollFeedback();
  contentEl.innerHTML = renderDetailContentHTML(vm);
  bindDetailContentEvents(contentEl, vm);
  modalEl.scrollTop = 0;
  contentEl.scrollTop = 0;

  modalEl.inert = false;
  modalEl.classList.add('open');
  modalEl.setAttribute('aria-hidden', 'false');
  overlayEl.classList.add('open');
  setCharacterDetailOverlayState(true);
  if (!wasOpen) setPageInteractionLock('char-detail', true);
  lockPageScroll('char-detail');
  if (!wasOpen) {
    focusFirstWithin(modalEl, '.cdp-back');
    scheduleFocusWithin(modalEl, '.cdp-back');
  }
  writeHistoryState(
    { section: appState.navigation.currentSection, detail: code, lightbox: false },
    wasOpen || skipTransition ? 'replace' : 'push'
  );

  renderDetailRosterRail();

  requestAnimationFrame(() => {
    modalEl.scrollTop = 0;
  });
}

/* 갤러리 페이지로 이동 + 해당 인물 선택.
   갤러리가 별도 문서가 되었으므로 같은 페이지 안에서 스크롤하는 대신 주소로
   넘긴다. 해시에 코드를 실어 보내면 그쪽에서 받아 그 인물을 펼친다. */
function goToCharAssets(code) {
  closeCharDetail({ history: false, restoreScroll: false, restoreFocus: false });
  setTimeout(() => {
    window.location.href = `./gallery.html#${encodeURIComponent(code)}`;
  }, UI_TIMING_MS.detailClose + 24);
}

function closeCharDetail(options = {}) {
  const modal = document.getElementById('char-detail');
  const overlay = document.getElementById('char-detail-overlay');
  if (!modal || !overlay || !modal.classList.contains('open')) {
    setCharacterDetailOverlayState(false);
    return;
  }
  modal.classList.add('closing');
  cleanupDetailScrollFeedback();
  overlay.classList.add('closing');
  overlay.classList.remove('open');
  if (appState.detail.closeTimer) clearTimeout(appState.detail.closeTimer);
  appState.detail.closeTimer = setTimeout(() => {
    modal.classList.remove('open', 'closing');
    modal.setAttribute('aria-hidden', 'true');
    modal.inert = true;
    overlay.classList.remove('closing');
    unlockPageScroll('char-detail', { restore: options.restoreScroll !== false });
    setPageInteractionLock('char-detail', false);
    appState.detail.currentCode = null;
    appState.detail.closeTimer = null;
    setCharacterDetailOverlayState(false);
    if (options.restoreFocus !== false && modal._returnFocus?.isConnected) {
      restoreOverlayFocus(modal._returnFocus);
    }
    modal._returnFocus = null;
  }, UI_TIMING_MS.detailClose);
  if (options.history !== false) {
    writeHistoryState({ section: appState.navigation.currentSection, detail: null, lightbox: false });
  }
}

function requestCloseCharDetail() {
  const state = history.state;
  if (appState.navigation.historyReady && state?.detail && !state?.lightbox) {
    // Start the close transition immediately; history restoration may arrive later on CI/slow devices.
    closeCharDetail({ history: false });
    history.back();
    return;
  }
  closeCharDetail();
}

/* ──────────────────────────────────────────────────
   ▶ GALLERY — 서브탭 전환
────────────────────────────────────────────────── */
function switchAssetsTab(tab, btn) {
  ensureGalleryPrepared();
  document.querySelectorAll('.assets-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.assets-sub-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('assets-' + tab);
  if (!panel) return;
  panel.classList.add('active');
  if (btn) btn.classList.add('active');

  if (!appState.gallery.currentAssetCode) return;
  const char = appState.characterByCode.get(appState.gallery.currentAssetCode);
  if (tab === 'nsfw' && !isNsfwEligibleCharacter(char)) {
    resetAssetSelection('all');
    return;
  }
  if (tab === 'nsfw') selectNsfwChar(appState.gallery.currentAssetCode, null, { force: true });
  else selectEmoChar(appState.gallery.currentAssetCode, null, { force: true });
}

/* ──────────────────────────────────────────────────
   ▶ GALLERY — 감정 에셋 사이드바 & 뷰어
────────────────────────────────────────────────── */


/* ──────────────────────────────────────────────────
   ▶ GALLERY — 사이드바 공통 빌더
   emo/nsfw 사이드바가 구조가 동일하므로 헬퍼로 통합
   (라벨 유지 → 비우기 → 캐릭터 목록 순회 → 카드 생성)
────────────────────────────────────────────────── */
const { buildAssetSidebar, setAssetSidebarActive } = createGallerySidebarTools({
  getCardDisplayName,
  setElementSearchDataset,
  cardImgAttrs,
  bindImageLoadState,
  escapeHTML,
  getCharacterOrg,
  accentColorFor: idAccentColorForCharacter,
  scrollAssetViewerIntoView,
  exactCodeSearchToken,
  elementMatchesSearch,
  debounce,
  bindSearchEvents,
  assetSearchDebounce: UI_TIMING_MS.assetSearchDebounce,
  makeButtonElement,
  makeTextElement,
  getCurrentAssetCode: () => appState.gallery.currentAssetCode,
});

function buildEmoSidebar() {
  buildAssetSidebar(
    document.getElementById('emo-sidebar'),
    assetCharacterList({ includeSpoilers: appState.spoilers.revealed }),
    selectEmoChar,
    {
      spoilersRevealed: appState.spoilers.revealed,
      onToggleSpoilers: () => {
        setSpoilersRevealed(!appState.spoilers.revealed);
        const currentEntry = getAssetCharacter(appState.gallery.currentEmotionCode);
        if (!appState.spoilers.revealed && currentEntry?.isSpoilerAsset) {
          appState.gallery.currentEmotionCode = null;
          appState.gallery.currentAssetCode = null;
          const viewer = document.getElementById('emo-viewer');
          if (viewer) viewer.innerHTML = '<div class="assets-empty">스포일러 기록을 숨겼습니다.</div>';
        }
        buildEmoSidebar();
      },
    }
  );
}

function resetAssetSelection(tab = 'all') {
  if (tab === 'all') appState.gallery.currentAssetCode = null;
  if (tab === 'all' || tab === 'emotions') {
    appState.gallery.currentEmotionCode = null;
    document.querySelectorAll('#emo-sidebar .assets-char-item').forEach(t => t.classList.remove('active'));
    const viewer = document.getElementById('emo-viewer');
    if (viewer) viewer.innerHTML = '<div class="assets-empty">위 명단에서 인물을 선택하세요.</div>';
  }
  if (tab === 'all' || tab === 'nsfw') {
    appState.gallery.currentNsfwCode = null;
    document.querySelectorAll('#nsfw-sidebar .assets-char-item').forEach(t => t.classList.remove('active'));
    const viewer = document.getElementById('nsfw-viewer');
    if (viewer) viewer.innerHTML = '<div class="assets-empty">위 명단에서 인물을 선택하세요.</div>';
  }
}

function renderAssetViewer(viewerId, { title, subtitle, gridClass, items, cardClass, imageClass, labelClass, makeUrl, makeAlt, makeLabel, makeLightboxLabel, makeCardClass, onOpen }) {
  const viewer = document.getElementById(viewerId);
  if (!viewer) return;
  viewer._assetOpen = onOpen;
  if (viewer.dataset.assetViewerBound !== '1') {
    viewer.dataset.assetViewerBound = '1';
    viewer.addEventListener('click', event => {
      const card = event.target.closest('.emo-asset-card, .nsfw-asset-card');
      if (!card || !viewer.contains(card)) return;
      const index = Number(card.dataset.assetIndex);
      const item = viewer._assetItems?.[index];
      const entry = viewer._assetLightboxItems?.[index];
      const url = entry?.url || card.dataset.assetUrl;
      if (!item || !url || card.dataset.assetUnavailable === '1') return;
      // Keep a deterministic return-focus target for the lightbox.
      focusElementSafely(card);
      viewer._assetOpen?.(item, url, index, viewer, entry, card);
    });
  }

  viewer.innerHTML = `
    <div class="assets-viewer-header">
      <span class="assets-viewer-title">${escapeHTML(title)}</span>
      <span class="assets-viewer-subtitle">${escapeHTML(subtitle)}</span>
    </div>
    <div class="${gridClass}"></div>
  `;

  const grid = viewer.querySelector(`.${gridClass}`);
  viewer._assetItems = items;
  viewer._assetLightboxItems = items.map(item => ({
    url: makeUrl(item),
    label: makeLightboxLabel ? makeLightboxLabel(item) : makeAlt(item),
    alt: makeAlt(item),
  }));
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const entry = viewer._assetLightboxItems[index];
    const url = entry.url;
    const knownMissing = isMissingAssetUrl(url);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = [cardClass, makeCardClass?.(item) || '', knownMissing ? 'broken' : '']
      .filter(Boolean)
      .join(' ');
    card.dataset.assetIndex = String(index);
    card.dataset.assetUrl = url;
    if (item?.code) card.dataset.assetCode = item.code;
    card.innerHTML = `
      <div class="${imageClass}">
        ${knownMissing
          ? '<div class="no-img"><span>◌</span><p>MISSING</p></div>'
          : `<img src="${url}" ${imageSizeAttrsForAsset(item?.code, url)} alt="${escapeHTML(entry.alt)}" loading="lazy" decoding="async">`}
      </div>
      <div class="${labelClass}">${makeLabel(item)}</div>
    `;
    const img = card.querySelector('img');
    bindImageLoadState(img, card.querySelector(`.${imageClass}`), { hideOnError: false });
    img?.addEventListener('error', () => {
      markMissingAssetUrl(url);
      card.dataset.assetUnavailable = '1';
      card.classList.add('broken');
    }, { once: true });
    fragment.appendChild(card);
  });
  grid.appendChild(fragment);
}

async function selectEmoChar(code, el, options = {}) {
  appState.gallery.currentAssetCode = code;
  setAssetSidebarActive('#emo-sidebar', code);
  setAssetSidebarActive('#nsfw-sidebar', code);
  if (!options.force && appState.gallery.currentEmotionCode === code && document.querySelector('#emo-viewer .assets-viewer-header')) return;
  appState.gallery.currentEmotionCode = code;
  const char = getAssetCharacter(code);
  const name = char ? getCardDisplayName(char) : code;
  const hiddenForMale = ['13', '14', '15', '17', '18'];
  const visibleEmotions = EMOTIONS.filter(e =>
    e.code !== '00' &&
    !isCharacterAssetMissing(char, DEFAULT_OUTFIT_CODE, e.code) &&
    !(isMale(char) && hiddenForMale.includes(e.code))
  );

  renderAssetViewer('emo-viewer', {
    title: name,
    subtitle: `감정 에셋 · ${visibleEmotions.length}종`,
    gridClass: 'emo-asset-grid',
    items: visibleEmotions,
    cardClass: 'emo-asset-card',
    imageClass: 'emo-asset-img',
    labelClass: 'emo-asset-name',
    makeUrl: e => imgUrl(code, e.code),
    makeAlt: e => emotionAssetDisplayName(e),
    makeLabel: e => escapeHTML(emotionAssetDisplayName(e)),
    makeLightboxLabel: e => emotionAssetDisplayName(e),
    makeCardClass: emotionAssetCardClass,
    onOpen: (e, url, index, viewer, entry, returnFocus) => openLightbox(url, entry?.label || emotionAssetDisplayName(e), {
      assets: viewer._assetLightboxItems,
      index,
      returnFocus,
    }),
  });

}

/* ──────────────────────────────────────────────────
   ▶ GALLERY — NSFW 에셋 사이드바 & 뷰어
────────────────────────────────────────────────── */
function buildNsfwSidebar() {
  buildAssetSidebar(
    document.getElementById('nsfw-sidebar'),
    appState.characters.filter(c => isPublicCharacter(c) && isNsfwEligibleCharacter(c)),
    selectNsfwChar
  );
}

function ensureGalleryPrepared() {
  if (appState.gallery.prepared || !appState.characters.length) return;
  buildEmoSidebar();
  buildNsfwSidebar();
  appState.gallery.prepared = true;
  selectFirstGalleryCharacter();
}

/* 갤러리에 들어오면 곧바로 에셋이 보이게 첫 인물을 잡아 준다. 예전에는
   소속을 펼치고 인물을 고르기 전까지 화면이 비어 있어, 무엇을 보는 곳인지
   알 수 없었다. 이미 고른 인물이 있으면 그대로 둔다. */
function selectFirstGalleryCharacter() {
  if (appState.gallery.currentAssetCode) return;
  const first = document.querySelector('#emo-sidebar .assets-org-group:not(.is-collapsed) .assets-char-item[data-code]');
  if (!first) return;
  selectEmoChar(first.dataset.code, first, { force: true });
}

async function selectNsfwChar(code, el, options = {}) {
  const char = appState.characterByCode.get(code);
  if (!isNsfwEligibleCharacter(char)) {
    resetAssetSelection('all');
    return;
  }
  appState.gallery.currentAssetCode = code;
  setAssetSidebarActive('#emo-sidebar', code);
  setAssetSidebarActive('#nsfw-sidebar', code);
  if (!options.force && appState.gallery.currentNsfwCode === code && document.querySelector('#nsfw-viewer .assets-viewer-header')) return;
  appState.gallery.currentNsfwCode = code;
  const name = char ? getCardDisplayName(char) : code;
  const hasAnchorAsset = !isCharacterAssetMissing(char, DEFAULT_OUTFIT_CODE, '101') &&
    await hasAvailableAsset(nsfwImgUrl(code, '101'));
  if (appState.gallery.currentNsfwCode !== code) return;
  if (!hasAnchorAsset) {
    const viewer = document.getElementById('nsfw-viewer');
    if (viewer) viewer.innerHTML = `
      <div class="assets-empty">해당 캐릭터의 NSFW 에셋은 준비 중입니다.</div>
    `;
    return;
  }
  const availableCodes = nsfwAssetsFor(code);
  const hideRestrictedPoses = hasRestrictedNsfwPoseSpecies(char);
  const visibleSituations = NSFW_SITUATIONS.filter(sit =>
    availableCodes.has(sit.code) &&
    !isCharacterAssetMissing(char, DEFAULT_OUTFIT_CODE, sit.code) &&
    !(hideRestrictedPoses && NSFW_POSE_RESTRICTED_CODES.has(sit.code))
  );
  if (!visibleSituations.length) {
    const viewer = document.getElementById('nsfw-viewer');
    if (viewer) viewer.innerHTML = `
      <div class="assets-empty">해당 캐릭터의 NSFW 에셋은 준비 중입니다.</div>
    `;
    return;
  }

  renderAssetViewer('nsfw-viewer', {
    title: name,
    subtitle: `NSFW 에셋 · ${visibleSituations.length}종`,
    gridClass: 'nsfw-asset-grid',
    items: visibleSituations,
    cardClass: 'nsfw-asset-card',
    imageClass: 'nsfw-asset-img',
    labelClass: 'nsfw-asset-label',
    makeUrl: sit => nsfwImgUrl(code, sit.code),
    makeAlt: sit => sit.code,
    makeLabel: sit => `
        ${sit.name ? `<span class="nsfw-asset-name">${escapeHTML(sit.name)}</span>` : ''}
        <span class="nsfw-asset-code">${escapeHTML(sit.code)}</span>
      `,
    makeLightboxLabel: sit => sit.name || sit.code,
    onOpen: (sit, url, index, viewer, entry, returnFocus) => openLightbox(url, sit.name || sit.code, {
      assets: viewer._assetLightboxItems,
      index,
      returnFocus,
    }),
  });
}

/* ──────────────────────────────────────────────────
   ▶ 라이트박스
────────────────────────────────────────────────── */
function setLightboxContext(url, options = {}) {
  if (options.assets) {
    appState.lightbox.assets = normalizeLightboxAssets(options.assets);
    appState.lightbox.index = Number.isInteger(options.index) ? options.index : -1;
  } else if (!appState.lightbox.assets.some(entry => entry.url === url)) {
    appState.lightbox.assets = url ? [{ url: String(url), label: String(options.label || ''), alt: String(options.label || '') }] : [];
    appState.lightbox.index = appState.lightbox.assets.length ? 0 : -1;
  }

  if (appState.lightbox.assets.length) {
    const safeIndex = Number.isInteger(appState.lightbox.index) ? appState.lightbox.index : -1;
    if (safeIndex < 0 || safeIndex >= appState.lightbox.assets.length || appState.lightbox.assets[safeIndex]?.url !== url) {
      appState.lightbox.index = appState.lightbox.assets.findIndex(entry => entry.url === url);
    }
    if (appState.lightbox.index < 0) appState.lightbox.index = 0;
  } else {
    appState.lightbox.index = -1;
  }
}

function updateLightboxNavState() {
  const canNavigate = appState.lightbox.assets.length > 1;
  document.querySelectorAll('[data-lightbox-nav]').forEach(btn => {
    btn.disabled = !canNavigate;
    btn.hidden = !canNavigate;
  });
}

function updateLightboxContent(url, label) {
  const lightbox = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const labelEl = document.getElementById('lightbox-label');
  if (!lightbox || !img || !labelEl) return false;

  const { width, height } = imageDimensionsForAsset('', url);
  img.width = width;
  img.height = height;
  img.src = url;
  img.alt = label || '';
  labelEl.textContent = label || '';
  lightbox.inert = false;
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.classList.add('lightbox-open');
  updateLightboxNavState();

  return true;
}

function writeLightboxHistory(url, label, mode = 'push') {
  writeHistoryState({
    section: appState.navigation.currentSection,
    detail: appState.detail.currentCode || null,
    lightbox: true,
    lightboxUrl: url,
    lightboxLabel: label || '',
    lightboxAssets: appState.lightbox.assets,
    lightboxIndex: appState.lightbox.index,
  }, mode);
}

function openLightbox(url, label, options = {}) {
  const lightbox = document.getElementById('lightbox');
  const wasOpen = lightbox?.classList.contains('open');
  if (!wasOpen && lightbox) {
    const requestedReturnFocus = options.returnFocus;
    lightbox._returnFocus = requestedReturnFocus instanceof HTMLElement
      ? requestedReturnFocus
      : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  setLightboxContext(url, { ...options, label });
  if (!updateLightboxContent(url, label)) return;
  if (!wasOpen) {
    setPageInteractionLock('lightbox', true);
    focusFirstWithin(lightbox, '.lightbox-close');
    scheduleFocusWithin(lightbox, '.lightbox-close');
  }
  lockPageScroll('lightbox');
  if (options.history !== false) writeLightboxHistory(url, label, options.historyMode || 'push');
}

function navigateLightbox(delta) {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox?.classList.contains('open')) return false;
  if (!appState.lightbox.assets.length) return false;

  const dir = delta < 0 ? -1 : 1;
  const total = appState.lightbox.assets.length;
  appState.lightbox.index = (appState.lightbox.index + dir + total) % total;
  const next = appState.lightbox.assets[appState.lightbox.index];
  if (!next) return false;

  updateLightboxContent(next.url, next.label);
  writeLightboxHistory(next.url, next.label, 'replace');
  return true;
}

function closeLightbox(options = {}) {
  const lightbox = document.getElementById('lightbox');
  const wasOpen = lightbox?.classList.contains('open');
  const returnFocus = lightbox?._returnFocus;
  lightbox?.classList.remove('open');
  lightbox?.setAttribute('aria-hidden', 'true');
  if (lightbox) lightbox.inert = true;
  document.body.classList.remove('lightbox-open');
  appState.lightbox.assets = [];
  appState.lightbox.index = -1;
  updateLightboxNavState();
  unlockPageScroll('lightbox', { restore: options.restoreScroll !== false });
  setPageInteractionLock('lightbox', false);
  if (wasOpen && options.restoreFocus !== false && returnFocus?.isConnected) {
    restoreOverlayFocus(returnFocus);
  }
  if (lightbox) lightbox._returnFocus = null;
  if (options.history !== false) {
    writeHistoryState({ section: appState.navigation.currentSection, detail: appState.detail.currentCode || null, lightbox: false });
  }
}
function requestCloseLightbox() {
  if (appState.navigation.historyReady && history.state?.lightbox) {
    // Close and restore focus synchronously from the user's perspective.
    // The subsequent popstate only reconciles the URL/history entry.
    closeLightbox({ history: false });
    history.back();
    return;
  }
  closeLightbox();
}
document.getElementById('lightbox')?.addEventListener('click', e => {
  if (e.target.id === 'lightbox' || e.target.id === 'lightbox-img') requestCloseLightbox();
});

function isLightboxOpen() {
  return document.getElementById('lightbox')?.classList.contains('open') ||
    document.body.classList.contains('lightbox-open');
}

function lightboxKeyboardAction(event) {
  const key = event.key || '';
  const code = event.code || '';
  const keyCode = event.keyCode || event.which || 0;

  if (key === 'Escape' || code === 'Escape' || keyCode === 27) return 'close';

  if (key === 'ArrowLeft' || key === 'Left' || code === 'ArrowLeft' || keyCode === 37 ||
      key === 'ArrowUp' || key === 'Up' || code === 'ArrowUp' || keyCode === 38) {
    return -1;
  }

  if (key === 'ArrowRight' || key === 'Right' || code === 'ArrowRight' || keyCode === 39 ||
      key === 'ArrowDown' || key === 'Down' || code === 'ArrowDown' || keyCode === 40) {
    return 1;
  }

  return null;
}

function handleLightboxKeyboard(event) {
  if (!isLightboxOpen()) return false;

  const action = lightboxKeyboardAction(event);
  if (action === null) return false;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  if (action === 'close') {
    requestCloseLightbox();
  } else {
    navigateLightbox(action);
  }

  return true;
}

/* ──────────────────────────────────────────────────
   ▶ 키보드 단축키
────────────────────────────────────────────────── */


window.ISMLightboxControls = {
  isOpen: isLightboxOpen,
  navigate: navigateLightbox,
  close: requestCloseLightbox,
  handleKeyboard: handleLightboxKeyboard,
};

window.addEventListener('keydown', handleLightboxKeyboard, { capture: true });

document.addEventListener('keydown', e => {
  if (handleLightboxKeyboard(e)) return;

  if (e.key === 'Tab' && trapTabFocus(e, activeFocusTrap())) return;

  if (e.key === 'Escape') {
    requestCloseCharDetail();
    return;
  }

  if (isTypingField(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;

  if (e.key === 'ArrowDown' && moveDetailToProfilePage()) {
    e.preventDefault();
    return;
  }

  if (e.key === 'ArrowLeft') appState.detail.navigate?.(-1);
  if (e.key === 'ArrowRight') appState.detail.navigate?.(1);
}, { capture: true });

/* ──────────────────────────────────────────────────
   ▶ 앱 초기화 — characters.json fetch & 전체 렌더링
   
   [호환성] category 필드가 있으면 그것을 우선 사용합니다.
   category가 없을 경우:
     grade 1 이상 → 아카데미생
     grade 0      → 아카데미 직원
     그 외        → external fallback
   role 필드가 있으면 뱃지로 표시됩니다.
────────────────────────────────────────────────── */
function createCardObserver() {
  const observer = new IntersectionObserver(entries => {
    entries
      .filter(entry => entry.isIntersecting)
      .sort((a, b) => Number(a.target.dataset.index || 0) - Number(b.target.dataset.index || 0))
      .forEach(entry => {
        const card = entry.target;
        const clearRevealDelay = event => {
          if (event.propertyName !== 'transform') return;
          card.style.removeProperty('--card-delay');
          card.removeEventListener('transitionend', clearRevealDelay);
        };
        card.addEventListener('transitionend', clearRevealDelay);
        card.classList.add('card-visible');
        observer.unobserve(card);
      });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  return observer;
}

function renderCharacterGroup(gridId, chars, cardObserver, fallback = []) {
  const grid = document.getElementById(gridId);
  if (!grid) return [];
  grid.replaceChildren();

  const source = chars.length ? chars : fallback;
  const fragment = document.createDocumentFragment();
  const cards = [];
  source.forEach((c, index) => {
    const card = makeCharCardSafely(c, !c.code, index);
    applyCardRenderTiming(card, index);
    fragment.appendChild(card);
    cardObserver.observe(card);
    if (card.dataset.code) cards.push(card);
  });
  grid.appendChild(fragment);
  return cards;
}

/* 상세창 명부 레일.
   43명을 오가려고 상세를 닫았다 여는 왕복이 잦았다. 좌우 화살표는 한 칸씩만
   움직여서 멀리 있는 인물로 가려면 계속 눌러야 했다. 레일은 같은 명단을 그대로
   펼쳐 두고 아무 데나 바로 짚게 한다. 순서는 화살표와 같은 "화면에 보이는 카드"
   순서라 두 조작이 어긋나지 않는다. */
let detailRailCards = [];

/* 상세에서 좌우로 넘길 때 따라갈 순서.

   예전에는 "지금 화면에 보이는 카드"를 썼다. 검색으로 한 명만 남으면 그
   한 명만 남아서 화살표를 눌러도 같은 자리를 맴돌았다. 검색은 찾기 위한
   임시 상태이지 명부의 순서가 아니다. 그래서 검색·필터가 걸어 놓은 숨김은
   무시하고 원래 명단 순서를 그대로 쓴다.

   범위는 지금 보고 있는 인물이 속한 명부 하나로 잡는다. 아카데미와 외부는
   서로 다른 환경(밝은 셸 / 와인)이라 화살표로 그 경계를 넘으면 배경이
   튀고, 명부 레일이 가리키는 목록과도 어긋난다. */
function rosterNavigationCards(code) {
  const current = detailRailCards.find(card => card.dataset.code === code);
  const panel = current?.closest('.org-roster');
  if (!panel) return detailRailCards;
  return detailRailCards.filter(card => card.closest('.org-roster') === panel);
}

function renderDetailRosterRail() {
  const rail = document.getElementById('cdp-roster-rail');
  if (!rail) return;
  const visible = rosterNavigationCards(appState.detail.currentCode);

  // 혼자뿐인 명단에서는 레일이 할 일이 없다. 지금 보는 인물이 그 명단에 없을
  // 때도(검색·딥링크로 다른 소속을 열었을 때) 감춘다 — "여기 있다"를 못 가리키는
  // 목록은 길잡이가 아니라 혼란이다.
  const hasCurrent = visible.some(card => card.dataset.code === appState.detail.currentCode);
  if (visible.length < 2 || !hasCurrent) {
    rail.hidden = true;
    rail.replaceChildren();
    delete rail.dataset.signature;
    return;
  }

  const signature = visible.map(card => card.dataset.code).join(',');
  if (rail.dataset.signature !== signature) {
    rail.dataset.signature = signature;
    const fragment = document.createDocumentFragment();
    visible.forEach(card => {
      const code = card.dataset.code;
      const character = appState.characterByCode.get(code);
      const name = character ? getCardDisplayName(character) : code;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cdp-rail-chip';
      chip.dataset.code = code;
      chip.title = name;
      const accent = idAccentColorForCharacter(character);
      if (accent) chip.style.setProperty('--rail-chip-accent', accent);
      chip.innerHTML = `
        <span class="cdp-rail-chip-thumb">${
          !character
            ? '<span aria-hidden="true">◌</span>'
            : `<img ${cardImgAttrs(character, '')}>`
        }</span>
        <span class="cdp-rail-chip-name">${escapeHTML(name)}</span>
      `;
      fragment.appendChild(chip);
    });
    rail.replaceChildren(fragment);
  }

  rail.hidden = false;
  let activeChip = null;
  rail.querySelectorAll('.cdp-rail-chip').forEach(chip => {
    const isCurrent = chip.dataset.code === appState.detail.currentCode;
    chip.classList.toggle('is-current', isCurrent);
    chip.setAttribute('aria-current', isCurrent ? 'true' : 'false');
    if (isCurrent) activeChip = chip;
  });
  // 현재 인물이 레일 밖으로 밀려나면 어디쯤인지 알 수 없다.
  activeChip?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

  if (rail.dataset.bound !== '1') {
    rail.dataset.bound = '1';
    rail.addEventListener('click', event => {
      const chip = event.target.closest('.cdp-rail-chip[data-code]');
      if (!chip || chip.classList.contains('is-current')) return;
      openCharDetail(chip.dataset.code, true);
    });
  }
}

function setupDetailKeyboardNavigation(cards) {
  detailRailCards = cards;
  appState.detail.navigate = dir => {
    const detail = document.getElementById('char-detail');
    if (!detail?.classList.contains('open')) return;

    // 검색이 걸어 놓은 숨김은 무시하고 원래 명부 순서를 따른다. 레일도 같은
    // 목록을 쓰므로 화살표와 레일이 어긋나지 않는다.
    const orderedCards = rosterNavigationCards(appState.detail.currentCode);
    if (orderedCards.length < 2) return;

    const idx = orderedCards.findIndex(c => c.dataset.code === appState.detail.currentCode);
    if (idx === -1) return;

    const nextIdx = (idx + dir + orderedCards.length) % orderedCards.length;
    const nextCode = orderedCards[nextIdx].dataset.code;
    const inner = document.querySelector('.char-detail-inner');

    if (!inner) {
      openCharDetail(nextCode, true);
      return;
    }

    inner.style.transition = 'opacity 0.15s, transform 0.15s';
    inner.style.opacity = '0';
    inner.style.transform = `translateX(${dir * 18}px)`;

    setTimeout(() => {
      openCharDetail(nextCode, true);
      inner.style.transform = `translateX(${-dir * 18}px)`;
      requestAnimationFrame(() => {
        inner.style.transition = 'opacity 0.22s, transform 0.22s';
        inner.style.opacity = '1';
        inner.style.transform = 'translateX(0)';
      });
    }, UI_TIMING_MS.detailNavigation);
  };
}

function updateStudentFilterCount(element, visible, total, timer) {
  element.textContent = `${total}명 중 ${visible}명`;
  return restartElementFlash(element, timer);
}

function setStudentGradeExpandedState(section, expanded) {
  const toggle = section?.querySelector('.char-grade-toggle');
  toggle?.setAttribute('aria-expanded', String(expanded));
}

function restoreStudentGradeFilterCollapse(section, wrap) {
  if (!section || section.dataset.preStudentFilterCollapsed === undefined) return;
  const shouldCollapse = section.dataset.preStudentFilterCollapsed === '1';
  section.classList.toggle('collapsed', shouldCollapse);
  if (wrap) wrap.style.maxHeight = shouldCollapse ? '0' : '';
  setStudentGradeExpandedState(section, !shouldCollapse);
  delete section.dataset.preStudentFilterCollapsed;
}

function openStudentGradeForFilter(section, wrap) {
  if (!section) return;
  if (section.dataset.preStudentFilterCollapsed === undefined) {
    section.dataset.preStudentFilterCollapsed = section.classList.contains('collapsed') ? '1' : '0';
  }
  section.classList.remove('collapsed', 'is-collapsing');
  if (wrap) wrap.style.maxHeight = '';
  setStudentGradeExpandedState(section, true);
}

function toggleFilterValue(values, value, button) {
  const active = !values.has(value);
  if (active) values.add(value);
  else values.delete(value);
  button.classList.toggle('active', active);
}

function writeCharacterFilterHistory() {
  appState.navigation.characterFilters = currentCharacterFilters();
  if (appState.navigation.currentSection !== 'characters') return;
  writeHistoryState({
    section: 'characters',
    detail: appState.detail.currentCode || null,
    lightbox: false,
    characterFilters: appState.navigation.characterFilters,
  }, 'replace');
}

function makeStudentFilterGroup(
  entries,
  activeValues,
  applyFilter,
  filterKind,
  classNameFor = () => 'filter-btn'
) {
  const group = document.createElement('div');
  group.className = 'char-filter-group';
  entries.forEach(({ value, label }) => {
    const button = makeButtonElement({ className: classNameFor(value), text: label });
    button.dataset.filterKind = filterKind;
    button.dataset.filterValue = String(value);
    button.classList.toggle('active', activeValues.has(value));
    button.setAttribute('aria-pressed', String(activeValues.has(value)));
    button.addEventListener('click', () => {
      toggleFilterValue(activeValues, value, button);
      button.setAttribute('aria-pressed', String(activeValues.has(value)));
      applyFilter();
      writeCharacterFilterHistory();
    });
    group.appendChild(button);
  });
  return group;
}

function setupStudentFilters(students, byGrade, cards, gradeSections) {
  const grid = document.getElementById('students-grid');
  const filterBar = document.getElementById('students-filter-bar');
  if (!grid || !filterBar) return;

  const initialFilters = normalizeCharacterFilters(appState.navigation.characterFilters);
  const activeGrades = new Set(initialFilters.grades);
  const activeSpecies = new Set(initialFilters.species);
  filterBar.replaceChildren();
  let flashTimer = null;

  function applyFilter() {
    const hasFilter = activeGrades.size > 0 || activeSpecies.size > 0;
    let visibleCount = 0;
    grid.dataset.filterActive = hasFilter ? '1' : '0';
    // 접힌 채로 걸러지면 무엇이 걸러졌는지 보이지 않는다. 단추가 개수를 들고
    // 있다가, 하나라도 켜지면 스스로 펴고 잠긴다.
    syncFilterToggle();

    cards.forEach(card => {
      const grade = Number(card.dataset.grade);
      const species = card.dataset.speciesGroup || card.dataset.species || '';
      const gradeOk = activeGrades.size === 0 || activeGrades.has(grade);
      const speciesOk = activeSpecies.size === 0 || activeSpecies.has(species);
      setCardVisibilityFlag(card, 'studentFilterVisible', gradeOk && speciesOk);
      if (isCardVisibleByFilters(card)) visibleCount++;
    });

    gradeSections.forEach(({ heading, wrap, section, sectionCards }) => {
      const anyVisible = sectionCards.some(isCardVisibleByFilters);
      heading.style.display = anyVisible ? '' : 'none';
      if (wrap) wrap.style.display = anyVisible ? '' : 'none';
      if (section) section.style.display = anyVisible ? '' : 'none';
      if (section && wrap) {
        if (hasFilter) openStudentGradeForFilter(section, wrap);
        else restoreStudentGradeFilterCollapse(section, wrap);
      }
      section?.querySelector('.char-grade-toggle')?.toggleAttribute('disabled', hasFilter);
    });

    const countEl = document.getElementById('students-filter-count');
    if (!countEl) return;

    if (!hasFilter) {
      countEl.style.display = 'none';
      return;
    }

    countEl.style.display = '';
    flashTimer = updateStudentFilterCount(countEl, visibleCount, students.length, flashTimer);
  }

  filterBar.hidden = false;

  /* 좁은 화면에서 이 막대는 176px을 늘 차지한다. 첫 카드까지 969px을 지나야
     하는데 그 중 가장 큰 덩어리였다. 접어 두고 필요할 때 펴게 한다.
     단추는 CSS가 좁은 폭에서만 보이게 하므로 데스크톱 동작은 그대로다.
     걸러진 상태에서 접으면 무엇이 걸러졌는지 모르게 되므로, 필터가 하나라도
     켜져 있으면 강제로 펴고 접기를 막는다. */
  const filterToggle = makeButtonElement({
    className: 'char-filter-toggle',
    text: '필터',
    onClick: () => setFilterBarCollapsed(!filterBar.classList.contains('is-collapsed')),
  });
  filterToggle.setAttribute('aria-controls', filterBar.id || '');
  filterBar.appendChild(filterToggle);

  function setFilterBarCollapsed(collapsed) {
    filterBar.classList.toggle('is-collapsed', collapsed);
    filterToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function syncFilterToggle() {
    const active = activeGrades.size + activeSpecies.size;
    filterToggle.textContent = active ? `필터 ${active}` : '필터';
    filterToggle.classList.toggle('is-active', active > 0);
    if (active > 0) setFilterBarCollapsed(false);
    filterToggle.disabled = active > 0;
  }

  setFilterBarCollapsed(true);

  filterBar.appendChild(makeTextElement('span', 'char-filter-label', '학년'));

  const grades = KNOWN_GRADES
    .filter(grade => byGrade[grade])
    .map(grade => ({ value: grade, label: getGradeName(grade) }));
  const gradeGroup = makeStudentFilterGroup(
    grades,
    activeGrades,
    applyFilter,
    'grade',
    grade => `filter-btn grade-${grade}`
  );
  filterBar.appendChild(gradeGroup);

  filterBar.appendChild(makeTextElement('div', 'char-filter-sep', ''));
  filterBar.appendChild(makeTextElement('span', 'char-filter-label', '종족'));

  const presentGroups = new Set(students.map(c => speciesGroupOf(c)).filter(Boolean));
  const species = [
    ...SPECIES_GROUP_ORDER.filter(group => presentGroups.has(group)),
    ...[...presentGroups].filter(group => !SPECIES_GROUP_ORDER.includes(group)).sort(),
  ].map(value => ({ value, label: value }));
  const speciesGroup = makeStudentFilterGroup(species, activeSpecies, applyFilter, 'species');
  filterBar.appendChild(speciesGroup);

  const resetBtn = makeButtonElement({
    className: 'filter-reset-btn',
    text: '초기화',
    onClick: () => {
      activeGrades.clear();
      activeSpecies.clear();
      filterBar.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      });
      applyFilter();
      writeCharacterFilterHistory();
    },
  });
  filterBar.appendChild(resetBtn);

  const countEl = document.createElement('span');
  countEl.id = 'students-filter-count';
  countEl.className = 'filter-count';
  filterBar.appendChild(countEl);

  appState.navigation.studentFilterContext = {
    activeGrades,
    activeSpecies,
    applyFilter,
    filterBar,
  };
  applyFilter();
}


function buildRosterSearchSections(cards, groupCardsByKey) {
  const rosterGroups = [
    { key: 'students', org: 'ism' },
    ...ROSTER_GROUPS.map(group => ({
      key: group.key,
      org: group.key === 'staff' ? 'ism' : 'external',
    })),
  ];

  return rosterGroups
    .map(group => {
      const section = document.querySelector(`.roster-group[data-roster-group="${group.key}"]`);
      return {
        key: group.key,
        org: group.org,
        section,
        wrap: section?.querySelector('.roster-group-body'),
        cards: group.key === 'students'
          ? cards.filter(card => card.dataset.category === 'student')
          : (groupCardsByKey[group.key] || []),
      };
    })
    .filter(group => group.section);
}

/* 검색 결과는 언제나 한쪽 명부 안에서만 보여 준다.

   예전에는 양쪽 패널을 동시에 열어서, 아카데미 탭에 머문 채 외부 인물이
   밝은 셸 위에 그려졌다. 명부의 환경색은 소속을 읽는 단서인데 그게 뒤집히면
   단서가 거짓말을 한다. 이제 검색 결과가 있는 쪽으로 탭이 따라간다. */
function setRosterPanelSearchDisplay(hasSearch, visibleByOrg) {
  const activeOrg = document.querySelector('.org-select-card.active')?.dataset.org || 'ism';
  document.querySelectorAll('.org-roster').forEach(panel => {
    if (!hasSearch) {
      panel.style.display = '';
      return;
    }
    const org = panel.id === 'org-external' ? 'external' : 'ism';
    panel.style.display = org === activeOrg && visibleByOrg[org] ? 'block' : 'none';
  });
}

/* 지금 보고 있는 명부에 결과가 하나도 없고 반대쪽에만 있으면 그쪽으로 옮긴다.
   양쪽에 다 있으면 보던 곳에 머문다 — 글자를 한 자 칠 때마다 탭이 튀면
   검색이 아니라 놀이기구가 된다. 반대쪽 몫은 아래 개수 표시로 알린다. */
function followSearchResultsToOrg(visibleByOrg) {
  const activeOrg = document.querySelector('.org-select-card.active')?.dataset.org || 'ism';
  if (visibleByOrg[activeOrg]) return activeOrg;
  const other = activeOrg === 'ism' ? 'external' : 'ism';
  if (!visibleByOrg[other]) return activeOrg;
  applyCharacterOrgSwitch(other);
  return other;
}

function updateStudentGradeSectionVisibility() {
  document.querySelectorAll('#students-grid .char-grade-section').forEach(section => {
    const heading = section.querySelector('.char-grade-heading');
    const wrap = section.querySelector('.char-grade-grid-wrap');
    const anyVisible = Array.from(section.querySelectorAll('.char-card[data-code]')).some(isCardVisibleByFilters);
    section.style.display = anyVisible ? '' : 'none';
    if (heading) heading.style.display = anyVisible ? '' : 'none';
    if (wrap) wrap.style.display = anyVisible ? '' : 'none';
  });
}

function cardMatchesCharacterScope(card, scope) {
  if (!card) return false;
  switch (scope) {
    case 'ism': return card.dataset.org === 'ism';
    case 'external': return card.dataset.org !== 'ism';
    case 'student': return card.dataset.category === 'student';
    case 'staff': return card.dataset.category === 'staff';
    default: return true;
  }
}

function ensureRosterGroupCount(section) {
  if (!section) return null;
  const toggle = section.querySelector('.roster-group-toggle');
  if (!toggle) return null;
  let count = toggle.querySelector('.roster-group-count');
  if (!count) {
    count = document.createElement('span');
    count.className = 'roster-group-count';
    count.setAttribute('aria-hidden', 'true');
    const icon = toggle.querySelector('.roster-group-icon');
    if (icon) toggle.insertBefore(count, icon);
    else toggle.appendChild(count);
  }
  return count;
}

function updateRosterGroupCount(section, visibleCount, totalCount, hasActiveFilter) {
  const count = ensureRosterGroupCount(section);
  if (!count) return;
  count.textContent = hasActiveFilter ? `${visibleCount} / ${totalCount}명` : `${totalCount}명`;
  count.classList.toggle('is-filtered', hasActiveFilter);
}

function setCharacterScopeButtons(scope) {
  document.querySelectorAll('[data-character-scope]').forEach(button => {
    const active = button.dataset.characterScope === scope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function characterCardOrgPanel(card) {
  return card.closest('.org-roster')?.id === 'org-external' ? 'external' : 'ism';
}

function applyCharactersGlobalSearch(context) {
  const term = context.searchTerm.trim();
  const hasActiveFilter = !!term || context.activeScope !== 'all';
  const exactCodeToken = exactCodeSearchToken(term, context.cards);
  let visibleCount = 0;

  context.cards.forEach(card => {
    const visible = elementMatchesSearch(card, term, exactCodeToken) &&
      cardMatchesCharacterScope(card, context.activeScope);
    setCardVisibilityFlag(card, 'globalSearchVisible', visible);
    if (isCardVisibleByFilters(card)) visibleCount++;
  });

  const visibleByOrg = { ism: false, external: false };
  context.groupSections.forEach(({ org, section, wrap, cards: sectionCards }) => {
    const groupVisibleCount = sectionCards.filter(isCardVisibleByFilters).length;
    const anyVisible = groupVisibleCount > 0;
    if (anyVisible) visibleByOrg[org] = true;
    updateRosterGroupCount(section, groupVisibleCount, sectionCards.length, hasActiveFilter);
    section.style.display = hasActiveFilter && !anyVisible ? 'none' : '';
    if (hasActiveFilter) rememberAndOpenRosterGroup(section, wrap, 'preGlobalSearchCollapsed');
    else restoreRememberedRosterGroup(section, wrap, 'preGlobalSearchCollapsed');
  });
  updateStudentGradeSectionVisibility();

  context.sectionRoot.classList.toggle('characters-search-active', hasActiveFilter);
  const shownOrg = hasActiveFilter ? followSearchResultsToOrg(visibleByOrg) : null;
  setRosterPanelSearchDisplay(hasActiveFilter, visibleByOrg);

  // 보이는 쪽과 감춘 쪽을 나눠 센다. 한 명부만 띄우므로 "43명 중 7명"이라고만
  // 하면 화면에 넷뿐일 때 셋이 어디 갔는지 알 수 없다.
  const otherOrg = shownOrg === 'ism' ? 'external' : 'ism';
  const shownCount = hasActiveFilter
    ? context.cards.filter(card => isCardVisibleByFilters(card) && characterCardOrgPanel(card) === shownOrg).length
    : visibleCount;
  const hiddenCount = hasActiveFilter ? visibleCount - shownCount : 0;
  const otherLabel = otherOrg === 'external' ? '외부 인물' : 'ISM 아카데미';
  context.countEl.textContent = hasActiveFilter
    ? `${context.cards.length}명 중 ${shownCount}명${hiddenCount > 0 ? ` · ${otherLabel}에도 ${hiddenCount}명` : ''}`
    : `전체 ${context.cards.length}명`;
  context.countEl.style.display = '';
  if (hasActiveFilter) {
    context.flashTimer = restartElementFlash(context.countEl, context.flashTimer);
  }
  if (context.emptyEl) context.emptyEl.hidden = !hasActiveFilter || visibleCount > 0;
}

function bindCharacterScopeSearch(context, scopeButtons) {
  scopeButtons.forEach(button => {
    if (button._characterScopeClick) {
      button.removeEventListener('click', button._characterScopeClick);
    }
    const onScopeClick = () => {
      context.activeScope = button.dataset.characterScope || 'all';
      setCharacterScopeButtons(context.activeScope);
      const targetOrg = context.activeScope === 'external'
        ? 'external'
        : (['ism', 'student', 'staff'].includes(context.activeScope) ? 'ism' : '');
      if (targetOrg) {
        switchCharacterOrg(targetOrg);
      }
      applyCharactersGlobalSearch(context);
      writeCharacterFilterHistory();
    };
    button._characterScopeClick = onScopeClick;
    button.addEventListener('click', onScopeClick);
  });
  setCharacterScopeButtons(context.activeScope);
}

function setupCharactersGlobalSearch(allCards, groupCardsByKey) {
  const sectionRoot = document.getElementById('section-characters');
  const filterBar = document.getElementById('characters-filter-bar');
  const searchInput = document.getElementById('characters-search');
  const resetBtn = document.getElementById('characters-search-reset');
  const countEl = document.getElementById('characters-search-count');
  const emptyEl = document.getElementById('characters-search-empty');
  if (!sectionRoot || !filterBar || !searchInput || !resetBtn || !countEl) return;

  const cards = Array.from(new Set((allCards || []).filter(Boolean)));
  const initialFilters = normalizeCharacterFilters(appState.navigation.characterFilters);
  const context = {
    sectionRoot,
    countEl,
    emptyEl,
    cards,
    groupSections: buildRosterSearchSections(cards, groupCardsByKey),
    searchTerm: initialFilters.q,
    activeScope: initialFilters.scope,
    flashTimer: null,
  };
  filterBar.hidden = cards.length === 0;
  searchInput.value = context.searchTerm;
  if (emptyEl) emptyEl.hidden = true;

  const scheduleSearch = debounce(
    () => {
      applyCharactersGlobalSearch(context);
      writeCharacterFilterHistory();
    },
    UI_TIMING_MS.searchDebounce
  );
  searchInput._charactersSearchUnbind?.();
  searchInput._charactersSearchUnbind = bindSearchEvents(searchInput, () => {
    context.searchTerm = searchInput.value;
    scheduleSearch();
  });
  bindCharacterScopeSearch(context, Array.from(document.querySelectorAll('[data-character-scope]')));

  resetBtn.onclick = () => {
    context.searchTerm = '';
    context.activeScope = 'all';
    searchInput.value = '';
    setCharacterScopeButtons(context.activeScope);
    applyCharactersGlobalSearch(context);
    writeCharacterFilterHistory();
  };
  appState.navigation.characterSearchContext = context;
  applyCharactersGlobalSearch(context);
}

function applyCharacterFilterStateToUI(filters) {
  const normalized = normalizeCharacterFilters(filters);
  const studentContext = appState.navigation.studentFilterContext;
  if (studentContext) {
    studentContext.activeGrades.clear();
    normalized.grades.forEach(grade => studentContext.activeGrades.add(grade));
    studentContext.activeSpecies.clear();
    normalized.species.forEach(species => studentContext.activeSpecies.add(species));
    studentContext.filterBar.querySelectorAll('[data-filter-kind][data-filter-value]').forEach(button => {
      const value = button.dataset.filterKind === 'grade'
        ? Number(button.dataset.filterValue)
        : button.dataset.filterValue;
      const active = button.dataset.filterKind === 'grade'
        ? studentContext.activeGrades.has(value)
        : studentContext.activeSpecies.has(value);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    studentContext.applyFilter();
  }

  const searchContext = appState.navigation.characterSearchContext;
  if (searchContext) {
    searchContext.searchTerm = normalized.q;
    searchContext.activeScope = normalized.scope;
    const searchInput = document.getElementById('characters-search');
    if (searchInput) searchInput.value = normalized.q;
    setCharacterScopeButtons(normalized.scope);
    const targetOrg = normalized.scope === 'external'
      ? 'external'
      : (['ism', 'student', 'staff'].includes(normalized.scope) ? 'ism' : '');
    if (targetOrg) switchCharacterOrg(targetOrg);
    applyCharactersGlobalSearch(searchContext);
  }
}


function getCollapsedStudentGrades(grid) {
  return new Set(
    Array.from(grid.querySelectorAll('.char-grade-section.collapsed .char-grade-heading'))
      .map(heading => heading.dataset.grade)
  );
}

function groupStudentsByGrade(students) {
  return students.reduce((byGrade, c) => {
    const grade = c.grade;
    if (!byGrade[grade]) byGrade[grade] = [];
    byGrade[grade].push(c);
    return byGrade;
  }, {});
}

function renderStudents(students, cardObserver) {
  const grid = document.getElementById('students-grid');
  if (!grid) return [];
  const collapsedGrades = getCollapsedStudentGrades(grid);
  const byGrade = groupStudentsByGrade(students);
  grid.replaceChildren();

  const fragment = document.createDocumentFragment();
  Object.keys(byGrade).sort((a, b) => Number(a) - Number(b)).forEach(grade => {
    const section = document.createElement('div');
    section.className = 'char-grade-section';
    if (collapsedGrades.has(String(grade))) section.classList.add('collapsed');
    section.style.setProperty('--grade-tint', getGradeColor(grade));

    const heading = document.createElement('h3');
    heading.className = 'char-grade-heading';
    heading.dataset.grade = grade;

    const headingToggle = makeButtonElement({ className: 'char-grade-toggle' });
    headingToggle.style.color = getGradeColor(grade);
    headingToggle.innerHTML = `<span class="grade-heading-number">${escapeHTML(grade)}</span><span class="grade-heading-unit">학년</span>`;

    const headingIcon = makeTextElement('span', 'grade-toggle-icon', '');
    headingIcon.setAttribute('aria-hidden', 'true');
    headingToggle.appendChild(headingIcon);
    heading.appendChild(headingToggle);
    section.appendChild(heading);

    const wrap = document.createElement('div');
    wrap.className = 'char-grid char-grade-grid-wrap';
    wrap.id = `students-grade-${grade}-grid`;
    headingToggle.setAttribute('aria-controls', wrap.id);
    headingToggle.setAttribute('aria-expanded', String(!collapsedGrades.has(String(grade))));
    if (collapsedGrades.has(String(grade))) wrap.style.maxHeight = '0';
    byGrade[grade].forEach((c, index) => {
      const card = makeCharCardSafely(c, false, index);
      applyCardRenderTiming(card, index);
      wrap.appendChild(card);
    });

    headingToggle.addEventListener('click', () => {
      if (grid.dataset.filterActive === '1') return;
      const sectionEl = heading.closest('.char-grade-section');
      const isCollapsed = sectionEl.classList.toggle('collapsed');
      setStudentGradeExpandedState(sectionEl, !isCollapsed);
      sectionEl.classList.add('is-collapsing');
      if (!isCollapsed) {
        wrap.style.maxHeight = wrap.scrollHeight + 'px';
        wrap.addEventListener('transitionend', () => {
          if (!sectionEl.classList.contains('collapsed')) wrap.style.maxHeight = '';
          sectionEl.classList.remove('is-collapsing');
        }, { once: true });
      } else {
        wrap.style.maxHeight = wrap.scrollHeight + 'px';
        requestAnimationFrame(() => { wrap.style.maxHeight = '0'; });
        wrap.addEventListener('transitionend', () => {
          sectionEl.classList.remove('is-collapsing');
        }, { once: true });
      }
    });

    section.appendChild(wrap);
    fragment.appendChild(section);
  });
  grid.appendChild(fragment);

  const cards = Array.from(grid.querySelectorAll('.char-card[data-code]'));
  cards.forEach(card => {
    cardObserver.observe(card);
  });

  const headings = Array.from(grid.querySelectorAll('.char-grade-heading'));
  const gradeSections = headings.map(heading => {
    const wrap = heading.nextElementSibling;
    return {
      heading,
      wrap,
      section: heading.closest('.char-grade-section'),
      sectionCards: wrap ? Array.from(wrap.querySelectorAll('.char-card[data-code]')) : [],
    };
  });
  setupStudentFilters(students, byGrade, cards, gradeSections);
  return cards;
}

const ROSTER_GROUPS = Object.freeze([
  { key: 'staff', gridId: 'staff-grid' },
  { key: 'pbs', gridId: 'pbs-grid', placeholder: ORG_PLACEHOLDERS.pbs },
  { key: 'hprf', gridId: 'hprf-grid', placeholder: ORG_PLACEHOLDERS.hprf },
  { key: 'wf', gridId: 'wf-grid', placeholder: ORG_PLACEHOLDERS.wf },
  { key: 'rtn', gridId: 'rtn-grid', placeholder: ORG_PLACEHOLDERS.rtn },
  { key: 'nf', gridId: 'nf-grid', placeholder: ORG_PLACEHOLDERS.nf },
]);

function createEmptyRosterGroups() {
  return ROSTER_GROUPS.reduce((groups, { key }) => {
    groups[key] = [];
    return groups;
  }, { students: [] });
}

function groupCharactersByRoster(chars) {
  const grouped = createEmptyRosterGroups();
  chars.forEach(c => {
    const category = getCharCategory(c);
    if (category === 'student') {
      grouped.students.push(c);
      return;
    }
    if (category === 'staff') {
      grouped.staff.push(c);
      return;
    }
    const org = getCharacterOrg(c);
    (grouped[org] || grouped.nf).push(c);
  });
  Object.values(grouped).forEach(group => {
    group.sort((a, b) => {
      const orderA = Number(a?.rosterOrder);
      const orderB = Number(b?.rosterOrder);
      const hasOrderA = Number.isFinite(orderA);
      const hasOrderB = Number.isFinite(orderB);
      if (hasOrderA && hasOrderB && orderA !== orderB) return orderA - orderB;
      return 0;
    });
  });
  return grouped;
}

/* 스포일러는 갤러리와 명부가 같은 값을 본다. 한쪽에서 켜면 다른 쪽도 열린다.
   명부는 목록 자체가 바뀌므로 다시 그리고, 갤러리는 다음에 열릴 때 새로 짜도록
   준비 상태만 무른다. 갤러리 페이지에 있을 때는 그 자리에서 다시 짠다. */
const SPOILER_STORAGE_KEY = 'ism.spoilers';

/* 갤러리(gallery.html)와 명부(index.html)는 별개 페이지다. 메모리에만 두면
   페이지를 옮기는 순간 꺼진다. 탭 단위로 남겨 두 화면이 같은 값을 보게 한다.
   경고를 본 사실도 함께 남긴다 — 페이지를 옮길 때마다 다시 묻지 않기 위해서다.
   sessionStorage라 탭을 닫으면 사라지고, 다음에 열면 다시 경고를 본다. */
function loadSpoilerState() {
  try {
    const raw = sessionStorage.getItem(SPOILER_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    appState.spoilers.revealed = !!saved?.revealed;
    appState.spoilers.warned = !!saved?.warned;
  } catch { /* 저장소를 막아 둔 브라우저에서는 그냥 꺼진 채로 간다. */ }
}

function saveSpoilerState() {
  try {
    sessionStorage.setItem(SPOILER_STORAGE_KEY, JSON.stringify(appState.spoilers));
  } catch { /* 저장에 실패해도 이번 페이지 안에서는 정상 동작한다. */ }
}

function setSpoilersRevealed(next) {
  appState.spoilers.revealed = !!next;
  saveSpoilerState();
  appState.gallery.prepared = false;
  if (document.getElementById('section-characters')) renderCharacters();
  if (appState.navigation.currentSection === 'gallery' || !document.getElementById('section-characters')) {
    ensureGalleryPrepared();
  }
}

/* 명부에 실을 인물. 스포일러 인물은 토글을 켜야만 들어온다.

   갤러리와 상태를 따로 둔다. 한쪽에서 열었다고 다른 쪽까지 열리면 갤러리를
   보러 온 사람이 명부에서 스포일러를 맞는다. `groupCharactersByRoster`는
   모르는 org를 nf로 떨어뜨리므로 org가 `spoiler`인 아자키엘은 무소속에 선다. */
function rosterCharacterList() {
  const base = appState.characters.filter(isPublicCharacter);
  if (!appState.spoilers.revealed) return base;
  return [...base, ...appState.characters.filter(c => c.spoilerOnly)];
}

function syncRosterSpoilerToggle(button) {
  if (!button) return;
  const on = appState.spoilers.revealed;
  button.textContent = on ? '스포일러 숨기기' : '스포일러 표시';
  button.setAttribute('aria-pressed', String(on));
  button.classList.toggle('active', on);
}

function bindRosterSpoilerToggle() {
  const button = document.getElementById('characters-spoiler-toggle');
  if (!button || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';
  syncRosterSpoilerToggle(button);
  button.addEventListener('click', () => {
    // 켤 때만, 그것도 한 번만 묻는다. 끌 때와 두 번째부터는 그냥 넘어간다.
    if (!appState.spoilers.revealed && !appState.spoilers.warned) {
      if (!window.confirm('주의! 강한 스포일러 인물이 표시됩니다!')) return;
      appState.spoilers.warned = true;
      saveSpoilerState();
    }
    setSpoilersRevealed(!appState.spoilers.revealed);
  });
}

function renderCharacters() {
  const cardObserver = createCardObserver();
  const grouped = groupCharactersByRoster(rosterCharacterList());
  const studentCards = renderStudents(grouped.students, cardObserver);
  const groupCardsByKey = {};
  ROSTER_GROUPS.forEach(group => {
    groupCardsByKey[group.key] = renderCharacterGroup(
      group.gridId,
      grouped[group.key],
      cardObserver,
      group.placeholder
    );
  });

  const allCards = [
    ...studentCards,
    ...ROSTER_GROUPS.flatMap(group => groupCardsByKey[group.key] || []),
  ];
  setupCharactersGlobalSearch(allCards, groupCardsByKey);
  setupDetailKeyboardNavigation(allCards);
  bindRosterSpoilerToggle();
  syncRosterSpoilerToggle(document.getElementById('characters-spoiler-toggle'));

  appState.gallery.prepared = false;
  if (appState.navigation.currentSection === 'gallery') ensureGalleryPrepared();
}

function showCharacterLoadError() {
  const message = `
    <div class="assets-empty">
      캐릭터 데이터를 불러오지 못했습니다.<br>
      잠시 후 다시 시도해 주세요.
    </div>
  `;
  [
    'students-grid',
    'staff-grid',
    'rtn-grid',
    'pbs-grid',
    'hprf-grid',
    'wf-grid',
    'nf-grid',
    'emo-viewer',
    'nsfw-viewer',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = message;
  });
}

/* 갤러리는 별도 페이지(gallery.html)로 나가 있다.

   에셋을 훑는 일은 세계관을 읽어 내려가는 흐름과 목적이 다르다. 한 인물의
   표정 열네 장을 비교하는 동안 스크롤 페이지의 다른 구간은 방해만 됐고,
   반대로 세계관을 읽는 사람에게 갤러리는 긴 빈 구간이었다. 페이지를 나누되
   런타임은 나누지 않는다 — 같은 app.js가 같은 헬퍼로 사이드바와 뷰어를
   만들고, 여기서는 명부·세계관·일정처럼 이 페이지에 없는 것만 건너뛴다. */
/* 상세의 "갤러리로 이동"이 인물 코드를 해시에 실어 보낸다. 그 인물이 접힌
   소속에 있을 수 있으므로 펼친 뒤 고른다. 없는 코드면 조용히 넘어간다 —
   첫 인물이 이미 잡혀 있어 화면이 비지 않는다. */
function selectGalleryCharacterFromHash() {
  const code = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).trim();
  if (!code) return;
  const safeCode = window.CSS?.escape ? CSS.escape(code) : code.replace(/"/g, '\\"');
  const item = document.querySelector(`#emo-sidebar .assets-char-item[data-code="${safeCode}"]`);
  if (!item) return;
  item.closest('.assets-org-group')?.classList.remove('is-collapsed');
  selectEmoChar(code, item, { force: true });
  scrollAssetViewerIntoView(item);
}

async function initGalleryPage() {
  loadSpoilerState();
  bindStaticEvents();

  try {
    const res = await fetch(`./characters.json?v=${encodeURIComponent(BUILD_VERSION)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appState.characters = (await res.json()).map(character => normalizeCharacter(character, makeCharacterSearchMeta));
    rebuildCharacterMaps();
    ensureGalleryPrepared();
    selectGalleryCharacterFromHash();
  } catch (err) {
    console.error('characters.json 로드 실패:', err);
    const viewer = document.getElementById('emo-viewer');
    if (viewer) viewer.innerHTML = '<div class="assets-empty">에셋 목록을 불러오지 못했습니다.</div>';
  }

  await finishInitialLoading();
}

async function initApp() {
  if (document.body.dataset.page === 'gallery') {
    await initGalleryPage();
    return;
  }

  loadSpoilerState();
  bindStaticEvents();
  setupFactionWordmarkFallbacks();
  initMainFactionSwitcher();
  setupCommandPalette();
  const initialState = stateFromLocation();
  appState.navigation.characterFilters = normalizeCharacterFilters(initialState.characterFilters);

  /* 1. characters.json fetch */
  try {
    const res = await fetch(`./characters.json?v=${encodeURIComponent(BUILD_VERSION)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    appState.characters = (await res.json()).map(character => normalizeCharacter(character, makeCharacterSearchMeta));
    rebuildCharacterMaps();

    renderCharacters();
  } catch (err) {
    console.error('characters.json 로드 실패:', err);
    document.body.classList.remove('js-loading');
    showCharacterLoadError();
  }

  /* 3. world-you 페이드인 */
  const wy = document.getElementById('world-you');
  if (wy) wyObserver.observe(wy);

  /* 4. 초기 진입: 주소 상태를 반영해 해당 위치/상세를 표시 */
  appState.navigation.historyReady = true;
  writeHistoryState(initialState, 'replace');
  applyHistoryState(initialState);
  window.addEventListener('popstate', e => {
    applyHistoryState(e.state || stateFromLocation());
  });

  await finishInitialLoading();

  appState.navigation.scrollController?.dispose?.();
  appState.navigation.scrollController = createSectionScrollController({
    onSectionChange(section) {
      appState.navigation.currentSection = section;
      updateScrollIndexToggleCount();
      if (!appState.navigation.historyReady || appState.navigation.isApplyingHistory) return;
      if (appState.detail.currentCode || document.getElementById('lightbox')?.classList.contains('open')) return;
      writeHistoryState({ section, detail: null, lightbox: false }, 'replace');
    },
  });
  appState.navigation.scrollController?.refresh?.();
}

initApp();
