import { describe, expect, it } from 'vitest';
import { splitCaptionText } from './caption-sentences';

describe('splitCaptionText', () => {
  it('separates terminal-punctuation sentences', () => {
    expect(splitCaptionText("We've got oats. Sliced banana! Really?")).toEqual([
      { text: "We've got oats.", complete: true },
      { text: 'Sliced banana!', complete: true },
      { text: 'Really?', complete: true },
    ]);
  });

  it('emits bracketed sound markers as complete segments', () => {
    expect(splitCaptionText('[music]')).toEqual([
      { text: '[music]', complete: true },
    ]);
  });

  it('retains an unfinished tail as an incomplete segment', () => {
    expect(splitCaptionText('We will add the')).toEqual([
      { text: 'We will add the', complete: false },
    ]);
  });

  it('forces a completed chunk at the last word boundary within 120 characters', () => {
    const text = 'aaaaaaaaaaa bbbbbbbbbbb ccccccccccc ddddddddddd eeeeeeeeeee fffffffffff ggggggggggg hhhhhhhhhhh iiiiiiiiiii jjjjjjjjjjj z';

    expect(splitCaptionText(text)).toEqual([
      { text: 'aaaaaaaaaaa bbbbbbbbbbb ccccccccccc ddddddddddd eeeeeeeeeee fffffffffff ggggggggggg hhhhhhhhhhh iiiiiiiiiii jjjjjjjjjjj', complete: true },
      { text: 'z', complete: false },
    ]);
  });

  it('keeps closing quotes with their terminal punctuation', () => {
    expect(splitCaptionText('She said "Stop!" Then left.')).toEqual([
      { text: 'She said "Stop!"', complete: true },
      { text: 'Then left.', complete: true },
    ]);
  });

});
