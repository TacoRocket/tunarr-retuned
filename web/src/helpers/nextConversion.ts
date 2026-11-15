import { EtvNextRoutableModes } from '@/components/settings/ffmpeg/nextTranscodeSupport.ts';
import type { Channel, ChannelStreamMode } from '@tunarr/types';
import { isAxiosError } from 'axios';
import { getApiErrorMessage } from './apiError.ts';
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
 *
 * Pass the channel's full record (GET /channels/{id}). A save replaces the
 * filler and subtitle settings with what it carries, and the channel list
 * leaves them out, so building this from a list row would erase them.
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

/** Why a conversion failed, in the server's words when it gave some. */
export function conversionFailureReason(error: unknown): string {
  const apiMessage = getApiErrorMessage(error);
  if (apiMessage) return apiMessage;
  // Channel routes answer a refusal with { error }.
  const data: unknown = isAxiosError(error) ? error.response?.data : undefined;
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error;
  }
  return error instanceof Error ? error.message : String(error);
}
