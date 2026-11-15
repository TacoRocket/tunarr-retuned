import { getApiTranscodeConfigsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import { DefaultChannel } from '@/helpers/constants.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
} from '@/test/utils.tsx';
import { expect, test, vi } from 'vitest';
import { DuplicateChannelProfileDialog } from './DuplicateChannelProfileDialog.tsx';
import { useChannelBulkActions } from './useChannelBulkActions.ts';

const copy = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCreateChannel.ts', () => ({
  useCreateChannel: () => ({ mutateAsync: copy }),
}));

const channel = (profile: string, number: number) => ({
  ...DefaultChannel,
  id: String(number),
  number,
  name: profile,
  transcodeConfigId: profile,
  startTime: 0,
});

const aac = channel('AAC', 1);
const eac3 = channel('EAC3', 2);

function DuplicateActions() {
  const { duplicateChannels, profileDialog } = useChannelBulkActions();
  return (
    <>
      <button onClick={() => void duplicateChannels([aac])}>Copy AAC</button>
      <button onClick={() => void duplicateChannels([aac, eac3])}>
        Copy both
      </button>
      {profileDialog && <DuplicateChannelProfileDialog {...profileDialog} />}
    </>
  );
}

test('a compatible channel copies in one click and only the EAC3 copy receives the selected replacement', async () => {
  const queryClient = seededQueryClient([
    [
      getApiTranscodeConfigsQueryKey({ query: { backend: 'etv_next' } }),
      [
        { id: 'AAC', name: 'AAC' },
        { id: 'AC3', name: 'AC3' },
      ],
    ],
  ]);
  const { user } = renderWithProviders(<DuplicateActions />, { queryClient });
  await user.click(screen.getByRole('button', { name: 'Copy AAC' }));
  expect(copy.mock.calls.map(([{ body }]) => body)).toEqual([
    { type: 'copy', channelId: aac.id },
  ]);
  copy.mockClear();
  await user.click(screen.getByRole('button', { name: 'Copy both' }));
  expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(copy).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Copy both' }));
  await user.click(screen.getByRole('combobox'));
  expect(screen.queryByRole('option', { name: 'EAC3' })).toBeNull();
  await user.click(screen.getByRole('option', { name: 'AC3' }));
  await user.click(screen.getByRole('button', { name: 'Duplicate' }));
  expect(copy.mock.calls.map(([{ body }]) => body)).toEqual([
    { type: 'copy', channelId: aac.id },
    { type: 'copy', channelId: eac3.id, transcodeConfigId: 'AC3' },
  ]);
});
