import type { CaptionCue } from './types';

export type QueryContext = {
  selectedText: string;
  sentence: string;
  contextBefore: string[];
  contextAfter: string[];
};

export function buildQueryContext(request: {
  selectedText: string;
  cueIndex: number;
  cues: CaptionCue[];
  contextLines: number;
}): QueryContext {
  if (!request.selectedText.trim()) {
    throw new Error('Selected text cannot be empty');
  }

  if (
    !Number.isInteger(request.cueIndex) ||
    !Number.isFinite(request.cueIndex) ||
    request.cueIndex < 0 ||
    request.cueIndex >= request.cues.length
  ) {
    throw new Error('Caption cue index is out of range');
  }

  if (request.contextLines < 0) {
    throw new Error('Context lines cannot be negative');
  }

  return {
    selectedText: request.selectedText,
    sentence: request.cues[request.cueIndex].text,
    contextBefore: request.cues
      .slice(Math.max(0, request.cueIndex - request.contextLines), request.cueIndex)
      .map((cue) => cue.text),
    contextAfter: request.cues
      .slice(request.cueIndex + 1, request.cueIndex + 1 + request.contextLines)
      .map((cue) => cue.text),
  };
}
