import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as data from '../js/data.js';
import * as storage from '../js/storage.js';
import * as flash from '../js/flashcards.js';
import * as learning from '../js/new-learning.js';
import * as audio from '../js/audio.js';

function memoryStore(initial = null) {
  const memory = new Map(initial ? [[storage.STORAGE_KEY, JSON.stringify(initial)]] : []);
  return {
    memory,
    store: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
      removeItem: (key) => memory.delete(key),
    },
  };
}

test('expanded catalog contains all six categories and correct totals', () => {
  assert.deepEqual(data.CATEGORY_IDS, ['basic', 'dakuten', 'handakuten', 'youon', 'sokuon', 'chouon']);
  assert.equal(data.itemsByCategory('basic').length, 46);
  assert.equal(data.itemsByCategory('dakuten').length, 20);
  assert.equal(data.itemsByCategory('handakuten').length, 5);
  assert.equal(data.itemsByCategory('youon').length, 33);
  assert.equal(data.itemsByCategory('sokuon').length, 12);
  assert.equal(data.itemsByCategory('chouon').length, 12);
  assert.equal(data.STUDY_ITEMS.length, 128);
});

test('dakuten aliases and small youon kana are represented correctly', () => {
  assert.deepEqual(data.itemById('dakuten-di').aliases, ['di']);
  assert.equal(data.itemById('dakuten-di').romaji, 'ji');
  assert.deepEqual(data.itemById('dakuten-du').aliases, ['du']);
  assert.equal(data.itemById('youon-kya').hiragana, 'きゃ');
  assert.equal(data.itemById('youon-kya').katakana, 'キャ');
  assert.equal(data.itemsByCategory('youon').every((item) => /[ゃゅょ]/.test(item.hiragana)), true);
});

test('sokuon and chouon use complete combinations rather than standalone symbols', () => {
  const kitte = data.itemById('sokuon-kitte');
  const coffee = data.itemById('chouon-koohii');
  assert.equal(kitte.kana, 'きって');
  assert.equal(kitte.romaji, 'kitte');
  assert.equal(kitte.focus, 'っ');
  assert.match(kitte.explanation, /辅音重复/);
  assert.equal(coffee.kana, 'コーヒー');
  assert.equal(coffee.romaji, 'koohii');
  assert.equal(coffee.focus, 'ー');
  assert.match(coffee.explanation, /延长/);
  assert.equal(data.itemsByCategory('sokuon').some((item) => item.kana === 'っ' || item.romaji === 'tsu'), false);
  assert.equal(data.itemsByCategory('chouon').some((item) => item.kana === 'ー'), false);
});

test('v3 state migrates to v4 once while preserving base history', () => {
  const { store, memory } = memoryStore({
    version: 3,
    courseUntil: 46,
    settings: { selectedMode: 'new', reviewCount: 20 },
    records: {
      a: { learned: true, totalReviews: 4, knownCount: 2, unsureCount: 1, unknownCount: 1, totalReaction: 12, lastResult: 'unknown' },
    },
  });
  const first = storage.loadState(store);
  assert.equal(first.version, 4);
  assert.equal(first.records.a.knownCount, 2);
  assert.equal(first.categoryStatus.basic, 'joined');
  assert.equal(first.categoryStatus.youon, 'not_started');
  assert.equal(first.settings.selectedMode, 'review');
  assert.equal(first.settings.reviewCount, 20);
  assert.equal(/reaction|speed|fastest|slowest|timer/i.test(JSON.stringify(first)), false);
  const once = memory.get(storage.STORAGE_KEY);
  assert.deepEqual(storage.loadState(store), first);
  assert.equal(memory.get(storage.STORAGE_KEY), once);
});

test('joining a browsed category creates learned records without overwriting first learned time', () => {
  const { store } = memoryStore();
  storage.saveBrowseProgress('dakuten', 4, store, '2026-08-20T01:00:00.000Z');
  storage.finishBrowsing('dakuten', store);
  let state = storage.joinCategory('dakuten', store, '2026-08-20T02:00:00.000Z');
  assert.equal(state.categoryStatus.dakuten, 'joined');
  assert.equal(state.records['dakuten-ga'].learned, true);
  assert.equal(state.records['dakuten-ga'].firstLearnedAt, '2026-08-20T02:00:00.000Z');
  state = storage.joinCategory('dakuten', store, '2026-08-21T02:00:00.000Z');
  assert.equal(state.records['dakuten-ga'].firstLearnedAt, '2026-08-20T02:00:00.000Z');
});

test('known streak removes recovered historical errors from weak pool', () => {
  const { store } = memoryStore();
  storage.joinCategory('handakuten', store);
  storage.recordRating('handakuten-pa', 'unknown', store);
  assert.equal(storage.isWeakRecord(storage.loadState(store).records['handakuten-pa']), true);
  storage.recordRating('handakuten-pa', 'known', store);
  storage.recordRating('handakuten-pa', 'known', store);
  assert.equal(storage.isWeakRecord(storage.loadState(store).records['handakuten-pa']), true);
  storage.recordRating('handakuten-pa', 'known', store);
  assert.equal(storage.isWeakRecord(storage.loadState(store).records['handakuten-pa']), false);
});

