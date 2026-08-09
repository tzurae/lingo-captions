import { describe, expect, it } from 'vitest';
import { calculateAssistantPosition } from './assistant-position';

describe('calculateAssistantPosition', () => {
  it('centers the popup above the anchor when it fits', () => {
    expect(calculateAssistantPosition(
      { x: 200, y: 200 },
      { width: 100, height: 50 },
      { width: 500, height: 400 },
    )).toEqual({ left: 150, top: 142, placement: 'above' });
  });

  it('clamps a horizontally left-overflowing popup to the inset', () => {
    expect(calculateAssistantPosition(
      { x: 20, y: 100 },
      { width: 150, height: 40 },
      { width: 500, height: 300 },
    )).toEqual({ left: 16, top: 52, placement: 'above' });
  });

  it('clamps a horizontally right-overflowing popup to the inset boundary', () => {
    expect(calculateAssistantPosition(
      { x: 490, y: 100 },
      { width: 100, height: 40 },
      { width: 500, height: 300 },
    )).toEqual({ left: 384, top: 52, placement: 'above' });
  });

  it('places the popup below when the above position clips and below has more space', () => {
    expect(calculateAssistantPosition(
      { x: 200, y: 20 },
      { width: 100, height: 50 },
      { width: 500, height: 400 },
    )).toEqual({ left: 150, top: 28, placement: 'below' });
  });

  it('clamps a below placement to the bottom boundary when neither side fully fits', () => {
    expect(calculateAssistantPosition(
      { x: 200, y: 100 },
      { width: 100, height: 100 },
      { width: 500, height: 200 },
    )).toEqual({ left: 150, top: 84, placement: 'below' });
  });

  it('places a popup wider than the available viewport space at the horizontal inset', () => {
    expect(calculateAssistantPosition(
      { x: 150, y: 100 },
      { width: 500, height: 40 },
      { width: 300, height: 200 },
    )).toEqual({ left: 16, top: 52, placement: 'above' });
  });

  it('places a popup taller than the available viewport space at the vertical inset', () => {
    expect(calculateAssistantPosition(
      { x: 200, y: 100 },
      { width: 100, height: 300 },
      { width: 500, height: 200 },
    )).toEqual({ left: 150, top: 16, placement: 'below' });
  });
});
