# Learning Dashboard and Mode Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing kana flashcard page into a compact learning dashboard with three mode-specific flows, resumable staged new-kana learning, count-only mastery, and lossless localStorage migration.

**Architecture:** Keep the native HTML/CSS/ES-module application and bundled audio. Move persistent-domain rules into `storage.js`, deterministic learning generators into `new-learning.js`, generic weighted flashcards into `flashcards.js`, and let `app.js` render a small view/state machine without owning mastery or migration algorithms.

**Tech Stack:** HTML5, CSS, browser ES modules, localStorage, local MP3 audio, Node.js built-in test runner.

---

## File map

- Modify `index.html`: semantic dashboard, mode panel mount, practice/summary pages, settings dialog, records and kana table.
- Modify `styles.css`: compact desktop dashboard, mode cards, learning-stage layouts, mobile breakpoints, permanent caret suppression outside text inputs.
- Modify `js/data.js`: keep 46 kana and expose row/confusion metadata helpers.
- Modify `js/storage.js`: version 3 schema, migration, course boundary, pending session, record updates, mastery calculation.
- Modify `js/new-learning.js`: group, two-direction quiz plan, distractors, and mixed reinforcement queue.
- Modify `js/flashcards.js`: no-time generic sessions, review weights, summaries, confusion detection.
- Modify `js/audio.js`: reusable player and non-blocking autoplay result.
- Modify `js/app.js`: dashboard rendering and the three mode/state flows.
- Replace `tests/flashcards.test.mjs`: domain, migration, learning flow, weight, and summary regression tests.
- Modify `README.md`: current modes, persistence behavior, and unchanged double-click start instructions.

### Task 1: Lock the no-time storage contract with tests

**Files:**
- Modify: `tests/flashcards.test.mjs`
- Modify: `js/storage.js`

- [ ] **Step 1: Write failing migration and course-boundary tests**

Add tests that create an in-memory store containing version 2 records such as:

```js
memory.set(STORAGE_KEY, JSON.stringify({
  version: 2,
  learnedUntil: 20,
  records: { a: { shown: 4, known: 2, fuzzy: 1, unknown: 1, totalReaction: 12 } },
}));
const state = loadState(store);
assert.equal(state.version, 3);
assert.equal(state.courseUntil, 20);
assert.deepEqual(state.records.a, {
  learned: true,
  learningLevel: 2,
  totalReviews: 4,
  knownCount: 2,
  unsureCount: 1,
  unknownCount: 1,
  quizCorrect: 0,
  quizWrong: 0,
  firstSeenAt: null,
  firstLearnedAt: null,
  lastReviewedAt: null,
  lastResult: 'unknown',
});
assert.equal(JSON.stringify(state).includes('Reaction'), false);
```

Add a second test that lowers `courseUntil` from 20 to 10, asserts the record at index 15 remains unchanged, then raises it to 20 and asserts the same statistics return to the active range.

- [ ] **Step 2: Run the test and confirm the old schema fails**

Run: `node --test tests/flashcards.test.mjs`

Expected: FAIL because version 3 fields and boundary-preserving APIs do not exist.

- [ ] **Step 3: Implement version 3 migration and pure mastery rules**

Define and export:

```js
export const STORAGE_KEY = 'kana-flashcards-v1';
export const createRecord = () => ({
  learned: false, learningLevel: 0, totalReviews: 0,
  knownCount: 0, unsureCount: 0, unknownCount: 0,
  quizCorrect: 0, quizWrong: 0, firstSeenAt: null,
  firstLearnedAt: null, lastReviewedAt: null, lastResult: null,
});
export function calculateLearningLevel(record) { /* count and accuracy thresholds only */ }
export function setCourseUntil(value, store) { /* change boundary, preserve records */ }
export function markSeen(romaji, store, now) { /* firstSeenAt only */ }
export function completeLearningGroup(group, store, now) { /* learned + firstLearnedAt once */ }
export function recordRating(romaji, rating, store, now) { /* counters + lastResult */ }
export function recordQuiz(romaji, correct, store, now) { /* quiz counters */ }
```

