# Sentence Transcript and Selection Popover Design

**Date:** 2026-08-04

## Goal

Make the side-panel transcript useful for English study: show one readable sentence per row, replay the matching audio by clicking a row, keep recovered diagnostics collapsed, and show query actions in a compact popover beside highlighted text.

## Confirmed behavior

- Visible YouTube rolling captions are accumulated without repeated words, then split at `.`, `!`, or `?` into one caption cue per sentence.
- A bracketed sound marker such as `[music]` is its own cue.
- An unfinished sentence remains one live row while YouTube progressively adds words.
- If speech has no punctuation, split at a word boundary after either 12 seconds or 120 characters so the transcript cannot grow into one large paragraph.
- Each cue keeps the timestamp from when its first words were observed. When a following cue appears, the prior cue ends at the new cue's start.
- Clicking a cue seeks the active YouTube video to 500 ms before its start (clamped to zero) and immediately plays it.
- Selecting text must not also trigger replay.
- The currently playing cue remains highlighted and auto-follow continues to scroll it into view.
- Caption diagnostics auto-open only while the newest diagnostic is `error` or `fallback`. A later `success` closes the diagnostics, while the user may still open it manually.
- Highlighting transcript text opens a fixed-position compact popover beside the selection. The first level contains `翻譯整句`, `解釋選取文字`, `文法分析`, and `更多`; the remaining actions appear only after `更多` is chosen.
- The popover does not repeat the complete selected text. It closes after choosing an action, on Escape, on outside click, or when the video/tab changes.

## Architecture

The visible-caption fallback remains the owner of rolling-caption reconciliation and emits normal `CaptionCue` records. A pure sentence-splitting helper produces punctuation and length boundaries; the fallback supplies the 12-second boundary and stable timestamps. The side panel sends a `SEEK_TO_TIME` tab message for replay, while the content script owns the actual video seek and `play()` call. Selection geometry travels from `TranscriptPanel` to `SelectionMenu` as viewport coordinates, keeping query creation independent of the popover layout.

## Testing

- Unit tests reproduce progressive captions, left-shifted captions, punctuation splits, bracket markers, and forced no-punctuation splits.
- Component tests verify click-to-replay, selection/replay separation, selection coordinates, compact action disclosure, and diagnostic recovery.
- Integration tests verify that the side panel targets the active tab and that the content script seeks 500 ms early and plays.
- The complete Vitest suite, TypeScript check, and Vite extension build must pass before delivery.
