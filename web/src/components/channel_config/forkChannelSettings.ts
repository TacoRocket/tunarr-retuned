import type {
  ChannelCreditSqueezeSettings,
  ChannelStreamMode,
  SaveableChannel,
  TranscodeConfig,
} from '@tunarr/types';

// Fork: shared rules for the channel editor's CRT, credit and offset controls.
// They mirror the server's checks in channelsApi.ts so the editor can explain a
// refusal before Save rather than after it.

export type ChannelCrtSettings = NonNullable<SaveableChannel['crt']>;
export type CrtLook = ChannelCrtSettings['look'];
export const CrtLooks: CrtLook[] = [
  'subtle',
  'classic-flat',
  'strong',
  'dvd-broadcast',
  'tv-broadcast',
];
export const isBroadcastLook = (look: CrtLook) =>
  look === 'dvd-broadcast' || look === 'tv-broadcast';

/**
 * Why this channel can't draw a CRT look or squeeze its credits, or undefined
 * when it can. Both need the transcode path with VAAPI encoding and hardware
 * filters; HLS Direct passes the video through untouched.
 */
export type PictureBlocker = 'passthrough' | 'profile';

export function pictureBlocker(
  streamMode: ChannelStreamMode,
  profile:
    | Pick<
        TranscodeConfig,
        | 'hardwareAccelerationMode'
        | 'disableHardwareEncoding'
        | 'disableHardwareFilters'
      >
    | undefined,
): PictureBlocker | undefined {
  if (!['hls', 'hls_slower', 'mpegts'].includes(streamMode)) {
    return 'passthrough';
  }
  if (
    !profile ||
    profile.hardwareAccelerationMode !== 'vaapi' ||
    profile.disableHardwareEncoding ||
    profile.disableHardwareFilters
  ) {
    return 'profile';
  }
  return undefined;
}

/** What happens at a program's final credits: one choice in the editor. */
export type CreditsChoice = 'play' | 'skip' | 'squeeze';

export function creditsChoice(values: {
  advanceAtFinalCredits?: boolean;
  creditSqueeze?: ChannelCreditSqueezeSettings | null;
}): CreditsChoice {
  if (values.creditSqueeze?.enabled) return 'squeeze';
  if (values.advanceAtFinalCredits) return 'skip';
  return 'play';
}

/**
 * The channel fields for a credits choice. Skipping and squeezing can't both
 * be on, so choosing one turns the other off. `squeeze` keeps the settings
 * the user already entered (image path, ad lists).
 */
export function creditsFields(
  choice: CreditsChoice,
  squeeze: Omit<ChannelCreditSqueezeSettings, 'enabled'>,
): {
  advanceAtFinalCredits: boolean;
  creditSqueeze: ChannelCreditSqueezeSettings | null;
} {
  switch (choice) {
    case 'play':
      return { advanceAtFinalCredits: false, creditSqueeze: null };
    case 'skip':
      return { advanceAtFinalCredits: true, creditSqueeze: null };
    case 'squeeze': {
      // Leave an empty ad list out: the API takes one or more lists, or none.
      const { advertisementFillerListIds: ads, ...rest } = squeeze;
      return {
        advanceAtFinalCredits: false,
        creditSqueeze: {
          ...rest,
          ...(ads?.length ? { advertisementFillerListIds: ads } : {}),
          enabled: true,
        },
      };
    }
  }
}

// Same rule as the server's schema: a container-local absolute PNG or JPEG.
export const isContainerImagePath = (path: string) =>
  /^\/(?!\/).*\.(?:png|jpe?g)$/i.test(path) && !path.includes('\0');

type OffsetCandidate = {
  id: string;
  onDemand: { enabled: boolean };
  offset?: { sourceChannelId: string } | null;
};

/** Why `channel` can't follow another channel, or undefined when it can. */
export function cannotFollowReason(
  channel: OffsetCandidate,
  channels: OffsetCandidate[],
): 'on-demand' | 'followed' | undefined {
  if (channel.onDemand.enabled) return 'on-demand';
  if (channels.some((c) => c.offset?.sourceChannelId === channel.id)) {
    return 'followed';
  }
  return undefined;
}

/**
 * Channels `channel` may follow: not itself, not an offset channel (no
 * chains), and not on-demand (it has no schedule to follow).
 */
export function offsetSources<T extends OffsetCandidate>(
  channel: OffsetCandidate,
  channels: T[],
): T[] {
  return channels.filter(
    (c) => c.id !== channel.id && !c.offset && !c.onDemand.enabled,
  );
}
