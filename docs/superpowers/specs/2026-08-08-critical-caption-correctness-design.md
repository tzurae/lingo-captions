# Critical Caption Correctness Design

## Goal

Fix the three Critical failures in the caption pipeline without redesigning the rest of the extension:

1. a YouTube single-page navigation must never reuse caption metadata from the previously viewed video;
2. sentences visible together in one YouTube caption block must not receive zero-length or contradictory timing;
3. the side panel must represent that visible block as one active group while retaining one selectable sentence per row.

This is the approved **Scheme A**: keep sentence rows, but group and highlight every sentence currently shown together by YouTube.

## User-visible behavior

- If YouTube displays three sentences in one caption block, the extension shows three sentence rows and marks all three as current.
- The complete current group is vertically centered in focus mode. Up to two prior rows appear above it and up to two future rows appear below it when those rows exist.
- Every sentence remains independently selectable for translation, explanation, grammar analysis, and other queries.
- Clicking any sentence in a current visible-DOM group seeks to the start of that group because YouTube does not expose reliable sentence-level timing through this fallback.
- Clicking an older visible-DOM sentence or a downloaded timed-text cue seeks to that cue's own `startMs`.
- A visible-DOM group remains current until the YouTube caption block changes or disappears; a synthetic four-second cue end must not remove its highlight.
- When a video changes, the old transcript and active group are cleared before any new caption response is accepted.

## Scope

### Included

- Exact video-identity validation across the page bridge and content script.
- Current visible-caption group metadata and stable group replay time.
- Non-zero timing for multiple sentences discovered in the same DOM snapshot.
- Multiple current rows in `App` and `TranscriptPanel`.
- Focus-window centering for a current group of one or more rows.
- Automated regression tests for these behaviors.

### Excluded from this change

- Adding support for additional YouTube timed-text response formats.
- Improving punctuation-sensitive word-overlap merging.
- Filtering hidden `.ytp-caption-segment` nodes.
- Performance work for the accumulated visible transcript.
- General debounce tuning.
- Restyling unrelated controls or changing OpenAI behavior.

Those excluded issues remain valid follow-up work, but they must not expand this Critical patch.

## Caption data contract

Add explicit source and active-group metadata to the domain model:

```ts
export type CaptionSource = 'timedtext' | 'visible-dom';

export type ActiveCaptionGroup = {
  cueIds: string[];
  startMs: number;
};

export type CaptionTrack = {
  language: string;
  isEnglish: boolean;
  source: CaptionSource;
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};
```

Invariants:

- `source` is required so downstream code cannot guess how a track was produced.
- A downloaded timed-text track uses `source: 'timedtext'` and omits `activeGroup`.
- A visible-DOM track uses `source: 'visible-dom'` and includes the latest active group when a caption block is visible.
- `activeGroup.cueIds` contains only IDs present in the same track's `cues` array, in cue order, without duplicates, and identifies one contiguous slice of that array.
- `activeGroup.startMs` is finite and non-negative.
- An empty or disappeared YouTube caption block clears `activeGroup`; it does not delete previously captured cues.
- `CAPTIONS_UPDATED` remains the transport message and carries the extended `CaptionTrack` atomically, so cues and their active group cannot arrive out of sync.

## Exact video ownership at the page bridge

The bridge request and response must identify the requested video:

```ts
type PlayerResponseRequest = {
  source: typeof PAGE_BRIDGE_SOURCE;
  type: typeof REQUEST_PLAYER_RESPONSE;
  videoId: string;
  requestVersion: number;
};

type PlayerResponseMessage = {
  source: typeof PAGE_BRIDGE_SOURCE;
  type: typeof PLAYER_RESPONSE;
  videoId: string;
  requestVersion: number;
  playerResponse: {
    videoDetails: { videoId: string };
    captions: PlayerResponse['captions'];
  };
};
```

The page bridge follows this selection order:

1. read `movie_player.getPlayerResponse()`;
2. use `ytplayer.player.getPlayerResponse()` only when the movie-player response is unavailable;
3. inspect `window.ytInitialPlayerResponse` and parsed script responses only as later candidates.

Every candidate must contain `videoDetails.videoId === request.videoId`. A response with caption tracks but no matching video ID is rejected. The bridge never falls back to an unidentified response. `requestVersion` must be a non-negative integer; the page bridge echoes it unchanged so the isolated-world content script can associate the response with the synchronization that requested it.

Before posting a response, the bridge also verifies that the current page URL still has the requested `v` parameter. The posted response includes the validated video ID and only the sanitized video identity and caption-track fields required by the extension.

The content script applies a second boundary check:

- a bridge response is accepted only when its top-level `videoId`, nested `videoDetails.videoId`, current URL video ID, active synchronization video ID, and `requestVersion` all match the pending synchronization;
- a navigation increments the existing synchronization version, clears previous synchronized caption state, and issues a new bridge request containing the new video ID;
- a late response from an earlier synchronization version is ignored even if it arrives during retries.

An accepted response is supplied directly to a fresh synchronization, which invalidates the older in-flight attempt through the existing version checks. This also permits an exact response that arrives after the polling window to replace the visible-DOM fallback without accepting stale data.

If no exact-identity response becomes available, the existing diagnostics and visible-DOM fallback path run. Old or unidentified captions are never treated as a usable fallback.

## Visible-DOM snapshot and active-group model

