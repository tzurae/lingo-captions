# YouTube English Learning Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-use Chrome Manifest V3 extension with a Chrome Side Panel that synchronizes YouTube English captions, lets the user select text and choose an OpenAI-powered learning action, and stores settings and history locally.

**Architecture:** Use TypeScript for all extension contexts, React only for the Side Panel UI, and Vite for bundling. A content script reads YouTube caption state, the Side Panel renders and selects transcript text, and a background service worker owns message routing and the OpenAI request boundary. Keep domain logic behind `ContextBuilder`, `LLMClient`, `WorkflowRunner`, and storage repository interfaces so future harness/loop workflows and alternate storage backends can replace adapters without changing the UI.

**Tech Stack:** TypeScript, React, Vite, Vitest, jsdom, fake-indexeddb, Chrome Manifest V3, Chrome Side Panel API, IndexedDB, `chrome.storage.local`, OpenAI Responses API via `fetch`.

## Global Constraints

- Personal-use extension: the user enters their own OpenAI API Key; no custom backend or login system.
- The API Key is never sent to the YouTube content script; only the background service worker reads it from extension storage.
- Supported source is ordinary YouTube videos with manual or auto-generated English captions; exclude live captions, Shorts, and other sites.
- The user's selected text is always the primary query target; the full sentence and optional neighboring caption lines are context only.
- Selecting text opens a MENU but never sends an API request until the user chooses an action.
- `translate_sentence` is the primary LLM action; also support `explain_selection`, `grammar`, `synonyms_antonyms`, `natural_rewrite`, and `custom`. `save` is a local history operation, not an LLM intent.
- Keep API calls bounded: one request for MVP actions, with future workflow limits represented in `WorkflowRunner`.
- Use TDD for production behavior: write one focused failing test, run it and verify the expected failure, implement the smallest passing code, rerun the focused and full suite, then refactor only while green.
- This workspace has no Git metadata, so checkpoint commits cannot be created until a repository is provided; keep each task independently reviewable.

## File Map

- `package.json`: scripts and dependencies.
- `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`: TypeScript, bundling, and test configuration.
- `public/manifest.json`: Manifest V3 permissions, Side Panel entry, service worker, content script, and OpenAI host permission.
- `src/sidepanel/index.html`: Side Panel HTML entry loaded by the Vite build.
- `src/domain/types.ts`: shared domain types for captions, queries, settings, history, and messages.
- `src/domain/query-intents.ts`: action metadata and default labels.
- `src/domain/context-builder.ts`: deterministic prompt context construction.
- `src/storage/history-repository.ts`: storage interface.
- `src/storage/indexeddb-history-repository.ts`: IndexedDB adapter.
- `src/storage/settings-store.ts`: `chrome.storage.local` adapter.
- `src/llm/llm-client.ts`: provider-independent LLM interface.
- `src/llm/openai-client.ts`: OpenAI Responses API adapter and error mapping.
- `src/workflows/workflow-runner.ts`: bounded one-step MVP workflow boundary.
- `src/background/service-worker.ts`: message handlers and dependency wiring.
- `src/content/youtube-captions.ts`: caption extraction and playback synchronization helpers.
- `src/content/content-script.ts`: YouTube page bridge.
- `src/sidepanel/main.tsx`, `src/sidepanel/App.tsx`: Side Panel bootstrap and state composition.
- `src/sidepanel/components/*`: transcript, action menu, result, settings, and history views.
- `tests/test-setup.ts`: jsdom and IndexedDB test setup.

---

### Task 1: Scaffold the TypeScript extension and test runner

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `public/manifest.json`
- Create: `tests/test-setup.ts`
- Test: `src/domain/query-intents.test.ts`

**Interfaces:**
- Produces the test command `pnpm test`, build command `pnpm build`, and a Manifest V3 bundle with `side_panel.html`, `background.js`, and YouTube content scripts.

- [ ] **Step 1: Install the development and runtime dependencies**

