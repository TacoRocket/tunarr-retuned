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

const queryClient = () =>
  seededQueryClient([
    [
      getApiTranscodeConfigsQueryKey({ query: { backend: 'etv_next' } }),
      [{ id: 'AAC', name: 'AAC' }],
    ],
  ]);

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
  const onConverted = vi.fn();
  const { user } = renderWithProviders(
    <LegacyEngineNotice
      channel={channel({ useEtvNext: false, streamMode: 'hls_slower' })}
      onConverted={onConverted}
    />,
    { queryClient: queryClient() },
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
