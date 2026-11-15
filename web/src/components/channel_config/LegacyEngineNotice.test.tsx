import { getApiTranscodeConfigsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import { DefaultChannel } from '@/helpers/constants.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
} from '@/test/utils.tsx';
import type { Channel } from '@tunarr/types';
import { expect, test, vi } from 'vitest';
import { LegacyEngineNotice } from './LegacyEngineNotice.tsx';

const update = vi.hoisted(() =>
  vi.fn(({ path, body }: { path: { id: string }; body: object }) =>
    Promise.resolve({ ...body, id: path.id }),
  ),
);
vi.mock('@/hooks/useUpdateChannel.ts', () => ({
  useUpdateChannel: () => ({ mutateAsync: update }),
}));
vi.mock('@/hooks/useCreateChannel.ts', () => ({
  useCreateChannel: () => ({ mutateAsync: vi.fn() }),
}));
// Full records, as GET /channels/{id} returns them.
const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/generated/@tanstack/react-query.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getChannelsByNumberV2Options: ({ path }: { path: { id: string } }) => ({
    queryKey: ['channel', path.id],
    queryFn: () => Promise.resolve(records.get(path.id)),
  }),
}));
vi.mock('@/components/base/RouterButtonLink.tsx', () => ({
  RouterButtonLink: ({
    children,
    params,
  }: {
    children: React.ReactNode;
    params: { channelId: string };
  }) => <a href={`/channels/${params.channelId}/edit`}>{children}</a>,
}));

const channel = (overrides: Partial<Channel>) =>
  ({
    ...DefaultChannel,
    id: 'c1',
    number: 1,
    name: 'Legacy',
    transcodeConfigId: 'AAC',
    startTime: 0,
    ...overrides,
  }) as Channel;

const queryClient = (...saved: Channel[]) => {
  records.clear();
  for (const record of saved) records.set(record.id, record);
  return seededQueryClient([
    [
      getApiTranscodeConfigsQueryKey({ query: { backend: 'etv_next' } }),
      [{ id: 'AAC', name: 'AAC' }],
    ],
  ]);
};

test('a channel already on ErsatzTV next shows no notice', () => {
  renderWithProviders(
    <LegacyEngineNotice
      channel={channel({ useEtvNext: true })}
      onConverted={vi.fn()}
    />,
    { queryClient: queryClient() },
  );
  expect(screen.queryByText(/legacy playback engine/)).toBeNull();
});

test('a legacy channel is offered a one-click conversion and says when its stream mode changes', async () => {
  const legacy = channel({ useEtvNext: false, streamMode: 'hls_slower' });
  const onConverted = vi.fn();
  const { user } = renderWithProviders(
    <LegacyEngineNotice channel={legacy} onConverted={onConverted} />,
    { queryClient: queryClient(legacy) },
  );
  expect(
    screen.getByText('This channel uses the legacy playback engine'),
  ).toBeVisible();
  expect(screen.getByText(/changes from HLS Alt to HLS/)).toBeVisible();
  expect(screen.getByText(/switch back under Streaming/)).toBeVisible();

  await user.click(
    screen.getByRole('button', { name: 'Convert to ErsatzTV next' }),
  );
  expect(update).toHaveBeenCalledTimes(1);
  expect(onConverted).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'c1', useEtvNext: true, streamMode: 'hls' }),
  );
});

test('an offset channel points at its source instead of converting', async () => {
  const source = channel({ id: 'src', name: 'The Late Show' });
  renderWithProviders(
    <LegacyEngineNotice
      channel={channel({
        useEtvNext: false,
        offset: { sourceChannelId: 'src', hours: 3 },
      })}
      onConverted={vi.fn()}
    />,
    { queryClient: queryClient(source) },
  );
  expect(await screen.findByText(/It plays The Late Show later/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Convert to ErsatzTV next' }),
  ).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Open The Late Show' }),
  ).toHaveAttribute('href', '/channels/src/edit');
});
