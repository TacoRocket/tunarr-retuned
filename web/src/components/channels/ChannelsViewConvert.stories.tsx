import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ChannelsView } from './ChannelsView.tsx';
import baseMeta from './ChannelsView.stories.tsx';

// Fork: the bulk action that moves selected legacy channels to ErsatzTV next.
// The fixtures' channels are on the legacy engine.
const meta = {
  ...baseMeta,
  title: 'Channels/ChannelsView/Convert to Next',
  component: ChannelsView,
  args: {
    ...baseMeta.args,
    layout: 'table',
    onConvertChannels: fn(),
  },
} satisfies Meta<typeof ChannelsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelectionWithLegacyChannels: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('checkbox', {
        name: 'Select Saturday Morning Cartoons',
      }),
    );
    const bar = within(canvas.getByRole('region', { name: 'Selection' }));
    await userEvent.click(
      bar.getByRole('button', { name: 'Convert to ErsatzTV next' }),
    );
    await expect(args.onConvertChannels).toHaveBeenCalledWith([
      expect.objectContaining({ number: 1 }),
    ]);
  },
};
