import { BASIC_KANA, CATEGORY_IDS, STUDY_ITEMS, itemById, itemsByCategory } from './data.js?v=20261010-1';

export const STORAGE_KEY = 'kana-flashcards-v1';
export const RECOVERY_STORAGE_KEY = `${STORAGE_KEY}:pre-import`;
export const DEFAULT_SETTINGS = {
  selectedMode: 'review',
  reviewCategories: ['basic'],
  reviewScript: 'mixed',
  reviewCount: 30,
  reviewMode: 'smart',
  reviewRangeStart: 1,
  reviewRangeEnd: null,
  browseCategory: 'dakuten',
  testCategories: [...CATEGORY_IDS],
  testScript: 'mixed',
  testCount: 30,
  testMode: 'uniform',
};

export const createRecord = () => ({
  learned: false,
  learningLevel: 0,
  totalReviews: 0,
  knownCount: 0,
  unsureCount: 0,
  unknownCount: 0,
  knownStreak: 0,
  quizCorrect: 0,
  quizWrong: 0,
  firstSeenAt: null,
  firstLearnedAt: null,
  lastReviewedAt: null,
  lastResult: null,
});

const sessionMemory = new Map();
const memoryStore = {
  getItem: (key) => sessionMemory.get(key) ?? null,
  setItem: (key, value) => sessionMemory.set(key, value),
  removeItem: (key) => sessionMemory.delete(key),
  isPersistent: false,
};
const browserAdapters = new WeakMap();

function writeValuesVerified(entries, store) {
  if (store.isPersistent === false) throw new Error('当前存储无法持久保存，请先导出当前记录后再导入。');
  const previous = new Map();
  const touched = [];
  try {
    for (const [key] of entries) previous.set(key, store.getItem(key));
    for (const [key, value] of entries) {
      touched.push(key);
      store.setItem(key, value);
      if (store.getItem(key) !== value) throw new Error('保存后的数据验证失败。');
    }
  } catch (cause) {
    let rollbackSucceeded = true;
    for (const key of touched.reverse()) {
      try {
        const oldValue = previous.get(key);
        if (store.getItem(key) !== oldValue) {
          if (oldValue === null) store.removeItem(key); else store.setItem(key, oldValue);
        }
        if (store.getItem(key) !== oldValue) throw new Error('rollback verification failed');
      } catch {
        rollbackSucceeded = false;
        // Keep the verified pre-import copy if restoring the main state failed.
        break;
      }
    }
    const error = new Error(rollbackSucceeded ? '保存或验证失败，原有记录已保留。' : '保存失败，旧记录恢复失败。请保留当前页面并导出记录，可使用“恢复导入前记录”重试。', { cause });
    error.rollbackSucceeded = rollbackSucceeded;
    throw error;
  }
}

function adaptBrowserStore(store) {
  if (browserAdapters.has(store)) return browserAdapters.get(store);
  const cache = new Map();
  let transient = false;
  const adapter = {
    get isPersistent() { return !transient; },
    getItem(key) {
      if (transient && key === RECOVERY_STORAGE_KEY) {
        try {
          const value = store.getItem(key);
          if (value === null) cache.delete(key); else cache.set(key, value);
          return value;
        } catch {}
      }
      if (!transient) {
        try {
          const value = store.getItem(key);
          if (value === null) cache.delete(key); else cache.set(key, value);
          return value;
        } catch { transient = true; }
      }
      return cache.get(key) ?? null;
    },
    setItem(key, value) {
      cache.set(key, value);
      if (!transient) { try { store.setItem(key, value); } catch { transient = true; } }
    },
    removeItem(key) {
      cache.delete(key);
      try {
        store.removeItem(key);
        if (store.getItem(key) !== null) throw new Error('删除后的数据验证失败。');
        return true;
      } catch {
        transient = true;
        return false;
      }
    },
    markResetVerified() { transient = false; },
    writeVerified(entries, { retryPersistence = false } = {}) {
      if (transient && !retryPersistence) throw new Error('当前存储无法持久保存，请先导出当前记录后再导入。');
      try {
        writeValuesVerified(entries, store);
        for (const [key, value] of entries) cache.set(key, value);
        transient = false;
      } catch (error) {
        if (error.rollbackSucceeded === false) {
          transient = true;
          const recovery = entries.find(([key]) => key === RECOVERY_STORAGE_KEY);
          if (recovery) cache.set(...recovery);
        }
        throw error;
      }
    },
  };
  browserAdapters.set(store, adapter);
  return adapter;
}
const browserStore = () => {
  try { return globalThis.localStorage ? adaptBrowserStore(globalThis.localStorage) : memoryStore; } catch { return memoryStore; }
};
export const isStoragePersistent = () => browserStore().isPersistent;
export function readStoredValue(key, store = browserStore()) { return store.getItem(key); }

