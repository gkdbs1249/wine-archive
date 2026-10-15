(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PanelState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let lastOpener = null;

  function lockPageScroll(doc, win) {
    const body = doc?.body;
    if (!body || body.classList.contains('detail-open')) return;
    const scrollY = Math.max(0, Number(win?.scrollY) || 0);
    body.dataset.detailScrollY = String(scrollY);
    body.style.top = `-${scrollY}px`;
    body.classList.add('detail-open');
  }

  function unlockPageScroll(doc, win) {
    const body = doc?.body;
    if (!body || !body.classList.contains('detail-open')) return;
    const scrollY = Math.max(0, Number(body.dataset.detailScrollY) || 0);
    body.classList.remove('detail-open');
    body.style.top = '';
    delete body.dataset.detailScrollY;
    if (win && typeof win.scrollTo === 'function') {
      win.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
    }
  }

  function activateDetail(doc, win, options = {}) {
    const { panel, background = [], opener = null, closeButton = null } = options;
    lastOpener = opener || doc?.activeElement || null;
    lockPageScroll(doc, win);
    if (panel && typeof panel.setAttribute === 'function') panel.setAttribute('aria-hidden', 'false');
    background.forEach((element) => { if (element) element.inert = true; });
    if (closeButton && typeof closeButton.focus === 'function') closeButton.focus({ preventScroll: true });
  }

  function deactivateDetail(doc, win, options = {}) {
    const { panel, background = [] } = options;
    if (panel && typeof panel.setAttribute === 'function') panel.setAttribute('aria-hidden', 'true');
    background.forEach((element) => { if (element) element.inert = false; });
    unlockPageScroll(doc, win);
    const opener = lastOpener;
    lastOpener = null;
    if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  }

  return { lockPageScroll, unlockPageScroll, activateDetail, deactivateDetail };
});
