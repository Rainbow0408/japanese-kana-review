# Review Range Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, freely adjustable review range with synchronized sliders and a full-kana preview that highlights the selected items.

**Architecture:** Keep range arithmetic in a new pure `js/review-range.js` module, persist only range settings in `js/storage.js`, and let `js/flashcards.js` build the ordered learned pool before slicing and optionally filtering weak items. `js/app.js` renders synchronized controls on the home screen and in a large native dialog, while the existing session engine remains unchanged.

**Tech Stack:** Native HTML/CSS/JavaScript ES modules, browser localStorage, native `<input type="range">` and `<dialog>`, Node.js built-in test runner, GitHub Pages.

---

## File map

- Create `js/review-range.js`: pure range normalization, bound updates, slicing, and summary helpers.
- Modify `js/storage.js`: add and sanitize `reviewRangeStart` and `reviewRangeEnd` without changing record history.
- Modify `js/flashcards.js`: build the learned ordered pool, slice it, then apply weak filtering.
- Modify `js/app.js`: range settings UI, synchronized draft/save behavior, dialog preview, and ranged review startup.
- Modify `index.html`: large review-range dialog and release cache version.
- Modify `styles.css`: accessible sliders, range summary, dialog grid, selected/unselected states, and responsive sizing.
- Modify `tests/flashcards.test.mjs`: range arithmetic, persistence, static UI, and cache-version regressions.
- Modify `tests/expansion.test.mjs`: multi-category range ordering and weak-filter sequencing.
- Modify `README.md`: document the new range workflow and preview.

### Task 1: Add pure range arithmetic

**Files:**
- Create: `js/review-range.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing range tests**

Add tests for the exact public API:

```js
import {
  normalizeReviewRange, updateReviewRange, sliceReviewRange, reviewRangeSummary,
} from '../js/review-range.js';

test('review range supports the first fifteen and an inclusive middle interval', () => {
  const items = Array.from({ length: 46 }, (_, index) => ({ id: `item-${index + 1}` }));
  assert.deepEqual(sliceReviewRange(items, 1, 15).map((item) => item.id),
    Array.from({ length: 15 }, (_, index) => `item-${index + 1}`));
  assert.deepEqual(sliceReviewRange(items, 16, 35).map((item) => item.id),
    Array.from({ length: 20 }, (_, index) => `item-${index + 16}`));
});

