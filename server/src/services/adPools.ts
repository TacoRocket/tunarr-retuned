import { podBreaks, type PodSchedule } from '@tunarr/shared/util';
import type { AdPool, AdPoolChannel } from '@tunarr/types/api';

type PoolList = {
  uuid: string;
  name: string;
  smartCollectionId: string | null;
  smartCollectionName: string | null;
  clipCount: number;
};

type ChannelLineup = {
  channel: {
    uuid: string;
    number: number;
    name: string;
    offsetSourceChannelId?: string | null;
  };
  lineup: {
    items: readonly {
      type: string;
      fillerType?: string;
      fillerListId?: string;
    }[];
    schedule?: PodSchedule;
  };
};

/**
 * Fork: the ad pools page. A pool is a filler list that ad breaks draw from:
 * one linked to a Smart Collection, or one a channel's break recipe or saved
 * breaks use. Saved ad spots are counted with podBreaks, the rule Redraw and
 * the Ad Breaks page use, so upstream's ordinary post-roll isn't counted;
 * Time Slots, which refuse pods, are skipped. Channels that play another
 * channel later are skipped too: their breaks are their source's.
 */
export function adPools(
  lists: readonly PoolList[],
  lineups: readonly ChannelLineup[],
): AdPool[] {
  const usage = new Map<string, Map<string, AdPoolChannel>>();
  const use = (listId: string, channel: ChannelLineup['channel']) => {
    let channels = usage.get(listId);
    if (!channels)
      usage.set(listId, (channels = new Map<string, AdPoolChannel>()));
    let entry = channels.get(channel.uuid);
    if (!entry) {
      entry = {
        id: channel.uuid,
        number: channel.number,
        name: channel.name,
        adSpots: 0,
        inRecipe: false,
      };
      channels.set(channel.uuid, entry);
    }
    return entry;
  };

  for (const { channel, lineup } of lineups) {
    if (channel.offsetSourceChannelId) continue;
    if (lineup.schedule?.type === 'time') continue;
    for (const slot of lineup.schedule?.slots ?? []) {
      for (const position of slot.postProgramPod ?? []) {
        for (const listId of position.fillerListIds) {
          use(listId, channel).inRecipe = true;
        }
      }
    }
    const clips = lineup.items.map((item) => ({
      afterShowPool:
        item.type === 'content' && item.fillerType === 'post'
          ? (item.fillerListId ?? null)
          : null,
    }));
    for (const run of podBreaks(clips, lineup.schedule)) {
      for (const index of run) {
        use(clips[index]!.afterShowPool!, channel).adSpots++;
      }
    }
  }

  return lists
    .filter((list) => list.smartCollectionId || usage.has(list.uuid))
    .map((list) => ({
      id: list.uuid,
      name: list.name,
      clipCount: list.clipCount,
      smartCollectionId: list.smartCollectionId,
      smartCollectionName: list.smartCollectionName,
      channels: [...(usage.get(list.uuid)?.values() ?? [])].sort(
        (a, b) => a.number - b.number,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
