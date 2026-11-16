import { ChannelAdBreaksPage } from '@/components/ads/ChannelAdBreaksPage.tsx';
import { channelProgrammingQuery } from '@/hooks/useChannelLineup';
import { channelQuery } from '@/hooks/useChannels';
import { createFileRoute } from '@tanstack/react-router';

// Fork: a channel's ad breaks.
export const Route = createFileRoute('/channels_/$channelId/ad-breaks')({
  loader: ({ params: { channelId }, context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(channelQuery(channelId)),
      queryClient.ensureQueryData(channelProgrammingQuery(channelId)),
    ]),
  component: function AdBreaksRoute() {
    const { channelId } = Route.useParams();
    return <ChannelAdBreaksPage channelId={channelId} />;
  },
});
