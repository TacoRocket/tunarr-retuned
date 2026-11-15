import type { ChannelStreamMode } from '@tunarr/types';
import type { SessionConcatStreamMode } from '@tunarr/types/schemas';
import type { ChannelOrm } from '../../db/schema/Channel.ts';
import { forkWritesFmp4Segments } from './EtvNextForkSettings.ts';

/**
 * The two worker sessions a channel can have. `etv_next` is the one HLS
 * viewers get. `etv_next_mpegts` exists only on an fMP4 channel, as the
 * MPEG-TS copy the continuous MPEG-TS stream reads.
 */
export type EtvNextSessionType = 'etv_next' | 'etv_next_mpegts';

/**
 * Channel stream modes the ErsatzTV next worker serves.
 *
 * The worker only writes HLS, so `mpegts` still goes through Tunarr's concat
 * session — it reads the worker's playlist instead of Tunarr's own pipeline.
 * `hls_slower` and `hls_direct` are excluded: both are slated for deprecation,
 * and `hls_direct` remuxes without transcoding, which the worker cannot do.
 */
export const EtvNextRoutableModes: ChannelStreamMode[] = [
  'hls',
  'hls_direct_v2',
  'mpegts',
];

export function routesToEtvNext(
  mode: ChannelStreamMode,
  channelOptedIn: boolean,
): boolean {
  return channelOptedIn && EtvNextRoutableModes.includes(mode);
}

/** The part of a running `etv_next` worker session routing reads. */
export type RunningEtvNextWorker = {
  writesFmp4Segments: boolean;
  stoppingOrStopped: boolean;
};

/**
 * Whether the channel's `etv_next` worker writes fMP4: the running one if
 * there is one, otherwise the one the saved setting would start.
 *
 * A worker keeps the segment type it started with, so after the setting
 * changes the running worker and the setting disagree until it exits. A
 * stopping worker is on its way out and the next one follows the setting.
 */
export function etvNextWritesFmp4(
  channel: Pick<ChannelOrm, 'streamMode' | 'hlsSegmentType'>,
  running: RunningEtvNextWorker | undefined,
): boolean {
  return running && !running.stoppingOrStopped
    ? running.writesFmp4Segments
    : forkWritesFmp4Segments(channel);
}

/**
 * Which concat session serves a channel's continuous MPEG-TS stream (`.ts`),
 * the one HDHomeRun-style clients such as Plex are given.
 *
 * That session re-reads the channel's worker HLS with FFmpeg, whose HLS reader
 * keeps the first program's fMP4 header and decodes every later program
 * against it. So when the channel's worker writes fMP4 the stream reads its
 * own MPEG-TS worker session instead of the one its HLS viewers share. The
 * running worker decides (see `etvNextWritesFmp4`), so a setting changed
 * mid-stream cannot send a tuner to a worker still writing fMP4.
 */
export function concatSessionTypeFor(
  mode: ChannelStreamMode,
  channel: Pick<ChannelOrm, 'useEtvNext' | 'streamMode' | 'hlsSegmentType'>,
  running?: RunningEtvNextWorker,
): SessionConcatStreamMode {
  if (!routesToEtvNext(mode, channel.useEtvNext ?? false)) {
    return `${mode}_concat`;
  }
  return etvNextWritesFmp4(channel, running)
    ? 'etv_next_mpegts_concat'
    : 'etv_next_concat';
}
