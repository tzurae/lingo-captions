# Sentence Transcript and Selection Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a one-sentence-per-row transcript with replayable timestamps, recovered diagnostics that collapse, and a compact selection popover.

**Architecture:** The content layer converts rolling DOM snapshots into stable sentence cues and handles video seeking. The side panel renders cue rows, sends replay commands to the active tab, and anchors a compact progressive-disclosure menu to the browser selection rectangle.

**Tech Stack:** TypeScript, React 18, Chrome Extensions Manifest V3 APIs, Vitest, Testing Library, Vite.

## Global Constraints

- Use TDD: each production behavior must be preceded by a failing test that fails for the expected reason.
- Preserve progressive rolling-caption deduplication and active-tab isolation.
- Split at `.`, `!`, `?`, and bracketed sound markers; force a word-boundary split at 12 seconds or 120 characters.
- Replay starts 500 ms before the cue timestamp, clamps at zero, and immediately plays.
- Selecting text never triggers replay.
- Popover first-level actions are exactly `翻譯整句`, `解釋選取文字`, `文法分析`, and `更多`.
- Do not add dependencies.
- This workspace is not a Git repository, so skip commit commands and record test evidence in the task report.

---

### Task 1: Convert rolling captions into sentence cues

**Files:**
- Create: `src/content/caption-sentences.ts`
- Create: `src/content/caption-sentences.test.ts`
- Modify: `src/content/visible-caption-fallback.ts`
- Modify: `src/content/visible-caption-fallback.test.ts`

**Interfaces:**
- Produces: `splitCaptionText(text: string, maxCharacters?: number): Array<{ text: string; complete: boolean }>`.
- Preserves: `createVisibleCaptionFallback(options): VisibleCaptionFallback`.

- [ ] **Step 1: Write failing pure segmentation tests**

Add literal expectations for `We've got oats. Sliced banana! Really?`, `[music]`, an unfinished tail, and a 121-character unpunctuated phrase. Tests must show that complete sentences and forced chunks are separate while the unfinished tail stays a single segment.

- [ ] **Step 2: Run the segmentation test and verify RED**

Run the new test file with Vitest. Expected: FAIL because `caption-sentences.ts` or `splitCaptionText` does not exist.

- [ ] **Step 3: Implement the minimal sentence splitter**

Normalize whitespace, emit bracketed markers as complete segments, include closing quotes after terminal punctuation, and split an overlong remainder at the final whitespace at or before 120 characters. Never drop text.

- [ ] **Step 4: Run the segmentation test and verify GREEN**

Run the new test file. Expected: all segmentation tests pass.

- [ ] **Step 5: Write failing fallback behavior tests**

Extend the fallback tests so progressive snapshots result in one cue per completed sentence, the active unfinished sentence updates in place, left-shifted captions do not repeat words, and an unpunctuated live cue starts a new cue after 12,000 ms.

- [ ] **Step 6: Run fallback tests and verify RED**

Run `visible-caption-fallback.test.ts`. Expected: the sentence-count and time-boundary expectations fail because the current implementation appends everything to one cue.

- [ ] **Step 7: Reconcile segmented text with stable cue timestamps**

Keep a merged transcript string, re-segment it after each new snapshot, preserve an existing cue's `startMs`, assign new cue IDs monotonically, close a prior cue when its successor appears, and create a forced boundary when the active cue reaches 12,000 ms. Continue debounced emissions at 350 ms.

- [ ] **Step 8: Run Task 1 tests and the full suite**

Run both caption sentence test files, then all Vitest tests. Expected: all pass with no unhandled errors.

