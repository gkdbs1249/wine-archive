(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BottleCutout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODULE_URL = './vendor/imgly-background-removal/index-1.7.0.mjs';
  const DATA_PATH = './vendor/imgly-background-removal/data/';
  let removerPromise = null;

  function resolveDataPath() {
    if (typeof document !== 'undefined' && document.baseURI) return new URL(DATA_PATH, document.baseURI).href;
    return DATA_PATH;
  }

  function loadDefaultRemover() {
    if (!removerPromise) {
      removerPromise = import(MODULE_URL)
        .then(module => module.removeBackground)
        .catch(error => {
          removerPromise = null;
          throw error;
        });
    }
    return removerPromise;
  }

  async function removeWithFallback(blob, options = {}) {
    const loadRemover = options.loadRemover || loadDefaultRemover;
    try {
      const removeBackground = await loadRemover();
      const progress = typeof options.onProgress === 'function'
        ? (...args) => { options.onProgress(...args); }
        : undefined;
      const result = await removeBackground(blob, {
        publicPath: options.publicPath || resolveDataPath(),
        device: 'cpu',
        model: 'isnet_quint8',
        output: { format: 'image/png', quality: 0.9 },
        progress,
      });
      if (!result) throw new Error('Background removal returned no image');
      return { blob: result, removed: true, error: null };
    } catch (error) {
      return { blob, removed: false, error };
    }
  }

  async function processWithFallback(source, removal, processResult) {
    if (!removal || !removal.removed) {
      return { value: source, removed: false, error: removal?.error || null };
    }
    try {
      return { value: await processResult(removal.blob), removed: true, error: null };
    } catch (error) {
      return { value: source, removed: false, error };
    }
  }

  return { MODULE_URL, DATA_PATH, removeWithFallback, processWithFallback };
});
