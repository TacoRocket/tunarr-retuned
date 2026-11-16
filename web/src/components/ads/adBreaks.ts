import { podBreaks } from '@tunarr/shared/util';
import type { CondensedChannelProgram } from '@tunarr/types';
import type { LineupSchedule, PostProgramPod } from '@tunarr/types/api';

// Fork: ad breaks are a few whole clips played in a row after each show,
// then back to the show. These read a channel's saved lineup and schedule.

export type BreakStats = {
  breaks: number;
  minAds: number;
  maxAds: number;
  // Ad spots per pool (filler list ID), in the saved breaks.
  adSpotsByPool: Map<string, number>;
};

// The saved breaks, by the rule Redraw and the Ad Pools page use
// (podBreaks): upstream's ordinary post-roll looks the same in a saved lineup
// and isn't counted, and Time Slots have none.
export function breakStats(
  lineup: readonly CondensedChannelProgram[],
  schedule: LineupSchedule | undefined,
): BreakStats {
  const clips = lineup.map((program) => ({
    afterShowPool:
      program.type === 'filler' && program.fillerType === 'post'
        ? program.fillerListId
        : null,
  }));
  const breaks = podBreaks(clips, schedule);
  const adSpotsByPool = new Map<string, number>();
  for (const index of breaks.flat()) {
    const pool = clips[index]?.afterShowPool;
    if (!pool) continue;
    adSpotsByPool.set(pool, (adSpotsByPool.get(pool) ?? 0) + 1);
  }
  const sizes = breaks.map((run) => run.length);
  return {
    breaks: sizes.length,
    minAds: sizes.length ? Math.min(...sizes) : 0,
    maxAds: sizes.length ? Math.max(...sizes) : 0,
    adSpotsByPool,
  };
}

export type BreakRecipe = {
  positions: PostProgramPod;
  // 1-based numbers of the slots that use this recipe.
  slots: number[];
};

// The break recipes on a Random Slots schedule, with identical recipes
// grouped, so the common case reads as one break after every show.
export function breakRecipes(
  schedule: LineupSchedule | undefined,
): BreakRecipe[] {
  if (schedule?.type !== 'random') return [];
  const byRecipe = new Map<string, BreakRecipe>();
  schedule.slots.forEach((slot, index) => {
    if (!('postProgramPod' in slot) || !slot.postProgramPod) return;
    const key = JSON.stringify(slot.postProgramPod);
    const existing = byRecipe.get(key);
    if (existing) existing.slots.push(index + 1);
    else
      byRecipe.set(key, { positions: slot.postProgramPod, slots: [index + 1] });
  });
  return [...byRecipe.values()];
}

// Show slots on the schedule (anything but flex or redirect).
export function showSlotCount(schedule: LineupSchedule | undefined) {
  return (schedule?.slots ?? []).filter(
    (slot) => slot.type !== 'flex' && slot.type !== 'redirect',
  ).length;
}

// Minutes the schedule pads to on the clock, or null when it doesn't. Ad
// break channels run with the smallest pad Tunarr allows (1 ms).
export function clockPaddingMinutes(schedule: LineupSchedule | undefined) {
  if (!schedule || schedule.padMs <= 1000) return null;
  return Math.round(schedule.padMs / 60_000);
}

export function hasMidRoll(schedule: LineupSchedule | undefined) {
  return (schedule?.slots ?? []).some(
    (slot) => 'midRoll' in slot && !!slot.midRoll,
  );
}
