(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WineStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WINES_KEY = 'wine-archive:custom-wines';
  const DELETED_KEY = 'wine-archive:deleted-wines';
  const MIGRATION_KEY = 'wine-archive:supabase-migration-v2-authenticated';
  const PENDING_UPSERTS_KEY = 'wine-archive:pending-wine-upserts';
  const PENDING_DELETES_KEY = 'wine-archive:pending-wine-deletes';
  const PENDING_RATINGS_KEY = 'wine-archive:pending-ratings';

  function markMigrationDirty(storage) {
    storage.setItem(MIGRATION_KEY, 'dirty');
  }

  function updatePendingIds(storage, key, addId, removeId) {
    const ids = new Set(readJson(storage, key, []).map(String));
    if (removeId) ids.delete(String(removeId));
    if (addId) ids.add(String(addId));
    storage.setItem(key, JSON.stringify([...ids]));
  }

  function readJson(storage, key, fallback) {
    if (!storage || typeof storage.getItem !== 'function') return fallback;
    try {
      const value = JSON.parse(storage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `wine-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeWine(input) {
    const name = String(input?.name || '').trim();
    if (!name) return null;
    const rawScore = input.externalScore;
    const score = rawScore === '' || rawScore === null || rawScore === undefined ? NaN : Number(rawScore);
    return {
      id: String(input.id || makeId()),
      name,
      vintage: String(input.vintage || '').trim(),
      country: String(input.country || '').trim(),
      externalScore: Number.isFinite(score) && score >= 0 && score <= 5 ? score : null,
      externalCount: String(input.externalCount || '').trim(),
      date: String(input.date || '').trim(),
      info: String(input.info || '').trim(),
      people: String(input.people || '').trim(),
      place: String(input.place || '').trim(),
      food: String(input.food || '').trim(),
      note: String(input.note || '').trim(),
      image: String(input.image || '').trim(),
      g: String(input.g || '').trim(),
      r: String(input.r || '').trim(),
      custom: input.custom !== false,
    };
  }

  function addWine(storage, input) {
    const wine = normalizeWine(input);
    if (!wine || !storage || typeof storage.setItem !== 'function') return null;
    const wines = readJson(storage, WINES_KEY, []).filter((item) => String(item.id) !== wine.id);
    wines.unshift(wine);
    storage.setItem(WINES_KEY, JSON.stringify(wines));
    const deleted = new Set(readJson(storage, DELETED_KEY, []).map(String));
    deleted.delete(wine.id);
    storage.setItem(DELETED_KEY, JSON.stringify([...deleted]));
    updatePendingIds(storage, PENDING_UPSERTS_KEY, wine.id);
    updatePendingIds(storage, PENDING_DELETES_KEY, null, wine.id);
    markMigrationDirty(storage);
    return wine;
  }

  function deleteWine(storage, id) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const wineId = String(id);
    const wines = readJson(storage, WINES_KEY, []).filter((wine) => wine.id !== wineId);
    storage.setItem(WINES_KEY, JSON.stringify(wines));
    const deleted = new Set(readJson(storage, DELETED_KEY, []));
    deleted.add(wineId);
    storage.setItem(DELETED_KEY, JSON.stringify([...deleted]));
    updatePendingIds(storage, PENDING_DELETES_KEY, wineId);
    updatePendingIds(storage, PENDING_UPSERTS_KEY, null, wineId);
    const pendingRatings = readJson(storage, PENDING_RATINGS_KEY, [])
      .filter((row) => !row || String(row.wineId) !== wineId);
    storage.setItem(PENDING_RATINGS_KEY, JSON.stringify(pendingRatings));
    markMigrationDirty(storage);
    return true;
  }

  function getVisibleWines(baseWines, storage) {
    const deleted = new Set(readJson(storage, DELETED_KEY, []));
    const custom = readJson(storage, WINES_KEY, []).filter((wine) => !deleted.has(String(wine.id)));
    const overrideIds = new Set(custom.map((wine) => String(wine.id)));
    const base = (baseWines || []).filter((wine) => !deleted.has(String(wine.id)) && !overrideIds.has(String(wine.id)));
    return [...custom, ...base];
  }

  function markWineSynced(storage, input) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const wine = normalizeWine(input);
    if (!wine) return false;
    const stored = readJson(storage, WINES_KEY, []).find((item) => String(item.id) === wine.id);
    if (!stored || JSON.stringify(normalizeWine(stored)) !== JSON.stringify(wine)) return false;
    updatePendingIds(storage, PENDING_UPSERTS_KEY, null, wine.id);
    const pending = [
      ...readJson(storage, PENDING_UPSERTS_KEY, []),
      ...readJson(storage, PENDING_DELETES_KEY, []),
      ...readJson(storage, PENDING_RATINGS_KEY, []),
    ];
    storage.setItem(MIGRATION_KEY, pending.length ? 'dirty' : 'complete');
    return true;
  }

  function markWineDeletionSynced(storage, id) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const wineId = String(id || '');
    const pendingDeletes = readJson(storage, PENDING_DELETES_KEY, []).map(String);
    const deleted = readJson(storage, DELETED_KEY, []).map(String);
    const stored = readJson(storage, WINES_KEY, []).some((wine) => String(wine.id) === wineId);
    if (!wineId || stored || !pendingDeletes.includes(wineId) || !deleted.includes(wineId)) return false;
    updatePendingIds(storage, PENDING_DELETES_KEY, null, wineId);
    const pending = [
      ...readJson(storage, PENDING_UPSERTS_KEY, []),
      ...readJson(storage, PENDING_DELETES_KEY, []),
      ...readJson(storage, PENDING_RATINGS_KEY, []),
    ];
    storage.setItem(MIGRATION_KEY, pending.length ? 'dirty' : 'complete');
    return true;
  }

  function requeueWineMutation(storage, id) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const wineId = String(id || '');
    if (!wineId) return false;
    const deleted = new Set(readJson(storage, DELETED_KEY, []).map(String));
    if (deleted.has(wineId)) {
      updatePendingIds(storage, PENDING_DELETES_KEY, wineId);
      updatePendingIds(storage, PENDING_UPSERTS_KEY, null, wineId);
      markMigrationDirty(storage);
      return true;
    }
    const stored = readJson(storage, WINES_KEY, []).some((wine) => String(wine.id) === wineId);
    if (!stored) return false;
    updatePendingIds(storage, PENDING_UPSERTS_KEY, wineId);
    updatePendingIds(storage, PENDING_DELETES_KEY, null, wineId);
    markMigrationDirty(storage);
    return true;
  }

  return { normalizeWine, addWine, deleteWine, getVisibleWines, markWineSynced, markWineDeletionSynced, requeueWineMutation };
});
