import type { Meta, StoryObj } from '@storybook/react-vite';
import { ExtensionAuthorGuide } from './ExtensionAuthorGuide.tsx';

// The section at the bottom of Settings → Extensions that points authors at
// the guides published so far.
const meta = {
  title: 'Settings/Extensions/ExtensionAuthorGuide',
  component: ExtensionAuthorGuide,
  args: { apiVersion: '0.5' },
} satisfies Meta<typeof ExtensionAuthorGuide>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
