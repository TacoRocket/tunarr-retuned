import { getApiTranscodeConfigsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import { DefaultChannel } from '@/helpers/constants.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
  within,
} from '@/test/utils.tsx';
import type { Channel } from '@tunarr/types';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, expect, test, vi } from 'vitest';
import { DuplicateChannelProfileDialog } from './DuplicateChannelProfileDialog.tsx';
import { useChannelBulkActions } from './useChannelBulkActions.ts';

// Conversion moves legacy channels to ErsatzTV next and nothing else: the
// rest of the channel, and the server-owned playback state, stay untouched.

const update = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useUpdateChannel.ts', () => ({
  useUpdateChannel: () => ({ mutateAsync: update }),
}));
vi.mock('@/hooks/useCreateChannel.ts', () => ({
  useCreateChannel: () => ({ mutateAsync: vi.fn() }),
}));
const enqueueSnackbar = vi.hoisted(() => vi.fn());
vi.mock('notistack', () => ({ useSnackbar: () => ({ enqueueSnackbar }) }));

// Full records, as GET /channels/{id} returns them.
const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/generated/@tanstack/react-query.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getChannelsByNumberV2Options: ({ path }: { path: { id: string } }) => ({
    queryKey: ['channel', path.id],
    queryFn: () => Promise.resolve(records.get(path.id)),
  }),
}));

const channel = (
  number: number,
  profile: string,
  overrides: Partial<Channel> = {},
) =>
  ({
    ...DefaultChannel,
    id: String(number),
    number,
    name: `Channel ${number}`,
    transcodeConfigId: profile,
    startTime: 1234,
    useEtvNext: false,
    ...overrides,
  }) as Channel;

// What the channel list returns: no filler or subtitle settings.
const listRow = (full: Channel) => {
  const { fillerCollections: _f, subtitlePreferences: _s, ...row } = full;
  return row as Channel;
};

const settings = {
  fillerCollections: [{ id: 'filler-1', weight: 55, cooldownSeconds: 600 }],
  subtitlePreferences: [
    {
      langugeCode: 'en',
      priority: 0,
      allowImageBased: false,
      allowExternal: true,
      filter: 'forced',
    },
  ],
} satisfies Partial<Channel>;

const legacyAac = channel(1, 'AAC', settings);
const legacyEac3 = channel(2, 'EAC3', settings);
const hlsAlt = channel(3, 'AAC', { ...settings, streamMode: 'hls_slower' });
const onNext = channel(4, 'AAC', { useEtvNext: true });
const offsetOf1 = channel(5, 'AAC', {
  offset: { sourceChannelId: '1', hours: 3 },
});

const onConverted = vi.fn();

function ConvertActions({ channels }: { channels: Channel[] }) {
  const { convertChannels, profileDialog } = useChannelBulkActions();
  return (
    <>
      <button onClick={() => void convertChannels(channels, onConverted)}>
        Convert
      </button>
      {profileDialog && <DuplicateChannelProfileDialog {...profileDialog} />}
    </>
  );
}

const profiles = () =>
  seededQueryClient([
    [
      getApiTranscodeConfigsQueryKey({ query: { backend: 'etv_next' } }),
      [
        { id: 'AAC', name: 'AAC' },
        { id: 'AC3', name: 'AC3' },
      ],
    ],
  ]);

const refused = (message: string) =>
  new AxiosError(
    'Request failed with status code 400',
    '400',
    undefined,
    undefined,
    {
      data: { error: message },
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );

const bodies = () => update.mock.calls.map(([{ body }]) => body as Channel);

beforeEach(() => {
  update.mockReset();
  update.mockImplementation(
    ({ path, body }: { path: { id: string }; body: object }) =>
      Promise.resolve({ ...body, id: path.id }),
  );
  onConverted.mockReset();
  enqueueSnackbar.mockReset();
  records.clear();
  for (const full of [legacyAac, legacyEac3, hlsAlt, onNext, offsetOf1]) {
    records.set(full.id, full);
  }
});

test('a legacy channel whose profile plays on Next converts in one click', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[legacyAac, hlsAlt].map(listRow)} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  expect(bodies().map((b) => [b.useEtvNext, b.streamMode])).toEqual([
    [true, 'hls'],
    // HLS Alt only exists on the native pipeline.
    [true, 'hls'],
  ]);
  expect(bodies().map((b) => b.transcodeConfigId)).toEqual(['AAC', 'AAC']);
  for (const body of bodies()) {
    // Sending these would reset an on-demand channel or the schedule clock.
    expect(body).not.toHaveProperty('startTime');
    expect(body).not.toHaveProperty('onDemand');
    expect(body.name).toBe(body.number === 1 ? legacyAac.name : hlsAlt.name);
  }
  expect(onConverted.mock.calls.map(([saved]) => saved.id)).toEqual(['1', '3']);
  expect(enqueueSnackbar).toHaveBeenCalledWith(
    'Converted 2 channels to ErsatzTV next',
    { variant: 'success' },
  );
});

