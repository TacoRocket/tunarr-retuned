import {
  getApiTranscodeConfigsOptions,
  getApiTranscodeConfigsQueryKey,
  getChannelsByNumberV2Options,
} from '@/generated/@tanstack/react-query.gen.ts';
import { deleteApiChannelsById } from '@/generated/sdk.gen.ts';
import {
  conversionFailureReason,
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

// A snackbar can show a few lines; past that, the count stands in.
const MaxListedFailures = 5;

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

  // An offset channel's source, by name, for pointing the user at it.
  const sourceName = useCallback(
    async (offsetChannel: Channel) => {
      const sourceId = offsetChannel.offset?.sourceChannelId;
      if (!sourceId) return t`its source channel`;
      try {
        const source = await queryClient.fetchQuery(
          getChannelsByNumberV2Options({ path: { id: sourceId } }),
        );
        return source.name;
      } catch (error) {
        console.error(error);
        return t`its source channel`;
      }
    },
    [queryClient, t],
  );

  // SIGNPOST(native-retirement): conversion goes with native playback.
  // Moves legacy channels to ErsatzTV next, changing only their engine, stream
  // mode and, where needed, profile. Channels already on Next are left alone.
  // An offset channel takes its engine from its source, so converting the
  // source moves both; one selected without its source is pointed at it.
  // `onConverted` receives each channel as the server saved it.
  const convertChannels = useCallback(
    async (channels: Channel[], onConverted?: (channel: Channel) => void) => {
      const legacy = channels.filter(isLegacyChannel);
      const selected = new Set(channels.map((channel) => channel.id));
      const followers = legacy.filter(
        (channel) =>
          channel.offset && !selected.has(channel.offset.sourceChannelId),
      );
      if (followers.length > 0) {
        const lines = await Promise.all(
          followers.map(async (channel) => {
            const source = await sourceName(channel);
            return t`${channel.name} follows ${source}. Convert ${source} to move both.`;
          }),
        );
        snackbar.enqueueSnackbar(lines.join('\n'), {
          variant: 'info',
          style: { whiteSpace: 'pre-line' },
        });
      }

      const direct = legacy.filter((channel) => !channel.offset);
      if (direct.length === 0) return;
      await withNextProfiles(direct, 'convert', async (replacements) => {
        // Each failure's channel and reason, to tell the user what to fix.
        const failures: { channel: Channel; error: unknown }[] = [];
        const result = await runEach(direct, async (channel) => {
          try {
            // The list row lacks filler and subtitle settings; saving it would
            // erase them. Save from the channel's full, current record.
            const full = await queryClient.fetchQuery({
              ...getChannelsByNumberV2Options({ path: { id: channel.id } }),
              staleTime: 0,
            });
            const saved = await updateChannel.mutateAsync({
              path: { id: channel.id },
              body: nextConversionUpdate(full, replacements?.get(channel.id)),
            });
            if (isLegacyChannel(saved)) {
              throw new Error(
                t`It is still on the legacy engine after saving.`,
              );
            }
            onConverted?.(saved);
          } catch (error) {
            failures.push({ channel, error });
            throw error;
          }
        });
        await queryClient.invalidateQueries({
          predicate: invalidateTaggedQueries('Channels'),
        });
        if (result.failed === 0) {
          snackbar.enqueueSnackbar(
            plural(result.succeeded, {
              one: 'Converted # channel to ErsatzTV next',
              other: 'Converted # channels to ErsatzTV next',
            }),
            { variant: 'success' },
          );
          return;
        }

        // A refused profile may have changed since the picker loaded; the
        // next attempt should see the profiles as they are now.
        await queryClient.invalidateQueries({
          queryKey: getApiTranscodeConfigsQueryKey({
            query: { backend: 'etv_next' },
          }),
        });
        const listed = failures
          .slice(0, MaxListedFailures)
          .map(
            ({ channel, error }) =>
              `${channel.name}: ${conversionFailureReason(error)}`,
          );
        const more = result.failed - listed.length;
        snackbar.enqueueSnackbar(
          [
            result.succeeded > 0
              ? t`Converted ${result.succeeded} of ${direct.length} channels. These stay on the legacy engine and still play:`
              : t`No channels were converted. These stay on the legacy engine and still play:`,
            ...listed,
            ...(more > 0 ? [t`and ${more} more`] : []),
          ].join('\n'),
          { variant: 'error', style: { whiteSpace: 'pre-line' } },
        );
      });
    },
    [queryClient, snackbar, sourceName, t, updateChannel, withNextProfiles],
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
