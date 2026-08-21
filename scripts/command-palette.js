/* 열람 색인 — Ctrl/⌘ + K
   인물, 상위 섹션과 세계관 패널을 한 입력창에서 찾아 이동한다.

   이 모듈은 UI와 검색 순위만 담당한다. 실제 이동은 app.js가 넘겨준
   onSelect 콜백이 수행하므로 단일 스크롤 해시 라우팅 규칙을 벗어나지 않는다.
   항목 목록도 app.js가 만들어 넘긴다. 이 파일은 characters.json을 알지 못한다. */

const RANK = Object.freeze({
  exactCode: 0,
  labelPrefix: 1,
  codePrefix: 2,
  labelContains: 3,
  textContains: 4,
  compactContains: 5,
  miss: 99,
});

const MAX_RESULTS = 40;

/* 질의 하나에 대한 항목의 순위. 낮을수록 먼저 나온다. */
function scoreEntry(entry, query, compactQuery) {
  const search = entry.search || {};
  const codes = search.codes || [];
  if (codes.some(code => code === query)) return RANK.exactCode;

  const label = search.label || '';
  if (label.startsWith(query)) return RANK.labelPrefix;
  if (codes.some(code => code.startsWith(query))) return RANK.codePrefix;
  if (label.includes(query)) return RANK.labelContains;
  if ((search.text || '').includes(query)) return RANK.textContains;
  if (compactQuery && (search.compact || '').includes(compactQuery)) return RANK.compactContains;
  return RANK.miss;
}

function rankEntries(entries, query, compactQuery) {
  if (!query) {
    return entries.slice().sort((a, b) => a.weight - b.weight || a.order - b.order).slice(0, MAX_RESULTS);
  }
  return entries
    .map(entry => ({ entry, rank: scoreEntry(entry, query, compactQuery) }))
    .filter(scored => scored.rank !== RANK.miss)
    .sort((a, b) => a.rank - b.rank || a.entry.weight - b.entry.weight || a.entry.order - b.entry.order)
    .slice(0, MAX_RESULTS)
    .map(scored => scored.entry);
}

function buildDom() {
  const root = document.createElement('div');
  root.className = 'cmdk';
  root.id = 'command-palette';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '열람 색인');
  root.innerHTML = `
    <div class="cmdk-backdrop" data-cmdk-dismiss></div>
    <div class="cmdk-panel">
      <div class="cmdk-field">
        <span class="cmdk-prompt" aria-hidden="true">▸</span>
        <input class="cmdk-input" type="text" name="command-search" autocomplete="off" spellcheck="false"
               role="combobox" aria-expanded="true" aria-controls="cmdk-results"
               aria-autocomplete="list" aria-label="이름, 코드, 종족, 세력 또는 섹션 검색"
               placeholder="이름, 코드, 종족, 세력, 섹션…">
        <button class="cmdk-dismiss" type="button" data-cmdk-dismiss aria-label="열람 색인 닫기">Esc</button>
      </div>
      <ul class="cmdk-results" id="cmdk-results" role="listbox" aria-label="검색 결과"></ul>
      <p class="cmdk-empty" hidden>일치하는 기록이 없습니다.</p>
      <p class="cmdk-foot">
        <span><b>↑</b><b>↓</b> 이동</span>
        <span><b>Enter</b> 열기</span>
        <span><b>Esc</b> 닫기</span>
      </p>
    </div>
  `;
  return root;
}

export function createCommandPalette({
  getEntries,
  onSelect,
  onOpen,
  onClose,
  normalizeText = value => String(value || '').trim().toLowerCase(),
  compactText = value => String(value || '').replace(/\s+/g, '').toLowerCase(),
  reducedMotionQuery = null,
} = {}) {
  if (typeof getEntries !== 'function' || typeof onSelect !== 'function') return null;

  const root = buildDom();
  document.body.appendChild(root);

  const input = root.querySelector('.cmdk-input');
  const list = root.querySelector('.cmdk-results');
  const empty = root.querySelector('.cmdk-empty');

  let visible = [];
  let activeIndex = 0;
  let isOpen = false;
  let lastFocused = null;

  const setActive = index => {
    const rows = list.children;
    if (!rows.length) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = Math.max(0, Math.min(rows.length - 1, index));
    for (let i = 0; i < rows.length; i += 1) {
      const selected = i === activeIndex;
      rows[i].classList.toggle('is-active', selected);
      rows[i].setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    const active = rows[activeIndex];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    const query = normalizeText(input.value);
    const compactQuery = compactText(input.value);
    visible = rankEntries(getEntries(), query, compactQuery);

    list.textContent = '';
    visible.forEach((entry, index) => {
      const row = document.createElement('li');
      row.className = `cmdk-row cmdk-row--${entry.kind}`;
      row.id = `cmdk-row-${index}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.dataset.index = String(index);
      if (entry.accent) row.style.setProperty('--cmdk-accent', entry.accent);

      const mark = document.createElement('span');
      mark.className = 'cmdk-row-mark';
      mark.setAttribute('aria-hidden', 'true');

      const code = document.createElement('span');
      code.className = 'cmdk-row-code';
      code.textContent = entry.code || '';

      const label = document.createElement('span');
      label.className = 'cmdk-row-label';
      label.textContent = entry.label;

      const sub = document.createElement('span');
      sub.className = 'cmdk-row-sub';
      sub.textContent = entry.sub || '';

      row.append(mark, code, label, sub);
      list.appendChild(row);
    });

    empty.hidden = visible.length > 0;
    list.hidden = visible.length === 0;
    setActive(0);
  };

  const close = ({ restoreFocus = true } = {}) => {
    if (!isOpen) return;
    isOpen = false;
    root.classList.remove('is-open');
    root.hidden = true;
    input.value = '';
    list.textContent = '';
    visible = [];
    onClose?.();
    if (restoreFocus && lastFocused?.isConnected) {
      try {
        lastFocused.focus({ preventScroll: true });
      } catch {
        /* 포커스 복원 실패는 무시한다. */
      }
    }
    lastFocused = null;
  };

  const open = () => {
    if (isOpen) return;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    isOpen = true;
    root.hidden = false;
    // 첫 프레임에 hidden이 풀린 뒤 전환이 걸리도록 한 틱 미룬다.
    if (reducedMotionQuery?.matches) root.classList.add('is-open');
    else window.requestAnimationFrame(() => root.classList.add('is-open'));
    onOpen?.();
    render();
    input.focus({ preventScroll: true });
  };

  const choose = index => {
    const entry = visible[index];
    if (!entry) return;
    close({ restoreFocus: false });
    onSelect(entry);
  };

  input.addEventListener('input', render);

  root.addEventListener('click', event => {
    if (event.target.closest('[data-cmdk-dismiss]')) {
      close();
      return;
    }
    const row = event.target.closest('.cmdk-row');
    if (row) choose(Number(row.dataset.index));
  });

  root.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActive(list.children.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // 문서 단계의 Escape 처리가 상세창까지 함께 닫지 않도록 막는다.
      event.stopPropagation();
      close();
    }
  });

  return {
    element: root,
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    isOpen: () => isOpen,
  };
}
