# Critical Caption Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every caption track belongs to the active YouTube video and represent every sentence currently visible in one YouTube caption block as a synchronized, replayable active group.

**Architecture:** Add explicit caption-source and active-group metadata at the domain boundary. Validate both video identity and synchronization version across the page bridge, make the visible-DOM fallback emit atomic snapshots, and let the side panel render multiple current sentence rows from that snapshot instead of deriving one fallback row from playback time.

**Tech Stack:** TypeScript 5.5, Chrome Extension Manifest V3, React 18, Vitest 2, Testing Library, Vite 5.

## Global Constraints

- Keep one selectable transcript row per sentence.
- Use `source: 'timedtext'` for downloaded tracks and `source: 'visible-dom'` for fallback tracks.
- Never accept player data unless top-level video ID, nested video ID, current URL video ID, and synchronization version agree.
- Keep the existing 350 ms visible-caption emission delay.
- Do not change timed-text formats, punctuation overlap behavior, hidden-segment filtering, OpenAI behavior, or unrelated styling.
- Use TDD for every behavior change: red test, minimal implementation, green test.
- This workspace is not a Git repository (`git rev-parse` exits 128), so do not run commit commands. End every task with the listed verification checkpoint instead.

---

## File Structure

- Modify `src/domain/types.ts`: define `CaptionSource`, `ActiveCaptionGroup`, and the extended `CaptionTrack` contract.
- Modify `src/domain/content-message.typecheck.ts`: compile-check valid timed-text and visible-DOM track literals.
- Modify `src/content/youtube-captions.ts`: mark parsed downloaded tracks as timed-text.
- Modify `src/content/youtube-captions.test.ts`: verify the required source metadata.
- Modify `src/content/page-bridge.ts`: choose only exact-video player responses and echo the request version.
- Modify `src/content/page-bridge.test.ts`: cover stale SPA state, identity rejection, response sanitization, and retries.
- Modify `src/content/visible-caption-fallback.ts`: emit atomic cue-plus-active-group snapshots with non-zero timing.
- Modify `src/content/visible-caption-fallback.test.ts`: cover the screenshot sentence block, progressive blocks, new blocks, blank blocks, and delayed emission.
- Modify `src/content/content-script.ts`: correlate bridge responses, transport caption source/group metadata, and reject stale events.
- Modify `src/content/content-script.test.ts`: verify request correlation, stale-response rejection, and both caption sources.
- Modify `src/sidepanel/App.tsx`: keep source/group state, ignore playback-derived fallback focus, sanitize groups, and select replay time.
- Modify `src/sidepanel/App.test.tsx`: verify visible-group persistence, reset behavior, and replay semantics.
- Modify `src/sidepanel/components/TranscriptPanel.tsx`: accept multiple current IDs and center the active range as one block.
- Modify `src/sidepanel/components/TranscriptPanel.test.tsx`: verify multi-row current state, focus boundaries, no fabricated rows, replay, and original cue indices.
- Rebuild `dist/`: publish the tested source changes into the loadable extension directory.

---

### Task 1: Caption source and active-group domain contract

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/content-message.typecheck.ts`
- Modify: `src/content/youtube-captions.ts`
- Test: `src/content/youtube-captions.test.ts`

**Interfaces:**
- Consumes: existing `CaptionCue` and `CaptionTrack` users.
- Produces: `CaptionSource`, `ActiveCaptionGroup`, and a required `CaptionTrack.source`; `parseCaptionTrack()` returns `source: 'timedtext'`.

- [ ] **Step 1: Write the failing parser and compile-contract checks**

Add `source: 'timedtext'` to the expected object in the language acceptance test:

```ts
expect(parseCaptionTrack({ language, cues: [] })).toMatchObject({
  language,
  isEnglish: true,
  source: 'timedtext',
  cues: [],
});
```

Add concrete literals to `content-message.typecheck.ts`:

```ts
const timedTextTrack: CaptionTrack = {
  language: 'en',
  isEnglish: true,
  source: 'timedtext',
  cues: [],
};

const visibleTrack: CaptionTrack = {
  language: 'en-visible',
  isEnglish: true,
  source: 'visible-dom',
  cues: [{ id: 'visible-0', startMs: 1_000, endMs: 5_000, text: 'Visible sentence.' }],
  activeGroup: { cueIds: ['visible-0'], startMs: 1_000 },
};

void timedTextTrack;
void visibleTrack;
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm.cmd test -- src/content/youtube-captions.test.ts`

Expected: FAIL because `parseCaptionTrack()` does not return `source`.

- [ ] **Step 3: Add the domain types and timed-text source**

Change `CaptionTrack` in `src/domain/types.ts` to:

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

Return the required source in `parseCaptionTrack()`:

```ts
return {
  language: raw.language,
  isEnglish: true,
  source: 'timedtext',
  cues: [...uniqueCues.values()].sort((left, right) => left.startMs - right.startMs),
};
```

- [ ] **Step 4: Run the focused test and verify green**

Run: `npm.cmd test -- src/content/youtube-captions.test.ts`

Expected: all `youtube-captions` tests PASS.

- [ ] **Step 5: Record the Task 1 checkpoint**

Run: `npm.cmd test -- src/content/youtube-captions.test.ts`

Expected: PASS with no snapshot changes beyond the new source field.

---

### Task 2: Exact-video page bridge protocol

**Files:**
- Modify: `src/content/page-bridge.ts`
- Test: `src/content/page-bridge.test.ts`

**Interfaces:**
- Consumes: request `{ source, type: 'REQUEST_PLAYER_RESPONSE', videoId, requestVersion }`.
- Produces: response `{ source, type: 'PLAYER_RESPONSE', videoId, requestVersion, playerResponse: { videoDetails, captions } }` only for an exact matching video.

- [ ] **Step 1: Update protocol fixtures and write stale-SPA failing tests**

Add deterministic test helpers before the test cases:

```ts
function responseFor(videoId: string, baseUrl: string) {
  return {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          baseUrl,
          languageCode: 'en',
          name: { simpleText: 'English' },
        }],
      },
    },
    videoDetails: { videoId },
  };
}

function pageWindowFor(
  videoId: string,
  postMessage: ReturnType<typeof vi.fn>,
  additions: Record<string, unknown> = {},
): Window {
  return {
    ...window,
    ...additions,
    location: { href: `https://www.youtube.com/watch?v=${videoId}` },
    postMessage,
  } as unknown as Window;
}

