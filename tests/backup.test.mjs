import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as storage from '../js/storage.js?v=20261010-1';

const backup = await import('../js/backup.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const now = '2026-10-10T03:00:00.000Z';

function api(name) {
  assert.equal(typeof backup[name], 'function', `${name} is available`);
  return backup[name];
}

function memoryStore() {
  const memory = new Map();
  return { memory, getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
}

function fullState() {
  const store = memoryStore();
  storage.setCourseUntil(12, store);
  storage.joinCategory('handakuten', store, now);
  storage.recordRating('a', 'unknown', store, now);
  storage.recordRating('handakuten-pa', 'known', store, now);
  storage.recordQuiz('handakuten-pa', true, store);
  storage.saveBrowseProgress('youon', 4, store, now);
  storage.saveSettings({ selectedMode: 'browse', reviewRangeStart: 2, reviewRangeEnd: 8, reviewCount: 'infinite', testCategories: ['sokuon'] }, store);
  return storage.loadState(store);
}

function envelope(state = fullState()) {
  return { format: 'japanese-kana-review-backup', formatVersion: 1, exportedAt: now, state };
}

test('export round trip preserves every v4 field without sharing mutable state', () => {
  const state = fullState();
  const exported = api('createBackup')(state, now);
  assert.deepEqual(exported, envelope(state));
  const text = api('serializeBackup')(state, now);
  assert.deepEqual(api('parseBackup')(text), exported);
  exported.state.records.a.knownCount = 90;
  assert.equal(state.records.a.knownCount, 0);
});

test('empty state exports and restores without changing its settings on reload', () => {
  const store = memoryStore();
  const empty = storage.loadState(store);
  const value = api('createBackup')(empty, now);
  api('importBackup')(value, { store, now });
  assert.deepEqual(storage.loadState(store), empty);
  api('recoverBackup')({ store });
  assert.deepEqual(storage.loadState(store), empty);
});

test('clearing all records also removes the pre-import recovery', () => {
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  storage.resetState(store);
  assert.equal(api('getRecoveryBackup')({ store }), null);
});

test('preview describes basic progress, records, reviews and browsing position', () => {
  const preview = api('backupSummary')(envelope());
  assert.equal(preview.courseUntil, 12);
  assert.equal(preview.recordCount, 17);
  assert.equal(preview.learnedCount, 17);
  assert.equal(preview.totalReviews, 2);
  assert.equal(preview.joinedCategories, 1);
  assert.deepEqual(preview.browseProgress, { category: 'youon', position: 5, total: 33 });
});

test('parser rejects invalid JSON, unknown envelopes and future versions', () => {
  const parse = api('parseBackup');
  assert.throws(() => parse('{broken'), /JSON/);
  for (const changes of [{ format: 'other' }, { formatVersion: 2 }, { formatVersion: 0 }, { exportedAt: 'tomorrow' }, { state: { ...fullState(), version: 5 } }]) {
    assert.throws(() => parse(JSON.stringify({ ...envelope(), ...changes })));
  }
});

test('parser enforces a one MiB UTF-8 file limit before parsing', () => {
  const parse = api('parseBackup');
  const text = JSON.stringify(envelope());
  assert.deepEqual(parse(text.padEnd(1024 * 1024, ' ')), envelope());
  assert.throws(() => parse(text.padEnd(1024 * 1024 + 1, ' ')), /1 MiB/);
  assert.throws(() => parse(text + 'あ'.repeat(350000)), /1 MiB/);
});

test('parser rejects missing fields, unknown item IDs and unexpected fields', () => {
  const parse = api('parseBackup');
  for (const mutate of [
    (state) => { delete state.categoryStatus; },
    (state) => { state.records['unknown-kana'] = storage.createRecord(); },
    (state) => { state.settings.extra = true; },
    (state) => { delete state.records.a.quizWrong; },
    (state) => { state.categoryStatus.future = 'joined'; },
  ]) {
    const value = envelope(); mutate(value.state);
    assert.throws(() => parse(JSON.stringify(value)));
  }
});

test('parser rejects invalid settings and category status rather than normalizing them', () => {
  const parse = api('parseBackup');
  for (const mutate of [
    (state) => { state.courseUntil = 47; },
    (state) => { state.settings.reviewCount = 21; },
    (state) => { state.settings.reviewCategories = ['basic', 'future']; },
    (state) => { state.settings.testCategories = ['basic', 'basic']; },
    (state) => { state.settings.reviewRangeStart = 0; },
    (state) => { state.settings.reviewRangeEnd = 1; },
    (state) => { state.settings.testScript = 'future'; },
    (state) => { state.categoryStatus.basic = 'wrong'; },
    (state) => { state.browseProgress.index = 33; },
    (state) => { state.browseProgress.startedAt = '<img>'; },
  ]) {
    const value = envelope(); mutate(value.state);
    assert.throws(() => parse(JSON.stringify(value)));
  }
});

test('parser rejects invalid counters, dates, ratings and inconsistent derived records', () => {
  const parse = api('parseBackup');
  for (const changes of [{ learned: 'yes' }, { totalReviews: -1 }, { quizWrong: 0.5 }, { knownCount: '1' }, { lastResult: 'other' }, { firstSeenAt: 'yesterday' }, { learningLevel: 4 }, { knownCount: 1 }, { knownStreak: 2 }]) {
    const value = envelope(); Object.assign(value.state.records.a, changes);
    assert.throws(() => parse(JSON.stringify(value)));
  }
});

test('import replaces state and persists the pre-import recovery across reads', () => {
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const previous = storage.loadState(store);
  const imported = envelope();
  assert.deepEqual(api('importBackup')(imported, { store, now }), imported.state);
  assert.deepEqual(storage.loadState(store), imported.state);
  assert.deepEqual(api('getRecoveryBackup')({ store }).state, previous);
  storage.recordRating('a', 'known', store, now);
  assert.deepEqual(api('recoverBackup')({ store }), previous);
  assert.deepEqual(storage.loadState(store), previous);
  assert.deepEqual(api('getRecoveryBackup')({ store }).state, previous);
});

test('invalid imports leave state and existing recovery unchanged', () => {
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  const before = new Map(store.memory);
  const invalid = envelope(); invalid.state.records.a.totalReviews = -1;
  assert.throws(() => api('importBackup')(invalid, { store, now }));
  assert.deepEqual(store.memory, before);
});

test('failed recovery write never replaces current state', () => {
  const importBackup = api('importBackup');
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const before = new Map(store.memory);
  const set = store.setItem;
  store.setItem = (key, value) => { if (key !== storage.STORAGE_KEY) throw new Error('quota'); set(key, value); };
  assert.throws(() => importBackup(envelope(), { store, now }), /保存|write|quota/);
  assert.deepEqual(store.memory, before);
});

test('failed state write rolls back state and the previous recovery', () => {
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  const before = new Map(store.memory);
  const set = store.setItem;
  let fail = true;
  store.setItem = (key, value) => {
    if (key === storage.STORAGE_KEY && fail) { fail = false; set(key, 'partial'); throw new Error('disk full'); }
    set(key, value);
  };
  assert.throws(() => api('importBackup')(envelope(storage.loadState(memoryStore())), { store, now }));
  assert.deepEqual(store.memory, before);
});

test('readback mismatch triggers rollback after a store silently changes a write', () => {
  const importBackup = api('importBackup');
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const before = new Map(store.memory);
  const set = store.setItem;
  let fail = true;
  store.setItem = (key, value) => { if (key === storage.STORAGE_KEY && fail) { fail = false; set(key, 'corrupted'); } else set(key, value); };
  assert.throws(() => importBackup(envelope(), { store, now }), /验证|verify/);
  assert.deepEqual(store.memory, before);
});

test('rollback removes a new state when the previous state had no stored value', () => {
  const importBackup = api('importBackup');
  const store = memoryStore();
  const set = store.setItem;
  let fail = true;
  store.setItem = (key, value) => { set(key, value); if (key === storage.STORAGE_KEY && fail) { fail = false; throw new Error('failure'); } };
  assert.throws(() => importBackup(envelope(), { store, now }));
  assert.equal(store.getItem(storage.STORAGE_KEY), null);
  assert.equal(store.memory.size, 0);
});

test('failed recovery rolls back the currently imported state', () => {
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  const before = new Map(store.memory);
  const set = store.setItem;
  let fail = true;
  store.setItem = (key, value) => { set(key, value); if (key === storage.STORAGE_KEY && fail) { fail = false; throw new Error('failure'); } };
  assert.throws(() => api('recoverBackup')({ store }));
  assert.deepEqual(store.memory, before);
});

test('missing or invalid recovery data cannot overwrite current state', () => {
  const store = memoryStore();
  assert.equal(api('getRecoveryBackup')({ store }), null);
  assert.throws(() => api('recoverBackup')({ store }), /恢复|recovery/);
  api('importBackup')(envelope(), { store, now });
  const recoveryKey = [...store.memory.keys()].find((key) => key !== storage.STORAGE_KEY);
  store.setItem(recoveryKey, 'invalid');
  const before = new Map(store.memory);
  assert.throws(() => api('recoverBackup')({ store }));
  assert.deepEqual(store.memory, before);
});

test('browser adapter detects swallowed persistence failure and retains session state', () => {
  const importBackup = api('importBackup');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const previous = storage.loadState(store);
  const before = new Map(store.memory);
  let blocked = false;
  const browser = { getItem: store.getItem, setItem: (key, value) => { if (blocked) throw new Error('QuotaExceededError'); store.setItem(key, value); }, removeItem: store.removeItem };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browser });
  try {
    assert.deepEqual(storage.loadState(), previous);
    blocked = true;
    assert.throws(() => importBackup(envelope(), { now }));
    assert.deepEqual(storage.loadState(), previous);
    assert.deepEqual(store.memory, before);
    storage.saveSettings({ selectedMode: 'test' });
    const session = storage.loadState();
    assert.throws(() => importBackup(envelope(), { now }), /保存|persistent/);
    assert.deepEqual(storage.loadState(), session);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('explicit transient stores reject destructive imports but ordinary test stores are supported', () => {
  const importBackup = api('importBackup');
  const store = memoryStore(); store.isPersistent = false;
  storage.setCourseUntil(3, store);
  const before = new Map(store.memory);
  assert.throws(() => importBackup(envelope(), { store, now }), /保存|persistent/);
  assert.deepEqual(store.memory, before);
});

test('browser keeps the old session state and can retry recovery after rollback is blocked', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const previous = storage.loadState(store);
  let blocked = false;
  const browser = {
    getItem: store.getItem,
    setItem(key, value) {
      if (blocked && key === storage.STORAGE_KEY) {
        store.setItem(key, 'corrupted');
        throw new Error('disk unavailable');
      }
      store.setItem(key, value);
    },
    removeItem: store.removeItem,
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browser });
  try {
    assert.deepEqual(storage.loadState(), previous);
    blocked = true;
    assert.throws(() => api('importBackup')(envelope(), { now }), (error) => error.rollbackSucceeded === false);
    assert.deepEqual(storage.loadState(), previous);
    assert.notEqual(api('getRecoveryBackup')(), null);
    assert.deepEqual(api('getRecoveryBackup')().state, previous);
    assert.equal(storage.isStoragePersistent(), false);
    blocked = false;
    assert.deepEqual(api('recoverBackup')(), previous);
    assert.equal(storage.isStoragePersistent(), true);
    assert.deepEqual(JSON.parse(store.getItem(storage.STORAGE_KEY)), previous);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('persisted recovery remains visible when a later session falls back after blocked writes', () => {
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const previous = storage.loadState(store);
  api('importBackup')(envelope(), { store, now });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const browser = { getItem: store.getItem, setItem() { throw new Error('QuotaExceededError'); }, removeItem: store.removeItem };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browser });
  try {
    storage.loadState();
    storage.saveSettings({ selectedMode: 'test' });
    assert.equal(storage.isStoragePersistent(), false);
    assert.notEqual(api('getRecoveryBackup')(), null);
    assert.deepEqual(api('getRecoveryBackup')().state, previous);
    assert.equal(storage.loadState().settings.selectedMode, 'test');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('settings provide JSON import, export, recovery and accessible overwrite confirmation', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="export-backup"/);
  assert.match(html, /id="import-backup"/);
  assert.match(html, /id="recover-backup"/);
  assert.match(html, /id="backup-file"[^>]*type="file"[^>]*accept="[^"]*\.json/);
  assert.match(html, /<dialog id="backup-confirm"[^>]*aria-labelledby="backup-confirm-title"[^>]*aria-describedby="backup-confirm-description"/);
  assert.match(html, /id="backup-status"[^>]*role="status"/);
  assert.match(html, /1\.0\.0/);
  assert.match(html, /VOICEVOX:四国めたん/);
  assert.match(html, /MIT/);
});

test('review counts saturate together at the safe integer limit across different ratings', () => {
  const store = memoryStore();
  const value = envelope();
  Object.assign(value.state.records.a, { totalReviews: Number.MAX_SAFE_INTEGER - 1, knownCount: Number.MAX_SAFE_INTEGER - 1, unsureCount: 0, unknownCount: 0, knownStreak: 2, lastResult: 'known' });
  value.state.records.a.learningLevel = storage.calculateLearningLevel(value.state.records.a);
  api('importBackup')(value, { store, now });
  const first = storage.recordRating('a', 'known', store, now).records.a;
  assert.equal(first.totalReviews, Number.MAX_SAFE_INTEGER);
  assert.equal(first.knownCount, Number.MAX_SAFE_INTEGER);
  for (const rating of ['fuzzy', 'unknown', 'known']) {
    const record = storage.recordRating('a', rating, store, now).records.a;
    assert.equal(record.totalReviews, Number.MAX_SAFE_INTEGER);
    assert.equal(record.knownCount, Number.MAX_SAFE_INTEGER);
    assert.equal(record.unsureCount, 0);
    assert.equal(record.unknownCount, 0);
    assert.equal(record.knownCount + record.unsureCount + record.unknownCount, record.totalReviews);
    assert.equal(record.lastResult, rating);
    assert.equal(record.knownStreak, rating === 'known' ? 1 : 0);
    assert.doesNotThrow(() => api('serializeBackup')(storage.loadState(store), now));
  }
});

test('quiz counts saturate without corrupting previously imported history', () => {
  const store = memoryStore();
  const value = envelope();
  Object.assign(value.state.records.a, { quizCorrect: Number.MAX_SAFE_INTEGER, quizWrong: Number.MAX_SAFE_INTEGER });
  api('importBackup')(value, { store, now });
  storage.recordQuiz('a', true, store);
  storage.recordQuiz('a', false, store);
  const record = storage.loadState(store).records.a;
  assert.equal(record.quizCorrect, Number.MAX_SAFE_INTEGER);
  assert.equal(record.quizWrong, Number.MAX_SAFE_INTEGER);
  assert.equal(record.totalReviews, 1);
  assert.doesNotThrow(() => api('serializeBackup')(storage.loadState(store), now));
});

test('saturated unknown or fuzzy history remains exportable after later known ratings', () => {
  for (const previousRating of ['unknown', 'fuzzy']) {
    const store = memoryStore();
    const value = envelope();
    Object.assign(value.state.records.a, { totalReviews: Number.MAX_SAFE_INTEGER, knownCount: 0, unsureCount: previousRating === 'fuzzy' ? Number.MAX_SAFE_INTEGER : 0, unknownCount: previousRating === 'unknown' ? Number.MAX_SAFE_INTEGER : 0, knownStreak: 0, lastResult: previousRating });
    value.state.records.a.learningLevel = storage.calculateLearningLevel(value.state.records.a);
    api('importBackup')(value, { store, now });
    for (const rating of ['known', 'known', 'unknown', 'fuzzy']) {
      const record = storage.recordRating('a', rating, store, now).records.a;
      assert.equal(record.totalReviews, Number.MAX_SAFE_INTEGER);
      assert.equal(record.knownCount, 0);
      assert.equal(record.unsureCount, value.state.records.a.unsureCount);
      assert.equal(record.unknownCount, value.state.records.a.unknownCount);
      assert.equal(record.knownStreak, 0);
      assert.equal(record.lastResult, rating);
      assert.doesNotThrow(() => api('serializeBackup')(storage.loadState(store), now));
    }
  }
});

test('loading overflow produced by an earlier rating keeps a safe complete record', () => {
  const store = memoryStore();
  const state = fullState();
  Object.assign(state.records.a, { totalReviews: Number.MAX_SAFE_INTEGER + 1, knownCount: Number.MAX_SAFE_INTEGER, unsureCount: 1, unknownCount: 0, knownStreak: 0, lastResult: 'fuzzy', quizCorrect: Number.MAX_SAFE_INTEGER + 1 });
  store.setItem(storage.STORAGE_KEY, JSON.stringify(state));
  const record = storage.loadState(store).records.a;
  assert.equal(record.totalReviews, Number.MAX_SAFE_INTEGER);
  assert.equal(record.knownCount, Number.MAX_SAFE_INTEGER);
  assert.equal(record.unsureCount, 0);
  assert.equal(record.unknownCount, 0);
  assert.equal(record.quizCorrect, Number.MAX_SAFE_INTEGER);
  assert.equal(record.lastResult, 'fuzzy');
  assert.equal(record.lastReviewedAt, now);
  assert.equal(record.knownCount + record.unsureCount + record.unknownCount, record.totalReviews);
  assert.doesNotThrow(() => api('serializeBackup')(storage.loadState(store), now));
});

test('valid recovery preview remains available even when current record dates are invalid', () => {
  const store = memoryStore();
  storage.setCourseUntil(3, store);
  const previous = storage.loadState(store);
  api('importBackup')(envelope(), { store, now });
  const invalidCurrent = storage.loadState(store);
  invalidCurrent.records.a.firstSeenAt = 'invalid date';
  store.setItem(storage.STORAGE_KEY, JSON.stringify(invalidCurrent));
  assert.equal(api('currentBackupSummary')(storage.loadState(store)), null);
  const recovery = api('getRecoveryBackup')({ store });
  assert.equal(api('backupSummary')(recovery).learnedCount, 3);
  assert.deepEqual(api('recoverBackup')({ store }), previous);
});

test('current preview does not swallow unrelated unexpected errors', () => {
  const summarize = api('currentBackupSummary');
  const state = fullState();
  Object.defineProperty(state, 'version', { enumerable: true, get() { throw new Error('unexpected getter failure'); } });
  assert.throws(() => summarize(state), /unexpected getter failure/);
});

test('reset after blocked writes removes saved state and recovery durably', () => {
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let removals = 0;
  const browser = { getItem: store.getItem, setItem() { throw new Error('quota'); }, removeItem(key) { removals += 1; store.removeItem(key); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: browser });
  try {
    storage.loadState();
    storage.saveSettings({ selectedMode: 'test' });
    assert.equal(storage.isStoragePersistent(), false);
    storage.resetState();
    assert.equal(removals, 2);
    assert.equal(store.getItem(storage.STORAGE_KEY), null);
    assert.equal(store.getItem(storage.RECOVERY_STORAGE_KEY), null);
    assert.equal(api('getRecoveryBackup')(), null);
    assert.equal(storage.loadState().courseUntil, 0);
    assert.equal(storage.isStoragePersistent(), true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage;
  }
});

test('reset reports a failed durable removal while independently clearing the other key', () => {
  assert.equal(typeof storage.resetStateWithResult, 'function');
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  const remove = store.removeItem;
  const attempted = [];
  store.removeItem = (key) => { attempted.push(key); if (key === storage.RECOVERY_STORAGE_KEY) throw new Error('blocked'); remove(key); };
  const result = storage.resetStateWithResult(store);
  assert.equal(result.persistentCleared, false);
  assert.deepEqual(result.failedKeys, [storage.RECOVERY_STORAGE_KEY]);
  assert.deepEqual(attempted, [storage.STORAGE_KEY, storage.RECOVERY_STORAGE_KEY]);
  assert.equal(store.getItem(storage.STORAGE_KEY), null);
  assert.notEqual(store.getItem(storage.RECOVERY_STORAGE_KEY), null);
});

test('reset reports silent durable deletion failures instead of claiming erased data', () => {
  assert.equal(typeof storage.resetStateWithResult, 'function');
  const store = memoryStore();
  api('importBackup')(envelope(), { store, now });
  store.removeItem = () => {};
  const result = storage.resetStateWithResult(store);
  assert.equal(result.persistentCleared, false);
  assert.deepEqual(result.failedKeys, [storage.STORAGE_KEY, storage.RECOVERY_STORAGE_KEY]);
  assert.notEqual(store.getItem(storage.STORAGE_KEY), null);
  assert.notEqual(store.getItem(storage.RECOVERY_STORAGE_KEY), null);
});

test('license terms are accessible inside the settings with selectable official URLs', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /关于与许可/);
  assert.match(html, /<details[^>]*>[\s\S]*<summary>音频使用条件<\/summary>/);
  assert.match(html, /商用和非商用均可免费使用/);
  assert.match(html, /后续使用者/);
  assert.match(html, /https:\/\/voicevox\.hiroshiba\.jp\/term\//);
  assert.match(html, /https:\/\/zunko\.jp\/con_ongen_kiyaku\.html/);
  assert.match(html, /<details id="license-details"/);
  assert.match(html, /id="license-text"/);
  assert.match(html, /id="reset-status"[^>]*role="alert"/);
});
