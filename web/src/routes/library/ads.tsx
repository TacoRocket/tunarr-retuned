import { AdPoolsPage } from '@/components/ads/AdPoolsPage.tsx';
import { getAdPoolsOptions } from '@/generated/@tanstack/react-query.gen.ts';
import { createFileRoute } from '@tanstack/react-router';

// Fork: Library → Ad Pools.
export const Route = createFileRoute('/library/ads')({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData(getAdPoolsOptions()),
  component: AdPoolsPage,
});