Run:

```powershell
pnpm add react react-dom
pnpm add -D typescript vite vitest jsdom @types/chrome @types/react @types/react-dom @vitejs/plugin-react @crxjs/vite-plugin fake-indexeddb
```

- [ ] **Step 2: Write the first failing domain test**

Create `src/domain/query-intents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getQueryIntent } from './query-intents';

describe('getQueryIntent', () => {
  it('marks translate_sentence as the primary action', () => {
    expect(getQueryIntent('translate_sentence')).toMatchObject({
      id: 'translate_sentence',
      primary: true,
    });
  });
});
```

- [ ] **Step 3: Run the focused test and verify the expected RED failure**

Run: `pnpm vitest run src/domain/query-intents.test.ts`

Expected: FAIL because `src/domain/query-intents.ts` does not exist yet.

- [ ] **Step 4: Add the minimum build and test configuration**

Create the Vite and Vitest configuration, including React JSX handling, `jsdom`, and `tests/test-setup.ts` importing `fake-indexeddb/auto`. Add scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Add the minimum Manifest V3 shell**

Configure `public/manifest.json` with `manifest_version: 3`, `permissions: ["storage", "sidePanel"]`, `host_permissions: ["https://api.openai.com/*"]`, a Side Panel page, a background service worker, and a YouTube content script. Do not add `unlimitedStorage` in MVP.

- [ ] **Step 6: Run the test runner and type checker**

Run: `pnpm vitest run src/domain/query-intents.test.ts` and `pnpm typecheck`.

Expected: the test still fails only because the domain implementation is missing; configuration itself loads without test-runner errors.

---

### Task 2: Implement domain types and query intents

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/query-intents.ts`
- Test: `src/domain/query-intents.test.ts`

**Interfaces:**
- `CaptionCue { id: string; startMs: number; endMs: number; text: string }`
- `CaptionTrack { language: string; isEnglish: boolean; cues: CaptionCue[] }`
- `QueryIntentId = 'translate_sentence' | 'explain_selection' | 'grammar' | 'synonyms_antonyms' | 'natural_rewrite' | 'custom'`
- `QueryIntent { id: QueryIntentId; label: string; primary: boolean }`
- `QueryRequest { intent: QueryIntentId; selectedText: string; sentence: string; contextBefore: string[]; contextAfter: string[]; outputLanguage: string; detailLevel: 'brief' | 'normal' | 'detailed'; customQuestion?: string }`
- `QueryResult { answer: string; model: string; createdAt: number }`
- `HistoryRecord` contains video metadata, query request, result, and `isFavorite`.
- `getQueryIntent(id)` and `listQueryIntents()` are the stable action registry consumed by the UI.

- [ ] **Step 1: Add failing tests for the complete action registry**

Test that the registry includes the six actions in the specified order, only `translate_sentence` is primary, and an unknown ID throws a clear error.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run src/domain/query-intents.test.ts`.

Expected: FAIL because the registry functions do not exist.

- [ ] **Step 3: Implement the minimum types and registry**

Return static metadata only; do not add UI or prompt logic to this file.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm vitest run src/domain/query-intents.test.ts` and `pnpm test`.

Expected: PASS with no warnings.

---

### Task 3: Build and test deterministic context construction

**Files:**
- Create: `src/domain/context-builder.ts`
- Test: `src/domain/context-builder.test.ts`

**Interfaces:**
- `buildQueryContext(request: { selectedText: string; cueIndex: number; cues: CaptionCue[]; contextLines: number }): { selectedText: string; sentence: string; contextBefore: string[]; contextAfter: string[] }`

- [ ] **Step 1: Write failing tests**

Cover: selected text is preserved exactly; the containing cue becomes `sentence`; context is clipped at the start and end; context lines never include the selected cue twice; empty selections are rejected.

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm vitest run src/domain/context-builder.test.ts`.

Expected: FAIL because `buildQueryContext` is missing.