function installMoviePlayer(response: object): void {
  const player = document.createElement('div');
  player.id = 'movie_player';
  (player as HTMLDivElement & { getPlayerResponse: () => object }).getPlayerResponse = () => response;
  document.body.append(player);
}
```

Give every bridge request a video ID and version:

```ts
const request = {
  source: bridgeSource,
  type: requestType,
  videoId: 'video-1',
  requestVersion: 7,
};
```

Expect the sanitized response to retain identity:

```ts
expect(postMessage).toHaveBeenCalledWith({
  source: bridgeSource,
  type: responseType,
  videoId: 'video-1',
  requestVersion: 7,
  playerResponse: {
    videoDetails: { videoId: 'video-1' },
    captions: playerResponse.captions,
  },
}, '*');
```

Add the stale-global/current-player regression:

```ts
it('prefers the current movie player over a stale SPA initial response', async () => {
  const oldResponse = responseFor('old-video', 'https://captions.test/old');
  const currentResponse = responseFor('video-1', 'https://captions.test/current');
  const postMessage = vi.fn();
  const pageWindow = pageWindowFor('video-1', postMessage, { ytInitialPlayerResponse: oldResponse });
  installMoviePlayer(currentResponse);

  const { createPageBridgeMessageHandler } = await import('./page-bridge');
  createPageBridgeMessageHandler(pageWindow, document)(new MessageEvent('message', {
    source: pageWindow,
    data: request,
  }));

  expect(postMessage.mock.calls[0][0].playerResponse.captions)
    .toEqual(currentResponse.captions);
});
```

Add table-driven rejection for absent/wrong nested video ID and invalid version:

```ts
it.each([
  ['missing identity', { captions: playerResponse.captions }, 7],
  ['wrong identity', responseFor('old-video', 'https://captions.test/old'), 7],
  ['invalid version', playerResponse, -1],
])('does not post %s', async (_label, response, requestVersion) => {
  setPlayerResponseScript(response);
  const postMessage = vi.fn();
  const pageWindow = pageWindowFor('video-1', postMessage);
  const { createPageBridgeMessageHandler } = await import('./page-bridge');

  createPageBridgeMessageHandler(pageWindow, document)(new MessageEvent('message', {
    source: pageWindow,
    data: { ...request, requestVersion },
  }));

  expect(postMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the bridge tests and verify red**

Run: `npm.cmd test -- src/content/page-bridge.test.ts`

Expected: FAIL because requests have no current identity contract and the stale initial response wins.

- [ ] **Step 3: Implement exact identity selection and version echo**

Extend the internal response type:

```ts
export type PlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
};
```

Add exact-candidate helpers:

```ts
function hasExactVideoIdentity(response: unknown, expectedVideoId: string): response is PlayerResponse {
  return isRecord(response)
    && isRecord(response.videoDetails)
    && response.videoDetails.videoId === expectedVideoId;
}

function hasUsableCaptions(response: unknown, expectedVideoId: string): response is PlayerResponse {
  return hasExactVideoIdentity(response, expectedVideoId)
    && Boolean(getCaptionTracks(response)?.length);
}
```

Change `getPagePlayerResponse()` to evaluate candidates in this order and return only exact matches:

```ts
const moviePlayer = pageDocument.getElementById('movie_player') as (HTMLElement & {
  getPlayerResponse?: () => unknown;
}) | null;
const liveCandidates = [
  moviePlayer?.getPlayerResponse?.(),
  typedWindow.ytplayer?.player?.getPlayerResponse?.(),
];
for (const candidate of liveCandidates) {
  if (hasUsableCaptions(candidate, expectedVideoId)) return candidate;
}

const parsedScriptResponses = Array.from(pageDocument.scripts)
  .map((script) => parsePlayerResponseScript(script.textContent ?? ''))
  .filter((response): response is PlayerResponse => response !== undefined);
const laterCandidates = [typedWindow.ytInitialPlayerResponse, ...parsedScriptResponses];
for (const candidate of laterCandidates) {
  if (hasUsableCaptions(candidate, expectedVideoId)) return candidate;
}
return undefined;
```

Validate the request before retrying:

```ts
if (typeof event.data.videoId !== 'string'
  || !Number.isInteger(event.data.requestVersion)
  || event.data.requestVersion < 0) return;

const requestedVideoId = event.data.videoId;
const requestVersion = event.data.requestVersion;
```

On every retry, require the page URL to remain on `requestedVideoId`. Post `videoId`, `requestVersion`, and sanitized `videoDetails` with the captions:

```ts
const respondIfReady = () => {
  const currentVideoId = new URL(pageWindow.location.href).searchParams.get('v');
  if (currentVideoId !== requestedVideoId) return;

  const response = getPagePlayerResponse(pageWindow, pageDocument, requestedVideoId);
  const captionTracks = getCaptionTracks(response);
  if (response && captionTracks?.length) {
    pageWindow.postMessage({
      source: PAGE_BRIDGE_SOURCE,
      type: PLAYER_RESPONSE,
      videoId: requestedVideoId,
      requestVersion,
      playerResponse: {
        videoDetails: { videoId: requestedVideoId },
        captions: { playerCaptionsTracklistRenderer: { captionTracks } },
      },
    }, '*');
    return;
  }

  if (attempts < retryCount) {
    attempts += 1;
    setTimeout(respondIfReady, retryDelayMs);
  }
};
```

- [ ] **Step 4: Run the bridge tests and verify green**

Run: `npm.cmd test -- src/content/page-bridge.test.ts`

Expected: all bridge protocol, stale-state, retry, and foreign-message tests PASS.

- [ ] **Step 5: Record the Task 2 checkpoint**

Run: `npm.cmd test -- src/content/page-bridge.test.ts`

Expected: PASS; no response is posted for an unidentified or stale video.

---

### Task 3: Atomic visible-caption snapshots and non-zero group timing

**Files:**
- Modify: `src/content/visible-caption-fallback.ts`
- Test: `src/content/visible-caption-fallback.test.ts`

**Interfaces:**
- Consumes: current visible YouTube caption text and current video time.
- Produces: `VisibleCaptionSnapshot = { cues, activeGroup? }` through `onSnapshotChanged`.

- [ ] **Step 1: Convert test callbacks to snapshots and add the screenshot regression**

Replace `onCuesChanged` test spies with `onSnapshotChanged`. Access the latest value with:

```ts
const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];
```

Add the exact three-sentence regression:

```ts
it('emits every sentence in one visible block as one non-zero active group', () => {
  vi.useFakeTimers();
  const segment = document.createElement('span');
  segment.className = 'ytp-caption-segment';
  segment.textContent = 'The rice patties are absolutely incredible. Stunning. They have a backdrop of incredible mountains, which is just so unique.';
  document.body.append(segment);
  const onSnapshotChanged = vi.fn();
  const fallback = createVisibleCaptionFallback({
    document,
    getCurrentTimeMs: () => 10_000,
    onSnapshotChanged,
  });

  fallback.captureNow();
  vi.advanceTimersByTime(350);

  const snapshot = latestSnapshot()!;
  expect(snapshot.cues.map((cue) => cue.text)).toEqual([
    'The rice patties are absolutely incredible.',
    'Stunning.',
    'They have a backdrop of incredible mountains, which is just so unique.',
  ]);
  expect(snapshot.cues.every((cue) => cue.endMs > cue.startMs)).toBe(true);
  expect(snapshot.activeGroup).toEqual({
    cueIds: ['visible-0', 'visible-1', 'visible-2'],
    startMs: 10_000,
  });
});
```

Add progressive and unrelated-block timing tests:

```ts
it('preserves a progressive block start and starts unrelated text at the new time', () => {
  vi.useFakeTimers();
  let currentTimeMs = 1_000;
  const segment = document.createElement('span');
  segment.className = 'ytp-caption-segment';
  document.body.append(segment);
  const onSnapshotChanged = vi.fn();
  const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });

  segment.textContent = 'We have';
  fallback.captureNow();
  currentTimeMs = 2_000;
  segment.textContent = 'We have beautiful rice patties.';
  fallback.captureNow();
  vi.advanceTimersByTime(350);
  expect(onSnapshotChanged.mock.calls.at(-1)?.[0].activeGroup.startMs).toBe(1_000);

  currentTimeMs = 5_000;
  segment.textContent = 'A completely unrelated sentence.';
  fallback.captureNow();
  vi.advanceTimersByTime(350);
  expect(onSnapshotChanged.mock.calls.at(-1)?.[0].activeGroup.startMs).toBe(5_000);
  vi.useRealTimers();
});
```

Add blank and repeated-text group-lifetime coverage:

```ts
it('clears a blank block and gives repeated later text a new group start', () => {
  vi.useFakeTimers();
  let currentTimeMs = 1_000;
  const segment = document.createElement('span');
  segment.className = 'ytp-caption-segment';
  segment.textContent = 'Repeated sentence.';
  document.body.append(segment);
  const onSnapshotChanged = vi.fn();
  const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });

  fallback.captureNow();
  vi.advanceTimersByTime(350);
  expect(onSnapshotChanged.mock.calls.at(-1)?.[0].activeGroup.startMs).toBe(1_000);

  currentTimeMs = 2_000;
  segment.textContent = '';
  expect(fallback.captureNow()).toBe(true);
  vi.advanceTimersByTime(350);
  expect(onSnapshotChanged.mock.calls.at(-1)?.[0].activeGroup).toBeUndefined();

  currentTimeMs = 6_000;
  segment.textContent = 'Repeated sentence.';
  expect(fallback.captureNow()).toBe(true);
  vi.advanceTimersByTime(350);
  expect(onSnapshotChanged.mock.calls.at(-1)?.[0].activeGroup.startMs).toBe(6_000);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run fallback tests and verify red**

Run: `npm.cmd test -- src/content/visible-caption-fallback.test.ts`

Expected: FAIL because the callback currently receives only an array and earlier same-capture cues are closed at their start time.

- [ ] **Step 3: Define the snapshot interface and continuity helpers**

Add:

```ts
import type { ActiveCaptionGroup, CaptionCue } from '../domain/types';

export type VisibleCaptionSnapshot = {
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};

type VisibleCaptionFallbackOptions = {
  document: Document;
  getCurrentTimeMs: () => number;
  onSnapshotChanged: (snapshot: VisibleCaptionSnapshot) => void;
};

function comparableText(text: string): string {
  return text.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTextContinuity(previous: string, next: string): boolean {
  const left = comparableText(previous);
  const right = comparableText(next);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  const maximum = Math.min(leftWords.length, rightWords.length);
  for (let size = maximum; size >= 1; size -= 1) {
    if (leftWords.slice(-size).join(' ') === rightWords.slice(0, size).join(' ')) return true;
  }
  return false;
}
```

- [ ] **Step 4: Make reconciliation return a contiguous active group without zero durations**

Track the current block separately:

```ts
let activeBlock: { text: string; startMs: number } | undefined;
let pendingSnapshot: VisibleCaptionSnapshot | undefined;
```

When creating a new sentence at the same group start, retain the prior cue's non-zero end:

```ts
const priorCue = getCues().at(-1);
if (priorCue && groupStartMs > priorCue.startMs) {
  priorCue.endMs = Math.max(priorCue.startMs + 1, groupStartMs);
}
cueGroups.push({
  text: segment.text,
  complete: segment.complete,
  cues: [createCue(segment.text, groupStartMs)],
});
```

Use explicit group-start and capture-time parameters during reconciliation:

```ts
function reconcileSegments(
  segments: CaptionSentence[],
  groupStartMs: number,
  captureTimeMs: number,
): void {
  for (const [index, segment] of segments.entries()) {
    const existingGroup = cueGroups[index];
    if (existingGroup) {
      updateGroup(existingGroup, segment, captureTimeMs);
      continue;
    }

    const priorCue = getCues().at(-1);
    if (priorCue && groupStartMs > priorCue.startMs) {
      priorCue.endMs = Math.max(priorCue.startMs + 1, groupStartMs);
    }
    cueGroups.push({
      text: segment.text,
      complete: segment.complete,
      cues: [createCue(segment.text, groupStartMs)],
    });
  }
}
```

Split the current block independently, reconcile the accumulated transcript, then map current sentences to the newest compatible cue without reusing an ID. If a current sentence has no compatible cue, append one at `activeBlock.startMs`. Sort the resulting IDs by their cue index and require them to form one contiguous cue slice before emitting:

```ts
function appendActiveCues(segments: CaptionSentence[], groupStartMs: number): string[] {
  return segments.map((segment) => {
    const cue = createCue(segment.text, groupStartMs);
    cueGroups.push({ text: segment.text, complete: segment.complete, cues: [cue] });
    return cue.id;
  });
}

function activeCueIdsFor(segments: CaptionSentence[], groupStartMs: number): string[] {
  const used = new Set<string>();
  const ids: string[] = [];
  for (const segment of segments) {
    const match = [...getCues()].reverse().find((cue) => {
      if (used.has(cue.id)) return false;
      const cueText = comparableText(cue.text);
      const segmentText = comparableText(segment.text);
      return cueText === segmentText || cueText.includes(segmentText) || segmentText.includes(cueText);
    });
    if (!match) return appendActiveCues(segments, groupStartMs);
    used.add(match.id);
    ids.push(match.id);
  }

  const cueOrder = new Map(getCues().map((cue, index) => [cue.id, index]));
  const orderedIds = ids.sort((left, right) => cueOrder.get(left)! - cueOrder.get(right)!);
  const indices = orderedIds.map((id) => cueOrder.get(id)!);
  const contiguous = indices.every((index, position) => (
    position === 0 || index === indices[position - 1] + 1
  ));
  return contiguous ? orderedIds : appendActiveCues(segments, groupStartMs);
}
```

- [ ] **Step 5: Emit the latest cues and group atomically, including blank transitions**

Use one delayed snapshot:

```ts
function scheduleEmission(activeGroup?: ActiveCaptionGroup): void {
  pendingSnapshot = {
    cues: getCues().map((cue) => ({ ...cue })),
    ...(activeGroup ? { activeGroup: { ...activeGroup, cueIds: [...activeGroup.cueIds] } } : {}),
  };
  if (emissionTimer !== null) window.clearTimeout(emissionTimer);
  emissionTimer = window.setTimeout(() => {
    emissionTimer = null;
    const snapshot = pendingSnapshot;
    pendingSnapshot = undefined;
    if (snapshot) options.onSnapshotChanged(snapshot);
  }, emissionDelayMs);
}
```

Replace `captureNow()` with the following flow. Pass `captureTimeMs` to `updateGroup()` for duration extension and `groupStartMs` to newly created cues:

```ts
function captureNow(): boolean {
  const text = readVisibleCaptionText(options.document);
  if (!text) {
    if (!lastSnapshot && !activeBlock) return false;
    lastSnapshot = '';
    activeBlock = undefined;
    scheduleEmission();
    return true;
  }
  if (text === lastSnapshot) return false;

  const captureTimeMs = Math.max(0, Math.round(options.getCurrentTimeMs()));
  if (!activeBlock || !hasTextContinuity(activeBlock.text, text)) {
    activeBlock = { text, startMs: captureTimeMs };
  } else {
    activeBlock.text = text;
  }

  const nextTranscript = !mergedTranscript
    ? text
    : mergeByWordOverlap(mergedTranscript, text) ?? `${mergedTranscript} ${text}`;
  if (nextTranscript !== mergedTranscript) {
    mergedTranscript = nextTranscript;
    reconcileSegments(
      splitCaptionText(mergedTranscript),
      activeBlock.startMs,
      captureTimeMs,
    );
  }

  const cueIds = activeCueIdsFor(splitCaptionText(text), activeBlock.startMs);
  lastSnapshot = text;
  scheduleEmission({ cueIds, startMs: activeBlock.startMs });
  return true;
}
```

- [ ] **Step 6: Run fallback tests and verify green**

Run: `npm.cmd test -- src/content/visible-caption-fallback.test.ts`

Expected: all existing rolling-caption tests and the new group/timing tests PASS.

- [ ] **Step 7: Record the Task 3 checkpoint**

Run: `npm.cmd test -- src/content/visible-caption-fallback.test.ts`

Expected: PASS; the screenshot block emits three current IDs and every cue has `endMs > startMs`.

---

### Task 4: Content-script correlation and caption snapshot transport

**Files:**
- Modify: `src/content/content-script.ts`
- Test: `src/content/content-script.test.ts`

**Interfaces:**
- Consumes: exact bridge responses from Task 2 and `VisibleCaptionSnapshot` from Task 3.
- Produces: `CAPTIONS_UPDATED` tracks with required `source` and optional validated `activeGroup`.

- [ ] **Step 1: Write failing correlation and transport tests**

Give the shared player fixture exact identity and make the bridge helper echo the latest request version:

```ts
const playerResponse = {
  videoDetails: { videoId: 'video-1' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{
        baseUrl: 'https://captions.test/track',
        languageCode: 'en',
      }],
    },
  },
};

function dispatchPageBridgeResponse(
  postMessage: ReturnType<typeof vi.fn>,
  override: Record<string, unknown> = {},
): void {
  const request = postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === 'REQUEST_PLAYER_RESPONSE')
    .at(-1);
  if (!request) throw new Error('Missing player-response request');
  const event = new MessageEvent('message', {
    data: {
      source: 'youtube-english-learning',
      type: 'PLAYER_RESPONSE',
      videoId: request.videoId,
      requestVersion: request.requestVersion,
      playerResponse,
      ...override,
    },
  });
  Object.defineProperty(event, 'source', { configurable: true, value: window });
  window.dispatchEvent(event);
}
```

Add a bridge assertion that the initial request carries the active video and synchronization version:

```ts
expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
  source: 'youtube-english-learning',
  type: 'REQUEST_PLAYER_RESPONSE',
  videoId: 'video-1',
  requestVersion: expect.any(Number),
}), '*');
```

Add this reusable fixture beside the existing content-script test helpers:

```ts
const matchingPlayerResponse = {
  videoDetails: { videoId: 'video-1' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{
        baseUrl: 'https://captions.test/video-1',
        languageCode: 'en',
        name: { simpleText: 'English' },
      }],
    },
  },
};
```

Dispatch a wrong-version response and verify no timed-text fetch occurs:

```ts
const playerRequest = postMessage.mock.calls
  .map(([message]) => message)
  .find((message) => message.type === 'REQUEST_PLAYER_RESPONSE');
