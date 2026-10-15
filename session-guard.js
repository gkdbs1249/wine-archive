(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SessionGuard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createSessionGuard() {
    let generation = 0;
    let controller = typeof AbortController === 'function' ? new AbortController() : null;
    let startPromise = null;
    let startGeneration = -1;
    return {
      snapshot() { return generation; },
      isCurrent(value) { return value === generation; },
      invalidate() {
        if (controller) controller.abort();
        generation += 1;
        controller = typeof AbortController === 'function' ? new AbortController() : null;
        return generation;
      },
      signal(value = generation) {
        if (value !== generation) throw new Error('Authentication session changed');
        return controller?.signal;
      },
      runStart(factory) {
        const current = generation;
        if (startPromise && startGeneration === current) return startPromise;
        let promise;
        promise = Promise.resolve().then(() => factory(current)).finally(() => {
          if (startPromise === promise) {
            startPromise = null;
            startGeneration = -1;
          }
        });
        startPromise = promise;
        startGeneration = current;
        return promise;
      },
    };
  }

  function guardClient(client, guard, generation) {
    const ensureCurrent = () => {
      if (!guard.isCurrent(generation)) throw new Error('Authentication session changed');
    };
    const wrap = (name) => async (...args) => {
      ensureCurrent();
      const result = await client[name](...args);
      ensureCurrent();
      return result;
    };
    return {
      realtime: client.realtime,
      listWines: wrap('listWines'),
      saveWine: wrap('saveWine'),
      insertWine: wrap('insertWine'),
      deleteWine: wrap('deleteWine'),
      listRatings: wrap('listRatings'),
      setRating: wrap('setRating'),
      insertRating: wrap('insertRating'),
      subscribe(onChange, onStatus) {
        ensureCurrent();
        return client.subscribe(
          (...args) => { if (guard.isCurrent(generation) && typeof onChange === 'function') onChange(...args); },
          (...args) => { if (guard.isCurrent(generation) && typeof onStatus === 'function') onStatus(...args); },
        );
      },
    };
  }

  return { createSessionGuard, guardClient };
});
