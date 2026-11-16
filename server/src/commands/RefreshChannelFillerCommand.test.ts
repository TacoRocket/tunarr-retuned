import { describe, expect, test, vi } from 'vitest';
import type { LineupRepository } from '../db/channel/LineupRepository.ts';
import type { ContentItem } from '../db/derived_types/Lineup.ts';
import type { BlockGenerationService } from '../services/scheduling/BlockGenerationService.ts';
import { RefreshChannelFillerCommand } from './RefreshChannelFillerCommand.ts';

const gaming = '11111111-1111-4111-8111-111111111111';
const promos = '22222222-2222-4222-8222-222222222222';

const show = (id: string): ContentItem => ({
  type: 'content',
  id,
  durationMs: 1_200_000,
});
const ad = (id: string, fillerListId: string): ContentItem => ({
  type: 'content',
  id,
  durationMs: 30_000,
  fillerType: 'post',
  fillerListId,
});

function command(items: ContentItem[]) {
  const generate = vi.fn(
    (request: { entries: { positions: { fillerListIds: string[] }[] }[] }) => {
      const lineup = request.entries.flatMap((entry) =>
        entry.positions.map((position, i) => ({
          type: 'filler' as const,
          id: `new-${i}`,
          duration: 30_000,
          fillerListId: position.fillerListIds[0],
        })),
      );
      return Promise.resolve({ lineup, programs: {}, seed: [1] });
    },
  );
  const lineups = {
    loadChannelAndLineup: () =>
      Promise.resolve({ channel: { startTime: 0 }, lineup: { items } }),
    applyFillerRefresh: () =>
      Promise.resolve({
        matchedPositions: 0,
        refreshedPositions: 0,
        preservedCurrentIndex: null,
        durationMs: 1,
        startTime: 0,
      }),
  };
  const refresh = new RefreshChannelFillerCommand(
    lineups as unknown as LineupRepository,
    { generate } as unknown as BlockGenerationService,
  );
  return { refresh, generate };
}

describe('redrawing saved after-show ads', () => {
  // Each saved position used to be redrawn as a break of its own, so two
  // positions in the same break could get the same clip.
  test('redraws the positions of one break together, so they skip repeats', async () => {
    const { refresh, generate } = command([
      show('episode-1'),
      ad('a', gaming),
      ad('b', gaming),
      ad('c', promos),
      show('episode-2'),
      ad('d', gaming),
    ]);

    await refresh.execute('channel', { fillerListIds: [gaming] });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]?.[0].entries).toEqual([
      {
        type: 'break',
        positions: [{ fillerListIds: [gaming] }, { fillerListIds: [gaming] }],
      },
      { type: 'break', positions: [{ fillerListIds: [gaming] }] },
    ]);
  });
});