if (!playerRequest) throw new Error('Missing player-response request');
const requestedVersion = playerRequest.requestVersion as number;

window.dispatchEvent(new MessageEvent('message', {
  source: window,
  data: {
    source: 'youtube-english-learning',
    type: 'PLAYER_RESPONSE',
    videoId: 'video-1',
    requestVersion: requestedVersion - 1,
    playerResponse: matchingPlayerResponse,
  },
}));
expect(fetch).not.toHaveBeenCalled();
```

In the timed-text and visible-fallback tests, extract the published track and assert its metadata:

```ts
const publishedMessages = sendMessage.mock.calls.map(([message]) => message as ContentMessage);
const timedTextMessage = publishedMessages.find((message) => (
  message.type === 'CAPTIONS_UPDATED' && message.track.source === 'timedtext'
));
expect(timedTextMessage?.type).toBe('CAPTIONS_UPDATED');
if (timedTextMessage?.type !== 'CAPTIONS_UPDATED') throw new Error('Missing timed-text message');
expect(timedTextMessage.track).toMatchObject({ source: 'timedtext' });

const visibleMessage = publishedMessages.find((message) => (
  message.type === 'CAPTIONS_UPDATED' && message.track.source === 'visible-dom'
));
expect(visibleMessage?.type).toBe('CAPTIONS_UPDATED');
if (visibleMessage?.type !== 'CAPTIONS_UPDATED') throw new Error('Missing visible-DOM message');
expect(visibleMessage.track).toMatchObject({
  source: 'visible-dom',
  activeGroup: { cueIds: ['visible-0', 'visible-1'], startMs: 10_000 },
});
```

Add exact boundary variants around the accepted event:

```ts
it.each(['top-level video', 'nested video', 'request version'])(
  'ignores a bridge response with mismatched %s',
  async (boundary) => {
  const playerRequest = postMessage.mock.calls
    .map(([message]) => message)
    .find((message) => message.type === 'REQUEST_PLAYER_RESPONSE');
  if (!playerRequest) throw new Error('Missing player-response request');
  const requestedVersion = playerRequest.requestVersion as number;
  const override = boundary === 'top-level video'
    ? { videoId: 'old-video' }
    : boundary === 'nested video'
      ? { playerResponse: { ...matchingPlayerResponse, videoDetails: { videoId: 'old-video' } } }
      : { requestVersion: requestedVersion - 1 };
  window.dispatchEvent(new MessageEvent('message', {
    source: window,
    data: {
      source: 'youtube-english-learning',
      type: 'PLAYER_RESPONSE',
      videoId: 'video-1',
      requestVersion: requestedVersion,
      playerResponse: matchingPlayerResponse,
      ...override,
    },
  }));
  await vi.advanceTimersByTimeAsync(200);
  expect(fetch).not.toHaveBeenCalled();
  },
);
```

Add the URL boundary test:

```ts
it('ignores a matching bridge payload after the page URL changes', async () => {
  const playerRequest = postMessage.mock.calls
    .map(([message]) => message)
    .find((message) => message.type === 'REQUEST_PLAYER_RESPONSE');
  if (!playerRequest) throw new Error('Missing player-response request');
  const requestedVersion = playerRequest.requestVersion as number;
  window.history.replaceState({}, '', '/watch?v=other-video');
  try {
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: {
        source: 'youtube-english-learning',
        type: 'PLAYER_RESPONSE',
        videoId: 'video-1',
        requestVersion: requestedVersion,
        playerResponse: matchingPlayerResponse,
      },
    }));
    await vi.advanceTimersByTimeAsync(200);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState({}, '', '/watch?v=video-1');
  }
});
```

- [ ] **Step 2: Run content-script tests and verify red**

Run: `npm.cmd test -- src/content/content-script.test.ts`

Expected: FAIL because bridge messages are uncorrelated and fallback messages do not carry source/group metadata.

- [ ] **Step 3: Correlate bridge responses to the active synchronization**

Use identity-bearing player-response types:

```ts
type PlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrackResponse[] };
  };
};

