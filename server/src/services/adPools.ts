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
    schedule?: {
      type: string;
      slots?: readonly {
        type: string;
        postProgramPod?: readonly { fillerListIds: readonly string[] }[];
      }[];
    };
  };
};

/**
 * Fork: the ad pools page. A pool is a filler list that ad breaks draw from:
 * one linked to a Smart Collection, or one a channel's break recipe or saved
 * breaks use. Upstream's own one-clip "post" filler looks the same in a saved
 * lineup, so only pods count:
 * - Random Slots: the pools in the recipe, and their saved ad spots.
 * - A lineup edited by hand (no schedule): its saved after-show clips, which
 *   only an earlier generated schedule leaves behind.
 * - Time Slots: none; they fill slots to the clock and refuse pods.
 * Channels that play another channel later are skipped: their breaks are
 * their source's.
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
    const recipe = new Set<string>();
    for (const slot of lineup.schedule?.slots ?? []) {
      for (const position of slot.postProgramPod ?? []) {
        for (const listId of position.fillerListIds) {
          recipe.add(listId);
          use(listId, channel).inRecipe = true;
        }
      }
    }
    for (const item of lineup.items) {
      if (
        item.type === 'content' &&
        item.fillerType === 'post' &&
        item.fillerListId &&
        (!lineup.schedule || recipe.has(item.fillerListId))
      ) {
        use(item.fillerListId, channel).adSpots++;
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
