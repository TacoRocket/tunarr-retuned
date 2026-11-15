import { bindingScopeValues, injectable } from 'inversify';
import type { StreamLineupItem } from '../../db/derived_types/StreamLineup.ts';
import type { ChannelOrm } from '../../db/schema/Channel.ts';
import type { Maybe } from '../../types/util.ts';
import { MutexMap } from '../../util/mutexMap.ts';

export type BreakAnswer = {
  lineupItem: StreamLineupItem;
  channelContext: ChannelOrm;
};

type BreakAiring = BreakAnswer & {
  /** Channel-clock span the answer covers. */
  startMs: number;
  finishMs: number;
  /** Wall clock after which no worker can still ask about it. */
  expiresAtMs: number;
};

/**
 * Up to 44s of transcode lead plus a joining worker's first ask. Kept past the
 * span on wall clock, so a pause on an on-demand channel only shortens reuse.
 */
const RetainAfterSpanMs = 60_000;

/** Bounds a channel whose schedule is all sub-second filler. */
const MaxAiringsPerChannel = 64;

/**
 * What a channel's breaks are airing, shared by every worker session of it.
 *
 * An fMP4 channel runs two workers, the HLS one and its MPEG-TS copy, and
 * each asks the dynamic callback what plays. Filler in a break is picked at
 * random under repeat cooldowns, so asking twice can give two answers: the
 * first records the play and the cooldown then refuses that clip to the
 * second. The copy is a second delivery of the same airing, not a second
 * airing, so the first answer stands for the span it covers and any later ask
 * inside that span gets the same item at the elapsed position.
 *
 * Only picked filler is kept: it is the one answer that depends on who asked
 * first. Programs, the fallback clip and the offline screen are read off the
 * schedule and answer the same for every worker, and they can span hours, so
 * keeping them would hold an edited lineup back from a worker that starts
 * later. A kept pick lasts one clip at most. Credit-squeeze ads have their own
 * plan per airing in `CreditSqueezeAdPlanner`.
 *
 * In memory only: the workers are Tunarr's child processes and do not outlive
 * it, so nothing is left to agree with after a restart.
 */
@injectable(bindingScopeValues.Singleton)
export class EtvNextBreakAirings {
  #airings = new Map<string, BreakAiring[]>();
  #locks = new MutexMap();

  /**
   * Runs one channel's resolution at a time, so concurrent first asks from
   * both workers share one pick rather than racing to two.
   */
  async runExclusive<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
    return this.#locks.runWithLockId(channelId, fn);
  }

  /** The kept answer covering `scheduleMs`, advanced to that position. */
  find(
    channelId: string,
    scheduleMs: number,
    nowMs: number,
  ): Maybe<BreakAnswer> {
    const airing = this.#live(channelId, nowMs).find(
      (a) => a.startMs <= scheduleMs && scheduleMs < a.finishMs,
    );
    if (!airing) {
      return;
    }
    return {
      lineupItem: advanceBy(airing.lineupItem, scheduleMs - airing.startMs),
      channelContext: airing.channelContext,
    };
  }

  /** Keeps a fresh answer at `scheduleMs` if it is picked filler. */
  remember(
    channelId: string,
    scheduleMs: number,
    answer: BreakAnswer,
    nowMs: number,
  ): void {
    if (!isBreakAnswer(answer.lineupItem)) {
      return;
    }
    const spanMs = answer.lineupItem.streamDuration;
    if (!(spanMs > 0)) {
      return;
    }
    const airings = this.#live(channelId, nowMs);
    airings.push({
      ...answer,
      startMs: scheduleMs,
      finishMs: scheduleMs + spanMs,
      expiresAtMs: nowMs + spanMs + RetainAfterSpanMs,
    });
    this.#airings.set(channelId, airings.slice(-MaxAiringsPerChannel));
  }

  #live(channelId: string, nowMs: number): BreakAiring[] {
    const airings = (this.#airings.get(channelId) ?? []).filter(
      (a) => a.expiresAtMs > nowMs,
    );
    if (airings.length > 0) {
      this.#airings.set(channelId, airings);
    } else {
      this.#airings.delete(channelId);
    }
    return airings;
  }
}

function isBreakAnswer(item: StreamLineupItem): boolean {
  switch (item.type) {
    case 'commercial':
      return true;
    case 'fallback':
    case 'offline':
    case 'program':
    case 'redirect':
    case 'error':
    case 'live':
    case 'scheduled-remote':
    case 'scheduled-break':
      return false;
  }
}

/**
 * The answer as the calculator would have given it `elapsedMs` later, had it
 * not picked again: the same clip, further in, with less left to play.
 */
function advanceBy(
  item: StreamLineupItem,
  elapsedMs: number,
): StreamLineupItem {
  if (elapsedMs <= 0) {
    return item;
  }
  const streamDuration = item.streamDuration - elapsedMs;
  switch (item.type) {
    case 'commercial': {
      const offset = (item.startOffset ?? 0) + elapsedMs;
      const clipMs = item.program.duration;
      return {
        ...item,
        // A looping clip seeks within its current loop, as the calculator does.
        startOffset: item.infiniteLoop && clipMs > 0 ? offset % clipMs : offset,
        streamDuration,
      };
    }
    case 'fallback':
    case 'offline':
    case 'program':
    case 'redirect':
    case 'error':
    case 'live':
    case 'scheduled-remote':
    case 'scheduled-break':
      return item;
  }
}
