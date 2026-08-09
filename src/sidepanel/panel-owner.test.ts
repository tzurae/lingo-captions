import { describe, expect, it } from 'vitest';
import { readOwnerTabId } from './panel-owner';

describe('readOwnerTabId', () => {
  it.each([
    ['?tabId=42', 42],
    ['', undefined],
    ['?tabId=-1', undefined],
    ['?tabId=1.5', undefined],
    ['?tabId=', undefined],
    ['?tabId=not-a-number', undefined],
  ])('returns %s as %s', (search, expected) => {
    expect(readOwnerTabId(search)).toBe(expected);
  });
});
