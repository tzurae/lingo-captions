# Model, Storage, and Subtitle Font Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show requested and API-reported models, make saved settings recover correctly after extension reload, and apply subtitle font size to transcript rows.

**Architecture:** Keep OpenAI response metadata in the domain result, snapshot request settings in `App`, and render both through the existing floating assistant. Keep settings in `chrome.storage.local`, distinguish loading failure from an empty key, and recover a stale side-panel context on focus/visibility. Apply subtitle presentation directly at the transcript component boundary.

**Tech Stack:** TypeScript, React 18, Chrome MV3 APIs, Ant Design, Vitest, Testing Library, Vite.

## Global Constraints

- Use TDD: every production behavior change must first have a test that fails for the expected reason.
- API keys must never appear in public settings responses, history, logs, or error messages.
- Existing history records without `requestedModel` must remain readable.
- Subtitle font size changes transcript text only, not the whole side-panel UI.
- The workspace is not a Git repository, so commit steps are unavailable; verification evidence replaces commit checkpoints.

---

### Task 1: Apply subtitle font settings at the transcript boundary

**Files:**
- Modify: `src/sidepanel/components/TranscriptPanel.test.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.tsx`
- Modify: `src/sidepanel/App.tsx`

**Interfaces:**
- Consumes: `PublicSettings.fontSize: number` and `PublicSettings.textColor: string`.
- Produces: `TranscriptPanel` props `fontSize: number` and `textColor: string` and a transcript region with concrete inline presentation values.

- [ ] **Step 1: Write the failing transcript presentation test**

Render `TranscriptPanel` with `fontSize={22}` and `textColor="#123456"`, then assert:

```tsx
expect(screen.getByRole('region', { name: 'Transcript' })).toHaveStyle({
  fontSize: '22px',
  color: '#123456',
});
```

- [ ] **Step 2: Verify the test fails because the props do not exist or no style is applied**

Run: `npm test -- src/sidepanel/components/TranscriptPanel.test.tsx`

Expected: FAIL for missing transcript font/color behavior.

- [ ] **Step 3: Implement the minimal concrete style**

Extend `TranscriptPanel` props and apply:

```tsx
style={{ fontSize: `${fontSize}px`, color: textColor }}
```

Pass `settings.fontSize` and `settings.textColor` from `App`.

- [ ] **Step 4: Verify the focused test passes**

Run: `npm test -- src/sidepanel/components/TranscriptPanel.test.tsx src/sidepanel/App.test.tsx`

Expected: PASS.