test('review pools filter categories, learned items, and weak items', () => {
  const { store } = memoryStore();
  storage.joinCategory('handakuten', store);
  storage.recordRating('handakuten-pa', 'fuzzy', store);
  const state = storage.loadState(store);
  assert.equal(flash.buildReviewPool(data.STUDY_ITEMS, state, ['handakuten'], { learnedOnly: true }).length, 5);
  assert.deepEqual(flash.buildReviewPool(data.STUDY_ITEMS, state, ['handakuten'], { learnedOnly: true, weakOnly: true }).map((item) => item.id), ['handakuten-pa']);
});

test('review range follows merged category order before weak filtering', () => {
  const { store } = memoryStore();
  storage.setCourseUntil(46, store);
  storage.joinCategory('dakuten', store);
  storage.recordRating(data.STUDY_ITEMS[44].id, 'fuzzy', store);
  storage.recordRating('dakuten-ga', 'fuzzy', store);
  const state = storage.loadState(store);

  const ranged = flash.buildRangedReviewPool(
    data.STUDY_ITEMS,
    state,
    ['basic', 'dakuten'],
    { start: 45, end: 48 },
    { learnedOnly: true },
  );
  assert.deepEqual(ranged.map((item) => item.id), [
    data.STUDY_ITEMS[44].id,
    data.STUDY_ITEMS[45].id,
    'dakuten-ga',
    'dakuten-gi',
  ]);

  const weak = flash.buildRangedReviewPool(
    data.STUDY_ITEMS,
    state,
    ['basic', 'dakuten'],
    { start: 45, end: 48 },
    { learnedOnly: true, weakOnly: true },
  );
  assert.deepEqual(weak.map((item) => item.id), [data.STUDY_ITEMS[44].id, 'dakuten-ga']);
});

test('smart review uses 1 3 5 weights and avoids the last three cards when possible', () => {
  assert.equal(flash.reviewWeight({ lastResult: 'known' }), 1);
  assert.equal(flash.reviewWeight({ lastResult: 'fuzzy' }), 3);
  assert.equal(flash.reviewWeight({ lastResult: 'unknown' }), 5);
  const pool = data.itemsByCategory('basic').slice(0, 5);
  const session = flash.createSession(pool, { mode: 'smart', script: 'hiragana', count: 10 }, () => 0, {});
  const cards = [flash.nextCard(session, () => 0), flash.nextCard(session, () => 0), flash.nextCard(session, () => 0), flash.nextCard(session, () => 0)];
  assert.equal(new Set(cards.map((item) => item.id)).size, 4);
});

test('rule items keep their own display while direct kana respect script selection', () => {
  assert.equal(flash.displayForItem(data.itemById('youon-kya'), 'hiragana', () => 0.9), 'きゃ');
  assert.equal(flash.displayForItem(data.itemById('youon-kya'), 'katakana', () => 0.1), 'キャ');
  assert.equal(flash.displayForItem(data.itemById('sokuon-kitte'), 'katakana', () => 0.1), 'きって');
});

test('simple browsing clamps positions and reports category completion', () => {
  const group = data.itemsByCategory('dakuten');
  assert.equal(learning.getBrowseItem(group, 99).id, group.at(-1).id);
  assert.equal(learning.getBrowseItem(group, -1).id, group[0].id);
  assert.equal(learning.nextBrowseIndex(group, 19), 19);
  assert.equal(learning.isBrowseComplete(group, 19), true);
});

test('audio uses local base files and speech fallback for expanded content', async () => {
  assert.equal(audio.audioSourceFor(data.itemById('so')), 'assets/audio/so.mp3');
  assert.equal(audio.audioSourceFor(data.itemById('youon-kya')), null);
  let spoken = '';
  const result = await audio.playStudyItem(data.itemById('youon-kya'), {
    manual: true,
    speechFactory: (text) => ({ text, lang: '' }),
    speak: (utterance, resolve) => { spoken = utterance.text; resolve(); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'speech');
  assert.equal(spoken, 'きゃ');
});

test('static page is review first and prepared for grouped content', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /日语假名复习/);
  assert.match(html, /巩固复习[\s\S]*快速过新内容[\s\S]*自定义测试/);
  assert.match(html, /只练薄弱项/);
  assert.match(html, /基础五十音[\s\S]*浊音 \/ 半浊音[\s\S]*拗音[\s\S]*发音规则/);
  assert.doesNotMatch(html, /开始小测|主动回忆|混合巩固/);
});

test('README and web assets are GitHub Pages safe and contain no private machine path', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(html, /href="styles\.css/);
  assert.match(html, /src="js\/app\.js(?:\?v=[^"]+)?"/);
  assert.doesNotMatch(html, /(?:href|src)="\//);
  assert.match(readme, /GitHub Pages/);
  assert.match(readme, /localStorage/);
  assert.doesNotMatch(readme, /C:\\Users|127\.0\.0\.1|localhost/);
});
