export type CaptionSentence = {
  text: string;
  complete: boolean;
};

const defaultMaxCharacters = 120;
const closingQuoteCharacters = new Set(['"', "'", '”', '’', '»']);

function appendForcedChunks(segment: CaptionSentence, maxCharacters: number): CaptionSentence[] {
  const chunks: CaptionSentence[] = [];
  let remaining = segment.text;

  while (remaining.length > maxCharacters) {
    const splitAt = remaining.lastIndexOf(' ', maxCharacters);
    if (splitAt <= 0) break;

    chunks.push({ text: remaining.slice(0, splitAt), complete: true });
    remaining = remaining.slice(splitAt + 1);
  }

  if (remaining) chunks.push({ text: remaining, complete: segment.complete });
  return chunks;
}

export function splitCaptionText(text: string, maxCharacters = defaultMaxCharacters): CaptionSentence[] {
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return [];

  const segments: CaptionSentence[] = [];
  let pendingText = '';
  let index = 0;

  function emitPending(complete: boolean): void {
    const normalizedPending = pendingText.trim();
    if (normalizedPending) segments.push({ text: normalizedPending, complete });
    pendingText = '';
  }

  while (index < normalizedText.length) {
    const character = normalizedText[index];
    if (character === '[') {
      const markerEnd = normalizedText.indexOf(']', index + 1);
      if (markerEnd !== -1) {
        emitPending(false);
        segments.push({ text: normalizedText.slice(index, markerEnd + 1), complete: true });
        index = markerEnd + 1;
        continue;
      }
    }

    pendingText += character;
    index += 1;
    if (!['.', '!', '?'].includes(character)) continue;

    while (['.', '!', '?'].includes(normalizedText[index] ?? '')) {
      pendingText += normalizedText[index];
      index += 1;
    }
    while (closingQuoteCharacters.has(normalizedText[index] ?? '')) {
      pendingText += normalizedText[index];
      index += 1;
    }
    emitPending(true);
  }

  emitPending(false);
  return segments.flatMap((segment) => appendForcedChunks(segment, maxCharacters));
}
