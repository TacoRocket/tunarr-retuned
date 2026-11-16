import { refreshChannelFillerMutation } from '@/generated/@tanstack/react-query.gen.ts';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import { channelProgrammingQuery } from '@/hooks/useChannelLineup.ts';
import { channelQuery } from '@/hooks/useChannels.ts';
import { fillerListsQuery } from '@/hooks/useFillerLists.ts';
import { replaceCurrentChannel } from '@/store/channelEditor/actions.ts';
import useStore from '@/store/index.ts';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Channel } from '@tunarr/types';
import type { PostProgramPod } from '@tunarr/types/api';
import { useSnackbar } from 'notistack';
import { useMemo, useState } from 'react';
import {
  breakRecipes,
  breakStats,
  clockPaddingMinutes,
  hasMidRoll,
  showSlotCount,
} from './adBreaks.ts';

const Section = ({ children }: { children: React.ReactNode }) => (
  <Paper sx={{ p: 2, mb: 2 }}>{children}</Paper>
);

/**
 * Fork: a channel's ad breaks in one place. Breaks are a few whole clips in
 * a row after each show, then back to the show; they don't pad to the clock.
 */
export function ChannelAdBreaksPage({ channelId }: { channelId: string }) {
  const { t } = useLingui();
  const channelResult = useQuery(channelQuery(channelId));
  const programming = useQuery(channelProgrammingQuery(channelId));
  const fillerLists = useQuery(fillerListsQuery());
  const channel = channelResult.data;
  const poolName = (id: string) =>
    fillerLists.data?.find((list) => list.id === id)?.name ?? t`Deleted list`;
  const lineup = programming.data?.lineup;
  const schedule = programming.data?.schedule;
  const recipes = useMemo(() => breakRecipes(schedule), [schedule]);
  const stats = useMemo(
    () => breakStats(lineup ?? [], schedule),
    [lineup, schedule],
  );
  const padding = clockPaddingMinutes(schedule);

  if (!channel) return null;
  const source = channel.offset?.sourceChannelId;

  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 1 }}>
        <Link to={`/channels/${channel.id}`}>
          {channel.number} · {channel.name}
        </Link>
      </Typography>
      <Typography variant="h4" sx={{ mb: 1 }}>
        <Trans>Ad breaks</Trans>
      </Typography>
      <Typography variant="body1" sx={{ mb: 3, maxWidth: 900 }}>
        <Trans>
          After each show the channel plays a few ads in a row, then the next
          show, like streaming TV. A break is as long as its ads; it doesn't pad
          to the clock. Each spot draws from an{' '}
          <Link to="/library/ads">ad pool</Link>.
        </Trans>
      </Typography>

      {source ? (
        <Alert severity="info">
          <Trans>
            This channel plays another channel's lineup later, so its ad breaks
            come from there.{' '}
            <Link to={`/channels/${source}/ad-breaks`}>
              See that channel's ad breaks
            </Link>
            .
          </Trans>
        </Alert>
      ) : programming.isError ? (
        <Alert severity="error">
          {getApiErrorMessage(programming.error) ??
            t`Couldn't load the channel's programming.`}
        </Alert>
      ) : !programming.data ? null : (
        <>
          <Section>
            <Typography variant="h6" gutterBottom>
              <Trans>On this channel</Trans>
            </Typography>
            {schedule?.type === 'time' ? null : stats.breaks === 0 ? (
              <Typography>
                <Trans>No ad breaks in the saved lineup yet.</Trans>
              </Typography>
            ) : (
              <Typography>
                <Plural value={stats.breaks} one="# break" other="# breaks" />,{' '}
                {stats.minAds === stats.maxAds ? (
                  <Plural
                    value={stats.maxAds}
                    one="# ad each"
                    other="# ads each"
                  />
                ) : (
                  <Trans>
                    {stats.minAds}–{stats.maxAds} ads each
                  </Trans>
                )}
                .
              </Typography>
            )}
            <Stack gap={1} sx={{ mt: 1 }}>
              {schedule?.type === 'time' && (
                <Alert severity="info">
                  <Trans>
                    This channel uses Time Slots, which fill each slot to the
                    clock. Ad breaks need a Random Slots schedule with shows
                    counted by episode.
                  </Trans>
                </Alert>
              )}
              {!schedule && stats.breaks > 0 && (
                <Alert severity="info">
                  <Trans>
                    These breaks come from an earlier schedule that has since
                    been edited by hand. They stay as they are; Redraw ads can
                    still refresh their clips.
                  </Trans>
                </Alert>
              )}
              {schedule?.type === 'random' &&
                (padding === null ? (
                  <Typography variant="body2" color="text.secondary">
                    <Trans>
                      No clock padding: the next show starts as soon as the
                      break ends.
                    </Trans>
                  </Typography>
                ) : (
                  <Alert severity="warning">
                    <Trans>
                      This schedule pads to the next {padding}-minute mark, so
                      dead air follows each break until the clock catches up. Ad
                      break channels run without clock padding.
                    </Trans>
                  </Alert>
                ))}
              {hasMidRoll(schedule) && (
                <Alert severity="info">
                  <Trans>
                    Some slots also have timed mid-roll breaks. Those are
                    Tunarr's interval breaks inside a show, separate from these
                    ad breaks.
                  </Trans>
                </Alert>
              )}
            </Stack>
          </Section>

          {schedule?.type !== 'time' && (
            <Section>
              <Typography variant="h6" gutterBottom>
                <Trans>Break recipe</Trans>
              </Typography>
              {recipes.length === 0 ? (
                <Typography>
                  <Trans>
                    The schedule has no break recipe. A recipe is set on a
                    Random Slots show slot; see the ad pods guide for now.
                  </Trans>
                </Typography>
              ) : (
                recipes.map((recipe) => (
                  <Box key={recipe.slots.join(',')} sx={{ mb: 1.5 }}>
                    <Typography variant="subtitle2">
                      {recipe.slots.length === showSlotCount(schedule) ? (
                        <Trans>After every show</Trans>
                      ) : (
                        <Trans>
                          After shows in slots {recipe.slots.join(', ')}
                        </Trans>
                      )}
                    </Typography>
                    <RecipePositions
                      positions={recipe.positions}
                      poolName={poolName}
                    />
                  </Box>
                ))
              )}
            </Section>
          )}

          {stats.adSpotsByPool.size > 0 && (
            <Section>
              <Typography variant="h6" gutterBottom>
                <Trans>Redraw ads</Trans>
              </Typography>
              <RedrawAds
                channel={channel}
                pools={[...stats.adSpotsByPool.entries()].map(
                  ([id, spots]) => ({ id, spots, name: poolName(id) }),
                )}
                timeSlots={schedule?.type === 'time'}
              />
            </Section>
          )}
        </>
      )}
    </Box>
  );
}