// Imports need confirmed durable writes; ordinary learning still supports the
// existing in-memory fallback when browser storage is unavailable.
export function replaceStateVerified(state, { store = browserStore(), recoveryRaw, retryPersistence = false } = {}) {
  const entries = [];
  if (recoveryRaw !== undefined) entries.push([RECOVERY_STORAGE_KEY, recoveryRaw]);
  entries.push([STORAGE_KEY, JSON.stringify(state)]);
  if (store.writeVerified) store.writeVerified(entries, { retryPersistence }); else writeValuesVerified(entries, store);
  return state;
}
const number = (value, fallbackValue = 0) => Number.isFinite(Number(value)) ? Number(value) : fallbackValue;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.trunc(number(value, min))));
const isoOrNull = (value) => typeof value === 'string' && value ? value : null;
const validResult = (value) => ['known', 'fuzzy', 'unknown'].includes(value) ? value : null;
const validStatus = (value) => ['not_started', 'browsing', 'browsed', 'joined'].includes(value) ? value : 'not_started';
const validScript = (value) => ['mixed', 'hiragana', 'katakana'].includes(value) ? value : 'mixed';
const validCount = (value, fallbackValue = 30) => value === 'infinite' || value === '∞' || value === Infinity
  ? 'infinite' : [20, 30, 50, 100].includes(number(value)) ? number(value) : fallbackValue;
const positiveInteger = (value, fallbackValue = 1) => Math.max(1, Math.trunc(number(value, fallbackValue)));
const counter = (value, fallbackValue = 0) => clamp(number(value, fallbackValue), 0, Number.MAX_SAFE_INTEGER);
const incrementCounter = (value) => value < Number.MAX_SAFE_INTEGER ? value + 1 : value;

export function calculateLearningLevel(record) {
  if (!record?.learned) return record?.firstSeenAt ? 1 : 0;
  const reviews = Math.max(0, number(record.totalReviews));
  if (reviews < 2) return 1;
  const knownRate = number(record.knownCount) / reviews;
  if (reviews >= 5 && knownRate >= 0.8 && number(record.knownStreak) >= 3) return 4;
  if (reviews >= 3 && knownRate >= 0.65) return 3;
  return 2;
}

function sanitizeRecord(source = {}, learned = false) {
  let lastResult = validResult(source.lastResult);
  const counts = {
    knownCount: counter(source.knownCount ?? source.known),
    unsureCount: counter(source.unsureCount ?? source.fuzzy),
    unknownCount: counter(source.unknownCount ?? source.unknown),
  };
  // Older builds could append one rating past the common safe-integer budget.
  // Keep valid history unchanged; remove only excess, from the latest rating
  // category first, without ever adding counters outside that budget.
  const latestCounter = { known: 'knownCount', fuzzy: 'unsureCount', unknown: 'unknownCount' }[lastResult];
  const countOrder = Object.keys(counts).filter((key) => key !== latestCounter);
  if (latestCounter) countOrder.push(latestCounter);
  let remaining = Number.MAX_SAFE_INTEGER;
  for (const key of countOrder) {
    counts[key] = Math.min(counts[key], remaining);
    remaining -= counts[key];
  }
  const { knownCount, unsureCount, unknownCount } = counts;
  const totalReviews = Math.max(counter(source.shown), counter(source.totalReviews), Number.MAX_SAFE_INTEGER - remaining);
  if (!lastResult) lastResult = unknownCount ? 'unknown' : unsureCount ? 'fuzzy' : knownCount ? 'known' : null;
  const record = {
    ...createRecord(),
    learned: Boolean(source.learned || learned),
    totalReviews,
    knownCount,
    unsureCount,
    unknownCount,
    knownStreak: Math.min(knownCount, counter(source.knownStreak, lastResult === 'known' ? 1 : 0)),
    quizCorrect: counter(source.quizCorrect),
    quizWrong: counter(source.quizWrong),
    firstSeenAt: isoOrNull(source.firstSeenAt),
    firstLearnedAt: isoOrNull(source.firstLearnedAt),
    lastReviewedAt: isoOrNull(source.lastReviewedAt ?? source.lastPracticed),
    lastResult,
  };
  record.learningLevel = calculateLearningLevel(record);
  return record;
}

