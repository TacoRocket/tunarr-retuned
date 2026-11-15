import { EtvNextRoutableModes } from '@/components/settings/ffmpeg/nextTranscodeSupport.ts';
import type { Channel, ChannelStreamMode } from '@tunarr/types';
import { channelSettingsUpdate } from './channelSettingsUpdate.ts';

// SIGNPOST(native-retirement): conversion goes with native playback.

/** A channel Tunarr's own (native) pipeline plays, not ErsatzTV next. */
export function isLegacyChannel(
  channel: Pick<Channel, 'useEtvNext' | 'streamMode'>,
): boolean {
  return (
    !channel.useEtvNext || !EtvNextRoutableModes.includes(channel.streamMode)
  );
}

/**
 * The stream mode a channel keeps on ErsatzTV next. HLS Alt and HLS Direct
 * only exist on the native pipeline, so they become HLS, as copies do.
 */
export function nextStreamMode(mode: ChannelStreamMode): ChannelStreamMode {
  return EtvNextRoutableModes.includes(mode) ? mode : 'hls';
}

/**
 * The update that moves a saved channel to ErsatzTV next. Every other setting
 * and the lineup stay as they are, and the server-owned playback state is
 * left alone (see channelSettingsUpdate).
 */
export function nextConversionUpdate(
  channel: Channel,
  transcodeConfigId: string = channel.transcodeConfigId,
) {
  return {
    ...channelSettingsUpdate(channel),
    useEtvNext: true,
    streamMode: nextStreamMode(channel.streamMode),
    transcodeConfigId,
  };
}
