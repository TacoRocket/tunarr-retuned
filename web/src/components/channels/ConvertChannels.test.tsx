import { getApiTranscodeConfigsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import { DefaultChannel } from '@/helpers/constants.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
  within,
} from '@/test/utils.tsx';
import type { Channel } from '@tunarr/types';
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

const legacyAac = channel(1, 'AAC');
const legacyEac3 = channel(2, 'EAC3');
const hlsAlt = channel(3, 'AAC', { streamMode: 'hls_slower' });
const onNext = channel(4, 'AAC', { useEtvNext: true });

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

beforeEach(() => {
  update.mockReset();
  update.mockImplementation(
    ({ path, body }: { path: { id: string }; body: object }) =>
      Promise.resolve({ ...body, id: path.id }),
  );
  onConverted.mockReset();
});

test('a legacy channel whose profile plays on Next converts in one click', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[legacyAac, hlsAlt]} />,
    { queryClient: profiles() },
  );
  await user.click(screen.getByRole('button', { name: 'Convert' }));

  const bodies = update.mock.calls.map(([{ body }]) => body as Channel);
  expect(bodies.map((b) => [b.useEtvNext, b.streamMode])).toEqual([
    [true, 'hls'],
    // HLS Alt only exists on the native pipeline.
    [true, 'hls'],
  ]);
  expect(bodies.map((b) => b.transcodeConfigId)).toEqual(['AAC', 'AAC']);
  // Sending these would reset an on-demand channel or the schedule clock.
  for (const body of bodies) {
    expect(body).not.toHaveProperty('startTime');
    expect(body).not.toHaveProperty('onDemand');
    expect(body.name).toBe(body.number === 1 ? legacyAac.name : hlsAlt.name);
  }
  expect(onConverted.mock.calls.map(([saved]) => saved.id)).toEqual(['1', '3']);
});

test('only channels Next cannot play take the chosen profile; canceling converts nothing', async () => {
  const { user } = renderWithProviders(
    <ConvertActions channels={[legacyAac, legacyEac3, onNext]} />,
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