const baseStatusFor = (courseUntil) => courseUntil >= 46 ? 'joined' : courseUntil > 0 ? 'browsing' : 'not_started';

function emptyStatus() {
  return Object.fromEntries(CATEGORY_IDS.map((id) => [id, 'not_started']));
}

function fallback() {
  return {
    version: 4,
    settings: { ...DEFAULT_SETTINGS, reviewCategories: [], testCategories: [...DEFAULT_SETTINGS.testCategories] },
    courseUntil: 0,
    categoryStatus: emptyStatus(),
    browseProgress: null,
    records: {},
  };
}

function learnedCategories(state) {
  return CATEGORY_IDS.filter((category) => STUDY_ITEMS.some((item) => {
    if (item.category !== category) return false;
    if (category === 'basic') return item.index <= state.courseUntil;
    return Boolean(state.records[item.id]?.learned);
  }));
}

function sanitizeCategoryList(value, fallbackList, allowed = CATEGORY_IDS) {
  const source = Array.isArray(value) ? value : fallbackList;
  return [...new Set(source.filter((id) => allowed.includes(id)))];
}

function sanitizeSettings(source = {}, available = CATEGORY_IDS) {
  const selectedMode = ['review', 'browse', 'test'].includes(source.selectedMode)
    ? source.selectedMode : source.selectedMode === 'new' ? 'review' : 'review';
  const reviewRangeStart = positiveInteger(source.reviewRangeStart, 1);
  const reviewRangeEnd = source.reviewRangeEnd === null || source.reviewRangeEnd === undefined || source.reviewRangeEnd === ''
    ? null : Math.max(reviewRangeStart, positiveInteger(source.reviewRangeEnd, reviewRangeStart));
  return {
    selectedMode,
    reviewCategories: sanitizeCategoryList(source.reviewCategories, available, available),
    reviewScript: validScript(source.reviewScript ?? source.script),
    reviewCount: validCount(source.reviewCount ?? source.count, 30),
    reviewMode: ['smart', 'uniform'].includes(source.reviewMode) ? source.reviewMode : 'smart',
    reviewRangeStart,
    reviewRangeEnd,
    browseCategory: CATEGORY_IDS.includes(source.browseCategory) ? source.browseCategory : CATEGORY_IDS.find((id) => id !== 'basic') ?? 'basic',
    testCategories: sanitizeCategoryList(source.testCategories, CATEGORY_IDS),
    testScript: validScript(source.testScript ?? source.script),
    testCount: validCount(source.testCount ?? source.count, 30),
    testMode: ['smart', 'uniform'].includes(source.testMode) ? source.testMode : 'uniform',
  };
}

function sanitizeBrowseProgress(source) {
  if (!source || !CATEGORY_IDS.includes(source.category)) return null;
  const group = itemsByCategory(source.category);
  if (!group.length) return null;
  return {
    category: source.category,
    index: clamp(source.index, 0, group.length - 1),
    startedAt: isoOrNull(source.startedAt),
  };
}

