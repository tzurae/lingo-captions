# Floating Query and Global Settings Design

**Date:** 2026-08-06

## Goal

Move every OpenAI query state into an anchored floating assistant, make all extension settings visibly global across YouTube tabs, expose editable prompt configuration, and make API-key persistence unmistakable.

## UI framework

- Use Ant Design consistently for the settings screen and floating assistant.
- Do not mix Bootstrap, shadcn, or another component framework into these views.
- Keep the existing transcript rendering lightweight; Ant Design is introduced where it materially improves forms, cards, status, collapse panels, alerts, and loading states.
- The UI must remain usable in a narrow Chrome side panel.

## Floating assistant

- Highlighting transcript text opens one anchored floating assistant near the browser selection.
- The action menu remains at the bottom of the assistant.
- Choosing an action does not close the assistant.
- Loading, request errors, history-save warnings, and the completed OpenAI answer render in a card immediately above the action menu.
- The answer card has a bounded height and internal scrolling for long responses.
- Save/favorite state remains available inside the floating answer card.
- Closing the assistant clears its selection, loading state, visible error/warning, and displayed answer.
- Selecting new transcript text replaces the old floating assistant state.
- The transcript page no longer renders a query result or OpenAI error beneath the caption list.

## Settings layout

Render four separate Ant Design cards:

1. **OpenAI 連線**
   - API-key status, replacement input, and clear action.
   - No model field is shown.
   - The extension continues to use its internal fixed model (`gpt-5.2`) when calling OpenAI.
2. **回答設定**
   - Output language, detail level, and context-line count.
3. **AI Prompt**
   - Global base instruction, input template, and one intent prompt per query action.
   - Prompt editors are grouped in collapsed Ant Design panels.
   - A reset action restores every default prompt; saving remains explicit.
4. **字幕外觀與播放**
   - Font size, text color, active-cue color, and auto-follow playback.

- One primary `儲存全部設定` button below the four cards saves the API-key replacement and every edited setting together.
- The obsolete configurable `model` setting is removed from application types and ignored if it remains in an older `chrome.storage.local` record.

## Prompt configuration

Settings store the following global prompt data:

- `basePrompt`: the shared system instruction with `{{outputLanguage}}` and `{{detailLevel}}` placeholders.
- `inputPrompt`: the structured user-input template with `{{intent}}`, `{{selectedText}}`, `{{sentence}}`, `{{contextBefore}}`, `{{contextAfter}}`, and `{{customQuestion}}` placeholders.
- `intentPrompts`: guidance for `translate_sentence`, `explain_selection`, `grammar`, `synonyms_antonyms`, `natural_rewrite`, and `custom`.

The default base prompt is:

```text
You are an English learning assistant.
Answer in {{outputLanguage}}.
Use a {{detailLevel}} level of detail.
Treat the selected text as the primary target; sentence and surrounding context are supporting context only.
{{intentPrompt}}
```

The default input template is:

```text
intent: {{intent}}
selectedText: {{selectedText}}
sentence: {{sentence}}
contextBefore: {{contextBefore}}
contextAfter: {{contextAfter}}
customQuestion: {{customQuestion}}
```

- Placeholder interpolation is literal and deterministic; unknown placeholders remain visible so configuration mistakes are diagnosable.
- Missing nested prompt keys are merged with defaults when older saved settings are loaded.
- Existing installations migrate automatically through default merging; no destructive storage migration is required.

## Global settings synchronization

- Continue storing settings in `chrome.storage.local`, which is extension-global rather than YouTube-tab-specific.
- Each open side-panel instance listens to `chrome.storage.onChanged` for the `local` area and reloads public settings after a change.
- Saving in one panel updates styling, answer behavior, prompts, and API-key status in other open panel instances.
- Video navigation and Chrome tab activation never reset global settings.

## API-key feedback and safety

- The raw API key is never returned from the background service to a side panel after saving.
- Public settings expose only `hasApiKey` and the final four characters as `apiKeyLastFour`.
- A configured key displays `OpenAI API Key：已儲存（結尾 ••••abcd）`.
- The password field remains empty after saving and explains that typing a new key replaces the stored one.
- Successful save and clear operations display explicit Ant Design status messages.
- Clearing the key removes only the key, not prompts or other settings.

## Data flow

1. The settings view sends a partial settings patch to the background router.
2. The router writes the patch to `chrome.storage.local` and returns sanitized public settings.
3. Chrome emits a storage change; every open panel reloads the same public settings.
4. A query loads the latest full settings in the background, constructs the configured prompt registry, and calls OpenAI with the internal fixed model.
5. The response returns to the requesting panel and renders inside its selection-anchored floating assistant.

## Error handling

- OpenAI request errors appear in the floating answer card, not below the transcript.
- Settings load/save/clear failures appear inside the relevant settings card.
- Prompt reset changes the local draft first and is persisted only after the user presses save.
- If no API key is stored, the OpenAI card clearly reports that state and queries retain the existing missing-key error behavior.

## Testing

- Prompt interpolation tests cover all placeholders, custom questions, default intent prompts, and unknown placeholders.
- Storage tests cover nested default merging, global prompt persistence, API-key last-four sanitization, and clearing only the key.
- Settings component tests cover the four cards, no model input, configured-key feedback, editable prompts, reset behavior, and save patches.
- App tests cover storage-change synchronization and query state staying inside the anchored assistant.
- Floating-assistant tests cover loading, errors, answer placement above actions, scrolling structure, new selections, and close cleanup.
- Complete Vitest, TypeScript, and Vite production builds must pass before regenerating `dist`.
