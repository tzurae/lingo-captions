# Caption Diagnostics and Visible-DOM Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show actionable caption-pipeline errors in the side panel and capture captions directly from YouTube's visible caption DOM when timedtext extraction fails.

**Architecture:** Add a structured diagnostic message contract, a focused visible-caption collector, and a diagnostic side-panel component. The content script keeps timedtext as primary and activates the DOM observer only on primary failure.

**Tech Stack:** TypeScript, React, Chrome Manifest V3, Vitest, Testing Library, JSDOM

## Global Constraints

- Never include API keys or full timedtext URLs in diagnostics.
- Keep OpenAI queries user-triggered only.
- Use strict red-green-refactor TDD.
- Preserve existing history and transcript behavior.

---

### Task 1: Diagnostic message contract

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/content-message.typecheck.ts`
- Test: `src/content/content-script.test.ts`

**Interfaces:**
- Produces: `CaptionDiagnosticStage`, `CaptionDiagnosticStatus`, and `CAPTION_DIAGNOSTIC` within `ContentMessage`.

- [ ] Write a failing test expecting player-response and track-discovery diagnostics.
- [ ] Run the focused test and confirm the missing diagnostic failure.
- [ ] Add the minimal structured message types and emitters.
- [ ] Run the focused test until green.

### Task 2: Visible caption collector

**Files:**
- Create: `src/content/visible-caption-fallback.ts`
- Create: `src/content/visible-caption-fallback.test.ts`

**Interfaces:**
- Produces: `createVisibleCaptionFallback({ document, getCurrentTimeMs, onCuesChanged })` returning `{ start(): void; stop(): void; captureNow(): boolean }`.

- [ ] Write failing tests for immediate capture, whitespace normalization, consecutive deduplication, and mutation capture.
- [ ] Run the focused tests and confirm the module/behavior is missing.
- [ ] Implement the minimal observer and cue accumulator.
- [ ] Run the focused tests until green.

### Task 3: Activate fallback after primary failure

**Files:**
- Modify: `src/content/content-script.ts`
- Modify: `src/content/content-script.test.ts`

**Interfaces:**
- Consumes: `createVisibleCaptionFallback` and the diagnostic contract.
- Produces: existing `CAPTIONS_UPDATED` messages with `language: 'en-visible'` and accumulated cues.

- [ ] Write a failing integration test where timedtext fails but `.ytp-caption-segment` is visible.
- [ ] Run it and confirm only `NO_CAPTIONS` is emitted.
- [ ] Start the fallback, capture immediately, emit diagnostics, and stop it on navigation/full-track success.
- [ ] Run content tests until green.

### Task 4: Side-panel diagnostic UI

**Files:**
- Create: `src/sidepanel/components/CaptionDiagnostics.tsx`
- Create: `src/sidepanel/components/CaptionDiagnostics.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `CAPTION_DIAGNOSTIC` messages.
- Produces: auto-expanding diagnostics with safe copyable text.

- [ ] Write failing component and App tests for automatic error expansion, safe details, refresh clearing, and connection errors.
- [ ] Run focused tests and confirm missing UI behavior.
- [ ] Implement the component and App state/error mapping.
- [ ] Run focused tests until green.

### Task 5: Verification and build

**Files:**
- Modify only files required by failures discovered during verification.

- [ ] Run the complete Vitest suite.
- [ ] Run `tsc --noEmit`.
- [ ] Build production `dist` with the bundled Node fallback.
- [ ] Confirm manifest references the newly built content and page-bridge bundles.
