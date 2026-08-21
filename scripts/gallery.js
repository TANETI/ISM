export const ASSET_ORG_ORDER = Object.freeze(['ism', 'pbs', 'hprf', 'wf', 'rtn', 'nf']);

/* `spoiler`는 스포일러 인물을 공개 목록에서 걸러 내기 위한 데이터 분류이며
   화면에서는 무소속과 같은 칸이다. 검증기가 spoiler org와 spoilerOnly를 짝으로
   묶어 두었으므로 데이터는 그대로 두고 표시할 때만 합친다. */
export function assetOrgBucket(org) {
  return org === 'spoiler' ? 'nf' : org;
}
export const ASSET_ORG_LABELS = Object.freeze({
  ism: 'ISM 아카데미',
  pbs: '원혈회',
  hprf: '인간보전전선',
  wf: '백색울타리',
  rtn: '귀향파',
  nf: '무소속',
});

export function compareAssetCharacters(first, second, getCharacterOrg) {
  const orgDifference = ASSET_ORG_ORDER.indexOf(assetOrgBucket(getCharacterOrg(first)))
    - ASSET_ORG_ORDER.indexOf(assetOrgBucket(getCharacterOrg(second)));
  if (orgDifference) return orgDifference;
  const nameDifference = String(first?.name || '').localeCompare(String(second?.name || ''), 'ko-KR', {
    sensitivity: 'base',
    numeric: true,
  });
  return nameDifference || String(first?.code || '').localeCompare(String(second?.code || ''), 'en');
}

export function groupAssetCharacters(characters, getCharacterOrg) {
  return [...characters]
    .sort((first, second) => compareAssetCharacters(first, second, getCharacterOrg))
    .reduce((groups, character) => {
      const organization = assetOrgBucket(getCharacterOrg(character));
      if (!groups.has(organization)) groups.set(organization, []);
      groups.get(organization).push(character);
      return groups;
    }, new Map());
}

export function setAssetOrgGroupCollapsed(group, collapsed) {
  if (!group) return;
  group.classList.toggle('is-collapsed', collapsed);
  group.querySelector('.assets-org-toggle')?.setAttribute('aria-expanded', String(!collapsed));
}

/* 첫 진입에 펼쳐 둘 소속. 갤러리에 들어오자마자 빈 화면과 "조직을 펼치세요"를
   만나던 2단 드릴다운을 없앤다. ISM은 이 사이트의 본체이고 인원도 가장 많아
   기본으로 열어 둔다 — 명부가 이미 같은 규칙을 쓰고 있다. */
const DEFAULT_OPEN_ASSET_ORG = 'ism';

export function collapsedAssetOrganizations(sidebar) {
  const groups = Array.from(sidebar.querySelectorAll('.assets-org-group'));
  if (!groups.length) return new Set(ASSET_ORG_ORDER.filter(org => org !== DEFAULT_OPEN_ASSET_ORG));
  return new Set(
    groups
      .filter(group => group.dataset.preSearchCollapsed === '1' ||
        (group.dataset.preSearchCollapsed === undefined && group.classList.contains('is-collapsed')))
      .map(group => group.dataset.org)
  );
}

