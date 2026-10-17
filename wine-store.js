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
  const ARCHIVE_PRESETS_KEY = 'wine-archive:archive-presets';

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

  function sortWinesNewestFirst(wines) {
    const sortableDate = (value) => {
      const date = String(value || '');
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!match) return '';
      const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      return parsed.getUTCFullYear() === Number(match[1])
        && parsed.getUTCMonth() === Number(match[2]) - 1
        && parsed.getUTCDate() === Number(match[3]) ? date : '';
    };
    return (Array.isArray(wines) ? wines : [])
      .map((wine, index) => ({ wine, index, date: sortableDate(wine?.date) }))
      .sort((left, right) => {
        if (!left.date && right.date) return 1;
        if (left.date && !right.date) return -1;
        return right.date.localeCompare(left.date) || left.index - right.index;
      })
      .map(({ wine }) => wine);
  }

  const COUNTRY_NAMES = {
    france: '프랑스', spain: '스페인', italy: '이탈리아', portugal: '포르투갈', germany: '독일', austria: '오스트리아',
    chile: '칠레', argentina: '아르헨티나', australia: '호주', 'new zealand': '뉴질랜드', 'south africa': '남아프리카공화국',
    usa: '미국', us: '미국', 'united states': '미국', korea: '대한민국', 'south korea': '대한민국',
  };

  function normalizeCountryName(value) {
    const country = String(value || '').trim().replace(/\s+/g, ' ');
    return COUNTRY_NAMES[country.toLowerCase()] || country;
  }

  function groupWinesByCountry(wines) {
    const grouped = new Map();
    sortWinesNewestFirst(wines).forEach((wine) => {
      const country = normalizeCountryName(wine?.country);
      if (!country) return;
      if (!grouped.has(country)) grouped.set(country, []);
      grouped.get(country).push(wine);
    });
    return [...grouped.entries()]
      .map(([country, countryWines]) => ({ country, count: countryWines.length, wines: countryWines }))
      .sort((left, right) => left.country.localeCompare(right.country, 'ko'));
  }

  function normalizePersonName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').replace(/(?:이랑|랑|하고|와|과)$/u, '').trim();
  }

  function personNames(value) {
    return [...new Set(String(value || '')
      .replace(/(?:이랑|랑|하고|와|과)\s+/gu, ',')
      .split(/[,·/&+]|\band\b/iu)
      .map(normalizePersonName)
      .filter(Boolean))];
  }

  function normalizePlaceName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').replace(/에서$/u, '').trim();
  }

  function groupWines(wines, valuesForWine, key) {
    const grouped = new Map();
    sortWinesNewestFirst(wines).forEach((wine) => {
      [...new Set(valuesForWine(wine))].forEach((value) => {
        if (!value) return;
        if (!grouped.has(value)) grouped.set(value, []);
        grouped.get(value).push(wine);
      });
    });
    return [...grouped.entries()]
      .map(([value, groupedWines]) => ({ [key]: value, count: groupedWines.length, wines: groupedWines }))
      .sort((left, right) => left[key].localeCompare(right[key], 'ko'));
  }

  function groupWinesByPerson(wines) {
    return groupWines(wines, (wine) => personNames(wine?.people), 'person');
  }

  function groupWinesByPlace(wines) {
    return groupWines(wines, (wine) => {
      const place = normalizePlaceName(wine?.place);
      return place ? [place] : [];
    }, 'place');
  }

  function sanitizePresetValues(values, type) {
    if (!Array.isArray(values)) return [];
    const normalize = type === 'people' ? normalizePersonName : normalizePlaceName;
    return [...new Set(values
      .filter((value) => typeof value === 'string')
      .map(normalize)
      .filter((value) => value && value.length <= 160))];
  }

  function addArchivePreset(storage, type, value) {
    if (!['people', 'places'].includes(type) || !storage || typeof storage.setItem !== 'function') return '';
    const normalized = type === 'people' ? normalizePersonName(value) : normalizePlaceName(value);
    if (!normalized || normalized.length > 160) return '';
    const saved = readJson(storage, ARCHIVE_PRESETS_KEY, null);
    const source = saved && !Array.isArray(saved) && typeof saved === 'object' ? saved : {};
    const presets = {
      people: sanitizePresetValues(source.people, 'people'),
      places: sanitizePresetValues(source.places, 'places'),
    };
    const values = presets[type];
    presets[type] = [...new Set([...values.map(String), normalized])];
    storage.setItem(ARCHIVE_PRESETS_KEY, JSON.stringify(presets));
    return normalized;
  }

  function getArchivePresets(wines, storage) {
    const saved = readJson(storage, ARCHIVE_PRESETS_KEY, null);
    const stored = saved && !Array.isArray(saved) && typeof saved === 'object' ? saved : {};
    const people = groupWinesByPerson(wines).sort((a, b) => b.count - a.count || a.person.localeCompare(b.person, 'ko')).map((group) => group.person);
    const places = groupWinesByPlace(wines).sort((a, b) => b.count - a.count || a.place.localeCompare(b.place, 'ko')).map((group) => group.place);
    return {
      people: [...new Set([...people, ...sanitizePresetValues(stored.people, 'people')])],
      places: [...new Set([...places, ...sanitizePresetValues(stored.places, 'places')])],
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

  return {
    normalizeWine,
    sortWinesNewestFirst,
    groupWinesByCountry,
    groupWinesByPerson,
    groupWinesByPlace,
    addArchivePreset,
    getArchivePresets,
    addWine,
    deleteWine,
    getVisibleWines,
    markWineSynced,
    markWineDeletionSynced,
    requeueWineMutation,
  };
});
