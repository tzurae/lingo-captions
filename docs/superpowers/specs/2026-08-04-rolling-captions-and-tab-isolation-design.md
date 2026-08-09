# Rolling Captions and Tab Isolation Design

## Goal

The visible-caption fallback must produce a readable, selectable transcript without progressive-prefix duplicates, and the side panel must always display the currently active YouTube tab only.

## Rolling caption model

YouTube updates visible captions word by word and later removes words from the left. Treat each DOM reading as a rolling snapshot, not a completed cue. Merge snapshots by finding the longest word-level overlap between the suffix of the accumulated transcript and the prefix of the new snapshot. A snapshot already contained in the accumulated transcript adds nothing. A snapshot with no useful overlap starts a new passage.

The fallback updates one current cue instead of appending a cue for every mutation. Emission is debounced for 350 ms so rapid word updates cause one panel render. The current cue keeps its original start time and extends its end time as text grows. A new cue is created only when the snapshot has no overlap with the active cue after a 1,500 ms gap.

## Playback synchronization and selection

When cue intervals overlap, the panel selects the latest matching cue rather than the earliest. Reducing render frequency and replacing the active cue in place prevents the transcript DOM from continuously growing while the user highlights text.

## Tab and video isolation

The side panel listens to `chrome.tabs.onActivated`. On activation it resets the selected video, cues, selection, diagnostics, and playback marker, then requests state from the newly active tab. Runtime messages are accepted only when `sender.tab.id` matches the active tab.

Within the same active tab, a `VIDEO_CHANGED` message with a new video ID is authoritative and resets the selected video ID. Messages from a different tab or stale non-navigation messages remain ignored.

## Testing

Use strict TDD. Cover progressive extension, rolling-window overlap, no-overlap passage creation, debounce behavior, latest overlapping cue selection, active-tab changes, stale-tab rejection, and same-tab YouTube navigation. Run the full test suite, TypeScript checker, and production build.