function migrate(parsed = {}) {
  const state = fallback();
  state.courseUntil = clamp(parsed.courseUntil ?? parsed.learnedUntil, 0, 46);
  for (const category of CATEGORY_IDS) state.categoryStatus[category] = validStatus(parsed.categoryStatus?.[category]);
  if (parsed.version !== 4 || !parsed.categoryStatus?.basic) state.categoryStatus.basic = baseStatusFor(state.courseUntil);
  for (const item of STUDY_ITEMS) {
    const source = parsed.records?.[item.id];
    const learnedByBoundary = item.category === 'basic' && item.index <= state.courseUntil;
    const learnedByCategory = state.categoryStatus[item.category] === 'joined';
    if (source || learnedByBoundary || learnedByCategory) state.records[item.id] = sanitizeRecord(source, learnedByBoundary || learnedByCategory);
  }
  state.browseProgress = sanitizeBrowseProgress(parsed.browseProgress ?? (parsed.pendingLearning ? {
    category: 'basic', index: parsed.pendingLearning.recognitionIndex, startedAt: parsed.pendingLearning.startedAt,
  } : null));
  if (state.browseProgress && state.categoryStatus[state.browseProgress.category] === 'not_started') state.categoryStatus[state.browseProgress.category] = 'browsing';
  const available = learnedCategories(state);
  state.settings = sanitizeSettings(parsed.settings, available);
  return state;
}

function save(state, store) {
  try { store.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  return state;
}

export function loadState(store = browserStore()) {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback();
    const migrated = migrate(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) save(migrated, store);
    return migrated;
  } catch { return fallback(); }
}

export function saveSettings(partial, store = browserStore()) {
  const state = loadState(store);
  const available = learnedCategories(state);
  state.settings = sanitizeSettings({ ...state.settings, ...partial }, available);
  return save(state, store);
}

export function saveBrowseProgress(category, index, store = browserStore(), now = new Date().toISOString()) {
  const state = loadState(store);
  if (!CATEGORY_IDS.includes(category)) return state;
  const group = itemsByCategory(category);
  if (!group.length) return state;
  state.browseProgress = { category, index: clamp(index, 0, group.length - 1), startedAt: state.browseProgress?.category === category ? state.browseProgress.startedAt : now };
  if (state.categoryStatus[category] !== 'joined') state.categoryStatus[category] = 'browsing';
  state.settings.browseCategory = category;
  return save(state, store);
}

export function finishBrowsing(category, store = browserStore()) {
  const state = loadState(store);
  if (!CATEGORY_IDS.includes(category)) return state;
  state.categoryStatus[category] = state.categoryStatus[category] === 'joined' ? 'joined' : 'browsed';
  if (state.browseProgress?.category === category) state.browseProgress = null;
  return save(state, store);
}

export function joinCategory(category, store = browserStore(), now = new Date().toISOString()) {
  const state = loadState(store);
  if (!CATEGORY_IDS.includes(category)) return state;
  for (const item of itemsByCategory(category)) {
    const record = sanitizeRecord(state.records[item.id], true);
    record.learned = true;
    if (!record.firstSeenAt) record.firstSeenAt = now;
    if (!record.firstLearnedAt) record.firstLearnedAt = now;
    record.learningLevel = calculateLearningLevel(record);
    state.records[item.id] = record;
  }
  state.categoryStatus[category] = 'joined';
  if (category === 'basic') state.courseUntil = 46;
  if (state.browseProgress?.category === category) state.browseProgress = null;
  const selected = new Set(state.settings.reviewCategories);
  selected.add(category);
  state.settings.reviewCategories = CATEGORY_IDS.filter((id) => selected.has(id));
  return save(state, store);
}

export function markSeen(itemId, store = browserStore(), now = new Date().toISOString()) {
  const state = loadState(store);
  if (!itemById(itemId)) return state;
  const record = sanitizeRecord(state.records[itemId]);
  if (!record.firstSeenAt) record.firstSeenAt = now;
  record.learningLevel = calculateLearningLevel(record);
  state.records[itemId] = record;
  return save(state, store);
}

export function recordRating(itemId, rating, store = browserStore(), now = new Date().toISOString()) {
  const state = loadState(store);
  if (!itemById(itemId) || !['known', 'fuzzy', 'unknown'].includes(rating)) return state;
  const record = sanitizeRecord(state.records[itemId]);
  if (record.totalReviews < Number.MAX_SAFE_INTEGER) {
    record.totalReviews += 1;
    const key = { known: 'knownCount', fuzzy: 'unsureCount', unknown: 'unknownCount' }[rating];
    record[key] += 1;
  }
  record.knownStreak = rating === 'known' ? Math.min(record.knownCount, incrementCounter(record.knownStreak)) : 0;
  record.lastResult = rating;
  record.lastReviewedAt = now;
  record.learningLevel = calculateLearningLevel(record);
  state.records[itemId] = record;
  return save(state, store);
}

