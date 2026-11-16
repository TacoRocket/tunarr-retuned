import { getChannelsByNumberV2Options } from '@/generated/@tanstack/react-query.gen.ts';
import { EtvNextRoutableModes } from '@/components/settings/ffmpeg/nextTranscodeSupport.ts';
import { fillerListsQuery } from '@/hooks/useFillerLists.ts';
import { useChannelFormContext } from '@/hooks/useChannelFormContext.ts';
import useStore from '@/store/index.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Collapse,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type {
  ChannelCreditSqueezeSettings,
  TranscodeConfig,
} from '@tunarr/types';
import { uniqBy } from 'lodash-es';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import {
  type CreditsChoice,
  type CrtLook,
  CrtLooks,
  creditsChoice,
  creditsFields,
  isBroadcastLook,
  isContainerImagePath,
  pictureBlocker,
} from './forkChannelSettings.ts';
import type { ChannelCrtSettings } from './forkChannelSettings.ts';

/**
 * Fork: the channel's CRT look and what happens at its final credits.
 * These were API-only; the editor shows them where the picture is configured.
 * Interim home until settings are reorganized.
 */
export function ChannelPictureAndCredits({
  transcodeConfigs,
}: {
  transcodeConfigs: TranscodeConfig[];
}) {
  const channel = useStore((s) => s.channelEditor.currentEntity);
  if (channel?.offset) {
    return <FollowsSourceNotice sourceId={channel.offset.sourceChannelId} />;
  }
  return <PictureAndCreditsControls transcodeConfigs={transcodeConfigs} />;
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <Box>
      <Typography sx={{ mb: 1 }} variant="h5">
        <Trans>Picture &amp; Credits</Trans>
      </Typography>
      {children}
    </Box>
  );
}

function FollowsSourceNotice({ sourceId }: { sourceId: string }) {
  const { data: source } = useQuery(
    getChannelsByNumberV2Options({ path: { id: sourceId } }),
  );
  const name = source?.name;
  return (
    <Section>
      <Typography variant="body2">
        {name ? (
          <Trans>
            This channel plays {name} later. Its credit handling follows {name};
            its picture is set under Properties, in Plays another channel later.
          </Trans>
        ) : (
          <Trans>
            This channel plays another channel later. Its credit handling
            follows that channel; its picture is set under Properties, in Plays
            another channel later.
          </Trans>
        )}
      </Typography>
    </Section>
  );
}