type CorrelatedPlayerResponse = {
  videoId: string;
  requestVersion: number;
  playerResponse: PlayerResponse;
};
```

Send correlated requests:

```ts
function requestPlayerResponse(videoId: string, requestVersion: number): void {
  window.postMessage({
    source: pageBridgeSource,
    type: requestPlayerResponseType,
    videoId,
    requestVersion,
  }, '*');
}
```

Accept document responses only through exact identity helpers. Change `getPlayerResponseFromDocument()` and its two discovery tests to require an expected video ID:

```ts
function hasExactVideoId(response: PlayerResponse | undefined, videoId: string): response is PlayerResponse {
  return response?.videoDetails?.videoId === videoId;
}

export function getPlayerResponseFromDocument(
  pageDocument: Document,
  fallback: PlayerResponse | undefined,
  expectedVideoId: string,
): PlayerResponse | undefined {
  for (const script of Array.from(pageDocument.scripts)) {
    const response = parsePlayerResponseScript(script.textContent ?? '');
    if (hasExactVideoId(response, expectedVideoId)) return response;
  }
  return hasExactVideoId(fallback, expectedVideoId) ? fallback : undefined;
}

function getPlayerResponse(videoId: string): PlayerResponse | undefined {
  const fallback = (window as Window & { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  return getPlayerResponseFromDocument(document, fallback, videoId);
}
```

Change `waitForPlayerResponse(videoId, requestVersion, requestFirst)` so every read calls `getPlayerResponse(videoId)` and every request calls `requestPlayerResponse(videoId, requestVersion)`.

Tighten the message guard and listener:

```ts
function isPlayerResponseMessage(message: unknown): message is CorrelatedPlayerResponse & {
  source: typeof pageBridgeSource;
  type: typeof playerResponseType;
} {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  const response = candidate.playerResponse as PlayerResponse | undefined;
  return candidate.source === pageBridgeSource
    && candidate.type === playerResponseType
    && typeof candidate.videoId === 'string'
    && Number.isInteger(candidate.requestVersion)
    && Number(candidate.requestVersion) >= 0
    && response?.videoDetails?.videoId === candidate.videoId;
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || !isPlayerResponseMessage(event.data)) return;
  if (getVideoId() !== event.data.videoId) return;
  if (event.data.requestVersion !== synchronizationVersion) return;
  void synchronizeVideo(false, false, event.data.playerResponse);
});
```

The version check rejects stale events. A valid response starts a new synchronization with that exact response supplied directly, so a legal response that arrives after the retry window is still processed. The older in-flight synchronization exits at its existing version checks.

- [ ] **Step 4: Pass the active version through synchronization**

Extend the existing synchronization signature with the supplied response parameter:

```diff
 async function synchronizeVideo(
   sendPlaybackAfter = false,
   requestPlayerResponseFirst = false,
+  suppliedPlayerResponse?: PlayerResponse,
 ): Promise<void> {
```

Replace its existing `waitForPlayerResponse` assignment with:

```ts
const playerResponse = hasExactVideoId(suppliedPlayerResponse, videoId)
  ? suppliedPlayerResponse
  : await waitForPlayerResponse(videoId, version, requestPlayerResponseFirst);
```

The existing version check immediately following that assignment remains unchanged. Remove the unversioned `requestPlayerResponse()` call and obsolete response cache clearing from `yt-navigate-finish`; `synchronizeVideo(false, true)` owns the new version and request.

- [ ] **Step 5: Transport timed-text and visible-DOM metadata**

Change the fallback callback to:

```ts
onSnapshotChanged: ({ cues, activeGroup }) => {
  if (version !== synchronizationVersion || getVideoId() !== videoId) return;
  captured = true;
  const readyDiagnostic = diagnosticMessage(videoId, {
    stage: 'ready',
    status: 'success',
    message: `已從畫面字幕取得 ${cues.length} 句。`,
    details: { cueCount: cues.length, source: 'visible-dom' },
  });
  const captionsUpdatedMessage: SynchronizableMessage = {
    type: 'CAPTIONS_UPDATED',
    videoId,
    videoTitle: getVideoTitle(),
    videoUrl: window.location.href,
    track: {
      language: 'en-visible',
      isEnglish: true,
      source: 'visible-dom',
      cues,
      ...(activeGroup ? { activeGroup } : {}),
    },
  };
  currentState = [videoChangedMessage, fallbackDiagnostic, readyDiagnostic, captionsUpdatedMessage];
  broadcastState(readyDiagnostic);
  broadcastState(captionsUpdatedMessage);
},
```

Downloaded tracks already receive `source: 'timedtext'` through Task 1. Update existing content-script test expectations and emitted fixture tracks to include the required source.

- [ ] **Step 6: Run content-script tests and verify green**

Run: `npm.cmd test -- src/content/content-script.test.ts`

Expected: all state replay, navigation, fallback, request correlation, and source/group tests PASS.

- [ ] **Step 7: Run all content-layer tests**

Run: `npm.cmd test -- src/content/page-bridge.test.ts src/content/visible-caption-fallback.test.ts src/content/content-script.test.ts src/content/youtube-captions.test.ts`

Expected: all content-layer tests PASS together with fake timers restored after each test.

- [ ] **Step 8: Record the Task 4 checkpoint**

Run: `npm.cmd test -- src/content/page-bridge.test.ts src/content/visible-caption-fallback.test.ts src/content/content-script.test.ts`

Expected: PASS; stale responses cannot publish or fetch captions.

---

### Task 5: Multi-row active group, focus layout, and replay behavior

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Test: `src/sidepanel/App.test.tsx`
- Modify: `src/sidepanel/components/TranscriptPanel.tsx`
- Test: `src/sidepanel/components/TranscriptPanel.test.tsx`

**Interfaces:**
- Consumes: `CaptionTrack.source`, `CaptionTrack.activeGroup`, and ordered `CaptionCue[]`.
- Produces: `TranscriptPanel.currentCueIds: string[]`; active visible-DOM replay uses group start, all other replay uses cue start.

- [ ] **Step 1: Update the TranscriptPanel test API and write multi-current failing tests**

Replace every `currentCueId` prop with `currentCueIds`, using `[]` or `[id]`. Add:

```tsx
it('centers and marks every cue in the current group', () => {
  render(
    <TranscriptPanel
      cues={focusCues}
      currentCueIds={['cue-3', 'cue-4', 'cue-5']}
      autoFollowPlayback
      onSelection={vi.fn()}
      onReplay={vi.fn()}
    />,
  );

  expect(screen.getByText('Cue three')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByText('Cue four')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByText('Cue five')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('region', { name: 'Transcript' })
    .querySelectorAll('[aria-current="true"]')).toHaveLength(3);
  expect(screen.getByText('Cue one')).toBeInTheDocument();
  expect(screen.getByText('Cue two')).toBeInTheDocument();
  expect(screen.getByText('Cue six')).toBeInTheDocument();
  expect(screen.getByText('Cue seven')).toBeInTheDocument();
});
```

Add an end-of-transcript case asserting that only real rows render:

```tsx
it('does not fabricate future rows after a group at the transcript end', () => {
  render(<TranscriptPanel
    cues={focusCues}
    currentCueIds={['cue-6', 'cue-7']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onReplay={vi.fn()}
  />);

  expect(screen.getAllByText(/^Cue /)).toHaveLength(4);
  expect(screen.getByText('Cue four')).toBeInTheDocument();
  expect(screen.getByText('Cue five')).toBeInTheDocument();
  expect(screen.getByText('Cue six')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByText('Cue seven')).toHaveAttribute('aria-current', 'true');
});
```

Add a selection test asserting a grouped row reports its original complete-transcript index:

```tsx
it('reports the full transcript index from a multi-row focus slice', () => {
  const onSelection = vi.fn();
  render(<TranscriptPanel
    cues={focusCues}
    currentCueIds={['cue-3', 'cue-4', 'cue-5']}
    autoFollowPlayback
    onSelection={onSelection}
    onReplay={vi.fn()}
  />);
  const cue = screen.getByText('Cue five');
  const range = document.createRange();
  range.selectNodeContents(cue);
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 20, width: 80, bottom: 110 } as DOMRect),
  });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.pointerUp(cue);

  expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({
    selectedText: 'Cue five',
    cueIndex: 4,
    sentence: 'Cue five',
  }));
});
```

- [ ] **Step 2: Run TranscriptPanel tests and verify red**

Run: `npm.cmd test -- src/sidepanel/components/TranscriptPanel.test.tsx`

Expected: FAIL because the component accepts one current ID and centers one row.

- [ ] **Step 3: Implement group-range focus without reordering rows**

Change the prop and derive exact current indices:

```ts
type Props = {
  cues: CaptionCue[];
  currentCueIds: string[];
  autoFollowPlayback: boolean;
  fontSize?: number;
  textColor?: string;
  onSelection: (selection: TranscriptSelection) => void;
  onReplay: (cue: CaptionCue) => void;
};