export function recordQuiz(itemId, correct, store = browserStore()) {
  const state = loadState(store);
  if (!itemById(itemId)) return state;
  const record = sanitizeRecord(state.records[itemId]);
  if (correct) record.quizCorrect = incrementCounter(record.quizCorrect); else record.quizWrong = incrementCounter(record.quizWrong);
  state.records[itemId] = record;
  return save(state, store);
}

export function isWeakRecord(record) {
  if (!record) return false;
  if (['fuzzy', 'unknown'].includes(record.lastResult)) return true;
  return number(record.unsureCount) + number(record.unknownCount) > 0 && number(record.knownStreak) < 3;
}

export function setCourseUntil(value, store = browserStore()) {
  const state = loadState(store);
  const next = clamp(value, 0, 46);
  if (next > state.courseUntil) {
    for (const item of BASIC_KANA.slice(state.courseUntil, next)) {
      const record = sanitizeRecord(state.records[item.id], true);
      record.learned = true;
      state.records[item.id] = record;
    }
  }
  state.courseUntil = next;
  state.categoryStatus.basic = baseStatusFor(next);
  const available = learnedCategories(state);
  state.settings.reviewCategories = state.settings.reviewCategories.filter((id) => available.includes(id));
  if (next && !state.settings.reviewCategories.includes('basic')) state.settings.reviewCategories.unshift('basic');
  return save(state, store);
}

export const setLearnedUntil = setCourseUntil;
export function getItemRecord(itemId, store = browserStore()) { return loadState(store).records[itemId] ?? null; }
export const getKanaRecord = getItemRecord;
export function proficiencyFor(record) { return ['new', 'seen', 'developing', 'familiar', 'strong'][calculateLearningLevel(record)] ?? 'new'; }
export function resetStateWithResult(store = browserStore()) {
  const failedKeys = [];
  for (const key of [STORAGE_KEY, RECOVERY_STORAGE_KEY]) {
    try {
      if (store.removeItem(key) === false || store.getItem(key) !== null) failedKeys.push(key);
    } catch { failedKeys.push(key); }
  }
  if (!failedKeys.length) store.markResetVerified?.();
  return { state: fallback(), persistentCleared: failedKeys.length === 0 && store.isPersistent !== false, failedKeys };
}
export function resetState(store = browserStore()) { return resetStateWithResult(store).state; }

// Compatibility for v3 callers while the UI migrates to the category model.
export function completeLearningGroup(group, store = browserStore(), now = new Date().toISOString()) {
  const state = loadState(store);
  for (const item of group) {
    const id = item.id ?? item.romaji;
    if (!itemById(id)) continue;
    const record = sanitizeRecord(state.records[id], true);
    record.learned = true;
    if (!record.firstSeenAt) record.firstSeenAt = now;
    if (!record.firstLearnedAt) record.firstLearnedAt = now;
    state.records[id] = record;
    if (item.category === 'basic' || BASIC_KANA.some((base) => base.id === id)) state.courseUntil = Math.max(state.courseUntil, item.index ?? 0);
  }
  state.categoryStatus.basic = baseStatusFor(state.courseUntil);
  return save(state, store);
}
export function savePendingLearning(pending, store = browserStore()) {
  return saveBrowseProgress('basic', pending?.recognitionIndex ?? 0, store, pending?.startedAt);
}
export function loadPendingLearning(store = browserStore()) {
  const progress = loadState(store).browseProgress;
  return progress?.category === 'basic' ? { group: BASIC_KANA.slice(progress.index).map((item) => item.id), script: 'mixed', recognitionIndex: progress.index, startedAt: progress.startedAt } : null;
}
export function clearPendingLearning(store = browserStore()) {
  const state = loadState(store); state.browseProgress = null; return save(state, store);
}
export function applyRound(cards, store = browserStore()) {
  let state = loadState(store);
  for (const card of cards) state = recordRating(card.id ?? card.romaji, card.rating, store);
  return state;
}
