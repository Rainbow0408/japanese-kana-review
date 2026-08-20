# Kana Review Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refocus the existing kana app on fast daily review, add five new content families, preserve v3 history through an idempotent v4 migration, and prepare the pure frontend project for GitHub Pages.

**Architecture:** Keep browser ES modules and split responsibilities between catalog data, storage/migration, review selection, audio fallback, and DOM rendering. Basic kana retain their existing record keys; all new items use stable prefixed IDs. The app renders three modes from one shared item catalog and one shared rating/session engine.

**Tech Stack:** Native HTML/CSS/JavaScript ES modules, browser localStorage, Web Audio element, SpeechSynthesis, Node.js built-in test runner, static GitHub Pages hosting.

---

## File map

- Modify `js/data.js`: category metadata plus all basic, dakuten, handakuten, youon, sokuon, and chouon items.
- Replace `js/storage.js`: v4 state, idempotent migration, category status, browse progress, settings, rating history.
- Replace `js/flashcards.js`: item display, category pools, 1/3/5 weighting, three-card spacing, weak detection, summary.
- Simplify `js/new-learning.js`: browse category helpers only; remove quiz/reinforcement responsibilities.
- Replace `js/audio.js`: local MP3 first for basic items, then SpeechSynthesis `ja-JP`.
- Replace `js/app.js`: review-first dashboard, simple browse flow, custom test, shared flashcards, category table and records.
- Modify `index.html`: review-first copy and containers for category status, quick actions, tabs, grouped records.
- Modify `styles.css`: category controls, compact dashboard, rule highlighting, tabs, records accordion, responsive layout.
- Replace `tests/flashcards.test.mjs`: catalog, migration, session, audio, static deployment and privacy tests.
- Modify `README.md`: Chinese public-project documentation and Pages instructions.
- Create `.gitignore`: privacy and temporary-file exclusions.

### Task 1: Build the unified study catalog

**Files:**
- Modify: `js/data.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing catalog tests**

Assert the exact category totals and representative items:

```js
assert.equal(itemsByCategory('basic').length, 46);
assert.equal(itemsByCategory('dakuten').length, 20);
assert.equal(itemsByCategory('handakuten').length, 5);
assert.equal(itemsByCategory('youon').length, 33);
assert.deepEqual(findItem('dakuten-di').aliases, ['di']);
assert.equal(findItem('sokuon-kitte').romaji, 'kitte');
assert.equal(findItem('chouon-koohii').focus, 'ー');
```

- [ ] **Step 2: Run the catalog tests and verify RED**

Run: `node --test --test-name-pattern="catalog|sokuon|chouon" tests/flashcards.test.mjs`

Expected: FAIL because category exports and expanded items do not exist.

- [ ] **Step 3: Implement category metadata and study items**

Export stable category definitions and normalized items:

```js
export const CATEGORY_IDS = ['basic', 'dakuten', 'handakuten', 'youon', 'sokuon', 'chouon'];
export const itemById = (id) => STUDY_ITEMS.find((item) => item.id === id);
export const itemsByCategory = (category) => STUDY_ITEMS.filter((item) => item.category === category);
```

Use the approved 46/20/5/33 direct-kana entries plus 12 common sokuon and 12 common chouon combinations. Rule items include `kana`, `focus`, and `explanation`; direct-kana items include both scripts.

- [ ] **Step 4: Run catalog tests and verify GREEN**

Run: `node --test --test-name-pattern="catalog|sokuon|chouon" tests/flashcards.test.mjs`

Expected: all selected tests PASS.

### Task 2: Migrate storage to v4 without losing history

**Files:**
- Modify: `js/storage.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing v3 migration and idempotence tests**

Create a memory store with v3 `courseUntil`, base records, legacy timing keys and settings. Assert:

```js
assert.equal(first.version, 4);
assert.equal(first.records.a.knownCount, 2);
assert.equal(first.categoryStatus.basic, 'joined');
assert.equal(first.categoryStatus.youon, 'not_started');
assert.deepEqual(storage.loadState(store), first);
assert.equal(/reaction|speed|fastest|slowest|timer/i.test(JSON.stringify(first)), false);
```

- [ ] **Step 2: Run migration tests and verify RED**

Run: `node --test --test-name-pattern="v4|migration|category status" tests/flashcards.test.mjs`

Expected: FAIL with version 3 or missing status fields.

- [ ] **Step 3: Implement v4 state and APIs**

Use these public operations:

```js
loadState(store)
saveSettings(partial, store)
saveBrowseProgress(category, index, store)
finishBrowsing(category, store)
joinCategory(category, store, now)
recordRating(itemId, rating, store, now)
setCourseUntil(value, store)
resetState(store)
isWeakRecord(record)
```

