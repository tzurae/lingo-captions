# Tab-specific Panel, Model Controls, and Transcript Polish Design

## Goal

Improve the YouTube learning side panel in five related areas: exact transcript replay, clearer transcript-row interaction, viewport-safe floating answers, tab-specific panel state, and configurable GPT-5.6 model/reasoning settings.

## Approved behavior

- Clicking a transcript row seeks to that row's exact `startMs`. No 500 ms pre-roll is applied.
- Transcript rows have visible separation, borders, padding, and a hover background. The currently playing row remains visually stronger than a merely hovered row.
- The floating assistant stays inside a 16 px viewport inset. It prefers the space above the selection, falls below when necessary, and clamps horizontally and vertically as its contents grow.
- Opening the extension on tab A creates a tab-specific side-panel instance. Switching to a tab without an opened instance hides the panel; returning to A restores the same in-memory panel state. Opening the extension on tab B creates a separate B instance.
- Settings remain extension-global in `chrome.storage.local` and synchronize across every open panel instance.
- The model is selected from an Ant Design dropdown with `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`. The default is `gpt-5.6-luna`.
- Reasoning effort is selected from `none`, `low`, `medium`, `high`, `xhigh`, and `max`. The default is `low`.
- The Responses API request sends `reasoning: { effort }`. Existing prompts and the `store: false` behavior remain unchanged.
- New query results and history records expose the model and reasoning effort actually used. Imported legacy records without an effort remain valid.

## Alternatives considered

### Replay timing

1. Exact `startMs` (selected): matches the clicked row and prevents the previous row from becoming active.
2. A smaller 100 ms pre-roll: can still enter the previous subtitle at tight boundaries.
3. A configurable pre-roll: adds a setting for a behavior the user explicitly identified as a bug.

### Side-panel ownership

1. Tab-specific panel path containing `tabId` (selected): Chrome creates independent panel instances and automatically hides/restores them across tab switches.
2. One global panel that rebinds on `tabs.onActivated`: destroys or replaces tab A's local UI state and caused the existing cross-tab behavior.
3. A global panel with manually serialized UI state per tab: more code and more failure modes than Chrome's native tab-specific panels.

### Floating positioning

1. Measure and clamp the rendered assistant (selected): handles answer growth and all viewport edges.
2. CSS transform only: cannot reliably avoid both horizontal and vertical clipping.
3. A fixed bottom sheet: avoids clipping but no longer appears near the selected text.

## Architecture

### Transcript replay and presentation

`TranscriptPanel` continues to pass the complete cue object to `App.replayCue`. `App.replayCue` sends `SEEK_TO_TIME` with the cue's exact, non-negative `startMs`. The content script remains responsible only for converting milliseconds to the video's `currentTime`, starting playback, and reporting the resulting playback position.

The transcript section receives a dedicated list class. Each cue is a bordered card-like row with a hover state, while `aria-current="true"` uses the configured active-cue color and a stronger border.

### Floating assistant placement

A pure positioning function receives the selection anchor, rendered assistant dimensions, viewport dimensions, 16 px inset, and 8 px gap. It returns fixed `left` and `top` coordinates. `SelectionAssistant` measures itself in a layout effect, observes size changes when supported, and recalculates on resize and scroll. CSS transforms are removed so the calculated coordinates are authoritative.

### Tab-specific panel lifecycle

The background worker disables the default/global panel, disables the old automatic global action-click behavior, and handles extension action clicks. For the clicked tab it sets a path of `src/sidepanel/index.html?tabId=<id>`, enables that tab's panel, and opens it in the same user gesture.

`App` reads the owner tab ID from its URL. A tab-owned instance requests and accepts state only from that tab, sends refresh and seek commands only to that tab, and does not rebind on `tabs.onActivated`. The existing active-tab lookup remains only as a compatibility fallback for tests or a legacy path without `tabId`.

### Model and reasoning settings

`Settings` adds validated `model` and `reasoningEffort` fields. Stored values outside the supported allowlists fall back to Luna and low. `SettingsView` renders both selectors inside the existing OpenAI card and saves them in the same global patch as other settings.

The service worker constructs `OpenAIClient` from the latest stored settings. `OpenAIClient` adds the Responses API `reasoning.effort` field and returns both the selected model and effort with the answer. History validation accepts the effort when present and keeps old records valid when absent.

## Error handling

- Invalid stored model or effort values never reach OpenAI; normalization replaces them with defaults.
- A missing or invalid owner `tabId` falls back to the current active-tab behavior rather than leaving the panel unusable.
- Failure to configure or open a tab-specific panel is caught in the service worker so the worker does not crash.
- If assistant measurement APIs are unavailable, the component still uses a clamped initial position and recalculates on ordinary React updates.

## Testing

- App regression tests prove a cue starting at 1000 ms sends exactly 1000 ms and a cue at zero stays at zero.
- Transcript component tests cover the list/row classes and keep text selection from triggering replay.
- Positioning unit tests cover left, right, top, bottom, and content-growth clamping.
- Side-panel behavior tests cover tab-specific path, enable-before-open ordering, and URL owner-tab parsing.
- Settings tests cover defaults, stale-value normalization, both dropdowns, global save patches, and storage synchronization.
- OpenAI client tests assert the exact Responses API `model` and `reasoning.effort` payload and returned metadata.
- Full Vitest, TypeScript, and Vite builds must pass before regenerating `dist`.

## Constraints

- Keep Ant Design as the only component framework.
- Do not expose the raw OpenAI API key outside the background worker.
- Do not change caption extraction, prompt text, history auto-save, favorites, or IndexedDB storage except where needed to record reasoning effort.
- This workspace has no Git metadata, so no commits or worktrees can be created.
