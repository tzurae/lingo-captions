# Transcript Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the currently spoken subtitle centered in a five-cue focus window while preserving full-transcript selection and replay behavior.

**Architecture:** `TranscriptPanel` will keep one ordered transcript, derive a five-entry view carrying original transcript indexes, and render focus mode in past/current/future layout regions. Existing `autoFollowPlayback` selects focus mode; disabling it retains the complete transcript. CSS owns visual emphasis and centering; no storage or message contracts change.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, CSS, Chrome MV3.

## Global Constraints

- Focus mode shows at most two preceding cues, the active cue, and two following cues.
- Past opacity is `0.4`, current opacity is `1`, and future opacity is `0.65`.
- A caption gap keeps the last focus anchor but removes `aria-current` until a cue is active again.
- Before the first playback position, show the first five cues with no active cue.
- Selection reports the cue's index in the complete ordered transcript, never its sliced-window index.
- Replay sends the selected cue's exact existing `startMs`.
- Disabling `autoFollowPlayback` renders the complete transcript.
- Do not add settings, dependencies, karaoke highlighting, cue merging, or caption acquisition changes.
- This workspace is not a Git repository, so commit steps are intentionally omitted.

---

### Task 1: Derive and render a stable five-cue focus window

**Files:**
- Modify: `src/sidepanel/components/TranscriptPanel.test.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.tsx`

**Interfaces:**
- Consumes: `CaptionCue[]`, `currentCueId: string | null`, and `autoFollowPlayback: boolean` from existing props.
- Produces: visible cue rows with `data-cue-index` equal to the full ordered transcript index and `data-cue-state` equal to `past`, `current`, or `future`.

- [ ] **Step 1: Add failing focus-window tests**

Add a seven-cue literal fixture and tests that verify:

```tsx
const focusCues = [
  { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Cue one' },
  { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Cue two' },
  { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Cue three' },
  { id: 'cue-4', startMs: 3_000, endMs: 4_000, text: 'Cue four' },
  { id: 'cue-5', startMs: 4_000, endMs: 5_000, text: 'Cue five' },
  { id: 'cue-6', startMs: 5_000, endMs: 6_000, text: 'Cue six' },
  { id: 'cue-7', startMs: 6_000, endMs: 7_000, text: 'Cue seven' },
];
```

For `currentCueId="cue-4"` and focus mode, assert cues 2 through 6 are present, cues 1 and 7 are absent, cue 2 is `past`, cue 4 is `current` plus `aria-current="true"`, and cue 6 is `future`. Add separate assertions for cue 1 and cue 7 boundaries, a null current cue retaining the cue-4 window after rerender, and full mode rendering all seven cues.

- [ ] **Step 2: Add a failing original-index selection test**

Select `Cue two` while cue 4 anchors focus mode and assert:

```tsx
expect(onSelection).toHaveBeenCalledWith({
  selectedText: 'Cue two',
  cueIndex: 1,
  sentence: 'Cue two',
  anchor: { x: 60, y: 110 },
});
```

The test catches the bug where a sliced-window index (`0`) is sent to `buildQueryContext` instead of the full-transcript index (`1`).

- [ ] **Step 3: Run the component tests and verify RED**

Run `src/sidepanel/components/TranscriptPanel.test.tsx` with Vitest. Expected failures: focus mode still renders all cues, no `data-cue-state` exists, and sliced selection behavior does not exist.

- [ ] **Step 4: Implement the minimal focus derivation**

In `TranscriptPanel.tsx`, memoize the ordered cues and derive entries shaped as:

```ts
type CueEntry = {
  cue: CaptionCue;
  originalIndex: number;
  state: 'past' | 'current' | 'future';
};
```

Track the last valid non-null cue ID in a ref. Use the active cue index when available, otherwise the remembered cue index, otherwise `-1`. In focus mode:

- anchor `-1`: return the first five cues as `future`;
- valid anchor: slice from `Math.max(0, anchorIndex - 2)` through `Math.min(length, anchorIndex + 3)`;
- assign `past` below the anchor, `current` at the anchor, and `future` above the anchor.

Keep `aria-current` controlled only by `cue.id === currentCueId`, so gaps retain the centered row but no active highlight. Render the focus entries in top, center, and bottom regions. Keep `data-cue-index={originalIndex}` so selection and replay resolve against the complete ordered list.

- [ ] **Step 5: Run component tests and verify GREEN**

Run the same component test file. Expected: all focus, gap, boundary, full-mode, selection, and replay tests pass.

---

### Task 2: Add focus hierarchy and centered layout styles

**Files:**
- Modify: `src/sidepanel/styles.test.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `.transcript-focus-window`, `.focus-past`, `.focus-current`, `.focus-future`, and `[data-cue-state]` emitted by Task 1.
- Produces: a centered three-region layout and exact cue opacities.

- [ ] **Step 1: Add failing computed-style tests**

Load the real stylesheet as the existing test does. Create a focus window with past/current/future rows and assert:

```ts
expect(getComputedStyle(pastCue).opacity).toBe('0.4');
expect(getComputedStyle(currentCue).opacity).toBe('1');
expect(getComputedStyle(futureCue).opacity).toBe('0.65');
expect(getComputedStyle(focusWindow).display).toBe('grid');
```

Also assert the current region is the middle grid region. Verify the `prefers-reduced-motion` transition override during final stylesheet review because jsdom does not evaluate that media query reliably.

- [ ] **Step 2: Run the style test and verify RED**

Run `src/sidepanel/styles.test.ts`. Expected: opacity and focus-layout assertions fail because the selectors do not exist.

- [ ] **Step 3: Implement the minimal stylesheet**

Add rules equivalent to:

```css
.transcript-focus-window {
  min-height: calc(100vh - 116px);
  grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
  overflow: hidden;
}
.focus-past { align-self: end; }
.focus-future { align-self: start; }
.focus-region { display: grid; gap: 10px; }
.caption-cue[data-cue-state='past'] { opacity: 0.4; }
.caption-cue[data-cue-state='current'] { opacity: 1; }
.caption-cue[data-cue-state='future'] { opacity: 0.65; }
.caption-cue { transition: background-color 140ms ease, border-color 140ms ease, opacity 140ms ease; }
@media (prefers-reduced-motion: reduce) {
  .caption-cue { transition: none; }
}
```

Preserve existing row border, hover, configured color, and active background rules.

- [ ] **Step 4: Run component and style tests and verify GREEN**

Run both changed test files. Expected: all tests pass.

---

### Task 3: Integration verification and production build

**Files:**
- Verify: `src/sidepanel/App.test.tsx`
- Verify: all `src/content/*.test.ts`
- Build output: `dist/`

**Interfaces:**
- Consumes: unchanged `TranscriptPanel` props and unchanged caption message contracts.
- Produces: a rebuilt unpacked extension in `dist/`.

- [ ] **Step 1: Run all subtitle and side-panel tests**

Run the five content test files, `TranscriptPanel.test.tsx`, `styles.test.ts`, and `App.test.tsx`. Expected: all pass with no warnings attributable to the change.

- [ ] **Step 2: Run the complete test suite and typecheck**

Run all Vitest tests and `tsc --noEmit`. Expected: zero failures and zero TypeScript errors.

- [ ] **Step 3: Build and smoke-test production output**

Run the production Vite build, then `tests/production-dependency-bundle.test.ts`. Expected: populated `dist/`, the side-panel bundle mounts, and the smoke test passes.

- [ ] **Step 4: Perform a read-only final review**

Review the changed component, stylesheet, and tests against the approved design. Reject any implementation that shows more than five focus cues, loses original indexes, highlights a cue during a gap, or changes caption acquisition behavior.
