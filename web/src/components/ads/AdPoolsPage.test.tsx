import {
  renderWithProviders,
  screen,
  seededQueryClient,
  withinRow,
} from '@/test/utils.tsx';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { AdPoolsPage } from './AdPoolsPage.tsx';

const putList = vi.hoisted(() =>
  vi.fn((_vars: unknown): Promise<unknown> => Promise.resolve({})),
);
const syncList = vi.hoisted(() =>
  vi.fn(
    (_vars: unknown): Promise<unknown> => Promise.resolve({ programCount: 99 }),
  ),
);
const createList = vi.hoisted(() =>
  vi.fn((_vars: unknown): Promise<unknown> => Promise.resolve({ id: 'new' })),
);
vi.mock('@/generated/@tanstack/react-query.gen.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  putApiFillerListsByIdMutation: () => ({ mutationFn: putList }),
  syncFillerListFromSmartCollectionMutation: () => ({ mutationFn: syncList }),
  postApiFillerListsMutation: () => ({ mutationFn: createList }),
  getApiSmartCollectionsOptions: () => ({
    queryKey: ['smart-collections'],
    queryFn: () =>
      Promise.resolve([
        { uuid: 'sc1', name: 'Ads: Retro Gaming', keywords: '' },
        { uuid: 'sc2', name: 'Promos', keywords: '' },
      ]),
  }),
  getAdPoolsOptions: () => ({
    queryKey: ['ad-pools'],
    queryFn: () =>
      Promise.resolve([
        {
          id: 'gaming',
          name: 'Retro Gaming',
          clipCount: 99,
          smartCollectionId: 'sc1',
          smartCollectionName: 'Ads: Retro Gaming',
          channels: [
            {
              id: 'c4',
              number: 4,
              name: 'Cartoons',
              adSpots: 1200,
              inRecipe: true,
            },
          ],
        },
        {
          id: 'promos',
          name: 'Station Promos',
          clipCount: 3,
          smartCollectionId: null,
          smartCollectionName: null,
          channels: [],
        },
      ]),
  }),
}));

function render() {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <AdPoolsPage /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return renderWithProviders(<RouterProvider router={router} />, {
    queryClient: seededQueryClient([]),
  });
}

beforeEach(() => {
  putList.mockClear();
  syncList.mockClear();
  createList.mockClear();
});

test('lists each pool with where its clips come from and who uses it', async () => {
  render();
  expect(await screen.findByText('Retro Gaming')).toBeVisible();
  const gaming = withinRow('Retro Gaming');
  expect(gaming.getByText('Ads: Retro Gaming')).toBeVisible();
  expect(gaming.getByRole('link', { name: '4 · Cartoons' })).toHaveAttribute(
    'href',
    '/channels/c4/ad-breaks',
  );
  const promos = withinRow('Station Promos');
  expect(promos.getByText('Hand-picked')).toBeVisible();
  expect(promos.getByText('No channel yet')).toBeVisible();
});

test('a linked pool syncs and unlinks', async () => {
  const { user } = render();
  await screen.findByText('Retro Gaming');
  await user.click(
    withinRow('Retro Gaming').getByRole('button', { name: 'Sync now' }),
  );
  expect(syncList).toHaveBeenCalledWith({ path: { id: 'gaming' } });
  await user.click(
    withinRow('Retro Gaming').getByRole('button', { name: 'Unlink' }),
  );
  expect(putList).toHaveBeenCalledWith({
    path: { id: 'gaming' },
    body: { smartCollectionId: null },
  });
});

test('a hand-picked pool can be linked to a Smart Collection', async () => {
  const { user } = render();
  await screen.findByText('Station Promos');
  await user.click(
    withinRow('Station Promos').getByRole('button', { name: 'Link…' }),
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(/replaces the pool's hand-picked clips/);
  await user.click(
    await screen.findByRole('combobox', { name: 'Smart Collection' }),
  );
  await user.click(await screen.findByRole('option', { name: 'Promos' }));
  await user.click(screen.getByRole('button', { name: 'Link' }));
  expect(putList).toHaveBeenCalledWith({
    path: { id: 'promos' },
    body: { smartCollectionId: 'sc2' },
  });
});

test('a new pool starts from a Smart Collection', async () => {
  const { user } = render();
  await user.click(await screen.findByRole('button', { name: 'New pool' }));
  await user.click(
    await screen.findByRole('combobox', { name: 'Smart Collection' }),
  );
  await user.click(
    await screen.findByRole('option', { name: 'Ads: Retro Gaming' }),
  );
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Ads: Retro Gaming',
  );
  await user.click(screen.getByRole('button', { name: 'Create' }));
  expect(createList).toHaveBeenCalledWith({
    body: { name: 'Ads: Retro Gaming', smartCollectionId: 'sc1' },
  });
});
