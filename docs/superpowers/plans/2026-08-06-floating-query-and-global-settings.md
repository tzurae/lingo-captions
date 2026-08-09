# Floating Query and Global Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render OpenAI answers above the anchored selection menu and provide a globally synchronized, Ant Design settings experience with editable prompts and unambiguous API-key status.

**Architecture:** Prompt templates become a nested global setting consumed by a configured prompt registry in the background worker. The side panel owns one selection-assistant state machine that keeps menu, loading, errors, and answers in one anchored overlay, while `chrome.storage.onChanged` keeps all open panel instances synchronized.

**Tech Stack:** TypeScript, React 18, Ant Design 5.27.6, Chrome Extensions Manifest V3 APIs, `chrome.storage.local`, Vitest, Testing Library, Vite.

## Global Constraints

- Use Ant Design consistently for the settings screen and floating assistant; do not add Bootstrap, shadcn, or another UI framework.
- Do not render OpenAI loading, errors, warnings, or answers below the transcript.
- The action menu stays below the answer card and stays open while a query runs or finishes.
- Keep raw API keys inside the background worker; public settings expose only `hasApiKey` and `apiKeyLastFour`.
- Remove the user-configurable model field and use internal model `gpt-5.2`.
- Persist one extension-global settings record in `chrome.storage.local` and synchronize all open side panels through `chrome.storage.onChanged`.
- Preserve caption collection, cue replay, active-tab isolation, history auto-save, and favorite behavior.
- This workspace has no Git metadata; skip commit commands and record RED/GREEN evidence in command output.

---

### Task 1: Install Ant Design and define prompt-backed settings

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/domain/types.ts`
- Create: `src/llm/prompt-templates.ts`
- Create: `src/llm/prompt-templates.test.ts`
- Modify: `src/llm/prompt-registry.ts`
- Modify: `src/llm/prompt-registry.test.ts`
- Modify: `src/llm/openai-client.ts`
- Modify: `src/llm/openai-client.test.ts`
- Modify: `src/storage/settings-store.ts`
- Modify: `src/storage/settings-store.test.ts`

**Interfaces:**
- Produces `PromptTemplates` with `basePrompt`, `inputPrompt`, and `intentPrompts: Record<QueryIntentId, string>`.
- Produces `defaultPromptTemplates: PromptTemplates` and `renderPromptTemplate(template, values): string`.
- Changes `Settings` to remove `model` and add `prompts: PromptTemplates`.
- Changes `PublicSettings` to add `apiKeyLastFour: string | null`.
- Changes `PromptRegistry` to `buildInstructions(request: QueryRequest): string` and `buildInput(request: QueryRequest): string`.

- [ ] **Step 1: Add Ant Design with an exact version**

Run:

```powershell
pnpm add antd@5.27.6
```

Expected: `package.json` contains `"antd": "5.27.6"` and the lockfile records the resolved package.

- [ ] **Step 2: Write failing prompt-template tests**

Create tests with literal expectations proving:

```ts
renderPromptTemplate('Answer in {{outputLanguage}}; {{unknown}}', {
  outputLanguage: '繁體中文',
}) === 'Answer in 繁體中文; {{unknown}}'
```

and proving default instructions contain the selected intent guidance while default input contains selected text, sentence, context, and an empty custom question when absent.

- [ ] **Step 3: Run prompt tests and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/llm/prompt-templates.test.ts src/llm/prompt-registry.test.ts
```

Expected: FAIL because `prompt-templates.ts` and the new registry API do not exist.

- [ ] **Step 4: Implement prompt templates and interpolation**

Implement literal `{{name}}` replacement for known values and preserve unknown placeholders. Define the approved base template, input template, and all six existing intent-guidance strings. Implement `ConfiguredPromptRegistry` so `buildInstructions` interpolates output language, detail level, and intent guidance, and `buildInput` interpolates all request fields.

- [ ] **Step 5: Write failing OpenAI-client tests for configured prompts and fixed model**

Assert the request body uses the registry's complete instructions/input and uses `gpt-5.2` supplied by the internal service-worker configuration rather than a public setting.

- [ ] **Step 6: Run OpenAI tests and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/llm/openai-client.test.ts
```

Expected: FAIL because the client still calls `getGuidance()` and constructs input internally.

- [ ] **Step 7: Delegate full prompt construction to PromptRegistry**

Replace `buildInstructions` and `buildInput` in `openai-client.ts` with calls to `promptRegistry.buildInstructions(request)` and `promptRegistry.buildInput(request)` while preserving OpenAI Responses API error handling.

- [ ] **Step 8: Write failing nested-settings tests**

Assert empty storage returns defaults including prompts, a stored partial `intentPrompts` object merges with every default intent, stale stored `model` is ignored, and prompt updates persist without removing unrelated settings.

- [ ] **Step 9: Run storage tests and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/storage/settings-store.test.ts
```

