(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SyncGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createMutationGuard(onIdleRefresh) {
    let active = 0;
    let epoch = 0;
    let refreshDeferred = false;
    let refreshScheduled = false;

    function scheduleRefresh() {
      if (typeof onIdleRefresh !== 'function' || refreshScheduled) return;
      refreshScheduled = true;
      queueMicrotask(() => {
        refreshScheduled = false;
        onIdleRefresh();
      });
    }

    return {
      begin() {
        active += 1;
        epoch += 1;
      },
      end() {
        active = Math.max(0, active - 1);
        epoch += 1;
        if (active === 0 && refreshDeferred) {
          refreshDeferred = false;
          scheduleRefresh();
        }
      },
      deferRefresh() {
        if (active > 0) refreshDeferred = true;
        else scheduleRefresh();
      },
      snapshot() {
        return { active, epoch };
      },
      canApply(snapshot) {
        return Boolean(snapshot)
          && snapshot.active === 0
          && active === 0
          && snapshot.epoch === epoch;
      },
    };
  }

  return { createMutationGuard };
});