- [ ] **Step 3: Implement the smallest pure function**

Use cue index arithmetic only; do not read DOM or storage in this module.

- [ ] **Step 4: Run the focused and full suites**

Expected: PASS.

---

### Task 4: Add the IndexedDB history repository and settings store

**Files:**
- Create: `src/storage/history-repository.ts`
- Create: `src/storage/indexeddb-history-repository.ts`
- Create: `src/storage/settings-store.ts`
- Test: `src/storage/indexeddb-history-repository.test.ts`
- Test: `src/storage/settings-store.test.ts`

**Interfaces:**
- `HistoryRepository.add(record): Promise<void>`
- `HistoryRepository.list(filter?): Promise<HistoryRecord[]>`
- `HistoryRepository.update(id, patch): Promise<void>`
- `HistoryRepository.remove(id): Promise<void>`
- `HistoryRepository.clear(): Promise<void>`
- `SettingsStore.get(): Promise<Settings>`
- `SettingsStore.update(patch): Promise<Settings>`
- `SettingsStore.clearApiKey(): Promise<void>`
- `Settings` includes `apiKey`, `model`, `outputLanguage`, `detailLevel`, `contextLines`, `fontSize`, `textColor`, `activeCueColor`, and `autoFollowPlayback`.

- [ ] **Step 1: Write failing repository tests**

Test that a record can be added and listed, favorites can be filtered, updates persist, deletion removes one record, and clear removes all records. Use `fake-indexeddb` only as the browser API substitute; assert on repository results, not mock calls.

- [ ] **Step 2: Run repository tests and verify RED**

Run: `pnpm vitest run src/storage/indexeddb-history-repository.test.ts`.

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement the repository with one database and one history object store**

Use a stable database name, `id` key path, and indexes for `createdAt`, `videoId`, and `isFavorite`. Preserve full request context and response for local replay.

- [ ] **Step 4: Run repository tests and verify GREEN**

Run: `pnpm vitest run src/storage/indexeddb-history-repository.test.ts`.

Expected: PASS.

- [ ] **Step 5: Write failing settings tests**

Test default values, partial updates, API Key clearing, and storage failure propagation.

- [ ] **Step 6: Run settings tests and verify RED**

Run: `pnpm vitest run src/storage/settings-store.test.ts`.

Expected: FAIL because the settings adapter is missing.

- [ ] **Step 7: Implement the `chrome.storage.local` adapter**

Keep the API Key in the extension-only storage layer and never include it in content-script messages or history records.

- [ ] **Step 8: Run storage tests and the full suite**

Run: `pnpm test` and `pnpm typecheck`.

Expected: PASS.

---

### Task 5: Implement the OpenAI adapter and bounded workflow boundary

**Files:**
- Create: `src/llm/llm-client.ts`
- Create: `src/llm/openai-client.ts`
- Create: `src/workflows/workflow-runner.ts`
- Test: `src/llm/openai-client.test.ts`
- Test: `src/workflows/workflow-runner.test.ts`

**Interfaces:**
- `LLMClient.complete(request: QueryRequest): Promise<QueryResult>`
- `WorkflowRunner.run(request: QueryRequest): Promise<QueryResult>`
- `OpenAIClient` receives `{ apiKey, model, fetchImpl }` by dependency injection.

- [ ] **Step 1: Write failing OpenAI adapter tests**

Test that the adapter sends `POST https://api.openai.com/v1/responses`, uses the configured model, includes the selected text, sentence, context, intent, and output language, sets `store: false`, extracts `output_text`, and maps HTTP 401, 429, and network errors to stable user-facing error codes. Use a local `fetchImpl` test function because network access is not part of unit tests.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `pnpm vitest run src/llm/openai-client.test.ts`.

Expected: FAIL because `OpenAIClient` is missing.

- [ ] **Step 3: Implement the minimal fetch adapter**

