import { describe, expect, test } from 'vitest';
import {
  cannotFollowReason,
  creditsChoice,
  creditsFields,
  isContainerImagePath,
  offsetSources,
  pictureBlocker,
} from './forkChannelSettings.ts';

const vaapi = {
  hardwareAccelerationMode: 'vaapi' as const,
  disableHardwareEncoding: false,
  disableHardwareFilters: false,
};

describe('pictureBlocker matches the server rule for CRT and credit squeeze', () => {
  test.each(['hls', 'hls_slower', 'mpegts'] as const)(
    '%s with a VAAPI profile can draw it',
    (mode) => expect(pictureBlocker(mode, vaapi)).toBeUndefined(),
  );
  test('HLS Direct passes video through', () => {
    expect(pictureBlocker('hls_direct_v2', vaapi)).toBe('passthrough');
    expect(pictureBlocker('hls_direct', vaapi)).toBe('passthrough');
  });
  test('a profile without VAAPI, hardware encoding or filters cannot', () => {
    expect(
      pictureBlocker('hls', { ...vaapi, hardwareAccelerationMode: 'qsv' }),
    ).toBe('profile');
    expect(
      pictureBlocker('hls', { ...vaapi, disableHardwareEncoding: true }),
    ).toBe('profile');
    expect(
      pictureBlocker('hls', { ...vaapi, disableHardwareFilters: true }),
    ).toBe('profile');
  });
});

describe('end credits are one choice', () => {
  const squeeze = { backgroundImage: '/artwork/credits.png' };
  test('reads the saved fields', () => {
    expect(creditsChoice({})).toBe('play');
    expect(creditsChoice({ advanceAtFinalCredits: true })).toBe('skip');
    expect(
      creditsChoice({ creditSqueeze: { ...squeeze, enabled: true } }),
    ).toBe('squeeze');
  });
  test('each choice turns the other setting off, since both cannot be on', () => {
    expect(creditsFields('play', squeeze)).toEqual({
      advanceAtFinalCredits: false,
      creditSqueeze: null,
    });
    expect(creditsFields('skip', squeeze)).toEqual({
      advanceAtFinalCredits: true,
      creditSqueeze: null,
    });
    expect(creditsFields('squeeze', squeeze)).toEqual({
      advanceAtFinalCredits: false,
      creditSqueeze: { backgroundImage: '/artwork/credits.png', enabled: true },
    });
  });
});

test('the background image must be a container PNG or JPEG path', () => {
  expect(isContainerImagePath('/artwork/credits.png')).toBe(true);
  expect(isContainerImagePath('/artwork/credits.JPG')).toBe(true);
  expect(isContainerImagePath('artwork/credits.png')).toBe(false);
  expect(isContainerImagePath('//host/credits.png')).toBe(false);
  expect(isContainerImagePath('/artwork/credits.gif')).toBe(false);
});

describe('offset channels', () => {
  const ch = (id: string, extra: object = {}) => ({
    id,
    onDemand: { enabled: false },
    offset: null,
    ...extra,
  });
  const channels = [
    ch('a'),
    ch('b', { offset: { sourceChannelId: 'a' } }),
    ch('c', { onDemand: { enabled: true } }),
    ch('d'),
  ];
  test('a channel can follow any other scheduled, non-offset channel', () => {
    expect(offsetSources(ch('d'), channels).map((c) => c.id)).toEqual(['a']);
  });
  test('a followed or on-demand channel cannot follow another', () => {
    expect(cannotFollowReason(channels[0]!, channels)).toBe('followed');
    expect(cannotFollowReason(channels[2]!, channels)).toBe('on-demand');
    expect(cannotFollowReason(channels[3]!, channels)).toBeUndefined();
  });
});