const currentIdSet = new Set(currentCueIds);
const currentIndices = orderedCues.flatMap((cue, index) => currentIdSet.has(cue.id) ? [index] : []);
const activeFirst = currentIndices.at(0) ?? -1;
const activeLast = currentIndices.at(-1) ?? -1;
```

Extend `CueEntry` with `region: 'past' | 'current' | 'future'`. Remember the last valid range and derive a real-row-only slice:

```ts
const lastFocusedRangeRef = useRef<{ firstId: string; lastId: string } | null>(null);
useLayoutEffect(() => {
  if (activeFirst >= 0 && activeLast >= activeFirst) {
    lastFocusedRangeRef.current = {
      firstId: orderedCues[activeFirst].id,
      lastId: orderedCues[activeLast].id,
    };
    return;
  }
  const remembered = lastFocusedRangeRef.current;
  if (!remembered || orderedCues.length === 0
    || !orderedCues.some((cue) => cue.id === remembered.firstId)
    || !orderedCues.some((cue) => cue.id === remembered.lastId)) {
    lastFocusedRangeRef.current = null;
  }
}, [activeFirst, activeLast, orderedCues]);

const remembered = lastFocusedRangeRef.current;
const rememberedFirst = remembered
  ? orderedCues.findIndex((cue) => cue.id === remembered.firstId)
  : -1;
