import { expect, test } from 'vitest';
import { isExemptNavigation } from './unsavedNavigation.ts';

const edit = (channelId: string) => ({
  fullPath: '/channels/$channelId/edit',
  params: { channelId },
});
const exempt = ['/channels/$channelId/edit'];

test("moving between the same channel's editor tabs doesn't prompt", () => {
  expect(isExemptNavigation(edit('702'), edit('702'), exempt)).toBe(true);
});

test("leaving one channel's editor for another channel's still prompts", () => {
  // An offset channel's "Open source channel" link goes 702 → 701.
  expect(isExemptNavigation(edit('702'), edit('701'), exempt)).toBe(false);
});

test('pages that are not listed always prompt', () => {
  expect(
    isExemptNavigation(
      edit('702'),
      { fullPath: '/channels', params: {} },
      exempt,
    ),
  ).toBe(false);
  expect(isExemptNavigation(edit('702'), edit('702'), undefined)).toBe(false);
});

test('index routes match with or without a trailing slash', () => {
  const add = (channelId: string) => ({
    fullPath: '/channels/$channelId/programming/add/',
    params: { channelId },
  });
  expect(
    isExemptNavigation(
      {
        fullPath: '/channels/$channelId/programming',
        params: { channelId: '7' },
      },
      add('7'),
      ['/channels/$channelId/programming/add'],
    ),
  ).toBe(true);
});
