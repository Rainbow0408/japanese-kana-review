# 日语五十音闪卡学习网页版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a double-click runnable desktop-first flashcard trainer for rapid kana-to-romaji recognition.

**Architecture:** Native ES modules separate kana data, pure practice/session logic, browser persistence, and DOM rendering. `index.html` loads the app directly; no package install, server, or external API is required.

**Tech Stack:** HTML5, CSS3, JavaScript ES modules, browser localStorage, optional SpeechSynthesis, Node built-in test runner.

---

## Planned files

- `index.html`: application shell and four views.
- `styles.css`: desktop-first visual system and responsive safety net.
- `js/data.js`: 46-item canonical kana list and confusing-pair list.
- `js/storage.js`: defaults, validation and long-term localStorage record operations.
- `js/flashcards.js`: pure session generator, scoring, speed labels and summaries.
- `js/app.js`: view state, DOM rendering, keyboard and audio behavior.
- `tests/flashcards.test.mjs`: logic and data regression tests.
- `README.md`: zero-install opening and feature guide.

### Task 1: Write and validate canonical learning data

**Files:**
- Create: `js/data.js`
- Test: `tests/flashcards.test.mjs`

- [ ] Add tests asserting 46 ordered records; indices 1 and 46 are `a` and `n`; index 15 is `so`; each entry has distinct hiragana and katakana.
- [ ] Run `node --test tests/flashcards.test.mjs` and confirm the test fails before the data module exists.
- [ ] Implement the exported `KANA` array and `CONFUSING_PAIRS` constant using the exact supplied 46 sounds.
- [ ] Re-run the test and confirm it passes.

### Task 2: Implement pure flashcard/session behavior

**Files:**
- Create: `js/flashcards.js`
- Modify: `tests/flashcards.test.mjs`

- [ ] Add failing tests for range selection, mixed-script display selection, weighted weak-item selection with a three-card cooldown, speed bands and final-summary counts.
- [ ] Run the focused Node test command and confirm failures identify missing exports.
- [ ] Implement `buildPool`, `chooseDisplay`, `createSession`, `nextCard`, `rateCard`, `speedBand`, `buildSummary`, and `findConfusions`. Normal mode uses weights 1/2/4, random mode uses equal weights, and completed records include reaction seconds.
- [ ] Re-run all logic tests and confirm they pass.

### Task 3: Implement durable learning-record storage

**Files:**
- Create: `js/storage.js`
- Modify: `tests/flashcards.test.mjs`

- [ ] Add failing tests using a memory storage adapter for defaults, a ratings update, corrupt-data fallback, reset and proficiency classification.
- [ ] Run the test and confirm the storage exports are absent.
- [ ] Implement versioned `loadState`, `saveSettings`, `applyRound`, `resetState`, `getKanaRecord`, and `proficiencyFor` with a replaceable storage adapter.
- [ ] Re-run all tests and confirm they pass.

### Task 4: Build the static app shell and desktop visual system

**Files:**
- Create: `index.html`
- Create: `styles.css`

- [ ] Create semantic nav and four named views: settings, flashcards, kana table and records; include all required controls, dialog confirmation, templates and an `app.js` module entry.
- [ ] Style calm, readable desktop layouts with a central large-card learning view, high-contrast large action buttons, low-saturation proficiency colors and compact shortcut hint.
- [ ] Open the document directly in a browser and confirm it renders without missing resources or overflowing main controls.

### Task 5: Connect learning settings and flashcard interactions

**Files:**
- Create: `js/app.js`
- Modify: `index.html`

- [ ] Render/synchronize slider, number input and quick-range controls; support the three scripts, six count modes and two selection modes.
- [ ] Start a session, render progress/card/reveal state, record reaction time at reveal, rate cards, advance or show the summary at finite completion.
- [ ] Bind Space, 1, 2, 3 and ArrowRight only while the flashcard view is active and no text field owns focus.
- [ ] Add optional `SpeechSynthesis` pronunciation with graceful disabled state.
- [ ] Manually run a 10-card session and validate range, script selection, progress and keyboard behavior.

### Task 6: Implement reports, revision mode and persistence views

**Files:**
- Modify: `js/app.js`
- Modify: `styles.css`

- [ ] Render summary counts, average timing, up to ten weak items and only data-backed confusion alerts.
- [ ] Add “only practice mistakes”, restart and settings return; special sessions are populated only from fuzzy/unknown tones.
- [ ] Render 46-cell kana table with detail panel and long-term statistics view; apply proficiency colors using stored records.
- [ ] Persist each finished/ongoing rated card immediately; add reset confirmation dialog that clears state and refreshes all views.
- [ ] Refresh the page after a rated card and confirm displayed long-term data is retained.

### Task 7: Verify and document delivery

**Files:**
- Create: `README.md`
- Modify: `tests/flashcards.test.mjs`

- [ ] Add regression tests for full range 1–15, 46 total tones, finite completion, correction weights and no immediate duplicate where alternatives exist.
- [ ] Run `node --test tests/flashcards.test.mjs` and resolve every failure.
- [ ] Use a browser to test direct opening, a mixed 10-card run, error-only practice, summary, reset confirmation and table details.
- [ ] Write `README.md` with opening instructions, file map, feature list and browser support note.
- [ ] Record verification results in the final handoff; no Git commit is possible because the supplied directory is not a Git repository.