const rememberedLast = remembered
  ? orderedCues.findIndex((cue) => cue.id === remembered.lastId)
  : -1;
const focusFirst = activeFirst >= 0 ? activeFirst : rememberedFirst;
const focusLast = activeLast >= 0 ? activeLast : rememberedLast;

const allEntries: CueEntry[] = orderedCues.map((cue, originalIndex) => {
  const region = focusFirst < 0 || originalIndex > focusLast
    ? 'future'
    : originalIndex < focusFirst ? 'past' : 'current';
  const state = currentIdSet.has(cue.id)
    ? 'current'
    : focusFirst >= 0 && originalIndex <= focusLast ? 'past' : 'future';
  return { cue, originalIndex, region, state };
});

const visibleEntries = autoFollowPlayback
  ? focusFirst < 0
    ? allEntries.slice(0, 5)
    : allEntries.slice(
      Math.max(0, focusFirst - 2),
      Math.min(allEntries.length, focusLast + 3),
    )
  : allEntries;
```

Render `aria-current="true"` only when `currentIdSet.has(cue.id)`. Set `data-cue-state` from `entry.state`. Filter the three layout regions from `entry.region`, preserving original cue order:

```ts
const pastEntries = visibleEntries.filter((entry) => entry.region === 'past');
const currentEntries = visibleEntries.filter((entry) => entry.region === 'current');
const futureEntries = visibleEntries.filter((entry) => entry.region === 'future');
```

- [ ] **Step 4: Run TranscriptPanel tests and verify green**

Run: `npm.cmd test -- src/sidepanel/components/TranscriptPanel.test.tsx`

Expected: existing one-current, gap, full-list, selection, replay, and new group tests PASS.

- [ ] **Step 5: Update the App mock and write visible-group failing tests**

Change the mocked TranscriptPanel signature in `App.test.tsx`:

```tsx
TranscriptPanel: ({ cues, onSelection, onReplay, currentCueIds, autoFollowPlayback }: {
  cues: CaptionCue[];
  onSelection: (selection: {
    selectedText: string;
    cueIndex: number;
    sentence: string;
    anchor: { x: number; y: number };
  }) => void;
  onReplay: (cue: CaptionCue) => void;
  currentCueIds: string[];
  autoFollowPlayback: boolean;
}) => <>
  <div data-testid="transcript-cues">{cues.map((cue) => cue.text).join(' ')}</div>
  <button type="button" onClick={() => onSelection({ selectedText: 'selected phrase', cueIndex: 0, sentence: 'A selected phrase.', anchor: { x: 10, y: 20 } })}>Select transcript text</button>
  <button type="button" onClick={() => onSelection({ selectedText: 'middle phrase', cueIndex: 1, sentence: 'Stale sentence.', anchor: { x: 10, y: 20 } })}>Select middle transcript text</button>
  <button type="button" onClick={() => cues[0] && onReplay(cues[0])}>Replay first cue</button>
  <button type="button" onClick={() => cues[1] && onReplay(cues[1])}>Replay second cue</button>
  <output data-testid="current-cues">{currentCueIds.join(',') || 'none'}</output>
  <output data-testid="auto-follow">{String(autoFollowPlayback)}</output>
