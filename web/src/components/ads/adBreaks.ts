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

// A break is a run of saved after-show clips between programs. Upstream's
// own one-clip "post" filler looks the same in a saved lineup, so a
// Random Slots channel passes its recipe's pools and only those count.
export function breakStats(
  lineup: readonly CondensedChannelProgram[],
  onlyPools?: ReadonlySet<string>,
): BreakStats {
  const adSpotsByPool = new Map<string, number>();
  const sizes: number[] = [];
  let run = 0;
  for (const program of lineup) {
    if (
      program.type === 'filler' &&
      program.fillerType === 'post' &&
      (!onlyPools || onlyPools.has(program.fillerListId))
    ) {
      run++;
      adSpotsByPool.set(
        program.fillerListId,
        (adSpotsByPool.get(program.fillerListId) ?? 0) + 1,
      );
    } else if (run > 0) {
      sizes.push(run);
      run = 0;
    }
  }
  if (run > 0) sizes.push(run);
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
