/* 인보전과 백색울타리는 한 칸에 묶여 있었다. 둘은 상하 관계이지 같은 조직이
   아니다 — 인보전은 제도권 정치 조직이고, 백색울타리는 그 산하의 현장 조직이다.
   묶어 두면 로고 두 개에 제목 두 줄이 한 판에 들어가 어느 쪽 설명인지도
   흐려졌다. 각각 한 칸씩 준다. */
const MAIN_FACTION_ORDER = Object.freeze(['ism', 'pbs', 'hprf', 'wf', 'rtn']);
/* 6초는 "한눈에 보기" 표까지 읽기에 짧았다. 문구를 소리내어 읽어 보면 성격·거점·
   역할 세 줄을 훑는 데만 그쯤 걸려서, 다 읽기 전에 화면이 넘어갔다. 9초로 늘리고
   읽는 동안에는 아예 멈추도록 했다(아래 pauseAuto 참고). */
const AUTO_ADVANCE_MS = 9000;
const FACTION_EXIT_MS = 150;
const FACTION_ENTER_MS = 620;
const MAIN_INTRO_MS = 900;

const MAIN_FACTIONS = Object.freeze({
  ism: Object.freeze({
    name: 'ISM 아카데미',
    kicker: 'Integrated Species Mutualism',
    titlePrimary: 'ISM',
    titleSecondary: 'Academy',
    titleScript: 'latin',
    titleLength: 'default',
    mottoPrimary: 'Nomen ante genus, fides ante vim',
    mottoSecondary: '이름은 혈통보다 앞서고, 신의는 힘보다 앞선다.',
    ledgerHeading: '한눈에 보기',
    ledgerStatus: '공존을 위한 교육·보호 기관',
    ledgerScope: '청해도 남부',
    ledgerReference: '교육 · 기록 · 보호 · 중재',
    logos: Object.freeze([
      Object.freeze({
        src: './assets/logo_ism_academy_transparent.webp',
        width: 838,
        height: 838,
      }),
    ]),
  }),
  pbs: Object.freeze({
    name: '원혈회',
    kicker: 'Pureblood Society',
    titlePrimary: '원혈회',
    titleSecondary: 'Pureblood Society',
    titleScript: 'ko',
    titleLength: 'default',
    mottoPrimary: 'Red Moon Theater / Casino Purered',
    mottoSecondary: '공연장 · 야간 카지노 · 이종족 은신망',
    ledgerHeading: '한눈에 보기',
    ledgerStatus: '인간 사회를 경계하는 비밀 공동체',
    ledgerScope: '대학로 적월극장',
    ledgerReference: '은신처 · 일자리 · 연결망',
    logos: Object.freeze([
      Object.freeze({ src: './assets/logo_pbs.webp', width: 512, height: 512 }),
    ]),
  }),
  hprf: Object.freeze({
    name: '인간보전전선',
    kicker: 'Human Preservation Front',
    titlePrimary: '인간보전전선',
    titleSecondary: 'Human Preservation Front',
    titleScript: 'ko',
    titleLength: 'long',
    mottoPrimary: '인간의 사회는 인간의 손으로.',
    mottoSecondary: '경계는 제도 안에서 세운다.',
    ledgerHeading: '한눈에 보기',
    ledgerStatus: '인간우월주의 정치 조직',
    ledgerScope: '제도권 · 입법과 여론',
    ledgerReference: '로비 · 여론 · 정책 압박',
    logos: Object.freeze([
      Object.freeze({ src: './assets/logo_hprf.webp', width: 512, height: 512 }),
    ]),
  }),
  wf: Object.freeze({
    name: '백색울타리',
    kicker: 'White Fence',
    titlePrimary: '백색울타리',
    titleSecondary: 'White Fence',
    titleScript: 'ko',
    titleLength: 'default',
    mottoPrimary: '울타리 밖의 것은 들이지 않는다.',
    mottoSecondary: '인간보전전선 산하의 현장 조직.',
    ledgerHeading: '한눈에 보기',
    ledgerStatus: '인보전 산하 현장 조직',
    ledgerScope: '현장 조직망',
    ledgerReference: '통제 · 강제 대응 · 현장 집행',
    logos: Object.freeze([
      Object.freeze({ src: './assets/logo_wf.webp', width: 512, height: 512 }),
    ]),
  }),
  rtn: Object.freeze({
    name: '귀향파',
    kicker: 'Return Faction',
    titlePrimary: '귀향파',
    titleSecondary: 'Return Faction',
    titleScript: 'ko',
    titleLength: 'default',
    mottoPrimary: 'Guirowon / Autonomous Community',
    mottoSecondary: '생활권 · 자치 · 구조 및 피난망',
    ledgerHeading: '한눈에 보기',
    ledgerStatus: '자치와 귀향을 중시하는 공동체',
    ledgerScope: '강화도 귀로원',
    ledgerReference: '생활권 · 구조 · 피난망',
    logos: Object.freeze([
      Object.freeze({ src: './assets/logo_rtn.webp', width: 353, height: 512 }),
    ]),
  }),
});

