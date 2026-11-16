import { setCurrentChannel } from '@/store/channelEditor/actions.ts';
import useStore from '@/store/index.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
} from '@/test/utils.tsx';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { Channel } from '@tunarr/types';
import { beforeEach, expect, test, vi } from 'vitest';
import { ChannelAdBreaksPage } from './ChannelAdBreaksPage.tsx';

const gaming = '11111111-1111-4111-8111-111111111111';
const promos = '22222222-2222-4222-8222-222222222222';

const redraw = vi.hoisted(() =>
  vi.fn(
    (_vars: unknown): Promise<unknown> =>
      Promise.resolve({ refreshedPositions: 3, matchedPositions: 3 }),
  ),
);
const server = vi.hoisted(() => ({
  channel: {} as Record<string, unknown>,
  programming: {} as Record<string, unknown>,
}));
vi.mock('@/generated/@tanstack/react-query.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshChannelFillerMutation: () => ({ mutationFn: redraw }),
  getApiFillerListsOptions: () => ({
    queryKey: ['filler-lists'],
    queryFn: () =>
      Promise.resolve([
        { id: gaming, name: 'Retro Gaming' },
        { id: promos, name: 'Station Promos' },
      ]),
  }),
  getChannelsByNumberV2Options: () => ({
    queryKey: ['channel'],
    queryFn: () => Promise.resolve(server.channel),
  }),
  getApiChannelsByIdProgrammingOptions: () => ({
    queryKey: ['programming'],
    queryFn: () => Promise.resolve(server.programming),
  }),
}));

const channel = (extra: Partial<Channel> = {}) =>
  ({
    id: 'c',
    number: 4,
    name: 'Cartoons',
    onDemand: { enabled: false },
    offset: null,
    ...extra,
  }) as Channel;
const show = (id: string) => ({ type: 'content', id, duration: 1_200_000 });
const ad = (id: string, fillerListId: string) => ({
  type: 'filler',
  id,
  duration: 30_000,
  fillerListId,
  fillerType: 'post',
});
const recipe = [{ fillerListIds: [gaming] }, { fillerListIds: [promos] }];
const programming = (padMs: number, items: object[]) => ({
  lineup: items,
  programs: {},
  totalPrograms: items.length,
  startTimeOffsets: items.map((_, i) => i),
  schedule: {
    type: 'random',
    padMs,
    slots: [
      { type: 'custom-show', postProgramPod: recipe },
      { type: 'custom-show', postProgramPod: recipe },
    ],
  },
});
const lineup = [
  show('ep-1'),
  ad('a', gaming),
  ad('b', promos),
  show('ep-2'),
  ad('c', gaming),
  ad('d', promos),
];

function render() {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <ChannelAdBreaksPage channelId="c" />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return renderWithProviders(<RouterProvider router={router} />, {
    queryClient: seededQueryClient([]),
  });
}

beforeEach(() => {
  redraw.mockClear();
  server.channel = channel();
  server.programming = programming(1, lineup);
});

test('shows the breaks, the recipe, and no clock padding', async () => {
  render();
  expect(await screen.findByText('2 breaks, 2 ads each.')).toBeVisible();
  expect(screen.getByText(/No clock padding/)).toBeVisible();
  expect(screen.getByText('After every show')).toBeVisible();
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    'Retro Gaming',
    'Station Promos',
  ]);
});

test('warns when the schedule pads to the clock', async () => {
  server.programming = programming(30 * 60_000, lineup);
  render();
  expect(
    await screen.findByText(/pads to the next 30-minute mark/),
  ).toBeVisible();
});

test("Time Slots channels explain instead of counting upstream's filler", async () => {
  server.programming = {
    ...programming(1, lineup),
    schedule: { type: 'time', padMs: 1, slots: [] },
  };
  render();
  expect(await screen.findByText(/uses Time Slots/)).toBeVisible();
  expect(screen.queryByText(/breaks,/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Redraw' })).toBeNull();
});

test('an offset channel points at its source', async () => {
  server.channel = channel({
    offset: { sourceChannelId: 'src', hours: 3 },
  } as Partial<Channel>);
  render();
  expect(
    await screen.findByRole('link', { name: "See that channel's ad breaks" }),
  ).toHaveAttribute('href', '/channels/src/ad-breaks');
});

// The programming editor only reloads a channel when a different one opens,
// so a redraw puts the new lineup there when it holds this channel.
test('redraws the ticked pools and refreshes an open editor', async () => {
  setCurrentChannel(channel(), programming(1, lineup) as never);
  const { user } = render();
  await user.click(
    await screen.findByRole('checkbox', { name: /Station Promos/ }),
  );
  server.programming = programming(1, [
    show('ep-1'),
    ad('x', gaming),
    ad('b', promos),
    show('ep-2'),
    ad('y', gaming),
    ad('d', promos),
  ]);
  await user.click(screen.getByRole('button', { name: 'Redraw' }));

  expect(redraw).toHaveBeenCalledWith({
    path: { id: 'c' },
    body: { fillerListIds: [gaming] },
  });
  await vi.waitFor(() =>
    expect(
      useStore
        .getState()
        .channelEditor.programList.map((p) => ('id' in p ? p.id : p.type)),
    ).toEqual(['ep-1', 'x', 'b', 'ep-2', 'y', 'd']),
  );
});
