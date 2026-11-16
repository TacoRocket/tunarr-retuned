import {
  getAdPoolsOptions,
  getApiSmartCollectionsOptions,
  postApiFillerListsMutation,
  putApiFillerListsByIdMutation,
  syncFillerListFromSmartCollectionMutation,
} from '@/generated/@tanstack/react-query.gen.ts';
import { getApiErrorMessage } from '@/helpers/apiError.ts';
import { invalidateTaggedQueries } from '@/helpers/queryUtil.ts';
import {
  fillerListProgramsQuery,
  fillerListQuery,
} from '@/hooks/useFillerLists.ts';
import { clearCurrentFillerList } from '@/store/fillerListEditor/action.ts';
import useStore from '@/store/index.ts';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { AdPool } from '@tunarr/types/api';
import { useSnackbar } from 'notistack';
import { useMemo, useState } from 'react';
import { DataTable } from '../ui/table/DataTable.tsx';
import { actionsColumn } from '../ui/table/columns.tsx';
import {
  createAppColumnHelper,
  useTunarrTable,
} from '../ui/table/tunarrTable.ts';

const columnHelper = createAppColumnHelper<AdPool>();

/**
 * Fork: Library → Ad Pools. The bins ad breaks draw from. Each is an
 * ordinary filler list, so playback is unchanged; this page shows the ones
 * ad breaks use and keeps them filled from tag searches.
 */
export function AdPoolsPage() {
  const { t } = useLingui();
  const pools = useQuery(getAdPoolsOptions());
  const [dialog, setDialog] = useState<
    { type: 'new' } | { type: 'link'; pool: AdPool } | null
  >(null);
  const actions = usePoolActions();

  const columns = useMemo(
    () => [
      ...columnHelper.columns([
        columnHelper.accessor('name', { header: t`Pool` }),
        columnHelper.accessor('clipCount', { header: t`Clips` }),
        columnHelper.accessor(
          (pool) =>
            pool.smartCollectionId
              ? (pool.smartCollectionName ?? t`a Smart Collection`)
              : t`Hand-picked`,
          { id: 'source', header: t`Fills from` },
        ),
        columnHelper.accessor(
          (pool) =>
            pool.channels.map((c) => `${c.number} ${c.name}`).join(', '),
          {
            id: 'channels',
            header: t`Used by`,
            enableSorting: false,
            cell: ({ row: { original: pool } }) => (
              <Stack direction="row" gap={0.5} sx={{ flexWrap: 'wrap' }}>
                {pool.channels.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    <Trans>No channel yet</Trans>
                  </Typography>
                ) : (
                  pool.channels.map((channel) => (
                    <Tooltip
                      key={channel.id}
                      title={
                        <Plural
                          value={channel.adSpots}
                          one="# ad spot in saved breaks"
                          other="# ad spots in saved breaks"
                        />
                      }
                    >
                      <Chip
                        size="small"
                        clickable
                        component={Link}
                        to={`/channels/${channel.id}/ad-breaks`}
                        label={`${channel.number} · ${channel.name}`}
                      />
                    </Tooltip>
                  ))
                )}
              </Stack>
            ),
          },
        ),
      ]),
      actionsColumn<AdPool>({
        render: ({ original: pool }) =>
          pool.smartCollectionId ? (
            <>
              <Button
                size="small"
                disabled={actions.busy}
                onClick={() => actions.sync(pool)}
              >
                <Trans>Sync now</Trans>
              </Button>
              <Button
                size="small"
                disabled={actions.busy}
                onClick={() => actions.setLink(pool, null)}
              >
                <Trans>Unlink</Trans>
              </Button>
            </>
          ) : (
            <>
              <Button
                size="small"
                disabled={actions.busy}
                onClick={() => setDialog({ type: 'link', pool })}
              >
                <Trans>Link…</Trans>
              </Button>
              <Button
                size="small"
                component={Link}
                to={`/library/fillers/${pool.id}/edit`}
              >
                <Trans>Edit clips</Trans>
              </Button>
            </>
          ),
      }),
    ],
    [actions, t],
  );
  const table = useTunarrTable({ columns, data: pools.data ?? [] });

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap' }}
        gap={2}
      >
        <Typography variant="h4" sx={{ flex: 1 }}>
          <Trans>Ad Pools</Trans>
        </Typography>
        <Button variant="contained" onClick={() => setDialog({ type: 'new' })}>
          <Trans>New pool</Trans>
        </Button>
      </Stack>
      <Typography variant="body1" sx={{ mb: 3, maxWidth: 900 }}>
        <Trans>
          An ad break plays a few ads in a row after each show, then goes back
          to the show, like streaming TV. It doesn't pad to the clock. Each spot
          in a break draws from a pool. A pool can fill itself from a tag search
          (a Smart Collection), so new ads show up after a library scan.
        </Trans>
      </Typography>

      {pools.isError ? (
        <Alert severity="error">
          {getApiErrorMessage(pools.error) ?? t`Couldn't load the ad pools.`}
        </Alert>
      ) : pools.data?.length === 0 ? (
        <Alert severity="info">
          <Trans>
            No ad pools yet. Create one from a Smart Collection with New pool.
            Pools a channel's ad breaks use also show up here.
          </Trans>
        </Alert>
      ) : (
        <DataTable table={table} aria-label={t`Ad pools`} />
      )}
      {dialog?.type === 'new' && (
        <NewPoolDialog onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'link' && (
        <LinkPoolDialog
          pool={dialog.pool}
          busy={actions.busy}
          onLink={(id) =>
            actions.setLink(dialog.pool, id, () => setDialog(null))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </Box>
  );
}

// Linking, syncing and unlinking rewrite a list's clips on the server. The
// filler list editor only reloads a list when a different one opens, so
// forget its copy too.
function usePoolActions() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const refresh = async (poolId: string) => {
    queryClient.removeQueries({ queryKey: fillerListQuery(poolId).queryKey });
    queryClient.removeQueries({
      queryKey: fillerListProgramsQuery(poolId).queryKey,
    });
    if (useStore.getState().fillerListEditor.currentEntity?.id === poolId) {
      clearCurrentFillerList();
    }
    await queryClient.invalidateQueries({
      predicate: invalidateTaggedQueries('Filler Lists'),
    });
  };
  const fail = (error: unknown) =>
    snackbar.enqueueSnackbar(
      getApiErrorMessage(error) ?? t`Couldn't update the pool.`,
      { variant: 'error' },
    );
  const save = useMutation({
    ...putApiFillerListsByIdMutation(),
    onError: fail,
  });
  const sync = useMutation({
    ...syncFillerListFromSmartCollectionMutation(),
    onError: fail,
  });
  return {
    busy: save.isPending || sync.isPending,
    setLink: (
      pool: AdPool,
      smartCollectionId: string | null,
      done?: () => void,
    ) =>
      save.mutate(
        { path: { id: pool.id }, body: { smartCollectionId } },
        {
          onSuccess: () => {
            void refresh(pool.id).then(() => done?.());
          },
        },
      ),
    sync: (pool: AdPool) =>
      sync.mutate(
        { path: { id: pool.id } },
        {
          onSuccess: (result) => {
            void refresh(pool.id).then(() =>
              snackbar.enqueueSnackbar(
                t`${pool.name}: synced ${result.programCount} clips`,
                { variant: 'success' },
              ),
            );
          },
        },
      ),
  };
}

function CollectionSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const collections = useQuery(getApiSmartCollectionsOptions());
  return (
    <FormControl fullWidth disabled={disabled}>
      <InputLabel id="ad-pool-collection">
        <Trans>Smart Collection</Trans>
      </InputLabel>
      <Select
        labelId="ad-pool-collection"
        label={t`Smart Collection`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(collections.data ?? []).map((c) => (
          <MenuItem key={c.uuid} value={c.uuid}>
            {c.name}
          </MenuItem>
        ))}
      </Select>
      <FormHelperText>
        {collections.data?.length === 0
          ? t`Create a Smart Collection under Library first, for example tags = "/commercials/Ads/Retro Gaming" AND type = "other_video".`
          : t`Its playable clips are copied into the pool, and again after every library scan.`}
      </FormHelperText>
    </FormControl>
  );
}

function NewPoolDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const snackbar = useSnackbar();
  const collections = useQuery(getApiSmartCollectionsOptions());
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const create = useMutation({
    ...postApiFillerListsMutation(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        predicate: invalidateTaggedQueries('Filler Lists'),
      });
      snackbar.enqueueSnackbar(t`Created the ${name} pool`, {
        variant: 'success',
      });
      onClose();
    },
    onError: (error) =>
      snackbar.enqueueSnackbar(
        getApiErrorMessage(error) ?? t`Couldn't create the pool.`,
        { variant: 'error' },
      ),
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Trans>New ad pool</Trans>
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          <CollectionSelect
            value={collectionId}
            onChange={(id) => {
              setCollectionId(id);
              if (!name) {
                setName(
                  collections.data?.find((c) => c.uuid === id)?.name ?? '',
                );
              }
            }}
          />
          <TextField
            label={t`Name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="contained"
          disabled={!collectionId || !name.trim() || create.isPending}
          onClick={() =>
            create.mutate({
              body: { name: name.trim(), smartCollectionId: collectionId },
            })
          }
        >
          <Trans>Create</Trans>
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function LinkPoolDialog({
  pool,
  busy,
  onLink,
  onClose,
}: {
  pool: AdPool;
  busy: boolean;
  onLink: (smartCollectionId: string) => void;
  onClose: () => void;
}) {
  const [collectionId, setCollectionId] = useState('');
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        <Trans>Fill {pool.name} from a Smart Collection</Trans>
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            <Trans>
              Linking replaces the pool's hand-picked clips. Unlinking later
              keeps whatever it has then.
            </Trans>
          </Alert>
          <CollectionSelect value={collectionId} onChange={setCollectionId} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="contained"
          disabled={!collectionId || busy}
          onClick={() => onLink(collectionId)}
        >
          <Trans>Link</Trans>
        </Button>
      </DialogActions>
    </Dialog>
  );
}
