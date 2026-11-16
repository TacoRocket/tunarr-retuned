import type {
  RefreshFillerRequest,
  RefreshFillerResult,
} from '@tunarr/types/api';
import { inject, injectable } from 'inversify';
import type { LineupRepository } from '../db/channel/LineupRepository.ts';
import { condensedProgramToLineupItem } from '../db/channel/lineupItemConversion.ts';
import { isContentItem, type ContentItem } from '../db/derived_types/Lineup.ts';
import { BlockGenerationService } from '../services/scheduling/BlockGenerationService.ts';
import { ScheduleValidationError } from '../types/errors.ts';
import { KEYS } from '../types/inject.ts';

@injectable()
export class RefreshChannelFillerCommand {
  constructor(
    @inject(KEYS.LineupRepository) private lineups: LineupRepository,
    @inject(BlockGenerationService) private blocks: BlockGenerationService,
  ) {}

  async execute(
    channelId: string,
    request: RefreshFillerRequest,
  ): Promise<RefreshFillerResult> {
    const original = await this.lineups.loadChannelAndLineup(channelId);
    if (!original)
      throw new ScheduleValidationError(`Channel ${channelId} does not exist`);
    if (
      original.lineup.onDemandConfig ||
      original.lineup.schedule?.type === 'time'
    ) {
      throw new ScheduleValidationError(
        'Filler refresh requires a looping channel without a time-slot schedule',
      );
    }

    const pools = new Set(request.fillerListIds);
    // Fork: a break is a run of saved after-show positions between programs.
    // Its positions are redrawn together so they skip clips already in the
    // break, as when the schedule was generated. Positions from pools not
    // being redrawn keep their clip and aren't counted against the others.
    const breaks: { index: number; poolId: string }[][] = [];
    let inBreak = false;
    for (const [index, item] of original.lineup.items.entries()) {
      const isPost = isContentItem(item) && item.fillerType === 'post';
      if (!isPost) {
        inBreak = false;
        continue;
      }
      if (!inBreak) {
        breaks.push([]);
        inBreak = true;
      }
      if (item.fillerListId && pools.has(item.fillerListId)) {
        breaks.at(-1)?.push({ index, poolId: item.fillerListId });
      }
    }
    const redrawn = breaks.filter((positions) => positions.length > 0);
    const positions = redrawn.flat();
    for (const poolId of pools) {
      if (!positions.some((position) => position.poolId === poolId)) {
        throw new ScheduleValidationError(
          `Pool ${poolId} has no saved after-show positions on this channel`,
        );
      }
    }

    const generated = await this.blocks.generate({
      entries: redrawn.map((positions) => ({
        type: 'break',
        positions: positions.map(({ poolId }) => ({ fillerListIds: [poolId] })),
      })),
      seed: request.seed,
    });
    const replacements = new Map<number, ContentItem>();
    for (const [offset, position] of positions.entries()) {
      const selected = generated.lineup[offset];
      if (
        !selected ||
        selected.type !== 'filler' ||
        selected.fillerListId !== position.poolId
      ) {
        throw new Error(
          `Block generation did not return filler for position ${position.index}`,
        );
      }
      const item = condensedProgramToLineupItem(selected);
      if (!isContentItem(item))
        throw new Error('Generated filler is not content');
      replacements.set(position.index, item);
    }

    return {
      ...(await this.lineups.applyFillerRefresh(
        channelId,
        original.lineup,
        original.channel.startTime,
        replacements,
      )),
      seed: generated.seed,
    };
  }
}