### Task 2: Preserve requested and API-reported model metadata

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/llm/openai-client.test.ts`
- Modify: `src/llm/openai-client.ts`
- Modify: `src/storage/history-transfer.test.ts`
- Modify: `src/storage/history-transfer.ts` only if validation needs to accept the optional field explicitly.

**Interfaces:**
- Produces: `QueryResult.requestedModel?: string`.
- `QueryResult.model` is the non-empty Responses API `model` field when present.
- `QueryResult.reasoningEffort` remains the requested effort.

- [ ] **Step 1: Write a failing OpenAI response-model test**

Use a response payload containing `model: 'gpt-5.6-luna-2026-07-01'`, request `gpt-5.6-luna`, and assert:

```ts
expect(result).toMatchObject({
  model: 'gpt-5.6-luna-2026-07-01',
  requestedModel: 'gpt-5.6-luna',
  reasoningEffort: 'low',
});
```

- [ ] **Step 2: Verify the model test fails because the client echoes the request model**

Run: `npm test -- src/llm/openai-client.test.ts`

Expected: FAIL showing `model` equals `gpt-5.6-luna` and `requestedModel` is absent.

- [ ] **Step 3: Implement response-model parsing**

Extend `ResponsesPayload` with `model?: unknown`, accept only a non-empty string, and return:

```ts
model: responseModel || this.model,
requestedModel: this.model,
reasoningEffort: this.reasoningEffort,
```

- [ ] **Step 4: Verify OpenAI and history compatibility tests pass**

Run: `npm test -- src/llm/openai-client.test.ts src/storage/history-transfer.test.ts`

Expected: PASS, including legacy records without `requestedModel`.

### Task 3: Render current request and returned model in the floating assistant

**Files:**
- Modify: `src/sidepanel/components/QueryResult.test.tsx`
- Modify: `src/sidepanel/components/QueryResult.tsx`
- Modify: `src/sidepanel/components/SelectionAssistant.test.tsx`
- Modify: `src/sidepanel/components/SelectionAssistant.tsx`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- `SelectionAssistant` and `QueryResult` consume `requestedModel?: string` and `requestedReasoningEffort?: ReasoningEffort` for an in-flight request.
- Completed display reads `result.requestedModel` and `result.model`.

- [ ] **Step 1: Write failing loading and mismatch tests**

Assert loading text includes `Requested model: gpt-5.6-luna` and `Effort: low`. For a completed result with different requested/returned models, assert both values and a warning with role `status`.

- [ ] **Step 2: Verify the component tests fail because request metadata is not rendered**

Run: `npm test -- src/sidepanel/components/QueryResult.test.tsx src/sidepanel/components/SelectionAssistant.test.tsx`

Expected: FAIL for missing requested/returned labels.

- [ ] **Step 3: Implement request snapshot and metadata rendering**

In `App`, set a snapshot before sending:

```ts
setActiveQueryConfig({ model: settings.model, reasoningEffort: settings.reasoningEffort });
```

Pass it through `SelectionAssistant`. Render requested metadata during loading, both models after completion, and an Ant Design warning when they differ.

- [ ] **Step 4: Verify assistant and App tests pass**

Run: `npm test -- src/sidepanel/components/QueryResult.test.tsx src/sidepanel/components/SelectionAssistant.test.tsx src/sidepanel/App.test.tsx`

Expected: PASS.

### Task 4: Make settings recovery after extension reload trustworthy

**Files:**
- Modify: `src/storage/settings-store.test.ts`
- Modify: `src/storage/settings-store.ts`
- Modify: `src/background/message-router.test.ts`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/components/SettingsView.tsx`

**Interfaces:**
- `ChromeStorageSettingsStore.update` must only resolve after a read-back confirms all supplied settings, including a supplied API key.
- `App` tracks settings state as `loading | ready | error` and retries `GET_SETTINGS` on window focus and visible `visibilitychange`.
- `SettingsView` receives a trustworthy `PublicSettings`; loading/error state is rendered outside it rather than masquerading as an empty key.

- [ ] **Step 1: Write a failing store reconstruction/read-back test**

Create two store instances over the same memory storage, save `{ apiKey: 'secret-9876', fontSize: 22 }` through the first, and assert the second reads both values. Add a storage double that drops the API-key write and assert `update` rejects.

- [ ] **Step 2: Write a failing App recovery test**

Make the first `getSettings()` reject and the second resolve saved settings. Assert the panel does not claim the key is missing during failure; dispatch `focus` and assert the saved suffix and font setting are restored.

- [ ] **Step 3: Verify both tests fail for the intended missing safeguards**

Run: `npm test -- src/storage/settings-store.test.ts src/sidepanel/App.test.tsx`

Expected: reconstruction passes as characterization, dropped-write and App retry tests FAIL.

- [ ] **Step 4: Implement read-back verification and panel retry**

Compare every supplied patch field against the raw storage read-back before returning normalized settings. In `App`, retry settings loading on focus/visibility and show a settings connection error instead of default key state when loading fails. If an error message identifies an invalidated extension context, call `window.location.reload()` once.

- [ ] **Step 5: Verify settings tests pass**

Run: `npm test -- src/storage/settings-store.test.ts src/background/message-router.test.ts src/sidepanel/App.test.tsx src/sidepanel/components/SettingsView.test.tsx`

Expected: PASS and no raw API key in rendered or router output.

### Task 5: Full production verification

**Files:**
- Rebuild: `dist/**`

**Interfaces:**
- The unpacked extension is loaded from `dist`.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all test files and tests PASS.

- [ ] **Step 2: Run static checks**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Build production output**

Run: `npm run build`

Expected: exit code 0 and populated `dist`.

- [ ] **Step 4: Re-run the production dependency smoke test**

Run: `npm test -- tests/production-dependency-bundle.test.ts`

Expected: PASS and the side-panel production bundle mounts.

