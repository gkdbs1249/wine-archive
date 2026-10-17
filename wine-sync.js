(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WineSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PEOPLE = new Set(['하윤', '제권']);
  const MIGRATION_KEY = 'wine-archive:supabase-migration-v2-authenticated';
  const PENDING_UPSERTS_KEY = 'wine-archive:pending-wine-upserts';
  const PENDING_DELETES_KEY = 'wine-archive:pending-wine-deletes';
  const PENDING_RATINGS_KEY = 'wine-archive:pending-ratings';
  const MAX_IMAGE_LENGTH = 1_000_000;
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
  const ROTATION_PATTERN = /^-?(?:[0-5](?:\.\d{1,2})?|6(?:\.0{1,2})?)deg$/;
  const KIND_ORDER = ['레드', '화이트', '로제', '위스키', '그 외'];
  const KIND_ALIASES = { red: '레드', white: '화이트', rose: '로제', 'rosé': '로제', whisky: '위스키', whiskey: '위스키', other: '그 외' };
  const FIELD_LIMITS = {
    name: 160,
    vintage: 32,
    country: 80,
    externalCount: 80,
    date: 32,
    info: 240,
    people: 160,
    place: 160,
    kind: 20,
    archiveOwner: 20,
    food: 300,
    note: 2000,
  };
  const mutationVersions = new Map();

  function beginMutation(id) {
    const key = String(id);
    const version = (mutationVersions.get(key) || 0) + 1;
    mutationVersions.set(key, version);
    return version;
  }

  function isLatestMutation(id, version) {
    return mutationVersions.get(String(id)) === version;
  }

  function currentMutationVersion(id) {
    return mutationVersions.get(String(id)) || 0;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function safeImage(value) {
    if (typeof value !== 'string' || value.length > MAX_IMAGE_LENGTH) return '';
    const image = value.trim();
    if (/^assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,480}$/.test(image) && !image.includes('..')) return image;
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(image)) return image;
    return '';
  }

  function safeColor(value) {
    const color = typeof value === 'string' ? value.trim() : '';
    return COLOR_PATTERN.test(color) ? color.toLowerCase() : '';
  }

  function safeRotation(value) {
    const rotation = typeof value === 'string' ? value.trim() : '';
    return ROTATION_PATTERN.test(rotation) ? rotation : '';
  }

  function safeKind(value) {
    const kind = text(value, FIELD_LIMITS.kind);
    if (!kind) return '';
    if (KIND_ORDER.includes(kind)) return kind;
    return KIND_ALIASES[kind.toLowerCase()] || '그 외';
  }

  function safeArchiveOwner(input) {
    if (!Object.prototype.hasOwnProperty.call(input, 'archiveOwner')) return '';
    if (input.archiveOwner === '') return '';
    return PEOPLE.has(input.archiveOwner) ? input.archiveOwner : null;
  }

  function normalizeWinePayload(input, expectedId) {
    if (!isRecord(input)) return null;
    const id = text(input.id, 128);
    const name = text(input.name, FIELD_LIMITS.name);
    if (!ID_PATTERN.test(id) || !name || (expectedId !== undefined && id !== String(expectedId))) return null;
    const archiveOwner = safeArchiveOwner(input);
    if (archiveOwner === null) return null;
    const rawScore = input.externalScore;
    const score = rawScore === '' || rawScore === null || rawScore === undefined ? NaN : Number(rawScore);
    return {
      id,
      name,
      vintage: text(input.vintage, FIELD_LIMITS.vintage),
      country: text(input.country, FIELD_LIMITS.country),
      externalScore: Number.isFinite(score) && score >= 0 && score <= 5 ? score : null,
      externalCount: text(input.externalCount, FIELD_LIMITS.externalCount),
      date: text(input.date, FIELD_LIMITS.date),
      info: text(input.info, FIELD_LIMITS.info),
      people: text(input.people, FIELD_LIMITS.people),
      place: text(input.place, FIELD_LIMITS.place),
      kind: safeKind(input.kind),
      archiveOwner,
      food: text(input.food, FIELD_LIMITS.food),
      note: text(input.note, FIELD_LIMITS.note),
      image: safeImage(input.image),
      g: safeColor(input.g),
      r: safeRotation(input.r),
      custom: input.custom === true,
    };
  }

  function rowsToWines(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.reduce((wines, row) => {
      if (!isRecord(row)) return wines;
      const wine = normalizeWinePayload(row.payload, row.id);
      if (wine) wines.push(wine);
      return wines;
    }, []);
  }

  function ratingUpsert(wineId, person, value) {
    const id = typeof wineId === 'string' ? wineId.trim() : '';
    const rating = Number(value);
    if (!ID_PATTERN.test(id) || !PEOPLE.has(person) || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
    return { wine_id: id, person, rating };
  }

  function rowsToRatings(rows) {
    if (!Array.isArray(rows)) return {};
    return rows.reduce((result, row) => {
      if (!isRecord(row)) return result;
      const valid = ratingUpsert(row.wine_id, row.person, row.rating);
      if (!valid) return result;
      if (!Object.prototype.hasOwnProperty.call(result, valid.wine_id)) result[valid.wine_id] = {};
      result[valid.wine_id][valid.person] = valid.rating;
      return result;
    }, {});
  }

  function readJson(storage, key, fallback) {
    if (!storage || typeof storage.getItem !== 'function') return fallback;
    try {
      const parsed = JSON.parse(storage.getItem(key));
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function migrationConflict(kind, detail) {
    const error = new Error(`Local migration ${kind} conflict${detail ? `: ${detail}` : ''}`);
    error.code = 'MIGRATION_CONFLICT';
    error.kind = kind;
    return error;
  }

  function isUniqueViolation(error) {
    return error?.code === '23505'
      || /23505|duplicate key|unique constraint/i.test(String(error?.message || ''));
  }

  function discoverStoredRatingTargets(storage) {
    if (!storage || !Number.isInteger(storage.length) || typeof storage.key !== 'function') return [];
    const prefix = 'wine-archive:rating:';
    const targets = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const separator = key.lastIndexOf(':');
      if (separator <= prefix.length) continue;
      try {
        const id = decodeURIComponent(key.slice(prefix.length, separator));
        const person = decodeURIComponent(key.slice(separator + 1));
        if (ID_PATTERN.test(id) && PEOPLE.has(person)) targets.push({ id, person });
      } catch {
        // Ignore malformed legacy keys and preserve them in localStorage.
      }
    }
    return targets;
  }

  async function migrateLocalData(sync, storage, knownWines, getStoredRating, ratingWriteQueue) {
    if (!storage || storage.getItem(MIGRATION_KEY) === 'complete') return true;
    const migrationState = storage.getItem(MIGRATION_KEY);
    const hasPendingTracking = [PENDING_UPSERTS_KEY, PENDING_DELETES_KEY, PENDING_RATINGS_KEY]
      .some((key) => storage.getItem(key) !== null);
    const incremental = migrationState === 'dirty' && hasPendingTracking;
    const rawRetainedWines = readJson(storage, 'wine-archive:custom-wines', []);
    const legacyMissingKindIds = new Set(rawRetainedWines
      .filter((wine) => isRecord(wine) && !Object.prototype.hasOwnProperty.call(wine, 'kind'))
      .map((wine) => String(wine.id || ''))
      .filter((id) => ID_PATTERN.test(id)));
    const legacyMissingArchiveOwnerIds = new Set(rawRetainedWines
      .filter((wine) => isRecord(wine) && !Object.prototype.hasOwnProperty.call(wine, 'archiveOwner'))
      .map((wine) => String(wine.id || ''))
      .filter((id) => ID_PATTERN.test(id)));
    const retainedWines = rawRetainedWines
      .map((wine) => normalizeWinePayload(wine))
      .filter(Boolean);
    const retainedById = new Map(retainedWines.map((wine) => [wine.id, wine]));
    const pendingUpserts = new Set(readJson(storage, PENDING_UPSERTS_KEY, []).map(String).filter((id) => ID_PATTERN.test(id)));
    const historicalDeletes = new Set(readJson(storage, 'wine-archive:deleted-wines', []).map(String).filter((id) => ID_PATTERN.test(id)));
    const deletedIds = incremental
      ? new Set(readJson(storage, PENDING_DELETES_KEY, []).map(String).filter((id) => ID_PATTERN.test(id)))
      : historicalDeletes;
    const customWines = (incremental
      ? [...pendingUpserts].map((id) => retainedById.get(id))
      : retainedWines)
      .filter((wine) => wine && !deletedIds.has(wine.id));
    const allWines = [...(Array.isArray(knownWines) ? knownWines : []), ...retainedWines]
      .map((wine) => normalizeWinePayload(wine))
      .filter((wine) => wine && !deletedIds.has(wine.id));
    const uniqueWines = [...new Map(allWines.map((wine) => [wine.id, wine])).values()];
    const localRatings = [];
    const processedUpserts = new Map(customWines.map((wine) => [wine.id, JSON.stringify(wine)]));
    const processedVersions = new Map(
      [...new Set([...customWines.map((wine) => wine.id), ...deletedIds])]
        .map((id) => [id, currentMutationVersion(id)]),
    );

    let initialRemoteRatings = null;
    let initialRemoteById = null;
    let initialAvailableRatingIds = null;
    const winesToInsert = [];
    if (!incremental) {
      const [existingRemote, existingRatings] = await Promise.all([sync.listWines(), sync.listRatings()]);
      initialRemoteRatings = existingRatings || {};
      initialRemoteById = new Map(existingRemote.map((wine) => {
        const normalized = normalizeWinePayload(wine);
        return normalized ? [normalized.id, normalized] : [String(wine?.id || ''), null];
      }));
      initialAvailableRatingIds = new Set([
        ...initialRemoteById.keys(),
        ...uniqueWines.map((wine) => wine.id),
      ]);
      for (const wine of customWines) {
        const remote = initialRemoteById.get(wine.id);
        if (initialRemoteById.has(wine.id) && (!remote || JSON.stringify(remote) !== JSON.stringify(wine))) {
          throw migrationConflict('wine', `wine id ${wine.id}`);
        }
        if (!initialRemoteById.has(wine.id)) winesToInsert.push(wine);
      }
      for (const id of historicalDeletes) {
        if (initialRemoteById.has(id)) throw migrationConflict('deletion', `wine id ${id}`);
      }
      if (typeof getStoredRating === 'function') {
        for (const wine of uniqueWines) {
          for (const person of PEOPLE) {
            const localRating = getStoredRating(storage, wine.id, person);
            const remoteRating = initialRemoteRatings[wine.id]?.[person];
            if (localRating && remoteRating != null && remoteRating !== localRating) {
              throw migrationConflict('rating', `wine id ${wine.id}, person ${person}`);
            }
          }
        }
      }
    }

    const expectedRemoteWines = new Map(
      incremental ? [] : customWines.map((wine) => [wine.id, wine]),
    );
    if (incremental) {
      for (const wine of customWines) {
        let saved = wine;
        const preserveKind = legacyMissingKindIds.has(wine.id);
        const preserveArchiveOwner = legacyMissingArchiveOwnerIds.has(wine.id);
        if (preserveKind || preserveArchiveOwner) {
          if (typeof sync.saveWinePreservingLegacyFields !== 'function') {
            throw new Error('Safe legacy field migration is unavailable');
          }
          saved = normalizeWinePayload(await sync.saveWinePreservingLegacyFields(wine, {
            preserveKind,
            preserveArchiveOwner,
          }), wine.id);
          if (!saved) throw new Error('Safe legacy field migration returned an invalid wine');
        } else {
          await sync.saveWine(wine);
        }
        expectedRemoteWines.set(wine.id, saved);
      }
    } else {
      if (typeof sync.insertWine !== 'function') throw new Error('Safe initial wine migration is unavailable');
      for (const wine of winesToInsert) {
        try {
          await sync.insertWine(wine);
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          throw migrationConflict('wine', `wine id ${wine.id}`);
        }
      }
    }
    if (typeof getStoredRating === 'function') {
      const rawRatingTargets = incremental
        ? readJson(storage, PENDING_RATINGS_KEY, [])
          .filter((row) => isRecord(row))
          .map((row) => ({ id: String(row.wineId || ''), person: row.person }))
          .filter((target) => !deletedIds.has(target.id))
        : [
          ...uniqueWines.flatMap((wine) => [...PEOPLE].map((person) => ({ id: wine.id, person }))),
          ...discoverStoredRatingTargets(storage).filter((target) => initialAvailableRatingIds.has(target.id)),
        ];
      const ratingTargets = [...new Map(rawRatingTargets.map((target) => [`${target.id}\u0000${target.person}`, target])).values()];
      for (const target of ratingTargets) {
        const key = `${target.id}\u0000${target.person}`;
        const writeLatestRating = async () => {
          const row = ratingUpsert(target.id, target.person, getStoredRating(storage, target.id, target.person));
          if (!row) return;
          localRatings.push(row);
          if (incremental) {
            await sync.setRating(row.wine_id, row.person, row.rating);
            return;
          }
          const remoteRating = initialRemoteRatings[row.wine_id]?.[row.person];
          if (remoteRating === row.rating) return;
          if (remoteRating != null) throw migrationConflict('rating', `wine id ${row.wine_id}, person ${row.person}`);
          if (typeof sync.insertRating !== 'function') throw new Error('Safe initial rating migration is unavailable');
          try {
            await sync.insertRating(row.wine_id, row.person, row.rating);
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
            throw migrationConflict('rating', `wine id ${row.wine_id}, person ${row.person}`);
          }
        };
        if (ratingWriteQueue && typeof ratingWriteQueue.enqueue === 'function') {
          await ratingWriteQueue.enqueue(key, writeLatestRating);
        } else {
          await writeLatestRating();
        }
      }
    }
    if (incremental) for (const id of deletedIds) await sync.deleteWine(id);

    const [remoteWines, remoteRatings] = await Promise.all([sync.listWines(), sync.listRatings()]);
    const remoteById = new Map(remoteWines.map((wine) => {
      const normalized = normalizeWinePayload(wine);
      return normalized ? [normalized.id, normalized] : [String(wine?.id || ''), null];
    }));
    const winesMatch = [...expectedRemoteWines].every(([id, expected]) => {
      const actual = remoteById.get(id);
      return actual && JSON.stringify(actual) === JSON.stringify(expected);
    }) && [...deletedIds].every((id) => !remoteById.has(id));
    const ratingsMatch = localRatings.every((row) => remoteRatings[row.wine_id]?.[row.person] === row.rating);
    if (!winesMatch || !ratingsMatch) throw new Error('Local migration readback did not match');

    const latestWines = readJson(storage, 'wine-archive:custom-wines', [])
      .map((wine) => normalizeWinePayload(wine))
      .filter(Boolean);
    const latestById = new Map(latestWines.map((wine) => [wine.id, wine]));
    const latestDeletedIds = new Set(
      readJson(storage, 'wine-archive:deleted-wines', []).map(String).filter((id) => ID_PATTERN.test(id)),
    );
    const remainingUpserts = readJson(storage, PENDING_UPSERTS_KEY, [])
      .map(String)
      .filter((id) => ID_PATTERN.test(id))
      .filter((id) => {
        if (!processedUpserts.has(id)) return true;
        const latest = latestById.get(id);
        return !latest || JSON.stringify(latest) !== processedUpserts.get(id);
      });
    const remainingDeletes = readJson(storage, PENDING_DELETES_KEY, [])
      .map(String)
      .filter((id) => ID_PATTERN.test(id) && !deletedIds.has(id));
    const processedRatings = new Map(localRatings.map((row) => [`${row.wine_id}\u0000${row.person}`, row.rating]));
    const remainingRatings = readJson(storage, PENDING_RATINGS_KEY, [])
      .filter((row) => isRecord(row) && typeof row.wineId === 'string' && PEOPLE.has(row.person))
      .filter((row) => !latestDeletedIds.has(row.wineId))
      .filter((row) => {
        const key = `${row.wineId}\u0000${row.person}`;
        if (!processedRatings.has(key) || typeof getStoredRating !== 'function') return true;
        return getStoredRating(storage, row.wineId, row.person) !== processedRatings.get(key);
      });
    const remainingUpsertSet = new Set(remainingUpserts);
    const remainingDeleteSet = new Set(remainingDeletes);
    const currentDeletedIds = latestDeletedIds;
    for (const [id, version] of processedVersions) {
      if (currentMutationVersion(id) === version) continue;
      if (currentDeletedIds.has(id)) {
        remainingUpsertSet.delete(id);
        remainingDeleteSet.add(id);
      } else if (latestById.has(id)) {
        remainingDeleteSet.delete(id);
        remainingUpsertSet.add(id);
      }
    }
    storage.setItem(PENDING_UPSERTS_KEY, JSON.stringify([...remainingUpsertSet]));
    storage.setItem(PENDING_DELETES_KEY, JSON.stringify([...remainingDeleteSet]));
    storage.setItem(PENDING_RATINGS_KEY, JSON.stringify(remainingRatings));
    const stillDirty = remainingUpsertSet.size || remainingDeleteSet.size || remainingRatings.length;
    storage.setItem(MIGRATION_KEY, stillDirty ? 'dirty' : 'complete');
    return true;
  }

  async function initializeSync(sync, localFallback) {
    try {
      const [wines, ratings] = await Promise.all([sync.listWines(), sync.listRatings()]);
      return { sync, wines, ratings, connected: true, error: null };
    } catch (error) {
      return {
        sync: null,
        wines: typeof localFallback === 'function' ? localFallback() : [],
        ratings: {},
        connected: false,
        error,
      };
    }
  }

  async function saveWineWithFallback(sync, wine, saveLocal, confirmSaved, requeueLatest) {
    const version = beginMutation(wine.id);
    let localResult = null;
    let localError = null;
    try {
      localResult = typeof saveLocal === 'function' ? saveLocal(wine) : null;
    } catch (error) {
      localError = error;
    }
    if (sync) {
      try {
        await sync.saveWine(wine);
        const latest = isLatestMutation(wine.id, version);
        if (latest) {
          if (localResult && typeof confirmSaved === 'function') confirmSaved(wine);
        } else if (localResult && typeof requeueLatest === 'function') requeueLatest(wine.id);
        return { sync, offline: false, stale: !latest, error: null, localError };
      } catch (error) {
        if (!localResult) {
          if (localError && !error.cause) error.cause = localError;
          throw error;
        }
        const latest = isLatestMutation(wine.id, version);
        return { sync, offline: true, stale: !latest, error, localError };
      }
    }
    if (!localResult) throw localError || new Error('Local wine save failed');
    return { sync: null, offline: true, stale: false, error: null, localError };
  }

  async function deleteWineWithFallback(sync, id, deleteLocal, confirmDeleted, requeueLatest) {
    const version = beginMutation(id);
    const localResult = typeof deleteLocal === 'function' ? deleteLocal(id) : null;
    if (sync) {
      try {
        await sync.deleteWine(id);
        const latest = isLatestMutation(id, version);
        if (latest) {
          if (typeof confirmDeleted === 'function') confirmDeleted(id);
        } else if (typeof requeueLatest === 'function') requeueLatest(id);
        return { sync, offline: false, stale: !latest, error: null };
      } catch (error) {
        if (!localResult) throw error;
        const latest = isLatestMutation(id, version);
        return { sync, offline: true, stale: !latest, error };
      }
    }
    if (!localResult) throw new Error('Local wine deletion failed');
    return { sync: null, offline: true, stale: false, error: null };
  }

  function create(client, signal = null) {
    function withSignal(query) {
      return signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query;
    }
    async function unwrap(query) {
      const { data, error } = await withSignal(query);
      if (error) throw error;
      return data;
    }

    return {
      realtime: true,
      async listWines() {
        return rowsToWines(await unwrap(client.from('wines').select('id,payload').order('updated_at', { ascending: false })));
      },
      async saveWine(input) {
        const wine = normalizeWinePayload(input);
        if (!wine) throw new Error('Invalid wine payload');
        await unwrap(client.from('wines').upsert({ id: wine.id, payload: wine, updated_at: new Date().toISOString() }));
        return wine;
      },
      async saveWinePreservingLegacyFields(input, options = {}) {
        const wine = normalizeWinePayload(input);
        if (!wine) throw new Error('Invalid wine payload');
        const saved = normalizeWinePayload(await unwrap(client.rpc('save_legacy_wine_preserving_fields', {
          p_id: wine.id,
          p_payload: wine,
          p_updated_at: new Date().toISOString(),
          p_preserve_kind: options.preserveKind === true,
          p_preserve_archive_owner: options.preserveArchiveOwner === true,
        })), wine.id);
        if (!saved) throw new Error('Invalid legacy wine migration response');
        return saved;
      },
      async insertWine(input) {
        const wine = normalizeWinePayload(input);
        if (!wine) throw new Error('Invalid wine payload');
        await unwrap(client.from('wines').insert({ id: wine.id, payload: wine, updated_at: new Date().toISOString() }));
        return wine;
      },
      async deleteWine(id) {
        const wineId = typeof id === 'string' ? id.trim() : '';
        if (!ID_PATTERN.test(wineId)) throw new Error('Invalid wine id');
        await unwrap(client.from('wines').delete().eq('id', wineId));
      },
      async listRatings() {
        return rowsToRatings(await unwrap(client.from('ratings').select('wine_id,person,rating')));
      },
      async setRating(wineId, person, value) {
        const row = ratingUpsert(wineId, person, value);
        if (!row) return null;
        await unwrap(client.from('ratings').upsert({ ...row, updated_at: new Date().toISOString() }));
        return row.rating;
      },
      async insertRating(wineId, person, value) {
        const row = ratingUpsert(wineId, person, value);
        if (!row) return null;
        await unwrap(client.from('ratings').insert({ ...row, updated_at: new Date().toISOString() }));
        return row.rating;
      },
      subscribe(onChange, onStatus) {
        return client.channel('wine-archive-live')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'wines' }, onChange)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, onChange)
          .subscribe((status, error) => {
            if (typeof onStatus === 'function') onStatus(status, error);
          });
      },
    };
  }

  function createRest(config, fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null, getAccessToken = null, signal = null) {
    const baseUrl = String(config?.url || '').replace(/\/$/, '');
    const apiKey = String(config?.publishableKey || config?.anonKey || '');
    if (!/^https:\/\//.test(baseUrl) || !apiKey || typeof fetchImpl !== 'function') throw new Error('Invalid Supabase REST configuration');
    async function request(path, options = {}) {
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
      const authHeaders = { apikey: apiKey };
      if (token) authHeaders.Authorization = `Bearer ${token}`;
      else if (!apiKey.startsWith('sb_publishable_')) authHeaders.Authorization = `Bearer ${apiKey}`;
      const response = await fetchImpl(`${baseUrl}/rest/v1/${path}`, {
        ...options,
        ...(signal ? { signal } : {}),
        headers: { ...authHeaders, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      });
      if (!response.ok) {
        let payload = null;
        let detail = `HTTP ${response.status}`;
        try {
          payload = await response.json();
          detail = JSON.stringify(payload);
        } catch {}
        const error = new Error(`Supabase REST request failed: ${detail}`);
        error.status = response.status;
        if (payload?.code) error.code = payload.code;
        throw error;
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    return {
      realtime: false,
      async listWines() {
        return rowsToWines(await request('wines?select=id,payload&order=updated_at.desc'));
      },
      async saveWine(input) {
        const wine = normalizeWinePayload(input);
        if (!wine) throw new Error('Invalid wine payload');
        await request('wines?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ id: wine.id, payload: wine, updated_at: new Date().toISOString() }),
        });
        return wine;
      },
      async saveWinePreservingLegacyFields(input, options = {}) {
        const wine = normalizeWinePayload(input);
        if (!wine) throw new Error('Invalid wine payload');
        const saved = normalizeWinePayload(await request('rpc/save_legacy_wine_preserving_fields', {
          method: 'POST',
          body: JSON.stringify({
            p_id: wine.id,
            p_payload: wine,
            p_updated_at: new Date().toISOString(),
            p_preserve_kind: options.preserveKind === true,
            p_preserve_archive_owner: options.preserveArchiveOwner === true,
          }),
        }), wine.id);
        if (!saved) throw new Error('Invalid legacy wine migration response');
        return saved;
      },
      async insertWine(input) {
        const wine = normalizeWinePayload(input);
        if (!wine) throw new Error('Invalid wine payload');
        await request('wines', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ id: wine.id, payload: wine, updated_at: new Date().toISOString() }),
        });
        return wine;
      },
      async deleteWine(id) {
        const wineId = typeof id === 'string' ? id.trim() : '';
        if (!ID_PATTERN.test(wineId)) throw new Error('Invalid wine id');
        await request(`wines?id=eq.${encodeURIComponent(wineId)}`, { method: 'DELETE' });
      },
      async listRatings() {
        return rowsToRatings(await request('ratings?select=wine_id,person,rating'));
      },
      async setRating(wineId, person, value) {
        const row = ratingUpsert(wineId, person, value);
        if (!row) return null;
        await request('ratings?on_conflict=wine_id%2Cperson', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
        });
        return row.rating;
      },
      async insertRating(wineId, person, value) {
        const row = ratingUpsert(wineId, person, value);
        if (!row) return null;
        await request('ratings', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
        });
        return row.rating;
      },
      subscribe() {
        return { unsubscribe() {} };
      },
    };
  }

  return {
    MIGRATION_KEY,
    normalizeWinePayload,
    safeImage,
    safeColor,
    safeRotation,
    rowsToWines,
    rowsToRatings,
    ratingUpsert,
    migrateLocalData,
    initializeSync,
    saveWineWithFallback,
    deleteWineWithFallback,
    create,
    createRest,
  };
});
