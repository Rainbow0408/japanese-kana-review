import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KANA } from '../js/data.js';
import * as flash from '../js/flashcards.js';
import * as storage from '../js/storage.js';
import * as audio from '../js/audio.js';
import { resolveFlashcardSpaceAction } from '../js/keyboard.js';

function memoryStore(initial = null) {
  const memory = new Map(initial ? [[storage.STORAGE_KEY, JSON.stringify(initial)]] : []);
  return {
    store: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: (key) => memory.delete(key),
    },
  };
}

test('basic kana retain the original 46 order and local audio keys', () => {
  assert.equal(KANA.length, 46);
  assert.deepEqual(
    { index: KANA[0].index, romaji: KANA[0].romaji, hiragana: KANA[0].hiragana, katakana: KANA[0].katakana },
    { index: 1, romaji: 'a', hiragana: 'あ', katakana: 'ア' },
  );
  assert.equal(KANA[14].romaji, 'so');
  assert.equal(KANA[45].romaji, 'n');
  assert.equal(KANA.every((item) => item.audioKey === item.romaji), true);
});

test('manual basic boundary preserves hidden history when lowered and restored', () => {
  const { store } = memoryStore();
  storage.setCourseUntil(20, store);
  storage.recordRating('so', 'fuzzy', store, '2026-08-20T00:00:00.000Z');
  const history = structuredClone(storage.loadState(store).records.so);
  storage.setCourseUntil(10, store);
  assert.deepEqual(storage.loadState(store).records.so, history);
  storage.setCourseUntil(20, store);
  assert.deepEqual(storage.loadState(store).records.so, history);
});

test('settings survive blocked localStorage writes without throwing', () => {
  const blocked = { getItem: () => null, setItem: () => { throw new Error('SecurityError'); }, removeItem: () => { throw new Error('SecurityError'); } };
  const result = storage.saveSettings({ selectedMode: 'test', testCount: 'infinite' }, blocked);
  assert.equal(result.settings.selectedMode, 'test');
  assert.equal(result.settings.testCount, 'infinite');
});

test('summary contains only rating results and weak items', () => {
  const summary = flash.buildSummary([
    { ...KANA[0], rating: 'known' },
    { ...KANA[0], rating: 'unknown' },
    { ...KANA[1], rating: 'fuzzy' },
  ]);
  assert.deepEqual(summary.counts, { known: 1, fuzzy: 1, unknown: 1 });
  assert.equal(summary.total, 3);
  assert.equal(summary.knownRate, 1 / 3);
  assert.equal(summary.weak[0].id, 'a');
  assert.equal(/reaction|speed|average|fastest|slowest|timed/i.test(JSON.stringify(summary)), false);
});

test('blocked audio is non-fatal even when speech is unavailable', async () => {
  audio.registerAudioInteraction();
  const result = await audio.playStudyItem(KANA[14], {
    audioFactory: () => ({ pause() {}, play: () => Promise.reject(new Error('NotAllowedError')) }),
  });
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, 'string');
});

test('project contains no reaction-time feature or timing weight copy', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const storageCode = readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8');
  const combined = `${html}\n${app}\n${storageCode}`;
  assert.doesNotMatch(combined, /反应时间|反应速度|答题耗时|速度评级|responseTime|totalReaction|averageReaction|fastestTime|slowestTime|speedScore/);
});

test('buttons hide carets while editable fields retain them', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /button[^}]*caret-color:\s*transparent/s);
  assert.match(css, /input\[type="number"\][^}]*caret-color:\s*auto/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
});

test('spacebar action follows reveal then known and rejects unsafe states', () => {
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, revealAvailable: true }), 'reveal');
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, knownAvailable: true }), 'known');
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, repeat: true, knownAvailable: true }), null);
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, editable: true, revealAvailable: true }), null);
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, dialogOpen: true, knownAvailable: true }), null);
  assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: false, revealAvailable: true }), null);
});

test('flashcard page and README retain the two-stage keyboard shortcut', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(html, /空格：显示答案 \/ 认识/);
  assert.match(css, /data-action="reveal-card"/);
  assert.match(readme, /Space.*显示答案.*再次按下.*认识/s);
});

test('runtime code avoids Object.groupBy for older desktop browsers', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /Object\.groupBy\s*\(/);
});

test('browser assets use one cache-busting release version', () => {
  const release = '20260820-1';
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const modules = ['app.js', 'storage.js', 'flashcards.js'].map((name) =>
    readFileSync(new URL(`../js/${name}`, import.meta.url), 'utf8'),
  ).join('\n');
  assert.match(html, new RegExp(`styles\\.css\\?v=${release}`));
  assert.match(html, new RegExp(`js/app\\.js\\?v=${release}`));
  assert.doesNotMatch(modules, /from ['"]\.\/[^'"]+\.js['"]/);
  assert.match(modules, new RegExp(`from ['"]\\.\\/data\\.js\\?v=${release}['"]`));
});
