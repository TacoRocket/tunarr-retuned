import type { CondensedChannelProgram } from '@tunarr/types';
import type { LineupSchedule } from '@tunarr/types/api';
import { describe, expect, test } from 'vitest';
import {
  breakRecipes,
  breakStats,
  clockPaddingMinutes,
  hasMidRoll,
} from './adBreaks.ts';

const show = {
  type: 'content',
  id: 's',
  duration: 1,
} as CondensedChannelProgram;
const ad = (fillerListId: string) =>
  ({
    type: 'filler',
    id: 'a',
    duration: 1,
    fillerListId,
    fillerType: 'post',
  }) as CondensedChannelProgram;

const randomSchedule = (padMs: number, slots: object[]) =>
  ({ type: 'random', padMs, slots }) as unknown as LineupSchedule;

describe('ad breaks', () => {
  test('a break is a run of after-show clips between programs', () => {
    // A hand-edited lineup (no schedule): runs of two or more are breaks.
    const stats = breakStats(
      [show, ad('g'), ad('g'), ad('p'), show, ad('g'), ad('p'), show],
      undefined,
    );
    expect(stats.breaks).toBe(2);
    expect([stats.minAds, stats.maxAds]).toEqual([2, 3]);
    expect([...stats.adSpotsByPool]).toEqual([
      ['g', 3],
      ['p', 2],
    ]);
  });

  // Codex review of #259: a station ID from the same pool as a break, placed
  // by an ordinary post-roll, isn't a break.
  test("upstream's post-roll from a break's own pool isn't a break", () => {
    const stats = breakStats(
      [show, ad('p'), ad('p'), show, ad('p'), show],
      randomSchedule(1, [
        {
          type: 'show',
          postProgramPod: [{ fillerListIds: ['p'] }, { fillerListIds: ['p'] }],
        },
        { type: 'show', filler: [{ types: ['post'], fillerListId: 'p' }] },
      ]),
    );
    expect(stats.breaks).toBe(1);
    expect([...stats.adSpotsByPool]).toEqual([['p', 2]]);
  });

  test("upstream's post filler from other pools isn't a break", () => {
    const stats = breakStats(
      [show, ad('flex'), show, ad('g'), ad('g'), show],
      randomSchedule(1, [
        {
          type: 'show',
          postProgramPod: [{ fillerListIds: ['g'] }, { fillerListIds: ['g'] }],
        },
        { type: 'show', filler: [{ types: ['post'], fillerListId: 'flex' }] },
      ]),
    );
    expect(stats.breaks).toBe(1);
    expect([...stats.adSpotsByPool.keys()]).toEqual(['g']);
  });

  test('identical recipes on several slots read as one', () => {
    const pod = [{ fillerListIds: ['g'] }, { fillerListIds: ['p'], count: 2 }];
    const recipes = breakRecipes(
      randomSchedule(1, [
        { type: 'show', postProgramPod: pod },
        { type: 'flex' },
        { type: 'show', postProgramPod: pod },
        { type: 'show', postProgramPod: [{ fillerListIds: ['x'] }] },
      ]),
    );
    expect(recipes.map((r) => r.slots)).toEqual([[1, 3], [4]]);
  });

  test('clock padding is reported only when it is more than a second', () => {
    expect(clockPaddingMinutes(randomSchedule(1, []))).toBeNull();
    expect(clockPaddingMinutes(randomSchedule(30 * 60_000, []))).toBe(30);
    expect(clockPaddingMinutes(undefined)).toBeNull();
  });

  test('timed mid-roll breaks are noticed', () => {
    expect(
      hasMidRoll(
        randomSchedule(1, [{ type: 'show', midRoll: { maxBreaks: 2 } }]),
      ),
    ).toBe(true);
    expect(hasMidRoll(randomSchedule(1, [{ type: 'show' }]))).toBe(false);
  });
});
