export const SECTION_IDS = Object.freeze(['main', 'factions', 'world', 'schedule', 'characters']);
export const CHARACTER_SCOPES = Object.freeze(['all', 'ism', 'external', 'student', 'staff']);
const SECTION_TITLES = Object.freeze({
  main: '이종족은 좋아하세요?',
  factions: 'Factions · 이종족은 좋아하세요?',
  characters: 'Characters · 이종족은 좋아하세요?',
  schedule: 'Schedule · 이종족은 좋아하세요?',
  world: 'World · 이종족은 좋아하세요?',
});

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export function stateFromLocation(locationObject = window.location) {
  const rawHash = locationObject.hash.replace(/^#/, '');
  const [pathPart, queryPart = ''] = rawHash.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const section = SECTION_IDS.includes(parts[0]) ? parts[0] : 'main';
  const detail = parts[1] && parts[1] !== 'lightbox' ? safeDecodeURIComponent(parts[1]) : null;
  const lightbox = parts.includes('lightbox');
  const params = new URLSearchParams(queryPart);
  const requestedScope = params.get('scope') || 'all';
  return {
    section,
    detail,
    lightbox,
    lightboxUrl: params.get('src') || null,
    lightboxLabel: params.get('label') || '',
    lightboxAssets: [],
    lightboxIndex: -1,
    characterFilters: {
      q: params.get('q') || '',
      scope: CHARACTER_SCOPES.includes(requestedScope) ? requestedScope : 'all',
      grades: params.getAll('grade')
        .map(Number)
        .filter(grade => Number.isInteger(grade) && grade >= 1 && grade <= 3),
      species: params.getAll('species')
        .map(value => value.trim())
        .filter(Boolean),
    },
  };
}

export function activateSection(targetId) {
  const normalized = SECTION_IDS.includes(targetId) ? targetId : 'main';

  SECTION_IDS.forEach(sectionId => {
    const section = document.getElementById(`section-${sectionId}`);
    if (!section) return;
    const active = sectionId === normalized;
    section.hidden = false;
    // Do not overwrite `inert` here. Overlay focus management owns that state.
    // Re-enabling sections during a modal/lightbox would leak focus behind it.
    section.setAttribute('aria-hidden', 'false');
    section.classList.toggle('active', active);
  });

  document.querySelectorAll('[data-section-index]').forEach(link => {
    const active = link.dataset.sectionIndex === normalized;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  document.title = SECTION_TITLES[normalized] || SECTION_TITLES.main;

  if (normalized === 'factions') {
    document.querySelector('#section-factions .main-inner')?.classList.add('main-anim-play');
  }
}

function shouldHandleInternalNavigation(event, element) {
  if (!(element instanceof HTMLAnchorElement)) return true;
  return event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;
}

function bindInternalNavigation(element, navigate) {
  element.addEventListener('click', event => {
    if (!shouldHandleInternalNavigation(event, element)) return;
    if (element instanceof HTMLAnchorElement) event.preventDefault();
    navigate();
  });
}

export function bindNavigationEvents({ navigate }) {
  document.querySelectorAll('[data-nav-target]').forEach(element => {
    bindInternalNavigation(element, () => navigate(element.dataset.navTarget));
  });
  document.querySelectorAll('[data-section-index]').forEach(link => {
    bindInternalNavigation(link, () => navigate(link.dataset.sectionIndex));
  });
}

export function createSectionScrollController({ onSectionChange } = {}) {
  const sections = SECTION_IDS
    .map(id => document.getElementById(`section-${id}`))
    .filter(Boolean);
  if (!sections.length) return null;

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let current = '';
  let disposed = false;

  sections.forEach(section => {
    section.hidden = false;
    // Preserve an existing overlay lock when the controller is initialized.
    section.setAttribute('aria-hidden', 'false');
    section.classList.add('section-scroll-ready');
  });

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-scroll-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  sections.forEach(section => revealObserver.observe(section));

  function nearestSection() {
    const marker = window.scrollY + window.innerHeight * 0.36;
    let selected = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= marker) selected = section;
      else break;
    }
    return selected.id.replace(/^section-/, '');
  }

  function update() {
    frame = 0;
    if (disposed) return;
    const next = nearestSection();
    if (next === current) return;
    current = next;
    activateSection(next);
    onSectionChange?.(next);
  }

  function scheduleUpdate() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(update);
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  reduceMotion?.addEventListener?.('change', scheduleUpdate);
  requestAnimationFrame(() => {
    sections[0]?.classList.add('is-scroll-visible');
    update();
  });

  return {
    refresh: scheduleUpdate,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      revealObserver.disconnect();
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      reduceMotion?.removeEventListener?.('change', scheduleUpdate);
    },
  };
}