Expected: FAIL because current settings are shallow-merged and still expose `model`.

- [ ] **Step 10: Implement normalized settings loading**

Build a known-key `Settings` object from stored values, deep-merge `prompts.intentPrompts`, omit stale `model`, and keep `clearApiKey()` scoped to `apiKey`.

- [ ] **Step 11: Run Task 1 tests and typecheck**

Run the four touched suites and `tsc --noEmit`. Expected: all pass with no type errors.

### Task 2: Sanitize API-key status and use configured prompts in the background

**Files:**
- Modify: `src/background/message-router.ts`
- Modify: `src/background/message-router.test.ts`
- Modify: `src/background/service-worker.ts`
- Modify: `src/domain/background-message.typecheck.ts`

**Interfaces:**
- `sanitizeSettings(settings): PublicSettings` returns no raw `apiKey`, `hasApiKey`, and `apiKeyLastFour`.
- The service worker constructs `ConfiguredPromptRegistry(settings.prompts)` and passes internal model `gpt-5.2` to `OpenAIClient`.

- [ ] **Step 1: Write failing sanitization tests**

For `apiKey: 'sk-example-1234'`, assert GET/SAVE settings return `hasApiKey: true`, `apiKeyLastFour: '1234'`, and serialized data does not contain `sk-example-1234`. For an empty key, assert `apiKeyLastFour: null`.

- [ ] **Step 2: Run router tests and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/background/message-router.test.ts
```

Expected: FAIL because `apiKeyLastFour` is absent.

- [ ] **Step 3: Implement sanitized key feedback**

Return the last four trimmed key characters only when a key exists. Keep raw-key removal recursive for all other responses.

- [ ] **Step 4: Update service-worker workflow construction**

Remove `settings.model`, define `const OPENAI_MODEL = 'gpt-5.2'`, and inject `new ConfiguredPromptRegistry(settings.prompts)` into `OpenAIClient`.

- [ ] **Step 5: Run router, workflow, OpenAI, and type checks**

Expected: all pass and no request/response type exposes a raw key.

### Task 3: Build the four-card Ant Design settings screen

**Files:**
- Modify: `src/sidepanel/components/SettingsView.tsx`
- Modify: `src/sidepanel/components/SettingsView.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/styles.css`
- Modify: `tests/test-setup.ts`

**Interfaces:**
- Changes `SettingsView` props to `{ settings: PublicSettings; onSaved(settings: PublicSettings): void }`.
- App remains the source of current public settings and passes them into SettingsView.

- [ ] **Step 1: Write failing settings-layout tests**

Assert four Ant Design cards named `OpenAI 連線`, `回答設定`, `AI Prompt`, and `字幕外觀與播放`; no `Model` input; one `儲存全部設定` button; and prompt editors hidden until their collapse section opens.

- [ ] **Step 2: Run SettingsView tests and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/sidepanel/components/SettingsView.test.tsx
```

Expected: FAIL because the current settings screen is one unsectioned native form.

- [ ] **Step 3: Implement Ant Design settings cards**

Use `Card`, `Form`, `Input.Password`, `Input.TextArea`, `Select`, `InputNumber`, `ColorPicker`, `Switch`, `Collapse`, `Alert`, `Tag`, and `Button`. Use one controlled draft derived from the `settings` prop, keep replacement key separate, and submit one partial `Settings` patch without `hasApiKey` or `apiKeyLastFour`.

- [ ] **Step 4: Write failing API-key feedback tests**

Assert configured settings show `OpenAI API Key：已儲存（結尾 ••••1234）`, never render the raw key, leave the password field empty, and show an explicit success status after saving or clearing.

- [ ] **Step 5: Run API-key tests and verify RED**

Expected: FAIL because current text is generic English and has no key suffix.

- [ ] **Step 6: Implement API-key feedback and prompt reset**

Use a success `Tag`/`Alert`, localized replacement placeholder, destructive clear confirmation styling, and a `還原預設 Prompt` button that updates only the local draft until the global save button is clicked.

- [ ] **Step 7: Write failing global-storage synchronization tests**

Mock `chrome.storage.onChanged`, render App, fire a `local` settings change, and assert App calls `getSettings()` again and passes the refreshed values to visible styling and SettingsView. Assert listener removal on unmount and ignore non-`local` areas.

- [ ] **Step 8: Run App synchronization tests and verify RED**

