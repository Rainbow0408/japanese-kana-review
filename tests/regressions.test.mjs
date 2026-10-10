import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../js/storage.js';
import { STUDY_ITEMS } from '../js/data.js';
import { buildReviewPool } from '../js/flashcards.js';
import { resolveFlashcardSpaceAction } from '../js/keyboard.js';
import { playStudyItem } from '../js/audio.js';

function memoryStore() {
  const memory = new Map();
  return { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
}

test('lowering basic progress excludes hidden history from actual review pool', () => {
  const store = memoryStore();
  storage.setCourseUntil(20, store);
  storage.recordRating('so', 'unknown', store);
  const before = structuredClone(storage.loadState(store).records.so);
  storage.setCourseUntil(10, store);
  const state = storage.loadState(store);
  assert.equal(buildReviewPool(STUDY_ITEMS, state, ['basic'], { learnedOnly: true }).length, 10);
  assert.deepEqual(state.records.so, before);
  assert.equal(buildReviewPool(STUDY_ITEMS, state, ['basic'], { learnedOnly: true, weakOnly: true }).length, 0);
});

test('explicit empty review selection survives reload', () => {
  const store = memoryStore();
  storage.setCourseUntil(10, store);
  storage.saveSettings({ reviewCategories: [] }, store);
  assert.deepEqual(storage.loadState(store).settings.reviewCategories, []);
});

test('revisiting a joined category preserves review qualification', () => {
  const store = memoryStore();
  storage.joinCategory('dakuten', store);
  storage.saveBrowseProgress('dakuten', 3, store);
  assert.equal(storage.loadState(store).categoryStatus.dakuten, 'joined');
  assert.equal(storage.loadState(store).browseProgress.index, 3);
  storage.finishBrowsing('dakuten', store);
  assert.equal(storage.loadState(store).categoryStatus.dakuten, 'joined');
});

test('progress and browse positions normalize fractional input to integer indices', () => {
  const store = memoryStore();
  assert.equal(storage.setCourseUntil(3.7, store).courseUntil, 3);
  assert.equal(storage.saveBrowseProgress('dakuten', 2.9, store).browseProgress.index, 2);
});

test('browser storage getter failures are non-fatal', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    assert.doesNotThrow(() => storage.loadState());
    assert.doesNotThrow(() => storage.saveSettings({ selectedMode: 'test' }));
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('blocked browser writes retain progress for the current session', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); },
  } });
  try {
    storage.saveSettings({ selectedMode: 'test' });
    assert.equal(storage.loadState().settings.selectedMode, 'test');
    storage.setCourseUntil(10);
    assert.equal(storage.loadState().courseUntil, 10);
    storage.resetState();
    assert.equal(storage.loadState().courseUntil, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('space shortcut preserves activation of other focused controls', () => {
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, revealAvailable: true, otherControlFocused: true }), null);
});

test('speech playback stops the previous local recording', async () => {
  let paused = 0;
  await playStudyItem({ audioKey: 'a', hiragana: 'あ' }, {
    manual: true, audioFactory: () => ({ pause() { paused += 1; }, play: async () => {} }),
  });
  paused = 0;
  await playStudyItem({ hiragana: 'きゃ' }, {
    manual: true, speechFactory: text => ({ text }), speak: (_, resolve) => resolve(),
  });
  assert.equal(paused, 1);
});

test('local playback cancels previous speech playback', async () => {
  let cancelled = 0;
  await playStudyItem({ audioKey: 'a', hiragana: 'あ' }, {
    manual: true, audioFactory: () => ({ pause() {}, play: async () => {} }),
    speechSynthesis: { cancel() { cancelled += 1; } },
  });
  assert.equal(cancelled, 1);
});
