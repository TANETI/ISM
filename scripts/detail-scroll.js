// Shared detail-page scrolling. Keep reveal state independent from observers:
// mobile viewport changes must never leave a rendered profile permanently hidden.
export function createDetailScrollController({ modal, profilePage, guide, reduceMotion }) {
  if (!modal || !profilePage) return null;

  let disposed = false;
  const profileTop = () => profilePage.offsetTop;
  const revealProfile = () => {
    if (disposed || profilePage.classList.contains('is-visible')) return;
    profilePage.classList.add('is-visible');
  };
  const profileHasEnteredViewport = () => (
    modal.scrollTop + modal.clientHeight >= profileTop() + Math.min(80, modal.clientHeight * 0.12)
  );
  const onScroll = () => {
    modal.classList.toggle('has-detail-scroll', modal.scrollTop > 48);
    if (profileHasEnteredViewport()) revealProfile();
  };
  const moveToProfile = () => {
    if (disposed || modal.scrollTop >= profileTop() - 2) {
      revealProfile();
      return false;
    }

    // Start the reveal with the same transition used for direct scrolling.
    revealProfile();
    modal.scrollTo({ top: profileTop(), behavior: reduceMotion?.() ? 'auto' : 'smooth' });
    return true;
  };

  modal.addEventListener('scroll', onScroll, { passive: true });
  guide?.addEventListener('click', moveToProfile);
  onScroll();

  return {
    moveToProfile,
    dispose() {
      if (disposed) return;
      disposed = true;
      modal.removeEventListener('scroll', onScroll);
      guide?.removeEventListener('click', moveToProfile);
      modal.classList.remove('has-detail-scroll');
    },
  };
}
