# Live Caption Hybrid Design

Date: 2026-08-09

## Goal

The blue current-caption rows must be an exact, continuously updated mirror of the subtitles that YouTube is rendering at that moment. When a rendered fragment grows from `that said` to `that said, I'm going to`, the existing row is updated in place with the same cue ID; a new row is not created merely because more words appeared.

When a complete timed-text track is available, the panel must continue to show historical and future transcript context. Future rows are read-only and cannot be selected or replayed. Historical rows remain selectable and replayable.

## Caption sources

### Timed-text track

The extension first attempts to download and parse the complete English caption track. A successful track supplies the ordered transcript and cue timing for historical and future context.

### Rendered-DOM snapshot

The currently rendered YouTube caption window supplies the authoritative blue text. Only rendered caption windows and rendered `.ytp-caption-segment` elements are read; hidden, detached, transparent, or non-layout caption nodes are excluded.

DOM snapshots never create future captions. If timed text is unavailable, the extension exposes only committed history plus the current rendered group.

## Hybrid state model

The content layer maintains three logically separate collections:

- `committed`: caption rows that have already left the YouTube screen.
- `live`: one or more rows whose combined text exactly matches the currently rendered YouTube caption block.
- `future`: timed-text cues whose start time is later than the current playback position. This collection exists only when a complete timed-text track is available.

Historical and live rows must not share mutable text objects. Updating a live fragment cannot rewrite an already committed historical row.

## Live-row reconciliation

For every rendered-DOM snapshot:

1. Read only visible caption segments and normalize whitespace.
2. Split the visible block into the sentence rows currently shown on screen.
3. Reconcile those rows against the existing live group by position and text continuity.
4. If a row grows by prefix extension, update its text in place and preserve its ID and start time.
5. If another sentence becomes visible in the same block, append a second live row while preserving existing live-row IDs.
6. If text rolls left, preserve IDs only for rows that still correspond to rendered text; rows that have left the screen are committed to history.
7. A blank screen or an unrelated caption block commits the previous live group and starts a new live group at the current playback time.
8. Every emitted active-group ID must reference a live cue whose text is exactly one of the current rendered rows. Substring containment must never activate a longer historical cue.

The combined text of the active group must therefore equal the current YouTube caption block after whitespace normalization.

## Panel interaction

### Historical rows

- Display with the historical/past color.
- Use `cursor: pointer`.
- Permit text selection and LLM lookup.
- Permit click or keyboard replay at the cue start time.

### Current rows

- Display with the active blue background.
- Permit text selection and LLM lookup.
- Progressive text updates mutate the same rendered row rather than creating a new row.
- Replay continues to use the active-group start time.

### Future rows

- Display with the future color.
- Do not use a pointer cursor.
- Disable click and keyboard replay.
- Disable text selection and LLM lookup.
- Remain visible only when supplied by a complete timed-text track.

## Mode behavior

### Complete timed text plus rendered DOM

- Timed text provides the complete ordered transcript and future rows.
- Rendered DOM overrides only the active display text.
- Playback timing partitions the timed-text track into historical and future context.
- The live DOM group is inserted between historical and future context without mutating the downloaded track.

### Visible-DOM fallback only

- Committed DOM rows provide history.
- The live DOM group provides current blue rows.
- No future rows are shown because no reliable future data exists.

### DOM temporarily absent

- Clear the live active group after the caption screen becomes blank.
- Keep committed history.
- When timed text exists, retain its read-only future context and use timing as non-blue context; do not fabricate blue text that is not on screen.

## Data boundaries

- Content-script messages must identify whether a complete timed-text track is available and carry the exact live snapshot separately from immutable transcript cues.
- The side panel must not infer current live text by substring matching against history.
- Tab ID, video ID, and synchronization-version isolation remain unchanged.
- Navigation or extension refresh clears live reconciliation state for the previous video.

## Testing

TDD coverage must demonstrate:

1. `that said` changing to `that said, I'm going to` updates the same live cue ID and does not append a row.
2. The active group text exactly equals the rendered caption text at each snapshot.
3. A historical cue containing the current fragment plus additional words cannot be marked current.
4. Hidden or non-rendered YouTube caption windows do not enter live text, history, or the active group.
5. A blank or unrelated block commits the previous live row and starts a new live row.
6. Timed-text mode retains future context while the DOM supplies exact blue text.
7. DOM-only fallback has no future rows.
8. Historical and current text can be selected; future text cannot.
9. Historical rows replay and show a pointer cursor; future rows do neither.
10. Existing tab/video isolation, OpenAI selection menu, settings, and history behavior remain green.

## Non-goals

- Predicting future subtitles when the complete timed-text track is unavailable.
- Changing OpenAI prompts, settings storage, or query history.
- Replacing YouTube's caption timing or synthesizing captions from audio.
- Refactoring unrelated side-panel components.

## Acceptance criteria

- Blue text is never ahead of the YouTube-rendered caption text.
- Progressive caption growth updates the same row in place.
- Future captions remain available only from complete timed text and are visibly read-only.
- Historical captions remain selectable, replayable, and show a pointer cursor.
- The extension builds as a loadable Manifest V3 package and passes the focused regressions, full tests, typecheck, and production build.