Use the Responses API shape with `model`, `instructions`, `input`, and `store: false`; never log the API Key or full response in production code. Keep prompt assembly in a pure helper so intent tests can cover it without network calls.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Write failing workflow tests**

Test that MVP runs exactly one LLM call, rejects empty selected text, and exposes a fixed `maxSteps: 1` boundary for future multi-step workflows.

- [ ] **Step 6: Run workflow tests and verify RED**

Run: `pnpm vitest run src/workflows/workflow-runner.test.ts`.

Expected: FAIL because `WorkflowRunner` is missing.

- [ ] **Step 7: Implement the one-step runner**

The runner delegates to `LLMClient` and does not add retries or autonomous looping in MVP.

- [ ] **Step 8: Run the full suite and type checker**

Expected: PASS.

---

### Task 6: Implement YouTube caption extraction and message contracts

**Files:**
- Create: `src/content/youtube-captions.ts`
- Create: `src/content/content-script.ts`
- Modify: `src/domain/types.ts`
- Test: `src/content/youtube-captions.test.ts`

**Interfaces:**
- `parseCaptionTrack(raw): CaptionTrack`
- `findCurrentCue(cues, currentTimeMs): CaptionCue | null`
- `ContentMessage = { type: 'CAPTIONS_UPDATED'; ... } | { type: 'PLAYBACK_UPDATED'; ... } | { type: 'VIDEO_CHANGED'; ... } | { type: 'NO_CAPTIONS'; ... }`

- [ ] **Step 1: Write failing caption parser tests**

Cover manual and auto-generated English track metadata, cue ordering, HTML/entity cleanup, duplicate cue removal, unsupported language, and current-cue lookup at start, middle, end, and gaps.

- [ ] **Step 2: Run caption tests and verify RED**

Run: `pnpm vitest run src/content/youtube-captions.test.ts`.

Expected: FAIL because parser functions are missing.

- [ ] **Step 3: Implement pure caption parsing and synchronization helpers**

Keep DOM access out of the pure parser. Normalize captions into the shared `CaptionCue` shape.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Add the content-script bridge**

Observe YouTube navigation and playback events, send only caption/video state to the Side Panel, and keep API Key access impossible from this context.

- [ ] **Step 6: Run the full suite and typecheck**

Expected: PASS.

---

### Task 7: Build the service worker message router

**Files:**
- Create: `src/background/service-worker.ts`
- Create: `src/background/message-router.ts`
- Test: `src/background/message-router.test.ts`

**Interfaces:**
- `MessageRouter.handle(message, sender): Promise<ResponseMessage>`.
- Request messages: `GET_SETTINGS`, `SAVE_SETTINGS`, `RUN_QUERY`, `SAVE_HISTORY`, `LIST_HISTORY`, `DELETE_HISTORY`, `TOGGLE_FAVORITE`.
- Response messages always include `{ ok: boolean }` and either `data` or a stable `{ code, message }` error.

- [ ] **Step 1: Write failing router tests**

Test that `RUN_QUERY` reads settings, calls the workflow once, persists the resulting history record, and returns the result; missing API Key returns `API_KEY_MISSING`; content-script senders cannot request `GET_SETTINGS` with the API Key included in the response.

- [ ] **Step 2: Run router tests and verify RED**

Run: `pnpm vitest run src/background/message-router.test.ts`.

Expected: FAIL because the router is missing.

- [ ] **Step 3: Implement dependency-injected router**

Pass repository, settings store, workflow runner, and clock dependencies into the router so tests exercise real routing logic with in-memory adapters.

- [ ] **Step 4: Run router tests and full suite**

Expected: PASS.

---

### Task 8: Build the React Side Panel UI with TDD boundaries