Expected: FAIL because App does not register a storage-change listener.

- [ ] **Step 9: Implement App-level settings synchronization**

Register one `chrome.storage.onChanged` listener in App, reload sanitized settings for `areaName === 'local'`, and remove it on unmount. Pass current settings into SettingsView so switching transcript/history/settings or Chrome tabs never creates a different settings source.

- [ ] **Step 10: Run Task 3 tests and typecheck**

Expected: all SettingsView and App tests pass without leaking the key.

### Task 4: Move query state into an anchored Ant Design assistant

**Files:**
- Create: `src/sidepanel/components/SelectionAssistant.tsx`
- Create: `src/sidepanel/components/SelectionAssistant.test.tsx`
- Modify: `src/sidepanel/components/SelectionMenu.tsx`
- Modify: `src/sidepanel/components/SelectionMenu.test.tsx`
- Modify: `src/sidepanel/components/QueryResult.tsx`
- Modify: `src/sidepanel/components/QueryResult.test.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Produces `SelectionAssistant` with selection anchor, selected text, query state, intent callbacks, save/favorite state, and close callback.
- `SelectionMenu` no longer closes when an intent is chosen; its close button still closes the entire assistant.
- `QueryResult` returns no empty placeholder and uses Ant Design states inside the assistant.

- [ ] **Step 1: Write failing SelectionAssistant layout tests**

Assert the floating wrapper uses selection coordinates, query card precedes the `Selection actions` menu in DOM order, loading uses a status indicator, errors/warnings use alerts, completed answers render with save/favorite actions, and the result container has a scrollable class.

- [ ] **Step 2: Run assistant tests and verify RED**

Run:

```powershell
node work/run-vitest.mjs src/sidepanel/components/SelectionAssistant.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement SelectionAssistant**

Use one fixed-position wrapper anchored by `{x, y}`, an Ant Design `Card`/`Spin`/`Alert` result region above the action menu, and one outside-click/Escape handler around the whole wrapper so interacting with answers does not close the menu.

- [ ] **Step 4: Write failing menu persistence tests**

Assert clicking `翻譯整句` calls `onChooseIntent` without calling `onClose`, while the close control, outside pointer, and Escape still close once.

- [ ] **Step 5: Run menu tests and verify RED**

Expected: FAIL because `SelectionMenu` currently closes before every intent callback.

- [ ] **Step 6: Make menu actions persistent**

Move outside/Escape ownership to SelectionAssistant, remove implicit close from intent selection, retain `更多` and custom-question behavior, and keep the explicit close button.

- [ ] **Step 7: Write failing App query-state tests**

Assert choosing an intent keeps the assistant visible; loading/result/error/history warning appear inside it; no `Query result`, loading, or OpenAI error exists after the transcript section; selecting new text clears the old result; closing clears all assistant state; and a late response from an older selection cannot populate a newer selection.

- [ ] **Step 8: Run App tests and verify RED**

Expected: FAIL because App clears selection before querying and renders QueryResult in page flow.

- [ ] **Step 9: Implement tokenized assistant query state**

Add a monotonically increasing query token. Increment it for new selections, queries, and close; apply async result/error/final-loading only when the token remains current. Keep transcript connection errors separate from query errors and remove page-flow QueryResult rendering.

- [ ] **Step 10: Run Task 4 tests and typecheck**

Expected: assistant, menu, result, and App suites all pass; no regression to query context/history/favorite behavior.

### Task 5: Verify and rebuild the extension

**Files:**
- Regenerate: `dist/**`

**Interfaces:**
- Produces a loadable unpacked Chrome extension in `dist`.

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
node work/run-vitest.mjs
```

Expected: 25 or more test files pass with zero failed tests.

- [ ] **Step 2: Run TypeScript verification**

Run:

```powershell
node node_modules/typescript/bin/tsc --noEmit
```

Expected: exit code 0 and no diagnostics.

- [ ] **Step 3: Run the production build**

Run:

```powershell
node work/run-build.mjs
```

Expected: Vite exits 0 and emits the manifest, side-panel HTML/CSS/JS, content script, page bridge, and service worker.

- [ ] **Step 4: Inspect built artifacts**

Verify `dist/manifest.json`, `dist/src/sidepanel/index.html`, the Ant Design-bearing side-panel bundle, content-script bundle, and service-worker bundle are non-empty.

- [ ] **Step 5: Review requirement coverage**

Confirm tests and built code cover floating result placement, persistent menu, four styled settings cards, editable/resettable prompts, hidden fixed model, global tab synchronization, and saved-key suffix feedback.
