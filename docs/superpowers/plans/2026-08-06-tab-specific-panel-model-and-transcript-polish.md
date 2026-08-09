# Tab-specific Panel, Model Controls, and Transcript Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver exact transcript replay, polished transcript rows, viewport-safe selection answers, tab-specific side-panel state, and global GPT-5.6 model/reasoning controls.

**Architecture:** Keep caption extraction and query workflows intact. Add small pure helpers for assistant positioning and tab ownership, route tab-specific panel setup through the service worker, and extend the existing global settings/OpenAI client boundaries with validated model and effort values.

**Tech Stack:** TypeScript, React 18, Ant Design 5.27.6, Chrome Extensions Manifest V3 Side Panel API, OpenAI Responses API, Vitest, Testing Library, Vite.

## Global Constraints

- Use Ant Design only; do not add Bootstrap, shadcn, or another UI framework.
- Default model is exactly `gpt-5.6-luna`; model options are exactly `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`.
- Default reasoning effort is exactly `low`; effort options are exactly `none`, `low`, `medium`, `high`, `xhigh`, and `max`.
- Responses API requests use `reasoning: { effort: settings.reasoningEffort }` and preserve `store: false`, instructions, and input behavior.
- Cue replay seeks to exactly `Math.max(0, cue.startMs)` with no pre-roll.
- Floating assistant uses a 16 px viewport inset and an 8 px anchor gap.
- Raw API keys stay in the background worker; global settings remain in `chrome.storage.local`.
- Preserve caption extraction, prompts, history auto-save, favorites, and IndexedDB behavior.
- This workspace has no Git metadata; skip commit commands and record RED/GREEN evidence in reports.

---

### Task 1: Exact replay and transcript-row interaction

**Files:**
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.test.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: existing `CaptionCue` and `SEEK_TO_TIME` message.
- Produces: exact cue-start seek messages and CSS classes `transcript-list` and `caption-cue`.

- [ ] **Step 1: Change the replay regression expectation before production code**

In `App.test.tsx`, replace the old 500 ms pre-roll expectation for a cue beginning at 1000 ms with:

```ts
expect(sendMessage).toHaveBeenCalledWith(42, { type: 'SEEK_TO_TIME', timeMs: 1_000 });
```

Rename the test to state that clicking a row seeks to the exact cue start. Keep a separate zero-start test.

- [ ] **Step 2: Run the focused App test and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/sidepanel/App.test.tsx
```

Expected: FAIL because `replayCue` still sends 500 ms.

- [ ] **Step 3: Implement the minimal replay fix**

Change the outgoing message to:

```ts
{ type: 'SEEK_TO_TIME', timeMs: Math.max(0, cue.startMs) }
```

- [ ] **Step 4: Add transcript structure tests before CSS/markup changes**

Assert the transcript region has class `transcript-list`, every cue has class `caption-cue`, and the active cue keeps `aria-current="true"`. These assertions catch removal of the styling hooks while existing behavioral tests continue to exercise real replay and selection.

- [ ] **Step 5: Run TranscriptPanel tests and verify RED**

Expected: FAIL because the transcript section does not yet have `transcript-list`.

- [ ] **Step 6: Implement row markup and styling**

Add `className="transcript-list"` to the transcript section. Style the list with a 10 px gap. Give rows zero margin, 12 px padding, a 1 px neutral border, 8 px radius, white background, and a visible hover/focus background. Keep the active-cue background variable and use a stronger active border.

- [ ] **Step 7: Run Task 1 tests**

Run App and TranscriptPanel suites. Expected: both pass and selection still prevents replay.

### Task 2: Global GPT-5.6 model and reasoning controls

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/background-message.typecheck.ts`
- Modify: `src/storage/settings-store.test.ts`
- Modify: `src/storage/settings-store.ts`
- Modify: `src/sidepanel/components/SettingsView.test.tsx`
- Modify: `src/sidepanel/components/SettingsView.tsx`
- Modify: `src/llm/openai-client.test.ts`
- Modify: `src/llm/openai-client.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/background/message-router.test.ts`
- Modify: `src/sidepanel/components/QueryResult.tsx`
- Modify: `src/sidepanel/components/HistoryView.test.tsx`
- Modify: `src/sidepanel/components/HistoryView.tsx`
- Modify: `src/storage/history-transfer.test.ts`
- Modify: `src/storage/history-transfer.ts`

