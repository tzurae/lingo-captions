# Caption Diagnostics and Visible-DOM Fallback Design

## Goal

When YouTube visibly renders English captions, the side panel must either show those captions or display a precise, copyable explanation of the failed stage.

## Architecture

Keep the current full-transcript path as the primary path: read YouTube player data, locate an English caption track, download timedtext, and parse cues. Add a fallback that observes YouTube's visible `.ytp-caption-segment` elements and accumulates cues while the video plays. The fallback starts only after the primary path fails and stops when a full timedtext track succeeds or the video changes.

## Diagnostics

The content script emits structured `CAPTION_DIAGNOSTIC` messages at these boundaries: player response, caption-track discovery, English-track selection, timedtext download, timedtext parsing, visible-DOM fallback, and ready. Messages contain a stable stage, status, user-facing Traditional Chinese text, and only safe metadata such as track count, language codes, HTTP status, cue count, and source. They never contain an API key or full timedtext URL.

The side panel shows a compact diagnostic section. It stays collapsed on success, opens automatically on error or fallback, and provides a copy button. Refresh clears the previous run. A failed connection to the content script is shown explicitly instead of being swallowed.

## Visible Caption Fallback

The observer reads all currently visible `.ytp-caption-segment` nodes, normalizes whitespace, ignores empty and consecutive duplicate text, and records a cue at the current video time. Captured cues are sent through the existing `CAPTIONS_UPDATED` message so selection and later LLM queries continue to use the same transcript UI.

## Error Handling

`NO_CAPTIONS` remains the terminal result only when neither the primary path nor a currently visible caption can produce a cue. The panel maps each failure reason to a distinct message. Extension-context or missing-receiver failures instruct the user to hard-refresh the YouTube tab.

## Testing

Use strict TDD. Add focused tests for structured diagnostics, visible-caption capture and deduplication, fallback activation, side-panel automatic expansion/copy behavior, and connection failures. Run all tests, TypeScript checking, and production build.
