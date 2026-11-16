// Fork: which clips in a saved lineup belong to an ad break (an after-show
// pod), so the Ad Pools and Ad Breaks pages count, and Redraw changes, the
// same clips.
//
// A saved clip only records "after-show clip from this filler list". A pod's
// clips and upstream's ordinary one-clip post-roll look the same, even when
// they share a list, so a run of after-show clips between programs counts as
// a break only when its shape proves it is one:
// - Random Slots: the run matches a break recipe spot by spot. A lone clip an
//   ordinary post-roll on the same schedule could have placed is left alone.
// - A lineup edited by hand (no schedule): the run has two or more clips.
//   Upstream's post-roll is always a single clip.
// - Time Slots: none. They refuse pods.

export type PodLineupClip = {
  // An after-show clip and the filler list it came from; anything else
  // (a program, flex, other filler) ends a run.
  afterShowPool: string | null;
};

export type PodSchedule =
  | {
      type: string;
      slots?: readonly {
        type: string;
        postProgramPod?: readonly {
          fillerListIds: readonly string[];
          count?: number;
        }[];
        filler?: readonly {
          types: readonly string[];
          fillerListId: string;
        }[];
      }[];
    }
  | null
  | undefined;

// Each break as the lineup indexes of its clips.
export function podBreaks(
  clips: readonly PodLineupClip[],
  schedule: PodSchedule,
): number[][] {
  if (schedule?.type === 'time') return [];

  const runs: number[][] = [];
  let run: number[] | null = null;
  clips.forEach((clip, index) => {
    if (clip.afterShowPool) {
      if (!run) runs.push((run = []));
      run.push(index);
    } else {
      run = null;
    }
  });

  if (!schedule) return runs.filter((r) => r.length >= 2);

  const slots = schedule.slots ?? [];
  // Each recipe as the pools allowed at each spot, counts expanded.
  const recipes = slots.flatMap((slot) =>
    slot.postProgramPod?.length
      ? [
          slot.postProgramPod.flatMap((position) =>
            Array.from(
              { length: position.count ?? 1 },
              () => new Set(position.fillerListIds),
            ),
          ),
        ]
      : [],
  );
  // Pools an ordinary post-roll draws from on slots without a break.
  const postRollPools = new Set(
    slots.flatMap((slot) =>
      slot.postProgramPod?.length
        ? []
        : (slot.filler ?? [])
            .filter((filler) => filler.types.includes('post'))
            .map((filler) => filler.fillerListId),
    ),
  );

  return runs.filter((r) => {
    const pool = (spot: number) => clips[r[spot]!]!.afterShowPool!;
    const matches = recipes.some(
      (recipe) =>
        recipe.length === r.length &&
        recipe.every((allowed, spot) => allowed.has(pool(spot))),
    );
    return matches && !(r.length === 1 && postRollPools.has(pool(0)));
  });
}
