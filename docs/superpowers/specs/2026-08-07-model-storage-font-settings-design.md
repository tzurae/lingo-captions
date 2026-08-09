# Model, Storage, and Subtitle Font Settings Design

## Goal

Make each OpenAI query transparent about the model it requested and the model the API returned, keep global settings trustworthy across an extension service-worker restart/reload, and make the configured subtitle font size visibly affect transcript rows.

## Confirmed root causes

- The OpenAI client currently writes the configured request model into `QueryResult.model` and ignores the Responses API `model` field. The UI therefore cannot prove which model the API reported.
- The side panel initially shows local defaults and silently ignores `GET_SETTINGS` failures. A stale or temporarily disconnected panel after an extension reload can consequently display “API Key not saved” even though no storage-clearing code ran.
- `--font-size` is set on `.sidepanel-app`, while the declaration that consumes it is on the ancestor `body`. The body computes 16px before the descendant variable override exists, so transcript rows continue to inherit 16px.

## Design

### Query model transparency

- Add optional `requestedModel` to `QueryResult` for backward-compatible history records.
- Parse the non-empty `model` string returned by the OpenAI Responses API into `QueryResult.model`.
- Fall back to the requested model only for malformed/legacy test payloads that omit the response model.
- Snapshot the selected model and reasoning effort when a query starts.
- While loading, show the requested model and effort in the floating result card.
- After completion, show both “Requested model” and “OpenAI returned model”. Display a warning when they differ.

### Settings persistence and reload recovery

- Continue using `chrome.storage.local`; an extension service-worker restart must not clear it.
- Verify writes by reading settings back after `storage.local.set` (the existing store already reads after writes) and explicitly reject a save when the requested API key is not present in the read-back result.
- Add a panel settings-load state. Do not present default “not saved” as authoritative while loading failed.
- Retry `GET_SETTINGS` when the side panel becomes visible/focused after an extension reload. If the extension context is invalidated, reload the side-panel document once so it reconnects to the newly loaded extension.
- Never expose the full API key to the side-panel response, history, logs, or error text.

### Subtitle font size

- Pass `fontSize` and `textColor` into `TranscriptPanel`.
- Apply them directly to the transcript region so the browser receives a concrete pixel value such as `22px`.
- Keep navigation, settings controls, and the floating assistant at their normal UI size; the setting is specifically “subtitle font size”.

## Verification

- OpenAI client test proves response `model` wins and requested model is retained.
- Query result tests prove loading and completed metadata, including mismatch warning.
- Settings store/router tests prove a fresh store/router instance can read the same saved API key and font size and that failed read-back does not report success.
- App test proves transient settings-load failure is not displayed as “not saved” and a later visibility/focus retry restores saved status.
- Transcript test proves the transcript region receives the configured concrete font size and color.
- Run the full Vitest suite, TypeScript check, production build, and production dependency smoke test.

