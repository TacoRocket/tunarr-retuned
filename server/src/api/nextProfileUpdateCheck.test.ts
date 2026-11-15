import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { TranscodeConfigOrm } from '../db/schema/TranscodeConfig.ts';
import { nextProfileUpdateError } from './nextProfileUpdateCheck.ts';

const unsupported = vi.hoisted(() =>
  vi.fn<() => { field: string; reason: string }[]>(),
);
vi.mock('../stream/etv/EtvNextChannelConfigMapper.ts', () => ({
  findUnsupportedSettings: unsupported,
}));

const eac3 = { uuid: 'EAC3', name: 'Surround EAC3' } as TranscodeConfigOrm;
const native = {
  streamMode: 'hls_slower',
  useEtvNext: false,
  transcodeConfigId: 'EAC3',
} as const;
const onNext = {
  streamMode: 'hls',
  useEtvNext: true,
  transcodeConfigId: 'AAC',
} as const;

beforeEach(() => {
  unsupported.mockReset();
  unsupported.mockReturnValue([
    { field: 'audioFormat', reason: 'must be one of aac, ac3' },
  ]);
});

describe('saving a channel onto ErsatzTV next with a profile it cannot play', () => {
  test('converting a native channel is refused, naming the profile and why', () => {
    expect(
      nextProfileUpdateError(
        native,
        { streamMode: 'hls', useEtvNext: true, transcodeConfigId: 'EAC3' },
        eac3,
      ),
    ).toBe(
      'ErsatzTV next can\'t play the transcode profile "Surround EAC3": audioFormat must be one of aac, ac3. Choose a profile it can play.',
    );
  });

  test('switching a Next channel to such a profile is refused', () => {
    expect(
      nextProfileUpdateError(
        onNext,
        { ...onNext, transcodeConfigId: 'EAC3' },
        eac3,
      ),
    ).toContain('Surround EAC3');
  });

  test('a profile Next can play converts', () => {
    unsupported.mockReturnValue([]);
    expect(
      nextProfileUpdateError(
        native,
        { ...onNext, transcodeConfigId: 'EAC3' },
        eac3,
      ),
    ).toBeUndefined();
  });
});

describe('updates that are never checked', () => {
  test('editing a native channel, whatever its profile', () => {
    expect(nextProfileUpdateError(native, { ...native }, eac3)).toBeUndefined();
    expect(unsupported).not.toHaveBeenCalled();
  });

  test('switching a Next channel back to native', () => {
    expect(
      nextProfileUpdateError(
        onNext,
        { ...onNext, useEtvNext: false, transcodeConfigId: 'EAC3' },
        eac3,
      ),
    ).toBeUndefined();
  });

  // Its profile may have been edited since it was chosen; a rename must not
  // fail because of that.
  test('a Next channel keeping its profile', () => {
    expect(nextProfileUpdateError(onNext, { ...onNext }, eac3)).toBeUndefined();
    expect(unsupported).not.toHaveBeenCalled();
  });
});
