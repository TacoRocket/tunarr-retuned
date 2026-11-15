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

/**
 * Which concat session serves a channel's continuous MPEG-TS stream (`.ts`),
 * the one HDHomeRun-style clients such as Plex are given.
 *
 * That session re-reads the channel's worker HLS with FFmpeg, whose HLS reader
 * keeps the first program's fMP4 header and decodes every later program
 * against it. So an fMP4 channel's stream reads its own MPEG-TS worker
 * session instead of the fMP4 one its HLS viewers share. Every other channel
 * keeps the one shared worker session.
 */
export function concatSessionTypeFor(
  mode: ChannelStreamMode,
  channel: Pick<ChannelOrm, 'useEtvNext' | 'streamMode' | 'hlsSegmentType'>,
): SessionConcatStreamMode {
  if (!routesToEtvNext(mode, channel.useEtvNext ?? false)) {
    return `${mode}_concat`;
  }
  return forkWritesFmp4Segments(channel)
    ? 'etv_next_mpegts_concat'
    : 'etv_next_concat';
}
