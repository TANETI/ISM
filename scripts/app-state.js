export const UI_TIMING_MS = Object.freeze({
  focusFallback: 80,
  organizationTransition: 70,
  assetSearchDebounce: 90,
  detailNavigation: 150,
  detailClose: 280,
  searchDebounce: 120,
  countFlash: 400,
});

export function createAppState() {
  return {
    characters: [],
    characterByCode: new Map(),
    assetCharacterByCode: new Map(),
    detail: {
      currentCode: null,
      navigate: null,
      closeTimer: null,
      scrollController: null,
    },
    spoilers: {
      revealed: false,
      warned: false,
    },
    gallery: {
      currentAssetCode: null,
      currentEmotionCode: null,
      currentNsfwCode: null,
      prepared: false,
    },
    navigation: {
      currentSection: 'main',
      historyReady: false,
      isApplyingHistory: false,
      characterFilters: {
        q: '',
        scope: 'all',
        grades: [],
        species: [],
      },
      characterSearchContext: null,
      studentFilterContext: null,
      scrollController: null,
    },
    organizationTransitionTimer: 0,
    lightbox: {
      assets: [],
      index: -1,
    },
  };
}