**Interfaces:**
- Produces: `OpenAIModel`, `ReasoningEffort`, `Settings.model`, `Settings.reasoningEffort`, and optional `QueryResult.reasoningEffort` for legacy compatibility.
- Changes: `OpenAIClientOptions` requires `reasoningEffort`; Responses payload includes `reasoning: { effort }`.

- [ ] **Step 1: Write failing storage normalization tests**

Assert empty storage defaults to `model: 'gpt-5.6-luna'` and `reasoningEffort: 'low'`; valid Sol/max values persist; invalid strings normalize to Luna/low.

- [ ] **Step 2: Run settings-store tests and verify RED**

Expected: FAIL because the settings fields do not exist.

- [ ] **Step 3: Add model/effort types and normalized defaults**

Define exact string unions and allowlists. Add the two fields to `Settings`, `defaultSettings`, and `normalizeSettings`.

- [ ] **Step 4: Write failing SettingsView dropdown tests**

Render settings with Luna/low, assert labels `OpenAI 模型` and `推理強度`, choose Terra/high, save, and assert the patch contains `model: 'gpt-5.6-terra'` and `reasoningEffort: 'high'` without raw API-key metadata.

- [ ] **Step 5: Run SettingsView tests and verify RED**

Expected: FAIL because neither selector is rendered.

- [ ] **Step 6: Add both Ant Design selectors**

Place both selectors in the existing `OpenAI 連線` card. Show human labels Luna/省成本, Terra/平衡, Sol/最強 while storing exact model IDs. Store exact effort strings.

- [ ] **Step 7: Write failing OpenAI request tests**

Construct the client with `gpt-5.6-luna` and `low`; assert the posted JSON contains:

```json
{"model":"gpt-5.6-luna","reasoning":{"effort":"low"},"store":false}
```

Also assert the returned result records model and effort.

- [ ] **Step 8: Run OpenAI tests and verify RED**

Expected: FAIL because reasoning effort is not accepted or sent.

- [ ] **Step 9: Implement client and service-worker wiring**

Add `reasoningEffort` to client options and payload. Remove the fixed `OPENAI_MODEL`; pass `settings.model` and `settings.reasoningEffort` from the workflow factory.

- [ ] **Step 10: Add history metadata compatibility tests**

Assert new records render model and effort, and imported version-1 records without `reasoningEffort` remain valid. Update `isResult` to accept undefined or one of the supported effort strings.

- [ ] **Step 11: Run Task 2 suites and typecheck**

Run settings, SettingsView, OpenAI client, router, HistoryView, history-transfer, and TypeScript checks. Expected: all pass.

### Task 3: Viewport-safe floating assistant