export function createGallerySidebarTools({
  getCardDisplayName,
  setElementSearchDataset,
  cardImgAttrs,
  bindImageLoadState,
  escapeHTML,
  getCharacterOrg,
  accentColorFor = () => '',
  scrollAssetViewerIntoView,
  exactCodeSearchToken,
  elementMatchesSearch,
  debounce,
  bindSearchEvents,
  assetSearchDebounce,
  makeButtonElement,
  makeTextElement,
  getCurrentAssetCode,
}) {
  function createAssetSidebarItem(c, previousActive) {
    const displayName = getCardDisplayName(c);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `assets-char-item${c.isSpoilerAsset ? ' is-spoiler-asset' : ''}`;
    item.dataset.code = c.code;
    // 에셋을 고를 때도 소속이 바로 읽히도록 명부와 같은 색 체계를 쓴다.
    // 아카데미는 학년색, 외부 인물은 소속 세력색이다.
    item.dataset.org = getCharacterOrg(c);
    const accent = accentColorFor(c);
    if (accent) item.style.setProperty('--asset-item-accent', accent);
    setElementSearchDataset(item, c, displayName);
    item.innerHTML = `
      <div class="assets-char-item-img">
        <img ${cardImgAttrs(c, '')}>
      </div>
      <span class="assets-char-item-name" title="${escapeHTML(c.name || '')}">
        ${escapeHTML(displayName)}
        ${c.isSpoilerAsset ? '<small>스포일러 기록</small>' : ''}
      </span>
    `;
    const img = item.querySelector('img');
    bindImageLoadState(img, item.querySelector('.assets-char-item-img'), { hideOnError: false });
    img?.addEventListener('error', event => {
      event.currentTarget.style.opacity = '0.2';
    });
    if (c.code === previousActive) item.classList.add('active');
    return item;
  }

  function makeAssetOrganizationFragment(sidebarEl, chars, collapsedOrgs, previousActive) {
    const fragment = document.createDocumentFragment();
    const groupedCharacters = groupAssetCharacters(chars, getCharacterOrg);

    ASSET_ORG_ORDER.forEach(org => {
      const orgCharacters = groupedCharacters.get(org);
      if (!orgCharacters?.length) return;

      const group = document.createElement('section');
      const itemsId = `${sidebarEl.id}-${org}-items`;
      group.className = `assets-org-group assets-org-group--${org}`;
      group.dataset.org = org;
      group.innerHTML = `
        <button class="assets-org-toggle" type="button" aria-expanded="${collapsedOrgs.has(org) ? 'false' : 'true'}" aria-controls="${itemsId}">
          <span class="assets-org-name">${escapeHTML(ASSET_ORG_LABELS[org] || org.toUpperCase())}</span>
          <span class="assets-org-count" aria-hidden="true">${orgCharacters.length}</span>
          <span class="assets-org-icon" aria-hidden="true">⌄</span>
        </button>
        <div class="assets-org-items" id="${itemsId}"></div>
      `;
      const items = group.querySelector('.assets-org-items');
      orgCharacters.forEach(character => items.appendChild(createAssetSidebarItem(character, previousActive)));
      setAssetOrgGroupCollapsed(group, collapsedOrgs.has(org));
      fragment.appendChild(group);
    });
    return fragment;
  }

  function bindAssetSidebarDelegation(sidebarEl) {
    if (sidebarEl.dataset.assetClickBound === '1') return;
    sidebarEl.dataset.assetClickBound = '1';
    sidebarEl.addEventListener('click', event => {
      const toggle = event.target.closest('.assets-org-toggle');
      if (toggle && sidebarEl.contains(toggle)) {
        const group = toggle.closest('.assets-org-group');
        setAssetOrgGroupCollapsed(group, !group.classList.contains('is-collapsed'));
        return;
      }
      const item = event.target.closest('.assets-char-item[data-code]');
      if (!item || !sidebarEl.contains(item)) return;
      sidebarEl._assetSelect?.(item.dataset.code, item);
      scrollAssetViewerIntoView(sidebarEl);
    });
  }

  function updateAssetSidebarSearch(sidebarEl, searchInput, emptyMessage) {
    const term = searchInput.value.trim();
    const items = Array.from(sidebarEl.querySelectorAll('.assets-char-item'));
    const exactCodeToken = exactCodeSearchToken(term, items);
    let visibleCount = 0;
    sidebarEl.classList.toggle('is-searching', !!term);

    sidebarEl.querySelectorAll('.assets-org-group').forEach(group => {
      const groupItems = Array.from(group.querySelectorAll('.assets-char-item'));
      const groupVisibleCount = groupItems.reduce((count, item) => {
        const visible = elementMatchesSearch(item, term, exactCodeToken);
        item.style.display = visible ? '' : 'none';
        return count + Number(visible);
      }, 0);
      visibleCount += groupVisibleCount;
      group.hidden = !!term && groupVisibleCount === 0;
      const count = group.querySelector('.assets-org-count');
      if (count) count.textContent = term ? `${groupVisibleCount}/${groupItems.length}` : String(groupItems.length);
      if (term) {
        if (group.dataset.preSearchCollapsed === undefined) {
          group.dataset.preSearchCollapsed = group.classList.contains('is-collapsed') ? '1' : '0';
        }
        setAssetOrgGroupCollapsed(group, false);
      } else if (group.dataset.preSearchCollapsed !== undefined) {
        setAssetOrgGroupCollapsed(group, group.dataset.preSearchCollapsed === '1');
        delete group.dataset.preSearchCollapsed;
      }
    });
    emptyMessage.style.display = (term && visibleCount === 0) ? '' : 'none';
  }

  function bindAssetSidebarSearch(sidebarEl, searchInput, emptyMessage) {
    const filterSidebarItems = debounce(
      () => updateAssetSidebarSearch(sidebarEl, searchInput, emptyMessage),
      assetSearchDebounce
    );
    sidebarEl._searchUnbind?.();
    sidebarEl._searchUnbind = bindSearchEvents(searchInput, filterSidebarItems);
    filterSidebarItems();
  }

  function buildAssetSidebar(sidebarEl, chars, onSelect, options = {}) {
    if (!sidebarEl) return;
    const label = sidebarEl.querySelector('.assets-sidebar-label');
    const previousSearch = sidebarEl.querySelector('.assets-sidebar-search')?.value || '';
    const previousActive = sidebarEl.querySelector('.assets-char-item.active')?.dataset.code || getCurrentAssetCode() || '';
    const collapsedOrgs = collapsedAssetOrganizations(sidebarEl);

    const controls = document.createElement('div');
    controls.className = 'assets-sidebar-controls';
    controls.innerHTML = '<input class="assets-sidebar-search" type="search" name="gallery-character-search" aria-label="갤러리 캐릭터 검색" placeholder="캐릭터 검색…" autocomplete="off">';
    const searchInput = controls.querySelector('.assets-sidebar-search');
    searchInput.value = previousSearch;

    const spoilerButton = options.onToggleSpoilers
      ? makeButtonElement({
          className: `assets-spoiler-toggle${options.spoilersRevealed ? ' is-revealed' : ''}`,
          text: options.spoilersRevealed ? '스포일러 숨기기' : '스포일러 표시',
          onClick: options.onToggleSpoilers,
        })
      : null;
    spoilerButton?.setAttribute('aria-pressed', String(!!options.spoilersRevealed));
    // 검색창과 스포일러 단추는 같은 묶음이다. 형제로 두면 가로 스트립에서
    // 단추가 독립 칸이 되어 제 폭을 못 받고 글자가 세로로 찌그러진다.
    if (spoilerButton) controls.appendChild(spoilerButton);

    const emptyMessage = makeTextElement('div', 'assets-sidebar-empty', '검색 결과가 없습니다.');
    emptyMessage.style.display = 'none';
    const organizations = makeAssetOrganizationFragment(sidebarEl, chars, collapsedOrgs, previousActive);
    sidebarEl.replaceChildren(...[label, controls, emptyMessage, organizations].filter(Boolean));

    sidebarEl._assetSelect = onSelect;
    bindAssetSidebarDelegation(sidebarEl);
    bindAssetSidebarSearch(sidebarEl, searchInput, emptyMessage);
  }


  function setAssetSidebarActive(sidebarSelector, code) {
    document.querySelectorAll(`${sidebarSelector} .assets-char-item`).forEach(item => {
      item.classList.toggle('active', item.dataset.code === code);
    });
    const activeItem = document.querySelector(`${sidebarSelector} .assets-char-item.active`);
    setAssetOrgGroupCollapsed(activeItem?.closest('.assets-org-group'), false);
  }


  return { buildAssetSidebar, setAssetSidebarActive };
}

export function normalizeLightboxAssets(assets) {
  if (!Array.isArray(assets)) return [];
  return assets
    .map(asset => typeof asset === 'string' ? { url: asset, label: '' } : asset)
    .filter(asset => asset?.url)
    .map(asset => ({ url: String(asset.url), label: String(asset.label || '') }));
}
