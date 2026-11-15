import type { ChannelStreamMode } from '@tunarr/types';
import type { TranscodeConfigOrm } from '../db/schema/TranscodeConfig.ts';
import { findUnsupportedSettings } from '../stream/etv/EtvNextChannelConfigMapper.ts';
import { routesToEtvNext } from '../stream/etv/EtvNextRouting.ts';

type Routing = {
  streamMode: ChannelStreamMode;
  useEtvNext: boolean;
  transcodeConfigId: string;
};

/**
 * SIGNPOST(native-retirement): goes once a profile Next can't play can't be
 * chosen.
 *
 * Refuses a channel update that lands on ErsatzTV next with a transcode
 * profile Next can't play. Creating a channel already refuses one; this
 * covers converting a channel and changing a Next channel's profile.
 *
 * Only an update that moves the channel to Next or changes its profile is
 * checked, so renaming a channel whose profile was edited later still saves.
 * Native channels and moving back to native are never checked.
 */
export function nextProfileUpdateError(
  current: Routing,
  update: Routing,
  transcodeConfig: TranscodeConfigOrm,
): string | undefined {
  if (!routesToEtvNext(update.streamMode, update.useEtvNext)) return;
  const unchanged =
    routesToEtvNext(current.streamMode, current.useEtvNext) &&
    current.transcodeConfigId === update.transcodeConfigId;
  if (unchanged) return;

  const unsupported = findUnsupportedSettings(transcodeConfig);
  if (unsupported.length === 0) return;
  const reasons = unsupported
    .map(({ field, reason }) => `${field} ${reason}`)
    .join('; ');
  return `ErsatzTV next can't play the transcode profile "${transcodeConfig.name}": ${reasons}. Choose a profile it can play.`;
}