</>,
```

Add a visible-DOM track with three active IDs, send a playback update outside their synthetic timing, and assert the group remains current:

```ts
const listener = registeredListeners[0];
const visibleCues = [
  { id: 'visible-0', startMs: 10_000, endMs: 14_000, text: 'First visible sentence.' },
  { id: 'visible-1', startMs: 10_000, endMs: 14_000, text: 'Second visible sentence.' },
  { id: 'visible-2', startMs: 10_000, endMs: 14_000, text: 'Third visible sentence.' },
];
await act(async () => listener({
  type: 'CAPTIONS_UPDATED',
  videoId: 'video-1',
  videoTitle: 'Video one',
  videoUrl: 'https://youtube.test/watch?v=video-1',
  track: {
    language: 'en-visible',
    isEnglish: true,
    source: 'visible-dom',
    cues: visibleCues,
    activeGroup: { cueIds: ['visible-0', 'visible-1', 'visible-2'], startMs: 10_000 },
  },
}));
await act(async () => listener({
  type: 'PLAYBACK_UPDATED',
  videoId: 'video-1',
  currentTimeMs: 20_000,
}));
expect(screen.getByTestId('current-cues')).toHaveTextContent('visible-0,visible-1,visible-2');
```

Add replay coverage for both active and inactive visible rows:

```ts
await user.click(screen.getByRole('button', { name: 'Replay first cue' }));
expect(sendMessage).toHaveBeenCalledWith(42, {
  type: 'SEEK_TO_TIME',
  timeMs: 10_000,
});

const historicalAndActiveCues = [
  { id: 'visible-old', startMs: 2_000, endMs: 6_000, text: 'Historical sentence.' },
  { id: 'visible-1', startMs: 10_000, endMs: 14_000, text: 'Second visible sentence.' },
  { id: 'visible-2', startMs: 10_000, endMs: 14_000, text: 'Third visible sentence.' },
];
await act(async () => listener({
  type: 'CAPTIONS_UPDATED',
  videoId: 'video-1',
  videoTitle: 'Video one',
  videoUrl: 'https://youtube.test/watch?v=video-1',
  track: {
    language: 'en-visible',
    isEnglish: true,
    source: 'visible-dom',
    cues: historicalAndActiveCues,
    activeGroup: { cueIds: ['visible-1', 'visible-2'], startMs: 10_000 },
  },
}));
await user.click(screen.getByRole('button', { name: 'Replay first cue' }));
expect(sendMessage).toHaveBeenLastCalledWith(42, {
  type: 'SEEK_TO_TIME',
  timeMs: 2_000,
});
```

Keep the existing timed-text replay test and add `source: 'timedtext'`; its expected time remains the cue's exact `startMs`.

Add reset and malformed-group coverage:

```ts
await act(async () => listener({
  type: 'CAPTIONS_UPDATED',
  videoId: 'video-1',
  videoTitle: 'Video one',
  videoUrl: 'https://youtube.test/watch?v=video-1',
  track: {
    language: 'en-visible',
    isEnglish: true,
    source: 'visible-dom',
    cues: visibleCues,
    activeGroup: {
      cueIds: ['missing', 'visible-1', 'visible-1', 'visible-2'],
      startMs: 10_000,
    },
  },
}));
expect(screen.getByTestId('current-cues')).toHaveTextContent('visible-1,visible-2');

await act(async () => listener({
  type: 'CAPTIONS_UPDATED',
  videoId: 'video-1',
  videoTitle: 'Video one',
  videoUrl: 'https://youtube.test/watch?v=video-1',
  track: {
    language: 'en-visible',
    isEnglish: true,
    source: 'visible-dom',
    cues: visibleCues,
    activeGroup: { cueIds: ['visible-0', 'visible-2'], startMs: 10_000 },
  },
}));
expect(screen.getByTestId('current-cues')).toHaveTextContent('none');