**Files:**
- Create: `src/sidepanel/main.tsx`
- Create: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/components/TranscriptPanel.tsx`
- Create: `src/sidepanel/components/SelectionMenu.tsx`
- Create: `src/sidepanel/components/QueryResult.tsx`
- Create: `src/sidepanel/components/HistoryView.tsx`
- Create: `src/sidepanel/components/SettingsView.tsx`
- Create: `src/sidepanel/styles.css`
- Test: `src/sidepanel/components/SelectionMenu.test.tsx`
- Test: `src/sidepanel/components/TranscriptPanel.test.tsx`
- Test: `src/sidepanel/components/SettingsView.test.tsx`

**Interfaces:**
- `TranscriptPanel` receives `cues`, `currentCueId`, and `onSelection(selection)`.
- `SelectionMenu` receives `selectedText`, `onChooseIntent(intent)`, and `onClose()`.
- `App` owns tab state (`transcript | history | settings`) and delegates persistence/API work to the message client.

- [ ] **Step 1: Write failing component tests**

Test that the transcript renders cues in order and highlights the active cue; selecting text opens the MENU; the primary button is labeled `翻譯整句`; clicking an action emits the correct intent; settings show API Key/model/output language/context controls without rendering the API Key value after save.

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm vitest run src/sidepanel/components`.

Expected: FAIL because the components are missing.

- [ ] **Step 3: Implement the smallest accessible components**

Use semantic buttons and labels, keyboard navigation, explicit loading/error/empty states, and CSS variables for font size and colors. Do not add visual features outside the approved settings.

- [ ] **Step 4: Run component tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Connect the UI to the message router**

Load captions from content-script messages, send query actions only after a button click, save history, render results, and support history/settings tabs.

- [ ] **Step 6: Run full tests and typecheck**

Run: `pnpm test` and `pnpm typecheck`.

Expected: PASS.

---

### Task 9: Add JSON import/export and end-to-end packaging checks

**Files:**
- Create: `src/storage/history-transfer.ts`
- Test: `src/storage/history-transfer.test.ts`
- Modify: `src/sidepanel/components/HistoryView.tsx`
- Modify: `src/sidepanel/components/SettingsView.tsx`

**Interfaces:**
- `exportHistory(records): string`
- `parseHistoryExport(json): HistoryRecord[]`

- [ ] **Step 1: Write failing transfer tests**

Test round-trip export/import, invalid JSON rejection, missing required fields rejection, and preservation of favorite state and query response.

- [ ] **Step 2: Run transfer tests and verify RED**

Run: `pnpm vitest run src/storage/history-transfer.test.ts`.

Expected: FAIL because transfer functions are missing.

- [ ] **Step 3: Implement validated JSON transfer**

Return a versioned export object `{ version: 1, exportedAt, records }` and reject unknown or incomplete records with a readable error.

- [ ] **Step 4: Run transfer tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Add buttons and browser download/file input behavior**

Export must be user initiated; import must validate before writing any records.

- [ ] **Step 6: Build the extension and inspect the output**

Run: `pnpm build`.

Expected: a loadable `dist` directory containing the Manifest V3 assets and no TypeScript errors.

- [ ] **Step 7: Run the complete verification suite**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Expected: all tests pass, typecheck passes, and the production bundle builds without warnings that indicate missing entrypoints.

---

## Manual acceptance checklist

- [ ] Load `dist` as an unpacked extension in Chrome.
- [ ] Open an ordinary YouTube video with English manual captions.
- [ ] Open the Chrome Side Panel and verify caption loading and playback synchronization.
- [ ] Repeat with English auto-generated captions.
- [ ] Select a word, phrase, and full sentence in the transcript.
- [ ] Verify the MENU appears without an API request.
- [ ] Verify `翻譯整句`, grammar, explanation, synonym/antonym, natural rewrite, and custom question use the selected text as the primary target.
- [ ] Verify missing key, invalid key, rate limit, no captions, and network failure states.
- [ ] Verify history, favorite, delete, JSON export, and JSON import.
- [ ] Verify changing model, output language, detail level, context lines, colors, font size, and auto-follow changes behavior.
- [ ] Verify the API Key never appears in content-script messages, history records, UI logs, or exported JSON.