Migration copies `shown/known/fuzzy/unknown` into the new counters, derives `lastResult` conservatively, preserves `learnedUntil` as `courseUntil`, and creates a sanitized version 3 object containing no timing keys.

- [ ] **Step 4: Run tests and confirm migration passes**

Run: `node --test tests/flashcards.test.mjs`

Expected: storage and migration tests PASS; later not-yet-updated legacy timing tests may still fail until Task 4.

### Task 2: Add resumable recognition-stage persistence

**Files:**
- Modify: `tests/flashcards.test.mjs`
- Modify: `js/storage.js`

- [ ] **Step 1: Write failing pending-session tests**

Test this sequence:

```js
savePendingLearning({ group: ['a', 'i', 'u'], script: 'mixed', recognitionIndex: 1 }, store);
markSeen('a', store, '2026-08-16T00:00:00.000Z');
assert.equal(loadState(store).courseUntil, 0);
assert.equal(loadPendingLearning(store).recognitionIndex, 1);
completeLearningGroup(KANA.slice(0, 3), store, '2026-08-16T00:05:00.000Z');
assert.equal(loadState(store).courseUntil, 3);
assert.equal(loadState(store).records.a.firstLearnedAt, '2026-08-16T00:05:00.000Z');
completeLearningGroup(KANA.slice(0, 3), store, '2026-08-17T00:00:00.000Z');
assert.equal(loadState(store).records.a.firstLearnedAt, '2026-08-16T00:05:00.000Z');
```

- [ ] **Step 2: Run and confirm the persistence test fails**

Run: `node --test tests/flashcards.test.mjs`

Expected: FAIL because pending learning APIs are missing.

- [ ] **Step 3: Implement pending session helpers**

Add `pendingLearning` to the state root and implement `savePendingLearning`, `loadPendingLearning`, and `clearPendingLearning`. Ensure all helpers sanitize indices and known romaji values, and completing the group advances the course boundary only after the recognition overview becomes available.

- [ ] **Step 4: Run tests**

Run: `node --test tests/flashcards.test.mjs`

Expected: pending-session and first-learned-at tests PASS.

### Task 3: Build deterministic new-learning generators

**Files:**
- Modify: `tests/flashcards.test.mjs`
- Modify: `js/new-learning.js`
- Modify: `js/data.js`

- [ ] **Step 1: Write failing quiz-plan and reinforcement tests**

Cover group sizes 3, 5, and 10:

```js
for (const [size, expected] of [[3, 6], [5, 10], [10, 20]]) {
  const plan = buildQuizPlan(KANA.slice(0, size), KANA.slice(0, size), () => 0.25);
  assert.equal(plan.length, expected);
  assert.ok(KANA.slice(0, size).every(k => plan.some(q => q.correct.romaji === k.romaji)));
  assert.ok(plan.some(q => q.direction === 'kana-to-romaji'));
  assert.ok(plan.some(q => q.direction === 'romaji-to-kana'));
}
```

Test `mixedWeight(record, isNew)` returns 1, 2, 3, or 5 and takes the maximum. Test `buildReinforcementQueue` starts with every new romaji once and has no adjacent duplicate when the pool has at least two entries.

- [ ] **Step 2: Run and confirm failures**

Run: `node --test tests/flashcards.test.mjs`

Expected: FAIL because quiz plan and reinforcement APIs are missing.

- [ ] **Step 3: Implement group-aware question construction**

Export `quizCountForGroup`, `buildQuizPlan`, `makeChoiceQuestion`, `mixedWeight`, and `buildReinforcementQueue`. Determine a kana row by groups of five in the source order; prefer same-group, then same-row learned distractors, then other active learned kana. Use Fisher-Yates shuffling with an injected random function for testability.

- [ ] **Step 4: Run tests**

Run: `node --test tests/flashcards.test.mjs`

Expected: all new-learning generator tests PASS.

### Task 4: Remove timing from generic flashcards and summaries

**Files:**
- Modify: `tests/flashcards.test.mjs`
- Modify: `js/flashcards.js`

- [ ] **Step 1: Replace legacy speed tests with count-only tests**