Add `knownStreak`; known increments it while fuzzy/unknown reset it. Preserve `firstLearnedAt` once set. Sanitize selected review categories against categories that currently contain learned items.

- [ ] **Step 4: Run storage tests and verify GREEN**

Run: `node --test --test-name-pattern="v4|migration|category status|settings|weak" tests/flashcards.test.mjs`

Expected: selected tests PASS and migration is byte-stable after the first save.

### Task 3: Replace the review engine with category-aware sessions

**Files:**
- Modify: `js/flashcards.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing pool, display, weighting and spacing tests**

Cover learned category filters, rule-item display, counts including infinity, 1/3/5 weights, and spacing:

```js
assert.equal(reviewWeight({ lastResult: 'known' }), 1);
assert.equal(reviewWeight({ lastResult: 'fuzzy' }), 3);
assert.equal(reviewWeight({ lastResult: 'unknown' }), 5);
assert.equal(new Set(queue.slice(0, 4).map((item) => item.id)).size, 4);
assert.equal(displayForItem(ruleItem, 'katakana'), ruleItem.kana);
```

- [ ] **Step 2: Run review-engine tests and verify RED**

Run: `node --test --test-name-pattern="review pool|weight|spacing|display|summary" tests/flashcards.test.mjs`

Expected: FAIL because sessions still key by `romaji` and use 1/2/4 weights.

- [ ] **Step 3: Implement the shared session engine**

Export:

```js
buildReviewPool(items, state, categories, { learnedOnly, weakOnly })
displayForItem(item, script, random)
reviewWeight(record)
createSession(pool, settings, random, records)
nextCard(session, random)
rateCard(session, card, rating)
buildSummary(cards)
```

Track the last three item IDs. Filter all three when at least one eligible item remains, otherwise progressively fall back to “not current” and finally the whole pool.

- [ ] **Step 4: Run review-engine tests and verify GREEN**

Run: `node --test --test-name-pattern="review pool|weight|spacing|display|summary" tests/flashcards.test.mjs`

Expected: selected tests PASS.

### Task 4: Simplify new-content browsing and add audio fallback

**Files:**
- Modify: `js/new-learning.js`
- Modify: `js/audio.js`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing browse and audio tests**

Assert browse clamping/resume, local basic audio, and speech fallback:

```js
assert.equal(getBrowseItem(group, 99).id, group.at(-1).id);
assert.equal(audioSourceFor(itemById('so')), 'assets/audio/so.mp3');
assert.equal(audioSourceFor(itemById('youon-kya')), null);
assert.equal((await playStudyItem(itemById('youon-kya'), speechOptions)).method, 'speech');
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --test-name-pattern="browse|audio|speech" tests/flashcards.test.mjs`

Expected: FAIL because browsing helpers and speech fallback are absent.

- [ ] **Step 3: Implement minimal browse helpers and resilient audio**

`new-learning.js` exports only category browse helpers. `audio.js` uses local MP3 only when `item.audioKey` exists; otherwise it speaks `item.hiragana ?? item.kana` with a `SpeechSynthesisUtterance` whose language is `ja-JP`. All errors return `{ ok: false }` and never throw into UI flow.

- [ ] **Step 4: Run browse/audio tests and verify GREEN**

Run: `node --test --test-name-pattern="browse|audio|speech" tests/flashcards.test.mjs`

Expected: selected tests PASS.

### Task 5: Rebuild the review-first UI and three modes

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `styles.css`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing static UI tests**

Assert the review-first title, mode labels, category controls, counts, weak button, table tabs and absence of legacy multi-stage copy:

```js
assert.match(html, /日语假名复习/);
assert.match(html, /巩固复习[\s\S]*快速过新内容[\s\S]*自定义测试/);
assert.doesNotMatch(html, /开始小测|主动回忆|混合巩固/);
assert.match(html, /只练薄弱项/);
```

- [ ] **Step 2: Run static UI tests and verify RED**

Run: `node --test --test-name-pattern="review-first UI|static page" tests/flashcards.test.mjs`

Expected: FAIL with old “学习新的五十音” and “快速测试” copy.

- [ ] **Step 3: Implement dashboard and settings renderers**

Default `selectedMode` to `review`. Render category status cards. Review settings use category checkboxes, script buttons, 20/30/50/100/infinite count buttons, smart/uniform buttons, and weak/all-learned quick actions. Browse mode renders eligible category cards. Test mode renders all-category checkboxes.

- [ ] **Step 4: Implement shared cards and simple browse**

Use one generic review/test card renderer and the existing keyboard helper. Rule answers call `highlightFocus(item)` to wrap every focus character in `<mark>`. Browse cards show answer immediately and save index after navigation; completion renders join/review actions.

- [ ] **Step 5: Implement concise summaries**

Render total, known, fuzzy, unknown, known rate and sorted weak rows. “只练这些” starts review with the summary pool; infinite sessions retain an explicit end button.

- [ ] **Step 6: Run syntax and UI tests**

Run: `node --check js/app.js && node --test tests/flashcards.test.mjs`

Expected: syntax exit 0 and all tests PASS.

### Task 6: Upgrade the kana table and grouped records

**Files:**
- Modify: `index.html`
- Modify: `js/app.js`
- Modify: `styles.css`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing table and records tests**

Assert tabs `基础五十音`, `浊音 / 半浊音`, `拗音`, `发音规则`, and grouped record containers for all six category IDs.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `node --test --test-name-pattern="kana table|grouped records" tests/flashcards.test.mjs`

Expected: FAIL because the old page has one 46-item grid and flat record list.

- [ ] **Step 3: Implement tabbed table and details**

Group direct kana by their `group` field. The rule tab displays sokuon/chouon examples and explanations. Detail panels include aliases only when present.

- [ ] **Step 4: Implement category record accordions**

Each `<details>` summary displays total, learned, strong and weak counts. Rows display item form, romaji, known/fuzzy/unknown totals. Do not render quiz or timing data.

- [ ] **Step 5: Run targeted and full tests**

Run: `node --test tests/flashcards.test.mjs`

Expected: all tests PASS.

### Task 7: Prepare the public static project

**Files:**
- Modify: `README.md`
- Create: `.gitignore`
- Modify: `index.html`
- Test: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write failing deployment/privacy static tests**

Assert relative CSS/JS/audio paths, required README sections, and no absolute machine path, localhost dependency in web assets, or secret-like value.

- [ ] **Step 2: Run deployment tests and verify RED**

Run: `node --test --test-name-pattern="GitHub Pages|privacy|README" tests/flashcards.test.mjs`

Expected: FAIL because README currently contains `C:\Users\...` and lacks Pages instructions.

- [ ] **Step 3: Rewrite README and add `.gitignore`**

README explains features, direct/static usage limitations, stable batch startup, Pages branch/root deployment, and localStorage privacy. `.gitignore` includes OS/IDE files, logs, temporary files, `export.json`, `user-data.json`, `progress.json`, and debug dumps.

- [ ] **Step 4: Run deployment/privacy tests and verify GREEN**

Run: `node --test --test-name-pattern="GitHub Pages|privacy|README" tests/flashcards.test.mjs`

Expected: selected tests PASS.

### Task 8: Browser verification, security scan, and local Git commit

**Files:**
- Verify all project files
- Create: `.git/` through `git init`

- [ ] **Step 1: Run complete automated verification**

Run: `node --check js/data.js; node --check js/storage.js; node --check js/flashcards.js; node --check js/new-learning.js; node --check js/audio.js; node --check js/app.js; node --test tests/flashcards.test.mjs`

Expected: all syntax checks exit 0 and test suite reports zero failures.

- [ ] **Step 2: Browser-test desktop and narrow viewport flows**

Start the local static server, then verify: review-first home, category filtering, 30/infinite settings, browse resume, join category, immediate review, reveal/rating shortcuts, weak-only summary action, table tabs, grouped records, refresh persistence, audio fallback, and a 390px-wide layout. Browser console must contain no application errors.

- [ ] **Step 3: Scan for secrets and personal data**

Run:

```powershell
rg -n -i "password|token|api[_-]?key|cookie|C:\\Users|user-data|progress\.json|export\.json" . -g "!docs/**" -g "!.git/**"
```

Expected: no secrets, credentials, absolute user paths, or committed learning-data files; documentation-only generic ignore entries are acceptable.

- [ ] **Step 4: Initialize Git and inspect the exact commit set**

Run: `git init`, `git status --short`, and `git diff --no-index NUL <file>` only as needed for untracked-file review. Do not add a remote.

- [ ] **Step 5: Commit the verified local project**

Run:

```powershell
git add .
git commit -m "feat: expand kana review system"
git status --short --branch
```

Expected: one local commit and a clean worktree. Remote creation, push, and Pages activation remain blocked on user confirmation of repository name and visibility.

## Execution note

The user explicitly requested continuous inline execution and supplied an approved detailed specification. Execute this plan in the current workspace without stopping at task checkpoints. Do not create or push a remote repository until the user confirms repository name and Public/Private visibility.
