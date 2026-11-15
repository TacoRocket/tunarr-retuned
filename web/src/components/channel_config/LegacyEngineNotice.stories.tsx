import { DefaultChannel } from '@/helpers/constants.ts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Channel } from '@tunarr/types';
import { SnackbarProvider } from 'notistack';
import { fn } from 'storybook/test';
import { LegacyEngineNotice } from './LegacyEngineNotice.tsx';

// The notice at the top of a legacy channel's edit page.
const legacy = (streamMode: Channel['streamMode']) =>
  ({
    ...DefaultChannel,
    id: 'story-legacy',
    number: 7,
    name: 'Saturday Morning Cartoons',
    transcodeConfigId: 'default',
    startTime: 0,
    useEtvNext: false,
    streamMode,
  }) as Channel;

const meta = {
  title: 'Channels/LegacyEngineNotice',
  component: LegacyEngineNotice,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <SnackbarProvider>
          <div style={{ padding: 16 }}>
            <Story />
          </div>
        </SnackbarProvider>
      </QueryClientProvider>
    ),
  ],
  args: { channel: legacy('hls'), onConverted: fn() },
} satisfies Meta<typeof LegacyEngineNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hls: Story = {};

// HLS Alt only exists on the native pipeline, so the notice says it changes.
export const HlsAlt: Story = { args: { channel: legacy('hls_slower') } };
