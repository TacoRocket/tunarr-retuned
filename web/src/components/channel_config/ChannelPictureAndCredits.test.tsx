import { getChannelsByNumberV2QueryKey } from '@/generated/@tanstack/react-query.gen.ts';
import { fillerListsQuery } from '@/hooks/useFillerLists.ts';
import {
  renderWithProviders,
  screen,
  seededQueryClient,
} from '@/test/utils.tsx';
import type { SaveableChannel, TranscodeConfig } from '@tunarr/types';
import type { ReactNode } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { expect, test } from 'vitest';
import useStore from '@/store/index.ts';
import { ChannelPictureAndCredits } from './ChannelPictureAndCredits.tsx';

const profiles = [
  {
    id: 'vaapi',
    hardwareAccelerationMode: 'vaapi',
    disableHardwareEncoding: false,
    disableHardwareFilters: false,
  },
] as TranscodeConfig[];

function Form({
  values,
  children,
}: {
  values: Partial<SaveableChannel>;
  children: ReactNode;
}) {
  const methods = useForm<SaveableChannel>({
    mode: 'onChange',
    defaultValues: {
      streamMode: 'hls',
      transcodeConfigId: 'vaapi',
      useEtvNext: true,
      crt: null,
      creditSqueeze: null,
      advanceAtFinalCredits: false,
      ...values,
    },
  });
  return (
    <FormProvider {...methods}>
      {children}
      <Saved />
    </FormProvider>
  );
}
// What Save would send for these fields.
function Saved() {
  const [crt, creditSqueeze, advanceAtFinalCredits] = useWatch<
    SaveableChannel,
    ['crt', 'creditSqueeze', 'advanceAtFinalCredits']
  >({ name: ['crt', 'creditSqueeze', 'advanceAtFinalCredits'] });
  return (
    <output data-testid="saved">
      {JSON.stringify({ crt, creditSqueeze, advanceAtFinalCredits })}
    </output>
  );
}
const saved = () =>
  JSON.parse(screen.getByTestId('saved').textContent ?? '{}') as Record<
    string,
    unknown
  >;

function render(values: Partial<SaveableChannel>, channel: object = {}) {
  useStore.setState((state) => ({
    channelEditor: {
      ...state.channelEditor,
      currentEntity: channel as never,
    },
  }));
  return renderWithProviders(
    <Form values={values}>
      <ChannelPictureAndCredits transcodeConfigs={profiles} />
    </Form>,
    {
      queryClient: seededQueryClient([
        [fillerListsQuery().queryKey, [{ id: 'ads', name: 'Ads' }]],
        [
          getChannelsByNumberV2QueryKey({ path: { id: 'src' } }),
          { id: 'src', name: 'The Late Show' },
        ],
      ]),
    },
  );
}

test('choosing a CRT look turns it on with that look', async () => {
  const { user } = render({});
  await user.click(screen.getByRole('combobox', { name: 'CRT look' }));
  await user.click(screen.getByRole('option', { name: 'Classic flat' }));
  expect(saved().crt).toEqual({
    enabled: true,
    look: 'classic-flat',
    processing: 'quality',
  });
  expect(
    screen.getByText('Clear scanlines, a bit of color bleed and glow.'),
  ).toBeVisible();

  await user.click(screen.getByRole('combobox', { name: 'CRT look' }));
  await user.click(screen.getByRole('option', { name: 'Off' }));
  expect(saved().crt).toBeNull();
});

test('HLS Direct says why there is no look or squeeze instead of failing on Save', () => {
  render({ streamMode: 'hls_direct_v2' });
  expect(screen.getByRole('combobox', { name: 'CRT look' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  expect(
    screen.getByText(/HLS Direct passes the video through untouched/),
  ).toBeVisible();
  expect(
    screen.getByRole('radio', { name: /Shrink them over a background/ }),
  ).toBeDisabled();
  // Skipping needs no GPU.
  expect(
    screen.getByRole('radio', { name: 'Skip to the next program' }),
  ).toBeEnabled();
});

test('the final credits are one choice: skipping and squeezing turn each other off', async () => {
  const { user } = render({});
  await user.click(
    screen.getByRole('radio', { name: 'Skip to the next program' }),
  );
  expect(saved()).toMatchObject({
    advanceAtFinalCredits: true,
    creditSqueeze: null,
  });

  await user.click(
    screen.getByRole('radio', { name: /Shrink them over a background/ }),
  );
  expect(saved()).toMatchObject({
    advanceAtFinalCredits: false,
    creditSqueeze: { enabled: true, backgroundImage: '' },
  });
  const image = screen.getByRole('textbox', { name: 'Background image' });
  await user.type(image, 'credits.png');
  expect(
    await screen.findByText(/Use a PNG or JPEG path inside the container/),
  ).toBeVisible();
  await user.clear(image);
  await user.type(image, '/artwork/credits.png');
  expect(saved().creditSqueeze).toMatchObject({
    backgroundImage: '/artwork/credits.png',
  });

  await user.click(screen.getByRole('radio', { name: 'Play them through' }));
  expect(saved()).toMatchObject({
    advanceAtFinalCredits: false,
    creditSqueeze: null,
  });
});

test('an offset channel points at its source instead of showing controls', async () => {
  render({}, { offset: { sourceChannelId: 'src', hours: 3 } });
  expect(
    await screen.findByText(/This channel plays The Late Show later/),
  ).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'CRT look' })).toBeNull();
});
