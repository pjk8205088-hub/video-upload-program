(() => {
  const form = document.querySelector('#campaignForm');
  const naver = document.querySelector('#naverClipOptions');
  const instagram = document.querySelector('#instagramOptions');
  if (!form || !naver || !instagram) return;

  const grid = document.createElement('div');
  grid.className = 'platform-options-grid';
  grid.setAttribute('aria-label', 'SNS별 업로드 준비물');
  form.insertBefore(grid, instagram);
  grid.append(instagram, naver);

  const syncLayout = () => {
    const visiblePanels = [instagram, naver].filter((panel) => !panel.hidden).length;
    grid.classList.toggle('is-single', visiblePanels === 1);
  };
  new MutationObserver(syncLayout).observe(instagram, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(syncLayout).observe(naver, { attributes: true, attributeFilter: ['hidden'] });
  syncLayout();
})();