Assert `rateCard(session, card, 'unknown')` contains no reaction field; intelligent review uses last result and historical error counts; `buildSummary` returns only `counts`, `total`, `knownRate`, `weak`, and `grouped`. Assert serialized session and summary text contains none of `reaction`, `speed`, `average`, `fastest`, `slowest`, or `timed`.

- [ ] **Step 2: Run and confirm failures**

Run: `node --test tests/flashcards.test.mjs`

Expected: FAIL because `speedBand`, reaction fields, and reaction averages still exist.

- [ ] **Step 3: Implement no-time sessions**

Delete `speedBand`; change `rateCard(session, card, rating)` to save only rating data. Make smart weights predictable: known 1, fuzzy 2, unknown 4 for review sessions. Build weak ordering from `unknown * 2 + fuzzy + quizWrong`, with stable romaji tie-breaking and no timing values.

- [ ] **Step 4: Run tests**

Run: `node --test tests/flashcards.test.mjs`

Expected: all domain tests PASS.

### Task 5: Replace homepage markup and responsive styling

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [ ] **Step 1: Replace the settings form with dashboard mounts**

Add stable elements `#dashboard-learned`, `#dashboard-skilled`, `#dashboard-progress`, `#dashboard-next`, `#dashboard-advice`, `.mode-card[data-mode]`, `#mode-title`, `#mode-subtitle`, `#mode-settings`, and `#mode-start`. Remove the old activity radios, sliders, shared settings, homepage reset, reaction paragraph, and timing copy.

Add a native settings dialog/page containing `#manual-progress`, `#save-manual-progress`, and a data-management reset action with the existing confirmation dialog. Keep the existing table and records mounts.

- [ ] **Step 2: Add stage-specific practice and summary mounts**

Add `#stage-label`, `#stage-position`, `#group-trail`, `#practice-content`, `#practice-feedback`, `#audio-note`, `#replay-audio`, and summary action mounts. Buttons must be real `<button>` elements and text inputs must remain the only caret-enabled controls.

- [ ] **Step 3: Implement compact desktop and mobile CSS**

Use a three-column mode-card grid on desktop, a compact settings panel, large touch targets, and one-column layouts below 720px. Apply:

```css
html, body, button, [role="button"] { caret-color: transparent; }
input[type="number"], input[type="text"], textarea { caret-color: auto; }
```

Keep the existing white, warm-white, and deep-green palette.

- [ ] **Step 4: Run static source checks**

Run: `rg -ni "reaction|response.?time|反应时间|答题耗时|平均反应|速度评级|1.?2 秒" index.html styles.css js tests`

Expected: no product-code matches.

### Task 6: Implement dashboard and dynamic mode settings

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Render dashboard from version 3 state**

Implement `renderDashboard()` using active course boundary records. Compute learned from the boundary and learned flags, skilled from `learningLevel === 4`, display the next group at the chosen 3/5/10 size, and choose one simple recommendation: weak-review advice if active records contain fuzzy/unknown results, otherwise next-group advice.

- [ ] **Step 2: Render isolated mode configuration**

Implement `renderModeSettings(mode)` with separate templates:

- New: group size, script, next group, resume/start button.
- Review: scope, script, 10/20/30/50, smart/uniform.
- Test: script, numeric start/end, prefix shortcuts, 10/20/30/50/100/infinite, smart/uniform.

Mode-card clicks update only the active mode and rerender the panel. Numeric range inputs clamp to 1–46 and keep start no greater than end.

- [ ] **Step 3: Wire settings and reset**

Saving manual progress calls `setCourseUntil` and rerenders without altering records. Reset remains inside settings, opens the confirmation dialog, then clears state only after confirmation.

- [ ] **Step 4: Verify mode rendering manually**

Start with `启动学习器.bat`, open `http://127.0.0.1:8765`, click each mode card, and confirm only that mode's settings and one primary button are visible.

### Task 7: Implement the complete new-learning state machine

**Files:**
- Modify: `js/app.js`
- Modify: `js/audio.js`

- [ ] **Step 1: Implement recognition and resume**

On start, restore a matching pending recognition session or create one from `nextLearningGroup`. Each “下一个” calls `markSeen` and saves the next recognition index. Render paired kana according to script selection, group trail, collapsed memory hint, automatic audio attempt, and replay button.

