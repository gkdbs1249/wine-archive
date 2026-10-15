(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WineRatings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIGRATION_KEY = 'wine-archive:supabase-migration-v2-authenticated';
  const PENDING_RATINGS_KEY = 'wine-archive:pending-ratings';

  function readPendingRatings(storage) {
    try {
      const rows = JSON.parse(storage.getItem(PENDING_RATINGS_KEY));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function normalizeRating(value) {
    const rating = Number(value);
    return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
  }

  function ratingStorageKey(wineName, person) {
    return `wine-archive:rating:${encodeURIComponent(wineName)}:${encodeURIComponent(person)}`;
  }

  function getStoredRating(storage, wineName, person) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    return normalizeRating(storage.getItem(ratingStorageKey(wineName, person)));
  }

  function setStoredRating(storage, wineName, person, value) {
    const rating = normalizeRating(value);
    if (!rating || !storage || typeof storage.setItem !== 'function') return null;
    storage.setItem(ratingStorageKey(wineName, person), String(rating));
    const key = `${wineName}\u0000${person}`;
    const pending = new Map(readPendingRatings(storage)
      .filter((row) => row && typeof row.wineId === 'string' && typeof row.person === 'string')
      .map((row) => [`${row.wineId}\u0000${row.person}`, row]));
    pending.set(key, { wineId: String(wineName), person: String(person) });
    storage.setItem(PENDING_RATINGS_KEY, JSON.stringify([...pending.values()]));
    storage.setItem(MIGRATION_KEY, 'dirty');
    return rating;
  }

  function createWriteQueue() {
    const tails = new Map();
    return {
      enqueue(key, task) {
        const queueKey = String(key);
        const previous = tails.get(queueKey) || Promise.resolve();
        const current = previous.catch(() => {}).then(task);
        tails.set(queueKey, current);
        current.finally(() => {
          if (tails.get(queueKey) === current) tails.delete(queueKey);
        }).catch(() => {});
        return current;
      },
      isIdle(key) {
        return !tails.has(String(key));
      },
    };
  }

  return { normalizeRating, ratingStorageKey, getStoredRating, setStoredRating, createWriteQueue };
});
