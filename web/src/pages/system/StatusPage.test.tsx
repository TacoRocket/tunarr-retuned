import { renderWithProviders, screen } from '@/test/utils';
import { expect, test, vi } from 'vitest';
import { StatusPage } from './StatusPage.tsx';

const featureWarning = [
  'This FFmpeg lacks pieces some fork features need.',
  '- Native NV12 output (CRT, opt-in): falls back to filtered NV12.',
  'Problems can be reported at https://github.com/TacoRocket/tunarr-retuned/issues/new',
].join('\n');

vi.mock('@/hooks/useSystemHealthChecks', () => ({
  useSystemHealthChecks: () => ({
    isLoading: false,
    data: {
      FfmpegVersion: { type: 'healthy' },
      FfmpegFeatureSupport: { type: 'warning', context: featureWarning },
    },
  }),
}));
vi.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useXmlTvLink', () => ({ useXmlTvLink: () => '' }));
vi.mock('@/hooks/useM3ULink', () => ({ useM3ULink: () => '' }));

test('shows which fork features the FFmpeg can run, one item per line', () => {
  renderWithProviders(<StatusPage />);
  const row = screen.getByText('FFmpeg Feature Support').closest('tr')!;
  const context = Array.from(row.querySelectorAll('p')).find((p) =>
    p.textContent?.startsWith('This FFmpeg lacks'),
  )!;
  expect(context.textContent).toBe(featureWarning);
  expect(getComputedStyle(context).whiteSpace).toBe('pre-line');
});