function setText(root, selector, value) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}

function renderLogos(root, logos) {
  const wrap = root.querySelector('[data-main-logo-wrap]');
  const figure = wrap?.querySelector('[data-main-logo-figure]');
  if (!wrap || !figure) return;

  const images = logos.map(logo => {
    const image = document.createElement('img');
    image.src = logo.src;
    image.alt = '';
    image.width = logo.width;
    image.height = logo.height;
    image.loading = 'eager';
    image.decoding = 'async';
    return image;
  });

  wrap.classList.toggle('main-logo-wrap--paired', images.length > 1);
  figure.replaceChildren(...images);
}

function updateStepLabels(root, currentIndex) {
  const previousIndex = (currentIndex - 1 + MAIN_FACTION_ORDER.length) % MAIN_FACTION_ORDER.length;
  const nextIndex = (currentIndex + 1) % MAIN_FACTION_ORDER.length;
  const previous = MAIN_FACTIONS[MAIN_FACTION_ORDER[previousIndex]];
  const next = MAIN_FACTIONS[MAIN_FACTION_ORDER[nextIndex]];
  const previousButton = root.querySelector('[data-main-faction-step="-1"]');
  const nextButton = root.querySelector('[data-main-faction-step="1"]');

  if (previousButton) previousButton.setAttribute('aria-label', `이전 세력: ${previous.name}`);
  if (nextButton) nextButton.setAttribute('aria-label', `다음 세력: ${next.name}`);
}

function applyFaction(root, key, { announce = true, moveOptionIntoView = true } = {}) {
  const faction = MAIN_FACTIONS[key];
  if (!faction) return;

  const section = root.closest('#section-factions');
  const title = root.querySelector('[data-main-title]');
  const status = root.querySelector('#main-faction-status');
  const currentIndex = MAIN_FACTION_ORDER.indexOf(key);

  root.dataset.mainFaction = key;
  if (section) section.dataset.mainFaction = key;
  setText(root, '[data-main-kicker]', faction.kicker);
  setText(root, '[data-main-title-primary]', faction.titlePrimary);
  setText(root, '[data-main-title-secondary]', faction.titleSecondary);
  setText(root, '[data-main-motto-primary]', faction.mottoPrimary);
  setText(root, '[data-main-motto-secondary]', faction.mottoSecondary);
  setText(root, '[data-main-ledger-heading]', faction.ledgerHeading);
  setText(root, '[data-main-ledger-status]', faction.ledgerStatus);
  setText(root, '[data-main-ledger-scope]', faction.ledgerScope);
  setText(root, '[data-main-ledger-reference]', faction.ledgerReference);

  if (title) {
    title.dataset.script = faction.titleScript;
    title.dataset.length = faction.titleLength;
  }

  renderLogos(root, faction.logos);

  root.querySelectorAll('[data-main-faction-option]').forEach(option => {
    const active = option.dataset.mainFactionOption === key;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
    if (active && moveOptionIntoView) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const options = option.closest('.main-faction-options');
      const targetLeft = option.offsetLeft - ((options?.clientWidth || 0) - option.offsetWidth) / 2;
      options?.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    }
  });

  updateStepLabels(root, currentIndex);
  if (announce && status) status.textContent = `${faction.name} 메인 페이지로 전환했습니다.`;
}

