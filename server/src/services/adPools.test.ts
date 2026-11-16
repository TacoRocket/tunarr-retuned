import { describe, expect, test } from 'vitest';
import { adPools } from './adPools.ts';

const list = (uuid: string, smartCollectionId: string | null = null) => ({
  uuid,
  name: uuid,
  smartCollectionId,
  smartCollectionName: smartCollectionId ? 'Ads: Retro Gaming' : null,
  clipCount: 10,
});
const channel = (uuid: string, number: number, offset?: string) => ({
  uuid,
  number,
  name: `Channel ${number}`,
  offsetSourceChannelId: offset ?? null,
});
const show = { type: 'content' };
const ad = (fillerListId: string) => ({
  type: 'content',
  fillerType: 'post',
  fillerListId,
});

describe('ad pools', () => {
  test('lists linked pools and pools that breaks use, with their channels', () => {
    const pools = adPools(
      [
        list('gaming', 'tag-search'),
        list('promos'),
        list('channel-flex'),
        list('recipe-only'),
      ],
      [
        {
          channel: channel('a', 4),
          lineup: {
            items: [show, ad('gaming'), ad('promos'), show, ad('gaming')],
            schedule: {
              type: 'random',
              slots: [
                {
                  type: 'custom-show',
                  postProgramPod: [
                    { fillerListIds: ['gaming'] },
                    { fillerListIds: ['promos', 'recipe-only'] },
                  ],
                },
              ],
            },
          },
        },
        // Plays channel 4 later: its breaks are channel 4's.
        {
          channel: channel('b', 5, 'a'),
          lineup: { items: [show, ad('gaming')] },
        },
        // Upstream's one-clip post filler on a Time Slots schedule.
        {
          channel: channel('t', 6),
          lineup: {
            items: [show, ad('channel-flex')],
            schedule: { type: 'time', slots: [{ type: 'show' }] },
          },
        },
        // A Random Slots slot with upstream's post filler and no pod.
        {
          channel: channel('r', 7),
          lineup: {
            items: [show, ad('channel-flex')],
            schedule: { type: 'random', slots: [{ type: 'show' }] },
          },
        },
        // Hand-edited: saved breaks from an earlier schedule still count.
        {
          channel: channel('m', 8),
          lineup: { items: [show, ad('promos'), ad('promos')] },
        },
      ],
    );

    expect(pools.map((p) => p.id)).toEqual(['gaming', 'promos', 'recipe-only']);
    // Only the first run matches the two-spot recipe; the lone clip after the
    // second show isn't a break.
    expect(pools[0]?.channels).toEqual([
      { id: 'a', number: 4, name: 'Channel 4', adSpots: 1, inRecipe: true },
    ]);
    expect(pools[1]?.channels.map((c) => [c.number, c.adSpots])).toEqual([
      [4, 1],
      [8, 2],
    ]);
    expect(pools[2]?.channels).toEqual([
      { id: 'a', number: 4, name: 'Channel 4', adSpots: 0, inRecipe: true },
    ]);
  });

  test('a linked pool nothing uses yet is still listed', () => {
    expect(adPools([list('new', 'tag-search')], [])).toEqual([
      {
        id: 'new',
        name: 'new',
        clipCount: 10,
        smartCollectionId: 'tag-search',
        smartCollectionName: 'Ads: Retro Gaming',
        channels: [],
      },
    ]);
  });

  // Codex review of #259: an ordinary post-roll from a pool a break also uses
  // isn't an ad spot.
  test("counts only the break, not upstream's post-roll from the same pool", () => {
    const pools = adPools(
      [list('promos')],
      [
        {
          channel: channel('a', 4),
          lineup: {
            items: [show, ad('promos'), ad('promos'), show, ad('promos')],
            schedule: {
              type: 'random',
              slots: [
                {
                  type: 'show',
                  postProgramPod: [
                    { fillerListIds: ['promos'] },
                    { fillerListIds: ['promos'] },
                  ],
                },
                {
                  type: 'show',
                  filler: [{ types: ['post'], fillerListId: 'promos' }],
                },
              ],
            },
          },
        },
      ],
    );
    expect(pools[0]?.channels[0]?.adSpots).toBe(2);
  });
});