**Files:**
- Create: `src/sidepanel/assistant-position.ts`
- Create: `src/sidepanel/assistant-position.test.ts`
- Modify: `src/sidepanel/components/SelectionAssistant.test.tsx`
- Modify: `src/sidepanel/components/SelectionAssistant.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Produces: `calculateAssistantPosition(anchor, popup, viewport, inset?, gap?): { left: number; top: number; placement: 'above' | 'below' }`.

- [ ] **Step 1: Write failing pure positioning tests**

Use literal dimensions to cover centered-above placement, left/right clamping, below placement when the top edge would clip, and bottom clamping when neither side fully fits.

- [ ] **Step 2: Run positioning tests and verify RED**

Expected: FAIL because `assistant-position.ts` does not exist.

- [ ] **Step 3: Implement the pure position calculation**

Prefer above, choose below when above does not fit and below has at least as much space, then clamp both coordinates within 16 px. Use an 8 px gap.

- [ ] **Step 4: Write failing component measurement tests**

Mock the dialog rectangle and viewport dimensions, render near an edge, dispatch resize, and assert the wrapper receives clamped pixel coordinates rather than the raw anchor plus a CSS transform.

- [ ] **Step 5: Run SelectionAssistant tests and verify RED**

Expected: FAIL because the current wrapper directly uses raw anchor coordinates.

- [ ] **Step 6: Integrate measurement and ResizeObserver**

Use `useLayoutEffect`, a guarded `ResizeObserver`, and resize/scroll listeners. Remove the transform from CSS, widen viewport safety to `calc(100vw - 32px)`, and keep result scrolling within the assistant.

- [ ] **Step 7: Run Task 3 tests**

Expected: positioning and assistant suites pass, including outside-click and Escape behavior.

### Task 4: Tab-specific side-panel ownership

**Files:**
- Modify: `src/background/side-panel-behavior.test.ts`
- Modify: `src/background/side-panel-behavior.ts`
- Modify: `src/background/service-worker.ts`
- Create: `src/sidepanel/panel-owner.ts`
- Create: `src/sidepanel/panel-owner.test.ts`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Produces: `openTabSpecificSidePanel(sidePanel, tabId)` and `readOwnerTabId(search)`.
- Tab path format: `src/sidepanel/index.html?tabId=<integer>`.

- [ ] **Step 1: Write failing background behavior tests**

Assert registration calls `setPanelBehavior({ openPanelOnActionClick: false })` and `setOptions({ enabled: false })`. Assert a click for tab 42 first sets `{ tabId: 42, path: 'src/sidepanel/index.html?tabId=42', enabled: true }` and then opens `{ tabId: 42 }`.

- [ ] **Step 2: Run side-panel behavior tests and verify RED**

Expected: FAIL because the current helper only enables global action-click behavior.

- [ ] **Step 3: Implement tab-specific configuration**

Expose a registration helper that disables automatic global action-click behavior and the default panel, subscribes to `chrome.action.onClicked`, ignores tabs without IDs, configures the path, and opens the tab panel. Catch promise failures in the service worker.

- [ ] **Step 4: Write failing owner parser and App isolation tests**

Assert `?tabId=42` returns 42 while missing, negative, fractional, and nonnumeric values return undefined. Render App with `?tabId=42`, assert state requests, refresh, and replay target only tab 42, and assert no `tabs.onActivated` listener is registered for the owned instance.

- [ ] **Step 5: Run owner/App tests and verify RED**

Expected: FAIL because App ignores the query parameter and rebinds on active-tab changes.

- [ ] **Step 6: Bind App to its immutable owner tab**

Read `window.location.search` once. Set `activeTabIdRef` to the owner, request its state directly, filter all runtime messages by that sender tab, and skip active-tab rebinding. Keep current lookup/rebinding only for a missing owner ID compatibility path.

- [ ] **Step 7: Run Task 4 tests**

Expected: side-panel, owner parser, and App suites pass.

### Task 5: Full verification and rebuild

**Files:**
- Regenerate: `dist/**`

**Interfaces:**
- Produces: a loadable unpacked extension in `dist`.

- [ ] **Step 1: Run the complete test suite**

```powershell
node work/run-vitest.mjs
```

Expected: every test file passes with zero failed tests.

- [ ] **Step 2: Run TypeScript verification**

```powershell
node node_modules/typescript/bin/tsc --noEmit
```

Expected: exit code 0 with no diagnostics.

- [ ] **Step 3: Run the production build**

```powershell
node work/run-build.mjs
```

Expected: Vite exits 0 and regenerates non-empty manifest, side-panel, content-script, page-bridge, and service-worker artifacts.

- [ ] **Step 4: Inspect built artifacts and requirement coverage**

Confirm the built side-panel bundle contains GPT-5.6 Luna/Terra/Sol labels and tab-owner parsing, the service worker contains tab-specific Side Panel calls and reasoning configuration, and the content-script bundle remains present.