await act(async () => listener({
  type: 'VIDEO_CHANGED',
  videoId: 'video-2',
  videoTitle: 'Video two',
  videoUrl: 'https://youtube.test/watch?v=video-2',
}));
expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
```

In a separate test, send an accepted no-caption message and verify the group is cleared:

```ts
await act(async () => listener({
  type: 'CAPTIONS_UPDATED',
  videoId: 'video-1',
  videoTitle: 'Video one',
  videoUrl: 'https://youtube.test/watch?v=video-1',
  track: {
    language: 'en-visible',
    isEnglish: true,
    source: 'visible-dom',
    cues: visibleCues,
    activeGroup: { cueIds: ['visible-0', 'visible-1', 'visible-2'], startMs: 10_000 },
  },
}));
expect(screen.getByTestId('current-cues')).not.toHaveTextContent('none');

await act(async () => listener({
  type: 'NO_CAPTIONS',
  videoId: 'video-1',
  reason: 'not-found',
}));
expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
```

- [ ] **Step 6: Run App tests and verify red**

Run: `npm.cmd test -- src/sidepanel/App.test.tsx`

Expected: FAIL because `App` stores one playback-derived current cue and has no group replay rule.

- [ ] **Step 7: Store, sanitize, and route active caption state in App**

Add source/group state and a source ref used by the long-lived Chrome listener:

```ts
const [captionSource, setCaptionSource] = useState<CaptionSource | null>(null);
const [activeGroup, setActiveGroup] = useState<ActiveCaptionGroup | undefined>();
const captionSourceRef = useRef<CaptionSource | null>(null);
```

On `CAPTIONS_UPDATED`, set source and sanitize the group against the incoming cue array:

```ts
function sanitizeActiveGroup(track: CaptionTrack): ActiveCaptionGroup | undefined {
  if (track.source !== 'visible-dom' || !track.activeGroup) return undefined;
  const validIds = new Set(track.cues.map((cue) => cue.id));
  const cueOrder = new Map(track.cues.map((cue, index) => [cue.id, index]));
  const seen = new Set<string>();
  const cueIds = track.activeGroup.cueIds.filter((id) => {
    if (!validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const positions = cueIds.map((id) => cueOrder.get(id)!);
  const contiguous = positions.every((position, index) => (
    index === 0 || position === positions[index - 1] + 1
  ));
  return cueIds.length > 0
    && contiguous
    && Number.isFinite(track.activeGroup.startMs)
    ? { cueIds, startMs: Math.max(0, track.activeGroup.startMs) }
    : undefined;
}
```

Apply it in the message listener:

```ts
if (message.type === 'CAPTIONS_UPDATED') {
  captionSourceRef.current = message.track.source;
  setCaptionSource(message.track.source);
  setActiveGroup(sanitizeActiveGroup(message.track));
  setCues(message.track.cues);
  setCurrentCueId(null);
  setVideo({ id: message.videoId, title: message.videoTitle, url: message.videoUrl });
  setError(null);
  setRefreshing(false);
}
```

For `PLAYBACK_UPDATED`, calculate one cue only when `captionSourceRef.current === 'timedtext'`. Compute panel IDs as:

```ts
const currentCueIds = captionSource === 'visible-dom'
  ? activeGroup?.cueIds ?? []
  : currentCueId === null ? [] : [currentCueId];
```

Clear source, active group, and scalar current cue on video/no-caption reset with:

```ts
captionSourceRef.current = null;
setCaptionSource(null);
setActiveGroup(undefined);
setCurrentCueId(null);
```

Pass `currentCueIds` to `TranscriptPanel`.

Apply the replay rule:

```ts
const usesGroupStart = captionSource === 'visible-dom'
  && activeGroup?.cueIds.includes(cue.id);
const timeMs = usesGroupStart ? activeGroup.startMs : cue.startMs;
void chrome.tabs.sendMessage(activeTabId, {
  type: 'SEEK_TO_TIME',
  timeMs: Math.max(0, timeMs),
});
```

- [ ] **Step 8: Add required source fields to all App test track fixtures**

Use `source: 'timedtext'` for existing playback-derived fixtures. Use `source: 'visible-dom'` only in tests that supply an active fallback group. Keep all existing video/tab isolation assertions unchanged.

- [ ] **Step 9: Run side-panel tests and verify green**

Run: `npm.cmd test -- src/sidepanel/App.test.tsx src/sidepanel/components/TranscriptPanel.test.tsx`

Expected: all side-panel tests PASS, including three current rows and group-start replay.

- [ ] **Step 10: Record the Task 5 checkpoint**

Run: `npm.cmd test -- src/sidepanel/App.test.tsx src/sidepanel/components/TranscriptPanel.test.tsx`

Expected: PASS; visible fallback focus is group-driven and timed-text focus remains playback-driven.

---

### Task 6: Full regression, type safety, and loadable extension build

**Files:**
- Modify generated output: `dist/**`
- Verify: all source and test files changed in Tasks 1–5

**Interfaces:**
- Consumes: completed Critical patch.
- Produces: a type-safe, tested, rebuilt `dist` directory for Chrome's Load unpacked flow.

- [ ] **Step 1: Run the complete test suite**

Run: `npm.cmd test`

Expected: every Vitest test PASS with no unhandled promise or fake-timer warnings.

- [ ] **Step 2: Run TypeScript validation**

Run: `npm.cmd run typecheck`

Expected: exit code 0. Any remaining `CaptionTrack` fixture without required `source` is corrected to the source that matches its test behavior.

- [ ] **Step 3: Build production output**

Run: `npm.cmd run build`

Expected: Vite exits 0 and regenerates `dist/manifest.json`, `dist/src/sidepanel/index.html`, and hashed assets.

- [ ] **Step 4: Verify the built extension has all entry points**

Run:

```powershell
$required = @(
  'dist\manifest.json',
  'dist\service-worker-loader.js',
  'dist\src\sidepanel\index.html'
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing build output: $path" }
}
$manifest = Get-Content -Raw -LiteralPath 'dist\manifest.json' | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) { throw 'Built manifest is not MV3.' }
if (-not $manifest.side_panel.default_path) { throw 'Built manifest has no side-panel entry.' }
Write-Output 'DIST_SMOKE=PASS'
```

Expected: `DIST_SMOKE=PASS`.

- [ ] **Step 5: Run the Critical regression set once more after build**

Run: `npm.cmd test -- src/content/page-bridge.test.ts src/content/visible-caption-fallback.test.ts src/content/content-script.test.ts src/sidepanel/App.test.tsx src/sidepanel/components/TranscriptPanel.test.tsx`

Expected: PASS after the production build, proving generated output did not alter source behavior.

- [ ] **Step 6: Record the final checkpoint**

Record these exact results in the handoff:

```text
Full tests: PASS (<passed>/<total>)
Typecheck: PASS
Production build: PASS
Dist smoke: PASS
Git commit: unavailable because workspace is not a Git repository
```

The user can then reload the unpacked extension from `dist` and verify the same three-sentence YouTube caption block is highlighted as one centered group.