// A save replaces filler and subtitle settings with what it carries, so a
// conversion started from a list row must not save the row.
test('converting from the channel list keeps filler and subtitle settings', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[listRow(legacyAac)]} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  expect(bodies()).toHaveLength(1);
  expect(bodies()[0]?.fillerCollections).toEqual(settings.fillerCollections);
  expect(bodies()[0]?.subtitlePreferences).toEqual(
    settings.subtitlePreferences,
  );
});

test('only channels Next cannot play take the chosen profile; canceling converts nothing', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[legacyAac, legacyEac3, onNext].map(listRow)} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));
  expect(
    screen.getByText(/can't play the transcode profile of Channel 2\./),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(update).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Convert' }));
  await user.click(screen.getByRole('combobox'));
  expect(screen.queryByRole('option', { name: 'EAC3' })).toBeNull();
  await user.click(screen.getByRole('option', { name: 'AC3' }));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Convert',
    }),
  );
  // The channel already on Next is left alone.
  expect(
    update.mock.calls.map(([{ path, body }]) => [
      path.id,
      (body as Channel).transcodeConfigId,
    ]),
  ).toEqual([
    ['1', 'AAC'],
    ['2', 'AC3'],
  ]);
});

test('a refused conversion names the channel and the server reason, and the rest still convert', async () => {
  update.mockImplementation(
    ({ path, body }: { path: { id: string }; body: object }) =>
      path.id === '1'
        ? Promise.reject(
            refused(
              'ErsatzTV next can\'t play the transcode profile "AAC": audioFormat must be one of aac, ac3. Choose a profile it can play.',
            ),
          )
        : Promise.resolve({ ...body, id: path.id }),
  );
  const { user } = renderWithProviders(
    <ConvertActions channels={[legacyAac, hlsAlt].map(listRow)} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  expect(onConverted.mock.calls.map(([saved]) => saved.id)).toEqual(['3']);
  expect(enqueueSnackbar).toHaveBeenCalledWith(
    [
      'Converted 1 of 2 channels. These stay on the legacy engine and still play:',
      'Channel 1: ErsatzTV next can\'t play the transcode profile "AAC": audioFormat must be one of aac, ac3. Choose a profile it can play.',
    ].join('\n'),
    expect.objectContaining({ variant: 'error' }),
  );
});

test('a save that leaves the channel on the legacy engine is not counted as converted', async () => {
  update.mockImplementation(({ path }: { path: { id: string } }) =>
    Promise.resolve({
      ...(records.get(path.id) as Channel),
      useEtvNext: false,
    }),
  );
  const { user } = renderWithProviders(
    <ConvertActions channels={[listRow(legacyAac)]} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  expect(onConverted).not.toHaveBeenCalled();
  expect(enqueueSnackbar).toHaveBeenCalledWith(
    expect.stringContaining(
      'Channel 1: It is still on the legacy engine after saving.',
    ),
    expect.objectContaining({ variant: 'error' }),
  );
});

test('an offset channel selected with its source converts with the source', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[legacyAac, offsetOf1].map(listRow)} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  expect(update.mock.calls.map(([{ path }]) => path.id)).toEqual(['1']);
  expect(enqueueSnackbar).not.toHaveBeenCalledWith(
    expect.stringContaining('follows'),
    expect.anything(),
  );
});

test('an offset channel selected alone points at its source and changes nothing', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[listRow(offsetOf1)]} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  expect(update).not.toHaveBeenCalled();
  expect(enqueueSnackbar).toHaveBeenCalledWith(
    'Channel 5 follows Channel 1. Convert Channel 1 to move both.',
    expect.objectContaining({ variant: 'info' }),
  );
});
