import { getApiTranscodeConfigsOptions } from '@/generated/@tanstack/react-query.gen.ts';
import { deleteApiChannelsById } from '@/generated/sdk.gen.ts';
import {
  isLegacyChannel,
  nextConversionUpdate,
} from '@/helpers/nextConversion.ts';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { useCreateChannel } from '@/hooks/useCreateChannel.ts';
import { useUpdateChannel } from '@/hooks/useUpdateChannel.ts';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useQueryClient } from '@tanstack/react-query';
import type { Channel } from '@tunarr/types';
import { useSnackbar } from 'notistack';
import { useCallback, useState } from 'react';
import type { DuplicateChannelProfileDialogProps } from './DuplicateChannelProfileDialog.tsx';

export type RunEachResult = { succeeded: number; failed: number };

// Runs `task` on each item in order, so the server sees one change at a time.
// A failure is counted and the rest still run.
export const runEach = async <T>(
  items: readonly T[],
  task: (item: T) => Promise<unknown>,
): Promise<RunEachResult> => {
  let failed = 0;
  for (const item of items) {
    try {
      await task(item);
    } catch (err) {
      console.error(err);
      failed++;
    }
  }
  return { succeeded: items.length - failed, failed };
};

export const useChannelBulkActions = () => {
  const { t } = useLingui();
  const snackbar = useSnackbar();
  const queryClient = useQueryClient();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();

  const report = useCallback(
    ({ succeeded, failed }: RunEachResult, done: string, broke: string) => {
      if (failed > 0) {
        snackbar.enqueueSnackbar(broke, { variant: 'error' });
      } else if (succeeded > 0) {
        snackbar.enqueueSnackbar(done, { variant: 'success' });
      }
    },
    [snackbar],
  );

  const [profileDialog, setProfileDialog] =
    useState<DuplicateChannelProfileDialogProps | null>(null);

  // Copies get the next free channel numbers, so they run one at a time.
  const copyChannels = useCallback(
    async (channels: Channel[], replacements?: ReadonlyMap<string, string>) => {
      const result = await runEach(channels, (channel) =>
        createChannel.mutateAsync({
          body: {
            type: 'copy',
            channelId: channel.id,
            transcodeConfigId: replacements?.get(channel.id),
          },
        }),
      );
      report(
        result,
        plural(result.succeeded, {
          one: 'Duplicated # channel',
          other: 'Duplicated # channels',
        }),
        t`${result.failed} of ${channels.length} channels failed to duplicate`,
      );
    },
    [createChannel, report, t],
  );

  // The transcode profiles ErsatzTV next can play, or undefined after telling
  // the user they could not be loaded.
  const loadNextProfiles = useCallback(async () => {
    try {
      return await queryClient.fetchQuery(
        getApiTranscodeConfigsOptions({ query: { backend: 'etv_next' } }),
      );
    } catch (error) {
      console.error(error);
      snackbar.enqueueSnackbar(
        t`Unable to load compatible transcode profiles.`,
        {
          variant: 'error',
        },
      );
      return undefined;
    }
  }, [queryClient, snackbar, t]);

  // Runs `run` straight away when every channel's profile plays on Next.
  // Otherwise asks once for a replacement, which applies only to the channels
  // that need one. Canceling runs nothing.
  const withNextProfiles = useCallback(
    async (
      channels: Channel[],
      purpose: DuplicateChannelProfileDialogProps['purpose'],
      run: (replacements?: ReadonlyMap<string, string>) => Promise<void>,
    ) => {
      const profiles = await loadNextProfiles();
      if (!profiles) return;
      const supportedIds = new Set(profiles.map((profile) => profile.id));
      const incompatible = channels.filter(
        (channel) => !supportedIds.has(channel.transcodeConfigId),
      );
      if (incompatible.length === 0) {
        await run();
        return;
      }

      setProfileDialog({
        purpose,
        channels: incompatible,
        profiles,
        onCancel: () => setProfileDialog(null),
        onConfirm: (profileId) => {
          setProfileDialog(null);
          void run(new Map(incompatible.map((c) => [c.id, profileId])));
        },
      });
    },
    [loadNextProfiles],
  );

  const duplicateChannels = useCallback(
    (channels: Channel[]) =>
      withNextProfiles(channels, 'duplicate', (replacements) =>
        copyChannels(channels, replacements),
      ),
    [copyChannels, withNextProfiles],
  );

  // SIGNPOST(native-retirement): conversion goes with native playback.
  // Moves legacy channels to ErsatzTV next. Channels already on Next are left
  // alone. `onConverted` receives each channel as the server saved it.
  const convertChannels = useCallback(
    async (channels: Channel[], onConverted?: (channel: Channel) => void) => {
      const legacy = channels.filter(isLegacyChannel);
      if (legacy.length === 0) return;
      await withNextProfiles(legacy, 'convert', async (replacements) => {
        const result = await runEach(legacy, async (channel) => {
          const saved = await updateChannel.mutateAsync({
            path: { id: channel.id },
            body: nextConversionUpdate(channel, replacements?.get(channel.id)),
          });
          onConverted?.(saved);
        });
        await queryClient.invalidateQueries({
          predicate: invalidateTaggedQueries('Channels'),
        });
        report(
          result,
          plural(result.succeeded, {
            one: 'Converted # channel to ErsatzTV next',
            other: 'Converted # channels to ErsatzTV next',
          }),
          t`${result.failed} of ${legacy.length} channels failed to convert`,
        );
      });
    },
    [queryClient, report, t, updateChannel, withNextProfiles],
  );

  const deleteChannels = useCallback(
    async (channels: Channel[]) => {
      const result = await runEach(channels, (channel) =>
        deleteApiChannelsById({
          path: { id: channel.id },
          throwOnError: true,
        }),
      );
      await queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries('Channels'),
      });
      report(
        result,
        plural(result.succeeded, {
          one: 'Deleted # channel',
          other: 'Deleted # channels',
        }),
        t`${result.failed} of ${channels.length} channels failed to delete`,
      );
    },
    [queryClient, report, t],
  );

  return { duplicateChannels, convertChannels, deleteChannels, profileDialog };
};
