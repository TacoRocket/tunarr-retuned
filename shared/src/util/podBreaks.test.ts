import { describe, expect, test } from 'vitest';
import { podBreaks } from './podBreaks.js';

const show = { afterShowPool: null };
const ad = (pool: string) => ({ afterShowPool: pool });
const pod = (...pools: string[][]) => ({
  type: 'show',
  postProgramPod: pools.map((fillerListIds) => ({ fillerListIds })),
});
const postRoll = (pool: string) => ({
  type: 'show',
  filler: [{ types: ['post'], fillerListId: pool }],
});

describe('pod breaks', () => {
  test('Random Slots: a run counts when it matches a recipe spot by spot', () => {
    const clips = [show, ad('g'), ad('p'), show, ad('p'), ad('g'), show];
    expect(
      podBreaks(clips, { type: 'random', slots: [pod(['g'], ['p'])] }),
    ).toEqual([[1, 2]]);
  });

  test('a recipe count expands to that many spots', () => {
    const clips = [show, ad('g'), ad('g'), ad('g'), show];
    expect(
      podBreaks(clips, {
        type: 'random',
        slots: [
          {
            type: 'show',
            postProgramPod: [{ fillerListIds: ['g'], count: 3 }],
          },
        ],
      }),
    ).toEqual([[1, 2, 3]]);
  });

  test("upstream's lone post-roll from a break's pool is left alone", () => {
    const clips = [show, ad('p'), ad('p'), show, ad('p'), show];
    const slots = [pod(['p'], ['p']), postRoll('p')];
    expect(podBreaks(clips, { type: 'random', slots })).toEqual([[1, 2]]);
    // A one-spot recipe and a post-roll from the same pool can't be told
    // apart, so neither is a break.
    expect(
      podBreaks([show, ad('p'), show], {
        type: 'random',
        slots: [pod(['p']), postRoll('p')],
      }),
    ).toEqual([]);
  });

  test('a hand-edited lineup counts runs of two or more', () => {
    const clips = [show, ad('p'), ad('g'), show, ad('p'), show];
    expect(podBreaks(clips, undefined)).toEqual([[1, 2]]);
  });

  test('Time Slots have no breaks', () => {
    expect(
      podBreaks([show, ad('p'), ad('p')], { type: 'time', slots: [] }),
    ).toEqual([]);
  });
});