function PictureAndCreditsControls({
  transcodeConfigs,
}: {
  transcodeConfigs: TranscodeConfig[];
}) {
  const { t } = useLingui();
  const { control, watch, setValue } = useChannelFormContext();
  const [
    crt,
    creditSqueeze,
    advanceAtFinalCredits,
    streamMode,
    transcodeConfigId,
    useEtvNext,
  ] = watch([
    'crt',
    'creditSqueeze',
    'advanceAtFinalCredits',
    'streamMode',
    'transcodeConfigId',
    'useEtvNext',
  ]);
  const profile = transcodeConfigs.find((c) => c.id === transcodeConfigId);
  const blocker = pictureBlocker(streamMode, profile);
  const onNext = useEtvNext && EtvNextRoutableModes.includes(streamMode);
  const fillerLists = useQuery(fillerListsQuery());
  const [moreOptions, setMoreOptions] = useState(false);
  // Keep what was typed for squeeze while trying the other choices.
  const [squeezeDraft, setSqueezeDraft] = useState<
    Omit<ChannelCreditSqueezeSettings, 'enabled'>
  >(() => ({
    backgroundImage: creditSqueeze?.backgroundImage ?? '',
    advertisementFillerListIds: creditSqueeze?.advertisementFillerListIds,
  }));

  const lookLabels: Record<CrtLook, string> = {
    subtle: t`Subtle`,
    'classic-flat': t`Classic flat`,
    strong: t`Strong`,
    'dvd-broadcast': t`DVD broadcast (480 lines)`,
    'tv-broadcast': t`TV broadcast (360 lines)`,
  };
  const lookDescriptions: Record<CrtLook, string> = {
    subtle: t`A light CRT texture. Flat screen, keeps the picture sharp.`,
    'classic-flat': t`Clear scanlines, a bit of color bleed and glow.`,
    strong: t`Curved screen and heavy texture. Loud on purpose.`,
    'dvd-broadcast': t`A softer standard-definition picture with flat scanlines, like a DVD on a 2000s TV.`,
    'tv-broadcast': t`Softer still, like catching it live on cable.`,
  };
  const blockerText =
    blocker === 'passthrough'
      ? t`HLS Direct passes the video through untouched, so there is nothing to draw on. Choose HLS or MPEG-TS under Channel Stream Mode.`
      : t`This needs a transcode profile with VAAPI hardware acceleration, hardware encoding and hardware filters turned on.`;

  // Built from the IDs the channel stores, so a list deleted since it was
  // chosen still shows and can be removed.
  const allAdLists = (fillerLists.data ?? []).map(({ id, name }) => ({
    id,
    name,
  }));
  const savedAdLists = (creditSqueeze?.advertisementFillerListIds ?? []).map(
    (id) =>
      allAdLists.find((list) => list.id === id) ?? {
        id,
        name: fillerLists.isPending ? t`Loading…` : t`Deleted list`,
      },
  );

  const crtOn = !!crt?.enabled;
  const look = crtOn ? crt.look : 'off';
  const setCrt = (next: ChannelCrtSettings | null) =>
    setValue('crt', next, { shouldDirty: true });
  const changeLook = (value: CrtLook | 'off') => {
    if (value === 'off') return setCrt(null);
    const next: ChannelCrtSettings = {
      enabled: true,
      look: value,
      processing: crt?.enabled ? crt.processing : 'quality',
    };
    if (isBroadcastLook(value) && crt?.enabled) {
      next.broadcastGrain = crt.broadcastGrain;
      next.broadcastTexture = crt.broadcastTexture;
      next.broadcastComposite = crt.broadcastComposite;
    }
    setCrt(next);
  };

  const choice = creditsChoice({ advanceAtFinalCredits, creditSqueeze });
  const changeCredits = (next: CreditsChoice) => {
    if (choice === 'squeeze' && creditSqueeze) {
      setSqueezeDraft({
        backgroundImage: creditSqueeze.backgroundImage,
        advertisementFillerListIds: creditSqueeze.advertisementFillerListIds,
      });
    }
    const fields = creditsFields(next, squeezeDraft);
    setValue('advanceAtFinalCredits', fields.advanceAtFinalCredits, {
      shouldDirty: true,
    });
    setValue('creditSqueeze', fields.creditSqueeze, { shouldDirty: true });
  };

  return (
    <Section>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>
        <Trans>
          An old-TV look for the picture, and what this channel does when a
          program reaches its final credits.
        </Trans>
      </Typography>
      <Stack gap={2}>
        <FormControl sx={{ maxWidth: { md: '50%' } }}>
          <InputLabel id="crt-look-label">
            <Trans>CRT look</Trans>
          </InputLabel>
          <Select<CrtLook | 'off'>
            labelId="crt-look-label"
            label={t`CRT look`}
            value={look}
            disabled={!!blocker && !crtOn}
            onChange={(e) => changeLook(e.target.value as CrtLook | 'off')}
          >
            <MenuItem value="off">
              <Trans>Off</Trans>
            </MenuItem>
            {CrtLooks.map((value) => (
              <MenuItem key={value} value={value}>
                {lookLabels[value]}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>
            {blocker
              ? blockerText
              : crtOn
                ? lookDescriptions[crt.look]
                : t`Scanlines, glow and color bleed, drawn by your GPU.`}
          </FormHelperText>
        </FormControl>
        {crtOn && blocker && (
          <Alert severity="warning">
            <Trans>
              This look won't be drawn: {blockerText} Turn it off, or change the
              stream mode or transcode profile.
            </Trans>
          </Alert>
        )}
        {crtOn && (
          <Box>
            <Button size="small" onClick={() => setMoreOptions((v) => !v)}>
              {moreOptions ? (
                <Trans>Fewer options</Trans>
              ) : (
                <Trans>More options</Trans>
              )}
            </Button>
            <Collapse in={moreOptions}>
              <Stack gap={2} sx={{ mt: 1, maxWidth: { md: '50%' } }}>
                <FormControl>
                  <InputLabel id="crt-processing-label">
                    <Trans>Processing</Trans>
                  </InputLabel>
                  <Select
                    labelId="crt-processing-label"
                    label={t`Processing`}
                    value={crt.processing}
                    onChange={(e) =>
                      setCrt({
                        ...crt,
                        processing: e.target
                          .value as ChannelCrtSettings['processing'],
                      })
                    }
                  >
                    <MenuItem value="quality">
                      <Trans>Quality (recommended)</Trans>
                    </MenuItem>
                    <MenuItem value="performance">
                      <Trans>Performance</Trans>
                    </MenuItem>
                    <MenuItem value="experimental">
                      <Trans>Experimental</Trans>
                    </MenuItem>
                  </Select>
                  <FormHelperText>
                    <Trans>
                      Performance and Experimental ask the GPU's video engines
                      to do more of the work. Experimental can change fine color
                      detail and grain slightly.
                    </Trans>
                  </FormHelperText>
                </FormControl>
                {isBroadcastLook(crt.look) && (
                  <>
                    <FormControl>
                      <InputLabel id="crt-grain-label">
                        <Trans>Film grain</Trans>
                      </InputLabel>
                      <Select
                        labelId="crt-grain-label"
                        label={t`Film grain`}
                        value={
                          crt.broadcastGrain === 'half'
                            ? 'half'
                            : crt.broadcastGrain
                              ? 'full'
                              : 'off'
                        }
                        onChange={(e) =>
                          setCrt({
                            ...crt,
                            broadcastGrain:
                              e.target.value === 'half'
                                ? 'half'
                                : e.target.value === 'full'
                                  ? true
                                  : undefined,
                          })
                        }
                      >
                        <MenuItem value="off">
                          <Trans>Off</Trans>
                        </MenuItem>
                        <MenuItem value="half">
                          <Trans>Light</Trans>
                        </MenuItem>
                        <MenuItem value="full">
                          <Trans>Full</Trans>
                        </MenuItem>
                      </Select>
                    </FormControl>
                    <FormControl>
                      <InputLabel id="crt-texture-label">
                        <Trans>Scanlines</Trans>
                      </InputLabel>
                      <Select
                        labelId="crt-texture-label"
                        label={t`Scanlines`}
                        value={crt.broadcastTexture ?? 'light'}
                        onChange={(e) =>
                          setCrt({
                            ...crt,
                            broadcastTexture:
                              e.target.value === 'classic-flat'
                                ? 'classic-flat'
                                : undefined,
                          })
                        }
                      >
                        <MenuItem value="light">
                          <Trans>Light</Trans>
                        </MenuItem>
                        <MenuItem value="classic-flat">
                          <Trans>Stronger, like Classic flat</Trans>
                        </MenuItem>
                      </Select>
                    </FormControl>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={!!crt.broadcastComposite}
                          onChange={(_, checked) =>
                            setCrt({
                              ...crt,
                              broadcastComposite: checked || undefined,
                            })
                          }
                        />
                      }
                      label={t`Composite-video signal feel`}
                    />
                  </>
                )}
              </Stack>
            </Collapse>
          </Box>
        )}

        <FormControl>
          <Typography variant="h6" component="div" id="final-credits-label">
            <Trans>At the final credits</Trans>
          </Typography>
          <RadioGroup
            aria-labelledby="final-credits-label"
            value={choice}
            onChange={(_, value) => changeCredits(value as CreditsChoice)}
          >
            <FormControlLabel
              value="play"
              control={<Radio />}
              label={t`Play them through`}
            />
            <FormControlLabel
              value="skip"
              control={<Radio />}
              label={t`Skip to the next program`}
            />
            <FormControlLabel
              value="squeeze"
              control={<Radio />}
              disabled={!!blocker && choice !== 'squeeze'}
              label={t`Shrink them over a background image (credit squeeze)`}
            />
          </RadioGroup>
          <FormHelperText>
            {choice === 'squeeze' && blocker ? (
              blockerText
            ) : choice === 'squeeze' && onNext && savedAdLists.length > 0 ? (
              <Trans>
                Uses final-credit markers from your media server. With ads, an
                episode's ending chapter also works: the ads stop at the end of
                the chapter and the episode returns full screen for its preview
                or the rest of the story. Programs with neither play to the end.
              </Trans>
            ) : (
              <Trans>
                Uses final-credit markers from your media server. Programs
                without one play to the end.
              </Trans>
            )}
          </FormHelperText>
        </FormControl>

        {choice === 'squeeze' && (
          <Stack gap={2} sx={{ maxWidth: { md: '50%' } }}>
            <Controller
              control={control}
              name="creditSqueeze.backgroundImage"
              rules={{
                validate: (value) =>
                  isContainerImagePath(value ?? '') ||
                  t`Use a PNG or JPEG path inside the container, such as /artwork/credits.png.`,
              }}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  value={field.value ?? ''}
                  label={t`Background image`}
                  placeholder="/artwork/credits.png"
                  error={!!fieldState.error}
                  helperText={
                    fieldState.error?.message ??
                    t`A PNG or JPEG Tunarr can read inside its container. Mount your artwork folder, for example ./artwork:/artwork:ro.`
                  }
                />
              )}
            />
            {/* Not a registered field: an empty list must be left out of the
                request, and a registered empty field is sent as null, which
                the API refuses. */}
            {/* Off Next, lists already saved can still be removed (the
                warning below asks for it), but none can be added. */}
            <Autocomplete
              multiple
              disabled={!onNext && savedAdLists.length === 0}
              options={
                onNext
                  ? uniqBy([...allAdLists, ...savedAdLists], (list) => list.id)
                  : savedAdLists
              }
              getOptionLabel={(list) => list.name}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              value={savedAdLists}
              onChange={(_, lists) => {
                if (!creditSqueeze) return;
                const { advertisementFillerListIds: _old, ...rest } =
                  creditSqueeze;
                setValue(
                  'creditSqueeze',
                  lists.length > 0
                    ? {
                        ...rest,
                        advertisementFillerListIds: lists.map((l) => l.id),
                      }
                    : rest,
                  { shouldDirty: true },
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t`Ads while the credits shrink (optional)`}
                  helperText={
                    onNext
                      ? t`Plays ads from these filler lists in the main picture while the credits shrink.`
                      : savedAdLists.length > 0
                        ? t`Needs the ErsatzTV next playback engine. Remove these lists to keep a still-image squeeze.`
                        : t`Needs the ErsatzTV next playback engine.`
                  }
                />
              )}
            />
            {!onNext && !!creditSqueeze?.advertisementFillerListIds?.length && (
              <Alert severity="warning">
                <Trans>
                  Ads during the credits need ErsatzTV next. Remove the filler
                  lists or switch the playback engine, or Save will be refused.
                </Trans>
              </Alert>
            )}
          </Stack>
        )}
      </Stack>
    </Section>
  );
}
