# Transcript Focus Mode Design

## Goal

Keep the sentence currently spoken by the YouTube video visually stable and easy to find, while retaining enough nearby context for English learning.

## Approved interaction

- When automatic playback following is enabled, render a five-sentence focus window:
  - the two preceding cues;
  - the active cue;
  - the two following cues.
- The active cue occupies the visual center of the available transcript area, including near the beginning and end of the video.
- Preceding cues are visually de-emphasized more strongly than following cues.
- The active cue remains fully emphasized and keeps the configured active-cue color.
- Near the beginning or end of a transcript, render only cues that exist; do not create fake rows.
- During a short caption gap, keep the window anchored at the most recently active cue, but remove the active-state highlight until a cue becomes active again.
- Before the first playback position is received, show the first five cues without marking one active.
- When automatic playback following is disabled, render the complete transcript with the existing row behavior.

## Interaction invariants

- Every visible row remains selectable and replayable.
- Selecting a cue in the five-row window must preserve its index in the complete ordered transcript so LLM context uses the correct preceding and following cues.
- Clicking a row seeks to that cue's exact `startMs`.
- A playback update must never cause selection text, an open assistant, or a pending query to move to another cue.
- Switching videos or tabs resets the focus anchor along with the transcript.

## Component design

`TranscriptPanel` derives a stable ordered list once per cue update. In focus mode it derives visible entries containing both the cue and its original ordered index. This avoids treating the five-row slice index as the full-transcript index.

The focus layout has three regions: a top region that bottom-aligns up to two past cues, an auto-sized center region for the active cue, and a bottom region that top-aligns up to two future cues. The top and bottom regions remain as layout space when cues do not exist, but no fake interactive rows are rendered. This keeps the active cue centered even when row heights differ or playback is near a transcript boundary.

The panel remembers the last non-null active cue ID for gap handling. Rendering uses three visual states:

- `past`: reduced opacity;
- `current`: full opacity and active background;
- `future`: moderately reduced opacity.

No new storage setting is required. The existing `autoFollowPlayback` setting controls focus mode versus full-transcript mode.

## Styling

- Focus window uses a stable container and row spacing already consistent with the panel.
- Past cue opacity: 0.4.
- Current cue opacity: 1.
- Future cue opacity: 0.65.
- Use a short background/opacity transition, disabled by `prefers-reduced-motion`.
- Do not reduce text contrast for the current cue.

## Tests

- Focus mode renders at most two past, one current, and two future cues.
- Current cue has current styling; past and future cues have distinct styling.
- Beginning and end windows do not fail or fabricate cues.
- A null current cue preserves the last focus window but removes current styling.
- Full-transcript mode renders every cue.
- Selection from a sliced window reports the original full-transcript cue index.
- Replay from a sliced window sends the selected cue's exact timing.
- Existing tab isolation, playback, query-context, and transcript tests remain green.

## Out of scope

- Changing how YouTube captions are downloaded or parsed.
- Word-by-word karaoke highlighting.
- Combining multiple sentence cues into one large YouTube-style caption block.
- Adding another settings field or toolbar toggle.
