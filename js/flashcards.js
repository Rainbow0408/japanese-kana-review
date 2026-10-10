import { isWeakRecord } from './storage.js?v=20261010-1';
import { sliceReviewRange } from './review-range.js?v=20261010-1';

export function buildPool(items, range) {
  if (typeof range === 'number') return items.slice(0, Math.max(1, Math.min(range, items.length)));
  const start = Math.max(1, Math.min(Number(range?.start) || 1, items.length));
  const end = Math.max(start, Math.min(Number(range?.end) || items.length, items.length));
  return items.slice(start - 1, end);
}

export function displayForItem(item, script = 'mixed', random = Math.random) {
  if (item.kana) return item.kana;
  if (script === 'hiragana') return item.hiragana;
  if (script === 'katakana') return item.katakana;
  return random() < 0.5 ? item.hiragana : item.katakana;
}

export const chooseDisplay = displayForItem;

export function buildReviewPool(items, state, categories, options = {}) {
  const selected = new Set(categories);
  return items.filter((item) => {
    if (!selected.has(item.category)) return false;
    const record = state.records?.[item.id];
    const activeBasic = item.category === 'basic' && item.index <= Number(state.courseUntil || 0);
    const learned = item.category === 'basic' ? activeBasic : Boolean(record?.learned);
    if (options.learnedOnly && !learned) return false;
    if (options.weakOnly && !isWeakRecord(record)) return false;
    return true;
  });
}

export function buildRangedReviewPool(items, state, categories, range = {}, options = {}) {
  const merged = buildReviewPool(items, state, categories, { ...options, weakOnly: false });
  const ranged = sliceReviewRange(merged, range.start, range.end);
  if (!options.weakOnly) return ranged;
  return ranged.filter((item) => isWeakRecord(state.records?.[item.id]));
}

export const reviewWeight = (record = {}) => record.lastResult === 'unknown' ? 5 : record.lastResult === 'fuzzy' ? 3 : 1;

export function createSession(pool, settings, random = Math.random, records = {}) {
  const smart = settings.mode === 'smart';
  return {
    pool,
    settings,
    random,
    cards: [],
    recent: [],
    weights: Object.fromEntries(pool.map((item) => [item.id, smart ? reviewWeight(records[item.id]) : 1])),
    current: null,
  };
}

function weightedPick(items, weights, random) {
  const total = items.reduce((sum, item) => sum + (weights[item.id] ?? 1), 0);
  let cursor = random() * total;
  return items.find((item) => (cursor -= (weights[item.id] ?? 1)) <= 0) ?? items.at(-1);
}

export function nextCard(session, random = session.random) {
  const spaced = session.pool.filter((item) => !session.recent.includes(item.id));
  const notCurrent = session.pool.filter((item) => item.id !== session.current?.id);
  const choices = spaced.length ? spaced : notCurrent.length ? notCurrent : session.pool;
  const item = weightedPick(choices, session.weights, random);
  const card = { ...item, display: displayForItem(item, session.settings.script, random) };
  session.current = card;
  session.recent = [...session.recent, item.id].slice(-3);
  return card;
}

export function rateCard(session, card, rating) {
  const rated = { ...card, rating };
  session.cards.push(rated);
  if (session.settings.mode === 'smart') session.weights[card.id] = rating === 'unknown' ? 5 : rating === 'fuzzy' ? 3 : 1;
  return rated;
}

export function buildSummary(cards) {
  const counts = { known: 0, fuzzy: 0, unknown: 0 };
  const grouped = {};
  for (const card of cards) {
    if (!Object.hasOwn(counts, card.rating)) continue;
    counts[card.rating] += 1;
    const id = card.id ?? card.romaji;
    const entry = grouped[id] ??= {
      id,
      category: card.category ?? 'basic',
      romaji: card.romaji,
      hiragana: card.hiragana,
      katakana: card.katakana,
      kana: card.kana,
      known: 0,
      fuzzy: 0,
      unknown: 0,
    };
    entry[card.rating] += 1;
  }
  const weak = Object.values(grouped)
    .map((entry) => ({ ...entry, errors: entry.unknown * 2 + entry.fuzzy }))
    .filter((entry) => entry.errors > 0)
    .sort((a, b) => b.errors - a.errors || a.romaji.localeCompare(b.romaji));
  const total = counts.known + counts.fuzzy + counts.unknown;
  return { counts, total, knownRate: total ? counts.known / total : 0, weak, grouped };
}

export function findConfusions(summary, pairs) {
  return pairs.filter(([a, b]) => {
    const first = summary.grouped[a];
    const second = summary.grouped[b];
    return first && second && first.fuzzy + first.unknown > 0 && second.fuzzy + second.unknown > 0;
  });
}