export function initMainFactionSwitcher(root = document.querySelector('#section-factions .main-registry')) {
  if (!root) return;

  const section = root.closest('#section-factions');
  const autoplayButton = root.querySelector('[data-main-faction-autoplay]');
  const autoplayIcon = autoplayButton?.querySelector('.main-faction-autoplay-icon');
  const autoplayCopy = autoplayButton?.querySelector('.main-faction-autoplay-copy');
  const autoplayCount = autoplayButton?.querySelector('.main-faction-autoplay-count');
  const status = root.querySelector('#main-faction-status');
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let autoEnabled = !reducedMotionQuery?.matches;
  let sectionVisible = false;
  let transitionActive = false;
  let autoTimer = 0;
  let progressFrame = 0;
  let transitionSwapTimer = 0;
  let transitionEndTimer = 0;

  const clearAutoTimer = () => {
    if (autoTimer) window.clearTimeout(autoTimer);
    if (progressFrame) window.cancelAnimationFrame(progressFrame);
    autoTimer = 0;
    progressFrame = 0;
    root.classList.remove('is-autoplay-counting');
  };

  const updateAutoplayButton = () => {
    root.classList.toggle('is-autoplay-enabled', autoEnabled);
    autoplayButton?.setAttribute('aria-pressed', String(autoEnabled));
    autoplayButton?.setAttribute('aria-label', autoEnabled ? '자동 전환 멈추기' : '자동 전환 시작하기');
    if (autoplayIcon) autoplayIcon.textContent = autoEnabled ? 'Ⅱ' : '▶';
    if (autoplayCopy) autoplayCopy.textContent = autoEnabled ? '자동 전환' : '전환 멈춤';
    // 라벨을 상수에서 뽑아 쓴다. 예전에는 '6초'가 박혀 있어 간격을 바꾸면 어긋났다.
    if (autoplayCount) autoplayCount.textContent = autoEnabled ? `${AUTO_ADVANCE_MS / 1000}초` : '—';
  };

  /* 읽고 있는 사람 앞에서 화면이 저 혼자 넘어가면 안 된다. 포인터가 올라와
     있거나 안쪽에 초점이 있으면 "지금 읽는 중"으로 보고 자동 전환을 멈춘다. */
  let readerPresent = false;

  const canAutoAdvance = () =>
    autoEnabled &&
    sectionVisible &&
    !transitionActive &&
    !readerPresent &&
    !document.hidden &&
    section?.classList.contains('active') &&
    !section.hidden;

  const restartProgress = () => {
    root.classList.remove('is-autoplay-counting');
    progressFrame = window.requestAnimationFrame(() => {
      progressFrame = window.requestAnimationFrame(() => {
        progressFrame = 0;
        if (canAutoAdvance()) root.classList.add('is-autoplay-counting');
      });
    });
  };

  const scheduleAutoAdvance = () => {
    clearAutoTimer();
    if (!canAutoAdvance()) return;
    restartProgress();
    autoTimer = window.setTimeout(() => {
      const currentIndex = Math.max(0, MAIN_FACTION_ORDER.indexOf(root.dataset.mainFaction));
      const nextKey = MAIN_FACTION_ORDER[(currentIndex + 1) % MAIN_FACTION_ORDER.length];
      transitionToFaction(nextKey, {
        announce: false,
        moveOptionIntoView: true,
      });
    }, AUTO_ADVANCE_MS);
  };

  /* 넘어가는 방향은 더 이상 화면에 남지 않는다. 예전에는 좌우로 미끄러지는
     연출이 방향을 따라갔지만, 지금은 어느 쪽으로 넘기든 글이 위에서 떨어진다. */
  function transitionToFaction(key, {
    announce = true,
    focusOption = false,
    moveOptionIntoView = true,
  } = {}) {
    if (!MAIN_FACTIONS[key]) return;
    if (root.dataset.mainFaction === key && !transitionActive) {
      scheduleAutoAdvance();
      return;
    }

    clearAutoTimer();
    window.clearTimeout(transitionSwapTimer);
    window.clearTimeout(transitionEndTimer);
    root.classList.remove('main-anim-play');
    root.classList.add('main-intro-complete');
    root.classList.remove('is-faction-entering');
    root.classList.add('is-faction-exiting');
    transitionActive = true;

    transitionSwapTimer = window.setTimeout(() => {
      applyFaction(root, key, { announce, moveOptionIntoView });
      root.classList.remove('is-faction-exiting');
      root.classList.add('is-faction-entering');
      if (focusOption) {
        root.querySelector(`[data-main-faction-option="${key}"]`)?.focus({ preventScroll: true });
      }

      transitionEndTimer = window.setTimeout(() => {
        root.classList.remove('is-faction-entering');
        transitionActive = false;
        scheduleAutoAdvance();
      }, FACTION_ENTER_MS + 50);
    }, FACTION_EXIT_MS);
  }

  /* 사람이 직접 세력을 고르면 그때부터는 그 사람이 운전대를 잡은 것이다.
     원하는 세력을 눌렀는데 몇 초 뒤 멋대로 다음 세력으로 넘어가면 조작이
     무시당한 것처럼 느껴진다. 자동 전환은 그 시점에 끈다 — 다시 켜고 싶으면
     자동 전환 버튼이 그대로 있다. */
  const yieldControlToReader = () => {
    if (!autoEnabled) return;
    autoEnabled = false;
    updateAutoplayButton();
    clearAutoTimer();
    if (status) status.textContent = '세력을 직접 골라 자동 전환을 멈췄습니다.';
  };

  root.querySelectorAll('[data-main-faction-option]').forEach(option => {
    option.addEventListener('click', () => {
      const key = option.dataset.mainFactionOption;
      yieldControlToReader();
      transitionToFaction(key);
    });
  });

  const setReaderPresent = present => {
    if (readerPresent === present) return;
    readerPresent = present;
    if (present) clearAutoTimer();
    else scheduleAutoAdvance();
  };

  /* "읽는 중"으로 볼 범위는 내비게이션이 아니라 본문 패널이다. root 전체에
     걸면 자동 전환 버튼에 초점이 닿는 순간 멈춰 버려서, 키보드로는 자동 전환을
     켤 수가 없다. 화살표와 세력 버튼도 마찬가지로 "조작"이지 "읽기"가 아니다. */
  const readingSurface = root.querySelector('.main-registry-copy') || root;
  readingSurface.addEventListener('pointerenter', () => setReaderPresent(true));
  readingSurface.addEventListener('pointerleave', () => setReaderPresent(false));
  readingSurface.addEventListener('focusin', () => setReaderPresent(true));
  readingSurface.addEventListener('focusout', event => {
    if (!readingSurface.contains(event.relatedTarget)) setReaderPresent(false);
  });

  root.querySelectorAll('[data-main-faction-step]').forEach(button => {
    button.addEventListener('click', () => {
      const currentIndex = Math.max(0, MAIN_FACTION_ORDER.indexOf(root.dataset.mainFaction));
      const direction = Number(button.dataset.mainFactionStep) || 1;
      const nextIndex = (currentIndex + direction + MAIN_FACTION_ORDER.length) % MAIN_FACTION_ORDER.length;
      const nextKey = MAIN_FACTION_ORDER[nextIndex];
      transitionToFaction(nextKey, { focusOption: true });
    });
  });

  autoplayButton?.addEventListener('click', () => {
    autoEnabled = !autoEnabled;
    updateAutoplayButton();
    if (status) {
      status.textContent = autoEnabled
        ? '세력 메인 페이지 자동 전환을 시작했습니다.'
        : '세력 메인 페이지 자동 전환을 멈췄습니다.';
    }
    scheduleAutoAdvance();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAutoTimer();
    else scheduleAutoAdvance();
  });

  reducedMotionQuery?.addEventListener('change', event => {
    if (event.matches && autoEnabled) {
      autoEnabled = false;
      updateAutoplayButton();
      clearAutoTimer();
    }
  });

  if ('IntersectionObserver' in window && section) {
    const observer = new IntersectionObserver(entries => {
      sectionVisible = entries.some(entry => {
        if (!entry.isIntersecting) return false;
        // A long single-scroll section can never reach a 20% intersection ratio.
        // Use a viewport-relative visible-pixel threshold instead.
        const requiredPixels = Math.min(120, Math.max(72, window.innerHeight * 0.15));
        return entry.intersectionRect.height >= requiredPixels;
      });
      if (sectionVisible) scheduleAutoAdvance();
      else clearAutoTimer();
    }, { threshold: [0, 0.08, 0.15] });
    observer.observe(section);
  } else {
    sectionVisible = true;
  }

  applyFaction(root, 'ism', { announce: false, moveOptionIntoView: false });
  updateAutoplayButton();
  window.setTimeout(() => {
    root.classList.remove('main-anim-play');
    root.classList.add('main-intro-complete');
    scheduleAutoAdvance();
  }, reducedMotionQuery?.matches ? 0 : MAIN_INTRO_MS);
}
