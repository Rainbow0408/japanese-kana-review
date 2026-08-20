# Spacebar Known Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Space reveal a flashcard answer on the first press and record “认识” on the second press without affecting quizzes, dialogs, or editable controls.

**Architecture:** Add one pure keyboard-decision helper so the state rules can be tested without a browser DOM. The existing `app.js` keyboard listener will translate current visible UI state into that helper, then click the same reveal or rating buttons used by mouse interaction.

**Tech Stack:** Browser ES modules, native DOM events, Node.js built-in test runner.

---

## File map

- Create `js/keyboard.js`: pure decision function for the Space shortcut.
- Modify `js/app.js`: use the helper in the existing `keydown` listener.
- Modify `index.html`: add the visible keyboard hint below the flashcard panel.
- Modify `styles.css`: low-emphasis hint styling.
- Modify `README.md`: document two-stage Space behavior.
- Modify `tests/flashcards.test.mjs`: unit and static regression coverage.

### Task 1: Test and implement the state-aware Space action

**Files:**
- Create: `js/keyboard.js`
- Modify: `tests/flashcards.test.mjs`
- Modify: `js/app.js`

- [ ] **Step 1: Write failing decision tests**

Import `resolveFlashcardSpaceAction` and assert the complete state table:

```js
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, revealAvailable: true }), 'reveal');
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, knownAvailable: true }), 'known');
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, repeat: true, knownAvailable: true }), null);
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, editable: true, revealAvailable: true }), null);
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true, dialogOpen: true, knownAvailable: true }), null);
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: true }), null);
assert.equal(resolveFlashcardSpaceAction({ flashcardsActive: false, revealAvailable: true }), null);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/flashcards.test.mjs`

Expected: FAIL because `js/keyboard.js` and its decision function do not exist.

- [ ] **Step 3: Implement the pure helper**

Create:

```js
export function resolveFlashcardSpaceAction({
  repeat = false,
  flashcardsActive = false,
  editable = false,
  dialogOpen = false,
  revealAvailable = false,
  knownAvailable = false,
} = {}) {
  if (repeat || !flashcardsActive || editable || dialogOpen) return null;
  if (revealAvailable) return 'reveal';
  if (knownAvailable) return 'known';
  return null;
}
```

- [ ] **Step 4: Wire the helper into `app.js`**

Import the helper. In `keydown`, ignore editable controls and open dialogs, query the current reveal button and the `known` rating button, and pass booleans into the helper. For `reveal` or `known`, call `event.preventDefault()` and click that existing button. Keep numeric shortcuts unchanged, but ignore repeated key events.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/flashcards.test.mjs`

Expected: all tests PASS.

### Task 2: Add guidance and verify all flashcard modes

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `README.md`
- Modify: `tests/flashcards.test.mjs`

- [ ] **Step 1: Write a failing static UI test**

Read `index.html` and assert it contains `空格：显示答案 / 认识`, then read `README.md` and assert the Space shortcut describes both actions.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/flashcards.test.mjs`

Expected: FAIL because the new two-stage hint is absent.

- [ ] **Step 3: Add the hint and documentation**

Add below the card panel:

```html
<p class="keyboard-hint">空格：显示答案 / 认识　1：认识　2：模糊　3：不认识</p>
```

Style `.keyboard-hint` as centered, muted, and small. Update the README Space entry to `显示答案；答案显示后再次按下会选择“认识”并进入下一张。`

- [ ] **Step 4: Run automated and syntax verification**

Run: `node --check js/keyboard.js`, `node --check js/app.js`, and `node --test tests/flashcards.test.mjs`.

Expected: syntax checks exit 0 and all tests PASS.

- [ ] **Step 5: Browser-test the two-stage shortcut**

In a finite quick test, press Space and verify the answer appears; press Space again and verify the counter advances exactly one card. Hold/repeat Space and verify it does not skip cards. Repeat the two presses in review, new-learning recall, and mixed reinforcement. Verify Space has no effect on a choice question or while Settings is open.

## Execution note

This workspace is not a Git repository, so commit steps do not apply. The user explicitly approved the recommended implementation and requested the modification, so execution proceeds inline in the current task.
