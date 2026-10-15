(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SyncRetry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createSyncRetryController(options = {}) {
    const retry = options.retry;
    const delay = Number(options.delay) || 10_000;
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    let timerId = null;
    let running = false;
    let generation = 0;
    let rerunRequested = false;

    async function run(runGeneration = generation) {
      timerId = null;
      if (runGeneration !== generation || running || typeof retry !== 'function') return false;
      running = true;
      let synced = false;
      try {
        synced = Boolean(await retry());
      } catch {
        synced = false;
      } finally {
        running = false;
      }
      if (runGeneration !== generation) return synced;
      if (rerunRequested) {
        rerunRequested = false;
        schedule();
      } else if (!synced) schedule();
      return synced;
    }

    function schedule() {
      if (timerId !== null || running) return;
      const scheduledGeneration = generation;
      timerId = setTimer(() => run(scheduledGeneration), delay);
    }

    function stop() {
      generation += 1;
      rerunRequested = false;
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
    }

    async function trigger() {
      if (running) {
        rerunRequested = true;
        return false;
      }
      stop();
      return run(generation);
    }

    return { schedule, stop, trigger };
  }

  return { createSyncRetryController };
});