The visible fallback callback becomes snapshot-based instead of returning cues alone:

```ts
type VisibleCaptionSnapshot = {
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};

onSnapshotChanged(snapshot: VisibleCaptionSnapshot): void;
```

For every capture:

1. Read and normalize the current YouTube caption block.
2. Split that current block into sentences separately from the accumulated transcript.
3. Reconcile those sentences into the accumulated cue list and return the exact cue IDs assigned to the current block.
4. Emit those IDs together as one `activeGroup`.

The reconciler owns the ID mapping. A current-block sentence reuses the newest compatible cue when its normalized text is equal to, extends, or is extended by that cue's text. Each cue ID can be assigned at most once within a snapshot. A sentence with no compatible cue creates a new cue. The emitted group therefore never relies on the side panel to infer grouping from timestamps or text.

### Group lifetime

- The first non-empty block starts a group at the current rounded video time.
- Progressive DOM mutations belong to the same group while the new block and previous block share normalized word overlap or one block contains the other. The original group `startMs` remains stable.
- A non-empty block with no such continuity starts a new group at the current rounded video time.
- An empty block clears the active group and resets snapshot continuity. This permits identical text to become a new group if it appears again after a blank interval.

### Cue timing

- Every newly created cue starts at the current group's `startMs`.
- Its initial `endMs` is `startMs + 4_000`.
- Creating a second or third sentence during the same capture must not close a preceding cue at the same timestamp.
- A previous cue is closed at a new group's start only when that start is greater than the cue's own `startMs`; otherwise its existing non-zero end is retained.
- Cue timing remains an approximation for transcript order and replay of historical fallback rows. The active group's explicit `startMs`, not an individual cue's synthetic end, controls current highlighting and replay.

The 350 ms emission delay remains unchanged in this patch. Each delayed emission contains the latest cues and active group from the same fallback state.

## Side-panel state and playback rules

`App` stores the caption source and active group from `CAPTIONS_UPDATED` in addition to the ordered cues.

Current row IDs are selected by source:

- `visible-dom`: use the validated IDs from `activeGroup.cueIds`; `PLAYBACK_UPDATED` must not replace them with a single timestamp-derived cue;
- `timedtext`: derive at most one current cue from playback time using the existing timed-text behavior.

Before using a visible active group, `App` filters out unknown or duplicate cue IDs while preserving cue order. If no valid IDs remain, no row is current. `VIDEO_CHANGED` and `NO_CAPTIONS` clear source, cues, active group, and focus anchor together.

`TranscriptPanel` replaces the scalar `currentCueId` input with `currentCueIds: string[]` and treats the IDs as one ordered current range.

In focus mode it renders:

- up to two cues before the first current cue;
- every cue in the current group;
- up to two cues after the last current cue.

All rows in the group receive current styling and `aria-current="true"`. The layout centers the group as a block rather than centering only its last sentence. Missing prior or future cues do not produce fake rows or placeholders. When no current group exists, the existing last-focus behavior anchors the window, but no row receives current styling.

Selection continues to report each cue's index from the complete ordered transcript. Query context therefore remains sentence-based and unchanged.

Replay uses this deterministic rule:

- if the selected cue belongs to the current visible-DOM active group, send `SEEK_TO_TIME` with `activeGroup.startMs`;
- otherwise send the selected cue's `startMs`.

## Failure handling and diagnostics

- A mismatched or missing player-response video ID is recorded as a player-response diagnostic and proceeds to the existing fallback path.
- A malformed active group is sanitized by discarding invalid IDs; it must not crash rendering.
- A visible-DOM snapshot with cues but no active block remains a valid historical transcript with no current highlight.
- A timed-text track must not be published until exact video identity is established.

## Test requirements

### Page bridge and content isolation

- With an old `window.ytInitialPlayerResponse` and a current matching `movie_player` response, the bridge returns the current video's track.
- A candidate with captions but the wrong, absent, or stale `videoDetails.videoId` is rejected.
- A bridge response for the previous synchronization version is ignored after navigation.
- A response whose top-level, nested, URL, or active video IDs disagree is ignored.

### Visible fallback

- Capturing `The rice patties are absolutely incredible. Stunning. They have a backdrop of incredible mountains, which is just so unique.` in one snapshot emits three cues, one active group containing all three IDs, and no zero-length cue.
- Progressive text updates preserve the active group's original start time.
- A no-overlap block starts a new group.
- A blank block clears the group; the same later text can form a new group.
- Delayed emission returns matching cues and active-group IDs from the latest state.

### Side panel

- All three IDs in a visible-DOM active group receive current styling and accessibility state.
- Focus mode centers the full current group and includes at most two real prior and two real future rows.
- With no future cues, no placeholder rows are rendered.
- Playback updates do not collapse a visible-DOM group to one current row.
- Clicking any active group row seeks to the group start; clicking an inactive row seeks to that cue's start.
- Selection still reports the full-transcript index and produces unchanged sentence-level LLM context.
- A timed-text track continues to highlight and replay one current cue using exact cue timing.

### Regression gate

- All existing tests, type checking, production build, and extension smoke checks must pass after fixture updates for the required `source` field.

## Acceptance criteria

The patch is accepted when the screenshot scenario produces three individually selectable current rows for the three sentences YouTube shows together, none of those cues has zero duration, clicking any of them replays the beginning of that visible block, and navigating between two videos cannot display or fetch the previous video's caption track.
