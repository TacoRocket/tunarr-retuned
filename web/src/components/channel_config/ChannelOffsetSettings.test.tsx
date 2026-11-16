import { getChannelsQueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
  within,
} from '@/test/utils.tsx';
import { setCurrentChannel } from '@/store/channelEditor/actions.ts';
import useStore from '@/store/index.ts';
import type { Channel, TranscodeConfig } from '@tunarr/types';
import { beforeEach, expect, test, vi } from 'vitest';
import { ChannelOffsetSettings } from './ChannelOffsetSettings.tsx';

const setOffset = vi.hoisted(() =>
  vi.fn((_vars: unknown): Promise<unknown> => Promise.resolve({})),
);
const clearOffset = vi.hoisted(() =>
  vi.fn((_vars: unknown): Promise<unknown> => Promise.resolve({})),
);
const loadProgramming = vi.hoisted(() =>
  vi.fn((_id: string): Promise<unknown> => Promise.resolve({})),
);
vi.mock('@/generated/@tanstack/react-query.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setChannelOffsetMutation: () => ({ mutationFn: setOffset }),
  clearChannelOffsetMutation: () => ({ mutationFn: clearOffset }),
  getApiChannelsByIdProgrammingOptions: (options: {
    path: { id: string };
  }) => ({
    queryKey: ['programming', options.path.id],
    queryFn: () => loadProgramming(options.path.id),
  }),
}));

const channel = (id: string, number: number, extra: Partial<Channel> = {}) =>
  ({
    id,
    number,
    name: `Channel ${number}`,
    onDemand: { enabled: false },
    offset: null,
    streamMode: 'hls',
    transcodeConfigId: 'vaapi',
    ...extra,
  }) as Channel;

const profiles = [
  {
    id: 'vaapi',
    hardwareAccelerationMode: 'vaapi',
    disableHardwareEncoding: false,
    disableHardwareFilters: false,
  },
] as TranscodeConfig[];

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
      transcodeConfigs={profiles}
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
  loadProgramming.mockClear();
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

// Codex review of #252: a delay-only edit sent the look as Quality with no
// extras, overwriting the saved picture.
test('changing only the hours keeps the saved custom picture', async () => {
  const styled = channel('s', 5, {
    offset: {
      sourceChannelId: 'src',
      hours: 3,
      picture: {
        mode: 'custom',
        crt: {
          enabled: true,
          look: 'tv-broadcast',
          processing: 'experimental',
          broadcastGrain: 'half',
          broadcastTexture: 'classic-flat',
          broadcastComposite: true,
        },
      },
    },
  } as Partial<Channel>);
  const { user } = render(styled, [source]);
  await user.click(screen.getByRole('button', { name: 'Change…' }));
  const dialog = screen.getByRole('dialog');
  const hours = within(dialog).getByRole('spinbutton', { name: 'Hours later' });
  await user.clear(hours);
  await user.type(hours, '4');
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  // Left out, the API keeps the saved picture.
  expect(setOffset).toHaveBeenCalledWith({
    path: { id: 's' },
    body: { sourceChannelId: 'src', hours: 4 },
  });
});

test("looks the chosen source can't draw are disabled, with the reason", async () => {
  const direct = channel('d', 6, {
    streamMode: 'hls_direct_v2',
  } as Partial<Channel>);
  const { user } = render(plain, [source, direct]);
  await user.click(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  );
  const dialog = screen.getByRole('dialog');
  const pick = async (name: string) => {
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Source channel' }),
    );
    await user.click(screen.getByRole('option', { name }));
  };
  const lookDisabled = async () => {
    await user.click(within(dialog).getByRole('combobox', { name: 'Picture' }));
    const disabled = screen
      .getByRole('option', { name: 'Its own look: Classic flat' })
      .getAttribute('aria-disabled');
    const sameEnabled = screen
      .getByRole('option', { name: 'Same as the source (recommended)' })
      .getAttribute('aria-disabled');
    await user.keyboard('{Escape}');
    return { disabled, sameEnabled };
  };

  await pick('6 · Channel 6');
  expect(await lookDisabled()).toEqual({ disabled: 'true', sameEnabled: null });
  expect(within(dialog).getByText(/source uses HLS Direct/)).toBeVisible();

  await pick('1 · Channel 1');
  expect(await lookDisabled()).toEqual({ disabled: null, sameEnabled: null });
});

