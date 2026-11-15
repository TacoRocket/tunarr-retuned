import { getChannelsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
  within,
} from '@/test/utils.tsx';
import type { Channel } from '@tunarr/types';
import { beforeEach, expect, test, vi } from 'vitest';
import { ChannelOffsetSettings } from './ChannelOffsetSettings.tsx';

const setOffset = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
const clearOffset = vi.hoisted(() => vi.fn(() => Promise.resolve({})));
vi.mock('@/generated/@tanstack/react-query.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setChannelOffsetMutation: () => ({ mutationFn: setOffset }),
  clearChannelOffsetMutation: () => ({ mutationFn: clearOffset }),
}));

const channel = (id: string, number: number, extra: Partial<Channel> = {}) =>
  ({
    id,
    number,
    name: `Channel ${number}`,
    onDemand: { enabled: false },
    offset: null,
    ...extra,
  }) as Channel;

const source = channel('src', 1);
const plain = channel('me', 2);
const onDemand = channel('od', 3, {
  onDemand: { enabled: true },
} as Partial<Channel>);
const follower = channel('f', 4, {
  offset: { sourceChannelId: 'src', hours: 3 },
});

function render(me: Channel, others: Channel[], hasUnsavedChanges = false) {
  return renderWithProviders(
    <ChannelOffsetSettings
      channel={me}
      hasUnsavedChanges={hasUnsavedChanges}
    />,
    {
      queryClient: seededQueryClient([
        [getChannelsQueryKey(), [me, ...others]],
      ]),
    },
  );
}

beforeEach(() => {
  setOffset.mockClear();
  clearOffset.mockClear();
});

test('a channel can be set to play another channel later', async () => {
  const { user } = render(plain, [source, onDemand, follower]);
  await user.click(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  );
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(/replaces this channel's programming/),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Source channel' }),
  );
  // Offset and on-demand channels can't be followed.
  expect(
    screen.getAllByRole('option').map((option) => option.textContent),
  ).toEqual(['1 · Channel 1']);
  await user.click(screen.getByRole('option', { name: '1 · Channel 1' }));
  const hours = within(dialog).getByRole('spinbutton', { name: 'Hours later' });
  await user.clear(hours);
  await user.type(hours, '1');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  expect(setOffset).toHaveBeenCalledWith({
    path: { id: 'me' },
    body: { sourceChannelId: 'src', hours: 1, picture: { mode: 'source' } },
  });
});

test('an offset channel says what it follows and can stop following', async () => {
  const { user } = render(follower, [source]);
  expect(screen.getByText(/Plays Channel 1 3 hours later/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Stop following' }));
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(/keeps the programming it has now/),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole('button', { name: 'Stop following' }),
  );
  expect(clearOffset).toHaveBeenCalledWith({ path: { id: 'f' } });
});

test("a channel others follow can't follow another, and says why", () => {
  render(source, [follower]);
  expect(screen.getByText(/Other channels play this one later/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  ).toBeDisabled();
});

test('unsaved channel changes must be saved or discarded first', () => {
  render(plain, [source], true);
  expect(
    screen.getByText('Save or discard your channel changes first.'),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  ).toBeDisabled();
});
