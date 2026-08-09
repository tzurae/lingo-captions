# Rolling Captions and Tab Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge YouTube rolling caption snapshots into stable selectable cues and isolate the side panel to the active browser tab and active video.

**Architecture:** The visible-caption collector owns word-overlap merging and debounced cue emission. The side panel owns active-tab binding and accepts cross-video navigation only from that active tab.

**Tech Stack:** TypeScript, React, Chrome Manifest V3, Vitest, Testing Library, JSDOM

## Global Constraints

- Debounce visible-caption emission for 350 ms.
- Start a new passage only after a no-overlap gap of at least 1,500 ms.
- Never mix messages from different Chrome tabs.
- Preserve full timedtext transcript behavior and OpenAI query behavior.
- Use strict red-green-refactor TDD.

---

### Task 1: Rolling caption merger

**Files:**
- Modify: `src/content/visible-caption-fallback.ts`
- Modify: `src/content/visible-caption-fallback.test.ts`

**Interfaces:**
- Preserve `createVisibleCaptionFallback({ document, getCurrentTimeMs, onCuesChanged })`.
- Replace the current active cue in place when snapshots overlap.

- [ ] Add failing tests for prefix growth, left-shift overlap, debounce, and passage gaps.
- [ ] Run the focused test and confirm duplicate cues or immediate emissions fail expectations.
- [ ] Implement word-level overlap merging and 350 ms debounced emission.
- [ ] Run the focused test until green.

### Task 2: Latest overlapping cue selection

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.tsx`

**Interfaces:**
- Playback updates select the last cue whose interval contains `currentTimeMs`.

- [ ] Add a failing App test with two overlapping cues.
- [ ] Confirm the earlier cue is selected by current code.
- [ ] Reverse the matching order or use `findLast`-equivalent logic.
- [ ] Run App tests until green.

### Task 3: Active-tab and same-tab video binding

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.tsx`

**Interfaces:**
- Consume `chrome.tabs.onActivated.addListener` and `.removeListener`.
- Request `{ type: 'REQUEST_STATE' }` from every newly active tab.

- [ ] Add failing tests for A-to-B tab activation, stale A messages, and same-tab video navigation.
- [ ] Confirm current App remains bound to tab A or rejects the new video.
- [ ] Add activation lifecycle, state reset, and authoritative same-tab `VIDEO_CHANGED` handling.
- [ ] Run App tests until green.

### Task 4: Verification

**Files:**
- Modify only files required by failures discovered during verification.

- [ ] Run all Vitest tests.
- [ ] Run `tsc --noEmit`.
- [ ] Build production `dist`.
- [ ] Confirm the generated content and panel bundles include the rolling merge and active-tab listener.
