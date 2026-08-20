import { BASIC_KANA, CATEGORY_IDS, STUDY_ITEMS, itemById, itemsByCategory } from './data.js?v=20260820-2';

export const STORAGE_KEY = 'kana-flashcards-v1';
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

const browserStore = () => globalThis.localStorage;
const number = (value, fallbackValue = 0) => Number.isFinite(Number(value)) ? Number(value) : fallbackValue;
const clamp = (value, min, max) => Math.min(max, Math.max(min, number(value, min)));
const isoOrNull = (value) => typeof value === 'string' && value ? value : null;
const validResult = (value) => ['known', 'fuzzy', 'unknown'].includes(value) ? value : null;
const validStatus = (value) => ['not_started', 'browsing', 'browsed', 'joined'].includes(value) ? value : 'not_started';
const validScript = (value) => ['mixed', 'hiragana', 'katakana'].includes(value) ? value : 'mixed';
const validCount = (value, fallbackValue = 30) => value === 'infinite' || value === '∞' || value === Infinity
  ? 'infinite' : [20, 30, 50, 100].includes(number(value)) ? number(value) : fallbackValue;
const positiveInteger = (value, fallbackValue = 1) => Math.max(1, Math.trunc(number(value, fallbackValue)));

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
  const oldShown = Math.max(0, number(source.shown));
  const knownCount = Math.max(0, number(source.knownCount ?? source.known));
  const unsureCount = Math.max(0, number(source.unsureCount ?? source.fuzzy));
  const unknownCount = Math.max(0, number(source.unknownCount ?? source.unknown));
  const totalReviews = Math.max(oldShown, number(source.totalReviews), knownCount + unsureCount + unknownCount);
  let lastResult = validResult(source.lastResult);
  if (!lastResult) lastResult = unknownCount ? 'unknown' : unsureCount ? 'fuzzy' : knownCount ? 'known' : null;
  const record = {
    ...createRecord(),
    learned: Boolean(source.learned || learned),
    totalReviews,
    knownCount,
    unsureCount,
    unknownCount,
    knownStreak: Math.max(0, number(source.knownStreak, lastResult === 'known' ? 1 : 0)),
    quizCorrect: Math.max(0, number(source.quizCorrect)),
    quizWrong: Math.max(0, number(source.quizWrong)),
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
    settings: { ...DEFAULT_SETTINGS, reviewCategories: [...DEFAULT_SETTINGS.reviewCategories], testCategories: [...DEFAULT_SETTINGS.testCategories] },
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
  if (!state.settings.reviewCategories.length && available.length) state.settings.reviewCategories = [...available];
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
  state.categoryStatus[category] = 'browsing';
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
  record.totalReviews += 1;
  if (rating === 'known') { record.knownCount += 1; record.knownStreak += 1; }
  if (rating === 'fuzzy') { record.unsureCount += 1; record.knownStreak = 0; }
  if (rating === 'unknown') { record.unknownCount += 1; record.knownStreak = 0; }
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
  if (correct) record.quizCorrect += 1; else record.quizWrong += 1;
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
export function resetState(store = browserStore()) { try { store.removeItem(STORAGE_KEY); } catch {} return fallback(); }

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
