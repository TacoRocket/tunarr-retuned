import {
  clearChannelOffsetMutation,
  getChannelsOptions,
  setChannelOffsetMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { conversionFailureReason } from '@/helpers/nextConversion.ts';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { channelProgrammingQuery } from '@/hooks/useChannelLineup.ts';
import { replaceCurrentChannel } from '@/store/channelEditor/actions.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Channel, TranscodeConfig } from '@tunarr/types';
import { useSnackbar } from 'notistack';
import { useState } from 'react';
import {
  type CrtLook,
  CrtLooks,
  cannotFollowReason,
  offsetSources,
  pictureBlocker,
} from './forkChannelSettings.ts';
import type { ChannelCrtSettings } from './forkChannelSettings.ts';

type PictureChoice = 'source' | 'off' | CrtLook;

/**
 * Fork: make this channel play another channel's lineup some hours later, or
 * stop. Uses the offset endpoints, which re-copy the source's programming and
 * settings, so the editor asks for a clean form first, like the live feed.
 * Interim home until settings are reorganized.
 */
export function ChannelOffsetSettings({
  channel,
  hasUnsavedChanges,
  transcodeConfigs,
}: {
  channel: Channel;
  hasUnsavedChanges: boolean;
  transcodeConfigs: TranscodeConfig[];
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const channels = useQuery(getChannelsOptions());
  const all = channels.data ?? [];
  const source = channel.offset
    ? all.find((c) => c.id === channel.offset?.sourceChannelId)
    : undefined;
  const blocked = cannotFollowReason(channel, all);
  const candidates = offsetSources(channel, all);

  const [dialog, setDialog] = useState<'link' | 'stop' | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [hours, setHours] = useState('3');
  const [picture, setPicture] = useState<PictureChoice>('source');
  // What the dialog opened with: an unchanged choice is left out of the
  // request, and the API keeps the saved picture with all its options.
  const [openedPicture, setOpenedPicture] = useState<PictureChoice>('source');

  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: invalidateTaggedQueries('Channels'),
    });
  const fail = (error: unknown) =>
    snackbar.enqueueSnackbar(conversionFailureReason(error), {
      variant: 'error',
    });
  // The editor's copy of this channel and its lineup only reload when a
  // different channel opens, but linking and stopping rewrite both on the
  // server: put the saved channel and a fresh lineup there. If the lineup
  // can't be read, drop it so the Programming page loads it again.
  const keep = async (saved: Channel) => {
    const lineup = channelProgrammingQuery(saved.id);
    const programming = await queryClient
      .fetchQuery({ ...lineup, staleTime: 0 })
      .catch(() => {
        queryClient.removeQueries({ queryKey: lineup.queryKey });
        return undefined;
      });
    replaceCurrentChannel(saved, programming);
  };
  const link = useMutation({
    ...setChannelOffsetMutation(),
    onSuccess: async (saved) => {
      await keep(saved);
      setDialog(null);
      await refresh();
      snackbar.enqueueSnackbar(t`Channel now plays its source later`, {
        variant: 'success',
      });
    },
    onError: fail,
  });
  const stop = useMutation({
    ...clearChannelOffsetMutation(),
    onSuccess: async (saved) => {
      await keep(saved);
      setDialog(null);
      await refresh();
      snackbar.enqueueSnackbar(t`Channel no longer follows another channel`, {
        variant: 'success',
      });
    },
    onError: fail,
  });

  const openLink = () => {
    setSourceId(channel.offset?.sourceChannelId ?? '');
    setHours(String(channel.offset?.hours ?? 3));
    const saved = channel.offset?.picture;
    const choice: PictureChoice =
      saved?.mode === 'custom'
        ? saved.crt.look
        : saved?.mode === 'off'
          ? 'off'
          : 'source';
    setPicture(choice);
    setOpenedPicture(choice);
    setDialog('link');
  };
  const hoursValue = Number(hours);
  const hoursValid =
    hours.trim() !== '' &&
    Number.isInteger(hoursValue) &&
    hoursValue >= 0 &&
    hoursValue <= 168;
  // The offset channel plays through the source's stream mode and profile, so
  // those decide whether it can draw a look of its own.
  const selected = all.find((c) => c.id === sourceId);
  const sourceBlocker = selected
    ? pictureBlocker(
        selected.streamMode,
        transcodeConfigs.find((p) => p.id === selected.transcodeConfigId),
      )
    : undefined;
  const ownLook = picture !== 'source' && picture !== 'off';
  const submitLink = () => {
    const crt: ChannelCrtSettings | undefined = ownLook
      ? { enabled: true, look: picture, processing: 'quality' }
      : undefined;
    const keepSaved = !!channel.offset && picture === openedPicture;
    link.mutate({
      path: { id: channel.id },
      body: {
        sourceChannelId: sourceId,
        hours: hoursValue,
        ...(keepSaved
          ? {}
          : {
              picture: crt
                ? { mode: 'custom', crt }
                : { mode: picture as 'source' | 'off' },
            }),
      },
    });
  };

  const lookLabels: Record<CrtLook, string> = {
    subtle: t`Its own look: Subtle`,
    'classic-flat': t`Its own look: Classic flat`,
    strong: t`Its own look: Strong`,
    'dvd-broadcast': t`Its own look: DVD broadcast`,
    'tv-broadcast': t`Its own look: TV broadcast`,
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6">
        <Trans>Plays another channel later</Trans>
      </Typography>
      {channel.offset ? (
        <Typography variant="body2" sx={{ mb: 1 }}>
          {source ? (
            <Trans>
              Plays {source.name} {channel.offset.hours} hours later. Its
              programming, clock and most settings follow {source.name}; its
              name, number, artwork and picture are its own.
            </Trans>
          ) : (
            <Trans>
              Plays another channel {channel.offset.hours} hours later.
            </Trans>
          )}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ mb: 1 }}>
          <Trans>
            Like an East Coast/West Coast feed: this channel shows another
            channel's lineup a set number of hours later, with nothing to
            program here.
          </Trans>
        </Typography>
      )}
      {hasUnsavedChanges && (
        <Alert severity="info" sx={{ mb: 1 }}>
          <Trans>Save or discard your channel changes first.</Trans>
        </Alert>
      )}
      {!channel.offset && blocked && (
        <Alert severity="info" sx={{ mb: 1 }}>
          {blocked === 'followed' ? (
            <Trans>
              Other channels play this one later, so it can't follow another
              channel itself.
            </Trans>
          ) : (
            <Trans>
              On-demand channels only move while someone watches, so they can't
              follow a schedule.
            </Trans>
          )}
        </Alert>
      )}
      <Stack direction="row" gap={1}>
        <Button
          variant="outlined"
          size="small"
          disabled={hasUnsavedChanges || (!channel.offset && !!blocked)}
          onClick={openLink}
        >
          {channel.offset ? (
            <Trans>Change…</Trans>
          ) : (
            <Trans>Play another channel later…</Trans>
          )}
        </Button>
        {channel.offset && (
          <Button
            size="small"
            color="inherit"
            disabled={hasUnsavedChanges}
            onClick={() => setDialog('stop')}
          >
            <Trans>Stop following</Trans>
          </Button>
        )}
      </Stack>

      <Dialog
        open={dialog === 'link'}
        onClose={() => setDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          <Trans>Play another channel later</Trans>
        </DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ pt: 1 }}>
            <FormControl>
              <InputLabel id="offset-source-label">
                <Trans>Source channel</Trans>
              </InputLabel>
              <Select
                labelId="offset-source-label"
                label={t`Source channel`}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                {candidates.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.number} · {c.name}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                <Trans>Offset and on-demand channels can't be followed.</Trans>
              </FormHelperText>
            </FormControl>
            <TextField
              label={t`Hours later`}
              type="number"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              error={!hoursValid}
              helperText={
                hoursValid
                  ? t`Whole hours, 0 to 168 (a week). 0 plays it at the same time.`
                  : t`Enter a whole number of hours from 0 to 168.`
              }
              slotProps={{ htmlInput: { min: 0, max: 168, step: 1 } }}
            />
            <FormControl>
              <InputLabel id="offset-picture-label">
                <Trans>Picture</Trans>
              </InputLabel>
              <Select<PictureChoice>
                labelId="offset-picture-label"
                label={t`Picture`}
                value={picture}
                onChange={(e) => setPicture(e.target.value as PictureChoice)}
              >
                <MenuItem value="source">
                  <Trans>Same as the source (recommended)</Trans>
                </MenuItem>
                <MenuItem value="off">
                  <Trans>No CRT look</Trans>
                </MenuItem>
                {CrtLooks.map((value) => (
                  <MenuItem
                    key={value}
                    value={value}
                    disabled={!!sourceBlocker}
                  >
                    {lookLabels[value]}
                  </MenuItem>
                ))}
              </Select>
              {sourceBlocker && (
                <FormHelperText error={ownLook}>
                  {sourceBlocker === 'passthrough' ? (
                    <Trans>
                      The source uses HLS Direct, which passes the video through
                      untouched, so this channel can't draw a look of its own.
                    </Trans>
                  ) : (
                    <Trans>
                      The source's transcode profile can't draw a look: it needs
                      VAAPI hardware acceleration, hardware encoding and
                      hardware filters turned on.
                    </Trans>
                  )}
                </FormHelperText>
              )}
            </FormControl>
            {!channel.offset && (
              <Alert severity="warning">
                <Trans>
                  This replaces this channel's programming with the source's.
                  Its name, number and artwork stay.
                </Trans>
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="contained"
            disabled={
              !sourceId ||
              !hoursValid ||
              (ownLook && !!sourceBlocker) ||
              link.isPending
            }
            onClick={submitLink}
          >
            <Trans>Save</Trans>
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === 'stop'} onClose={() => setDialog(null)}>
        <DialogTitle>
          <Trans>Stop following?</Trans>
        </DialogTitle>
        <DialogContent>
          <Trans>
            The channel keeps the programming it has now and becomes an ordinary
            channel again.
          </Trans>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="contained"
            disabled={stop.isPending}
            onClick={() => stop.mutate({ path: { id: channel.id } })}
          >
            <Trans>Stop following</Trans>
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