- [ ] **Step 2: Complete the group only at recognition boundary**

After the last recognition card, call `completeLearningGroup`, clear the pending session, and render the overview. “再看一遍” restarts recognition display without overwriting `firstSeenAt` or `firstLearnedAt`; “开始小测” loads the deterministic quiz plan.

- [ ] **Step 3: Implement quiz, recall, and reinforcement**

Quiz answers call `recordQuiz`. Correct answers advance after feedback; wrong answers show the correct mapping and selected distractor mapping and require explicit continuation. Recall cards reveal before showing the three ratings and call `recordRating`. Reinforcement uses `buildReinforcementQueue`, covers every new item, and records the same three ratings.

- [ ] **Step 4: Implement new-group summary actions**

Render group, quiz score, weak items, and buttons for another round, next group, and home. Hide next group when the boundary is 46.

- [ ] **Step 5: Add resilient audio behavior**

Use one reusable audio object. `playJapaneseKana` resolves `{ ok: true }` or `{ ok: false, reason }` instead of throwing. An autoplay failure shows `#audio-note` briefly, never opens an alert, and never prevents save or navigation. Manual replay calls the same function.

### Task 8: Implement review, test, records, and table views

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Build active review pools**

Resolve all learned, recent group, weak-only, or custom active-range pools from `courseUntil`. If empty, render an inline message and a route back to new learning; do not use an alert.

- [ ] **Step 2: Run review and quick-test flashcards**

Both flows show kana first, reveal answer, autoplay, then ratings. Review uses smart/uniform configuration; test uses selected numeric range even when it includes manually known external-learning entries. Infinite test exposes an “结束测试” action.

- [ ] **Step 3: Render count-only summaries**

Review summary shows total and rating counts plus weak items and “再练薄弱项”. Test summary additionally shows known rate. Neither page displays or stores time data.

- [ ] **Step 4: Update table and records**

Render course status, learning level, total reviews, known rate, fuzzy/unknown counts, and quiz correct/wrong. Do not derive “learned” from whether a record object happens to exist.

### Task 9: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `tests/flashcards.test.mjs` only if a newly discovered regression needs coverage

- [ ] **Step 1: Run the automated suite**

Run: `node --test tests/flashcards.test.mjs`

Expected: all tests PASS, zero failures.

- [ ] **Step 2: Run source and syntax checks**

Run: `node --check js/app.js` and repeat for each JS module.

Run: `rg -ni "reaction|response.?time|totalReaction|speedBand|averageReaction|fastestTime|slowestTime|timedScore|反应时间|答题耗时|平均反应|速度评级" index.html styles.css js tests README.md`

Expected: no matches outside migration test fixture names that explicitly verify removal; implementation contains no timing field or UI.

- [ ] **Step 3: Browser-test all three modes**

Use the local server and verify new learning recognition → overview → 10-question quiz → recall → reinforcement → summary; review; quick test; rating persistence; wrong-answer continuation; and no caret on buttons.

- [ ] **Step 4: Verify persistence and migration**

Interrupt recognition, refresh, and resume at the stored index without advancing the course boundary. Complete recognition and confirm the boundary advances. Lower then raise manual progress and confirm hidden historical statistics return. Inject a version 2 fixture, reload, and confirm its ratings survive while time data disappears.

- [ ] **Step 5: Verify audio fallback and mobile layout**

Verify normal autoplay/replay. Simulate rejected `audio.play()` and confirm the inline notice appears while navigation and storage continue. Test at desktop width and around 390 × 844; confirm the dashboard order, large buttons, mode isolation, and no horizontal overflow.

- [ ] **Step 6: Update README and rerun verification**

Document the three modes, local persistence/migration behavior, audio fallback, and unchanged double-click start. Rerun all automated and static checks after documentation changes.

## Execution note

This directory is not a Git repository, so the commit steps normally required by the planning workflow cannot be performed. Changes will be kept in the existing workspace and verified directly. The user explicitly requested continuous work in the current task, so execution proceeds inline after this plan without an additional choice gate.