test('moving either range bound preserves the moved bound', () => {
  assert.deepEqual(updateReviewRange(46, 10, 20, 'start', 25), { start: 25, end: 25, endSetting: 25, count: 1 });
  assert.deepEqual(updateReviewRange(46, 10, 20, 'end', 5), { start: 5, end: 5, endSetting: 5, count: 1 });
  assert.deepEqual(normalizeReviewRange(46, -4, null), { start: 1, end: 46, endSetting: null, count: 46 });
  assert.equal(reviewRangeSummary(46, 16, 35), '第 16–35 项（共 20 项）');
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="review range" tests/flashcards.test.mjs`

Expected: FAIL because `js/review-range.js` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Create functions with inclusive one-based bounds:

```js
const integer = (value, fallback) => Number.isFinite(Number(value))
  ? Math.trunc(Number(value)) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeReviewRange(length, start = 1, endSetting = null) {
  const size = Math.max(0, integer(length, 0));
  if (!size) return { start: 0, end: 0, endSetting: null, count: 0 };
  const end = endSetting == null ? size : clamp(integer(endSetting, size), 1, size);
  const normalizedStart = Math.min(clamp(integer(start, 1), 1, size), end);
  return { start: normalizedStart, end, endSetting: endSetting == null ? null : end, count: end - normalizedStart + 1 };
}

export function updateReviewRange(length, start, endSetting, bound, value) {
  const current = normalizeReviewRange(length, start, endSetting);
  const moved = clamp(integer(value, bound === 'start' ? current.start : current.end), 1, Math.max(1, length));
  if (bound === 'start') {
    const end = Math.max(current.end, moved);
    return { start: moved, end, endSetting: end, count: end - moved + 1 };
  }
  const nextStart = Math.min(current.start, moved);
  return { start: nextStart, end: moved, endSetting: moved, count: moved - nextStart + 1 };
}

export function sliceReviewRange(items, start, endSetting) {
  const range = normalizeReviewRange(items.length, start, endSetting);
  return range.count ? items.slice(range.start - 1, range.end) : [];
}

export const reviewRangeSummary = (length, start, endSetting) => {
  const range = normalizeReviewRange(length, start, endSetting);
  return range.count ? `第 ${range.start}–${range.end} 项（共 ${range.count} 项）` : '暂无可复习内容';
};
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test --test-name-pattern="review range" tests/flashcards.test.mjs`

Expected: all selected tests PASS.

### Task 2: Persist range settings without altering history

**Files:**
- Modify: `js/storage.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write a failing migration/settings test**

```js
test('old state defaults to full review range and explicit bounds persist', () => {
  const { store } = memoryStore();
  const before = storage.loadState(store);
  assert.equal(before.settings.reviewRangeStart, 1);
  assert.equal(before.settings.reviewRangeEnd, null);
  storage.recordRating('a', 'fuzzy', store, '2026-08-20T00:00:00.000Z');
  const record = structuredClone(storage.loadState(store).records.a);
  const after = storage.saveSettings({ reviewRangeStart: 16, reviewRangeEnd: 35 }, store);
  assert.equal(after.settings.reviewRangeStart, 16);
  assert.equal(after.settings.reviewRangeEnd, 35);
  assert.deepEqual(after.records.a, record);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="full review range" tests/flashcards.test.mjs`

Expected: FAIL because the two settings are missing.

- [ ] **Step 3: Add compatible settings sanitization**

Add defaults:

```js
reviewRangeStart: 1,
reviewRangeEnd: null,
```

Add helpers and returned settings:

```js
const positiveInteger = (value, fallback = 1) => Math.max(1, Math.trunc(number(value, fallback)));
const nullablePositiveInteger = (value) => value == null ? null : positiveInteger(value);

reviewRangeStart: positiveInteger(source.reviewRangeStart, 1),
reviewRangeEnd: nullablePositiveInteger(source.reviewRangeEnd),
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test --test-name-pattern="full review range|manual basic boundary|v3 state" tests/flashcards.test.mjs tests/expansion.test.mjs`

Expected: range and migration tests PASS with preserved records.

### Task 3: Build the ranged review pool in the required order

**Files:**
- Modify: `js/flashcards.js`
- Test: `tests/expansion.test.mjs`

- [ ] **Step 1: Write failing ordered-pool tests**

```js
test('ranged review merges selected categories before slicing and weak filtering', () => {
  const state = joinedStateFor(['basic', 'dakuten']);
  state.records.a.lastResult = 'known';
  state.records.i.lastResult = 'unknown';
  const firstFifteen = flash.buildRangedReviewPool(
    STUDY_ITEMS, state, ['basic', 'dakuten'], { start: 1, end: 15 },
  );
  assert.deepEqual(firstFifteen.map((item) => item.id), BASIC_KANA.slice(0, 15).map((item) => item.id));
  const weak = flash.buildRangedReviewPool(
    STUDY_ITEMS, state, ['basic'], { start: 1, end: 2, weakOnly: true },
  );
  assert.deepEqual(weak.map((item) => item.id), ['i']);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="ranged review merges" tests/expansion.test.mjs`

Expected: FAIL because `buildRangedReviewPool` is missing.

- [ ] **Step 3: Implement composition without changing session weights**

Import `sliceReviewRange` and export:

```js
export function buildRangedReviewPool(items, state, categories, {
  start = 1, end = null, weakOnly = false,
} = {}) {
  const learned = buildReviewPool(items, state, categories, { learnedOnly: true });
  const ranged = sliceReviewRange(learned, start, end);
  return weakOnly ? ranged.filter((item) => isWeakRecord(state.records[item.id])) : ranged;
}
```

- [ ] **Step 4: Verify GREEN**

Run: `node --test --test-name-pattern="ranged review merges|review pools|smart review" tests/expansion.test.mjs`

Expected: selected tests PASS and weights remain 1/3/5.

### Task 4: Add the homepage controls and complete preview dialog

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `styles.css`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing static UI tests**

```js
test('review range UI provides synchronized controls and a complete highlighted preview', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="review-range-dialog"/);
  assert.match(html, /id="review-range-grid"/);
  assert.match(app, /data-review-range-bound/);
  assert.match(app, /查看全部假名/);
  assert.match(app, /aria-selected/);
  assert.match(css, /review-range-grid/);
  assert.match(css, /range-item\.selected/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="complete highlighted preview" tests/flashcards.test.mjs`

Expected: FAIL because the dialog and controls do not exist.

- [ ] **Step 3: Add the dialog shell**

Add before existing settings dialogs:

```html
<dialog id="review-range-dialog" class="range-dialog" aria-labelledby="review-range-title">
  <div class="dialog-head">
    <div><p class="eyebrow">当前勾选内容</p><h2 id="review-range-title">复习范围预览</h2></div>
    <button class="text" id="close-review-range" aria-label="关闭范围预览">✕</button>
  </div>
  <div id="review-range-dialog-controls"></div>
  <div id="review-range-grid" class="review-range-grid" aria-label="全部假名范围"></div>
</dialog>
```

- [ ] **Step 4: Render synchronized controls and preview**

Import range helpers and `buildRangedReviewPool`. Add:

```js
function currentReviewSourcePool() {
  return buildReviewPool(STUDY_ITEMS, state, state.settings.reviewCategories, { learnedOnly: true });
}

function rangeControlsTemplate(scope, pool) {
  const range = normalizeReviewRange(pool.length, state.settings.reviewRangeStart, state.settings.reviewRangeEnd);
  const disabled = pool.length ? '' : 'disabled';
  return `<div class="review-range-controls" data-range-scope="${scope}">
    <div class="setting-heading"><b>复习范围</b><strong data-range-summary>${reviewRangeSummary(pool.length, range.start, range.endSetting)}</strong></div>
    <label>从第 <input type="number" min="1" max="${pool.length}" value="${range.start}" data-review-range-bound="start" ${disabled}> 项开始</label>
    <input type="range" min="1" max="${Math.max(1, pool.length)}" value="${range.start}" data-review-range-bound="start" aria-label="复习范围起点" ${disabled}>
    <label>到第 <input type="number" min="1" max="${pool.length}" value="${range.end}" data-review-range-bound="end" ${disabled}> 项结束</label>
    <input type="range" min="1" max="${Math.max(1, pool.length)}" value="${range.end}" data-review-range-bound="end" aria-label="复习范围终点" ${disabled}>
    <div class="range-actions"><button type="button" data-review-range-action="all">全部范围</button><button type="button" data-review-range-action="preview">查看全部假名</button></div>
  </div>`;
}
```

Render category-grouped preview cells with continuous indexes and both visible and semantic state:

```js
const selected = index >= range.start && index <= range.end;
return `<div class="range-item ${selected ? 'selected' : ''}" aria-selected="${selected}">
  <small>${index}</small><b>${itemForm(item)}</b><span>${item.romaji}</span>${selected ? '<em>已选</em>' : ''}
</div>`;
```

- [ ] **Step 5: Implement live draft synchronization and persistence**

On `input`, use `updateReviewRange` to update the in-memory settings and refresh all matching controls, summaries, and grid classes without re-rendering the whole home view. On `change`, call:

```js
state = saveSettings({
  reviewRangeStart: state.settings.reviewRangeStart,
  reviewRangeEnd: state.settings.reviewRangeEnd,
});
```

“全部范围” saves `{ reviewRangeStart: 1, reviewRangeEnd: null }`. “查看全部假名” renders the dialog then calls `showModal()`. The close button calls `close()`.

- [ ] **Step 6: Add accessible desktop-first styling**

Add CSS with minimum 44px inputs, a wide dialog, readable unselected cells, explicit selected label, and no layout shift:

```css
.range-dialog { width: min(1120px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; }
.review-range-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
.review-range-controls .setting-heading, .range-actions { grid-column: 1 / -1; }
.review-range-controls input[type="range"] { width: 100%; min-height: 44px; accent-color: var(--green); }
.review-range-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin-top: 20px; }
.range-item { min-height: 96px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; opacity: .58; }
.range-item.selected { border-color: var(--green); background: var(--green-pale); opacity: 1; box-shadow: inset 0 0 0 1px var(--green); }
.range-item em { display: block; color: var(--green-dark); font-size: 12px; font-style: normal; font-weight: 700; }
```

- [ ] **Step 7: Verify UI GREEN**

Run: `node --check js/app.js && node --test --test-name-pattern="complete highlighted preview|buttons hide carets" tests/flashcards.test.mjs`

Expected: syntax succeeds and selected tests PASS.

### Task 5: Apply the range to review startup and category changes

**Files:**
- Modify: `js/app.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write a failing integration/static test**

```js
test('review startup applies the saved range before weak filtering', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /buildRangedReviewPool\([\s\S]*reviewRangeStart[\s\S]*reviewRangeEnd[\s\S]*weakOnly/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test --test-name-pattern="saved range before weak" tests/flashcards.test.mjs`

Expected: FAIL because startup still calls `buildReviewPool` directly.

- [ ] **Step 3: Use the ranged builder for normal and weak review**

Replace normal pool construction only when `customPool` is absent:

```js
const pool = customPool ?? buildRangedReviewPool(STUDY_ITEMS, state, categories, {
  start: state.settings.reviewRangeStart,
  end: state.settings.reviewRangeEnd,
  weakOnly: Boolean(overrides.weakOnly),
});
```

Custom pools used by “立即复习”, summary repeats, and “只练这些” retain their explicit contents. When review categories change, normalize explicit stored bounds against the new pool; keep `reviewRangeEnd: null` unchanged so “全部范围” follows future additions.

- [ ] **Step 4: Verify GREEN**

Run: `node --test --test-name-pattern="saved range before weak|review range|ranged review" tests/flashcards.test.mjs tests/expansion.test.mjs`

Expected: all selected tests PASS.

### Task 6: Documentation, release version, and full verification

**Files:**
- Modify: `README.md`
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `js/storage.js`
- Modify: `js/flashcards.js`
- Modify: `tests/flashcards.test.mjs`

- [ ] **Step 1: Update README and cache version**

Document range examples `1–15` and `16–35`, the preview dialog, and per-browser persistence. Change the release query from `20260820-1` to `20260820-2` in every browser import and in the cache-busting test.

- [ ] **Step 2: Run complete syntax and test verification**

Run:

```powershell
node --check js/data.js
node --check js/storage.js
node --check js/flashcards.js
node --check js/review-range.js
node --check js/new-learning.js
node --check js/audio.js
node --check js/keyboard.js
node --check js/app.js
node --test tests/flashcards.test.mjs tests/expansion.test.mjs
```

Expected: every syntax command exits 0 and the full test suite reports zero failures.

- [ ] **Step 3: Inspect the exact change set**

Run: `git status --short`, `git diff --check`, and `git diff --stat`.

Expected: only the spec, plan, range module, review/storage/app/UI/tests/README and release-version changes appear; no local data or unrelated files.

- [ ] **Step 4: Request commit and push authorization**

Report the verified files and test count. Ask explicitly whether to stage the confirmed paths, commit the feature, merge/update `main`, and push to `origin` so GitHub Pages redeploys. Do not run `git add`, `git commit`, or `git push` before that authorization.