function RecipePositions({
  positions,
  poolName,
}: {
  positions: PostProgramPod;
  poolName: (id: string) => string;
}) {
  const { t } = useLingui();
  return (
    <Box component="ol" sx={{ m: 0, pl: 3 }}>
      {positions.map((position, index) => (
        <li key={index}>
          {position.fillerListIds.map(poolName).join(t` or `)}
          {(position.count ?? 1) > 1 && ` × ${position.count}`}
        </li>
      ))}
    </Box>
  );
}

function RedrawAds({
  channel,
  pools,
  timeSlots,
}: {
  channel: Channel;
  pools: { id: string; spots: number; name: string }[];
  timeSlots: boolean;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const editingThis = useStore(
    (s) => s.channelEditor.currentEntity?.id === channel.id,
  );
  const unsaved = useStore((s) => s.channelEditor.dirty.programs);
  const [skipped, setSkipped] = useState<string[]>([]);
  const chosen = pools.filter((pool) => !skipped.includes(pool.id));

  const blocker = channel.onDemand?.enabled
    ? t`On-demand channels can't redraw their ads.`
    : timeSlots
      ? t`Time Slots channels pick their ads when the schedule is generated. Generate it again for new ones.`
      : editingThis && unsaved
        ? t`Save or reset your programming changes first.`
        : undefined;

  const redraw = useMutation({
    ...refreshChannelFillerMutation(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries('Channels'),
      });
      // The programming editor only reloads a channel when a different one
      // opens, so it gets the redrawn lineup if it holds this channel. Edits
      // made there while Redraw ran are kept: checked again right before
      // replacing, since the reload waits on the network.
      const editor = () => useStore.getState().channelEditor;
      const holdsThis = () => editor().currentEntity?.id === channel.id;
      let keptEdits = false;
      if (holdsThis()) {
        try {
          const [fresh, lineup] = await Promise.all([
            queryClient.fetchQuery({
              ...channelQuery(channel.id),
              staleTime: 0,
            }),
            queryClient.fetchQuery({
              ...channelProgrammingQuery(channel.id),
              staleTime: 0,
            }),
          ]);
          if (holdsThis() && !editor().dirty.programs) {
            replaceCurrentChannel(fresh, lineup);
          } else {
            keptEdits = holdsThis();
          }
        } catch {
          if (holdsThis() && !editor().dirty.programs) {
            replaceCurrentChannel(channel);
          } else {
            keptEdits = holdsThis();
          }
        }
      }
      snackbar.enqueueSnackbar(
        keptEdits
          ? t`Redrew ${result.refreshedPositions} of ${result.matchedPositions} ads. Your unsaved Programming changes were kept; saving them puts the previous ads back.`
          : t`Redrew ${result.refreshedPositions} of ${result.matchedPositions} ads`,
        { variant: keptEdits ? 'warning' : 'success' },
      );
    },
    onError: (error) =>
      snackbar.enqueueSnackbar(
        getApiErrorMessage(error) ?? t`Couldn't redraw the ads.`,
        { variant: 'error' },
      ),
  });

  if (blocker) return <Alert severity="info">{blocker}</Alert>;
  return (
    <>
      <Typography variant="body2" sx={{ mb: 1 }}>
        <Trans>
          Redraw picks ads from the checked pools and keeps the shows, schedule,
          and ad currently on air. Within each break, it avoids repeats among
          its new picks when another clip is available. A clip kept on air or
          from an unchecked pool can play again in the same break.
        </Trans>
      </Typography>
      <FormGroup>
        {pools.map((pool) => (
          <FormControlLabel
            key={pool.id}
            control={
              <Checkbox
                checked={!skipped.includes(pool.id)}
                onChange={(e) =>
                  setSkipped((current) =>
                    e.target.checked
                      ? current.filter((id) => id !== pool.id)
                      : [...current, pool.id],
                  )
                }
              />
            }
            label={
              <>
                {pool.name}{' '}
                <Typography
                  component="span"
                  variant="body2"
                  color="text.secondary"
                >
                  <Plural
                    value={pool.spots}
                    one="(# ad spot)"
                    other="(# ad spots)"
                  />
                </Typography>
              </>
            }
          />
        ))}
      </FormGroup>
      <Button
        sx={{ mt: 1 }}
        variant="contained"
        disabled={chosen.length === 0 || redraw.isPending}
        onClick={() =>
          redraw.mutate({
            path: { id: channel.id },
            body: { fillerListIds: chosen.map((pool) => pool.id) },
          })
        }
      >
        <Trans>Redraw</Trans>
      </Button>
    </>
  );
}