// Codex review of #252: Picture & Credits reads the editor store, which kept
// the old offset for the same channel after linking or stopping.
test('linking and stopping update the channel the other tabs read', async () => {
  const setEditing = (c: Channel) =>
    useStore.setState((state) => ({
      channelEditor: {
        ...state.channelEditor,
        currentEntity: c as never,
        originalEntity: c as never,
      },
    }));
  setEditing(plain);
  setOffset.mockResolvedValueOnce({
    ...plain,
    offset: { sourceChannelId: 'src', hours: 1 },
  });
  const { user, unmount } = render(plain, [source]);
  await user.click(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  );
  const dialog = screen.getByRole('dialog');
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Source channel' }),
  );
  await user.click(screen.getByRole('option', { name: '1 · Channel 1' }));
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await vi.waitFor(() =>
    expect(useStore.getState().channelEditor.currentEntity?.offset).toEqual({
      sourceChannelId: 'src',
      hours: 1,
    }),
  );
  unmount();

  setEditing(follower);
  clearOffset.mockResolvedValueOnce({ ...follower, offset: null });
  const again = render(follower, [source]);
  await again.user.click(
    screen.getByRole('button', { name: 'Stop following' }),
  );
  await again.user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Stop following',
    }),
  );
  await vi.waitFor(() =>
    expect(useStore.getState().channelEditor.currentEntity?.offset).toBeNull(),
  );
});

const lineupOf = (...durations: number[]) =>
  ({
    lineup: durations.map((duration) => ({ type: 'flex', duration })),
    programs: {},
    totalPrograms: 0,
    startTimeOffsets: durations.map((_, i) => i),
  }) as never;
const editorDurations = () =>
  useStore.getState().channelEditor.programList.map((p) => p.duration);

// Codex review of #252, round 2: linking re-copies the source's lineup on the
// server, but the editor kept the lineup it had loaded for this channel, so
// Programming showed the old one and could save it back.
test('linking and stopping reload the lineup the editor holds', async () => {
  setCurrentChannel(plain, lineupOf(1000));
  setOffset.mockResolvedValueOnce({
    ...plain,
    offset: { sourceChannelId: 'src', hours: 1 },
  });
  loadProgramming.mockResolvedValueOnce(lineupOf(2000, 3000));
  const { user, unmount } = render(plain, [source]);
  await user.click(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  );
  const dialog = screen.getByRole('dialog');
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Source channel' }),
  );
  await user.click(screen.getByRole('option', { name: '1 · Channel 1' }));
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await vi.waitFor(() => expect(editorDurations()).toEqual([2000, 3000]));
  expect(loadProgramming).toHaveBeenCalledWith('me');
  unmount();

  setCurrentChannel(follower, lineupOf(1000));
  clearOffset.mockResolvedValueOnce({ ...follower, offset: null });
  loadProgramming.mockResolvedValueOnce(lineupOf(4000));
  const again = render(follower, [source]);
  await again.user.click(
    screen.getByRole('button', { name: 'Stop following' }),
  );
  await again.user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Stop following',
    }),
  );
  await vi.waitFor(() => expect(editorDurations()).toEqual([4000]));
});

// If the fresh lineup can't be read, the editor drops the old one so the
// Programming page loads it again instead of showing it.
test('a lineup that fails to reload is dropped, not kept', async () => {
  setCurrentChannel(plain, lineupOf(1000));
  setOffset.mockResolvedValueOnce({
    ...plain,
    offset: { sourceChannelId: 'src', hours: 1 },
  });
  loadProgramming.mockRejectedValueOnce(new Error('offline'));
  const { user } = render(plain, [source]);
  await user.click(
    screen.getByRole('button', { name: 'Play another channel later…' }),
  );
  const dialog = screen.getByRole('dialog');
  await user.click(
    within(dialog).getByRole('combobox', { name: 'Source channel' }),
  );
  await user.click(screen.getByRole('option', { name: '1 · Channel 1' }));
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
  await vi.waitFor(() =>
    expect(useStore.getState().channelEditor.currentEntity?.offset).toEqual({
      sourceChannelId: 'src',
      hours: 1,
    }),
  );
  expect(useStore.getState().channelEditor.programsLoaded).toBe(false);
  expect(editorDurations()).toEqual([]);
  // The save still counts as done: the dialog closes rather than erroring.
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