### Task 2: Add cue replay and compact selection popover

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/content/content-script.ts`
- Modify: `src/content/content-script.test.ts`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.test.tsx`
- Modify: `src/sidepanel/components/SelectionMenu.tsx`
- Modify: `src/sidepanel/components/SelectionMenu.test.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Produces: `SidePanelContentMessage = { type: 'REQUEST_STATE' } | { type: 'SEEK_TO_TIME'; timeMs: number }`.
- Extends: `TranscriptSelection` with `anchor: { x: number; y: number }`.
- Extends: `TranscriptPanel` props with `onReplay(cue: CaptionCue): void`.
- Extends: `SelectionMenu` props with `anchor: { x: number; y: number }`.

- [ ] **Step 1: Write failing transcript interaction tests**

Assert that a normal cue click calls `onReplay` with the cue, Enter does the same, and a mouseup/click containing a non-empty browser selection reports text plus the selection rectangle without replaying.

- [ ] **Step 2: Run TranscriptPanel tests and verify RED**

Expected: FAIL because replay and anchor coordinates are not part of the current interface.

- [ ] **Step 3: Implement transcript replay and selection geometry**

Use `Range.getBoundingClientRect()` and pass `{ x: rect.left + rect.width / 2, y: rect.bottom }`. Ignore pointer replay while selection text is non-empty. Preserve current-cue highlighting and auto-follow behavior.

- [ ] **Step 4: Write failing content/App replay tests**

Assert that App sends `{ type: 'SEEK_TO_TIME', timeMs: 500 }` to the active tab for a cue starting at 1,000 ms, and that the content script receiving the command sets `video.currentTime` to `0.5` and calls `video.play()`. Add a clamp-to-zero case.

- [ ] **Step 5: Run replay tests and verify RED**

Expected: FAIL because the message type and runtime handler do not exist.

- [ ] **Step 6: Implement active-tab replay**

Store the active tab ID in an App ref, query it only when the ref is empty, subtract 500 ms in App, and send the command. In the content script validate the command, seek the current video, call `play()`, and send an immediate playback update.

- [ ] **Step 7: Write failing compact-menu tests**

Assert fixed-position anchor styles, only the three primary learning actions plus `更多` at first, disclosure of the remaining intents after `更多`, no full selected-text paragraph, and close behavior for Escape, outside click, and intent choice.

- [ ] **Step 8: Run SelectionMenu and App tests and verify RED**

Expected: FAIL because the current component renders every action in document flow.

- [ ] **Step 9: Implement the compact popover**

Render the menu with `role="dialog"`, fixed positioning, a small wrapped action row, a `更多` disclosure, and an accessible close button. Close the selection before beginning an LLM request while retaining local request/context values.

- [ ] **Step 10: Run Task 2 tests and the full suite**

Run the four touched test files, then all Vitest tests. Expected: all pass.

### Task 3: Collapse recovered caption diagnostics

**Files:**
- Modify: `src/sidepanel/components/CaptionDiagnostics.tsx`
- Modify: `src/sidepanel/components/CaptionDiagnostics.test.tsx`

**Interfaces:**
- Preserves: `CaptionDiagnostics({ entries }: { entries: CaptionDiagnostic[] })`.

- [ ] **Step 1: Write a failing recovery test**

Render `error`, `fallback`, then `success` entries and assert the `details` element is closed. Rerender with a newest `error` and assert it opens.

- [ ] **Step 2: Run the diagnostics test and verify RED**

Expected: FAIL because any historical error/fallback currently forces `open`.

- [ ] **Step 3: Base automatic state on the newest diagnostic**

Open only when `entries.at(-1)?.status` is `error` or `fallback`; close for `success` while leaving the summary available for manual inspection.

- [ ] **Step 4: Run diagnostics tests and the full suite**

Run `CaptionDiagnostics.test.tsx`, then all Vitest tests. Expected: all pass.

### Task 4: Verify and build the extension

**Files:**
- Regenerate: `dist/**`

**Interfaces:**
- Produces: a loadable unpacked Chrome extension in `dist`.

- [ ] **Step 1: Run complete verification**

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` with the bundled Node runtime. Expected: zero test failures, zero TypeScript errors, and Vite exit code 0.

- [ ] **Step 2: Inspect build contents**

Confirm `dist/manifest.json`, the side-panel HTML/assets, the content-script bundle, and service-worker bundle are non-empty.

- [ ] **Step 3: Review requirement coverage**

Check the design requirements against the emitted UI behavior and test names: one sentence per row, 12-second/120-character bounds, 500-ms replay, selection-safe click handling, compact four-item first level, and recovered diagnostics closed.
