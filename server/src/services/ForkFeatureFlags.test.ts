import type { ISettingsDB } from '@/db/interfaces/ISettingsDB.js';
import { FeatureFlagsSchema } from '@tunarr/types';
import { afterEach, expect, test, vi } from 'vitest';
import { FeatureFlagService } from './FeatureFlagService.ts';

// The fork's three switches are set only in Settings → Features. An install
// upgraded with the old lines still in its Compose file must not have them
// turn a switch on, or lock it, behind the page's back.
afterEach(() => {
  vi.unstubAllEnvs();
});

test('retired container variables neither set nor lock the fork switches', () => {
  vi.stubEnv('TUNARR_VAAPI_HABLE_LUT', '1');
  vi.stubEnv('TUNARR_VAAPI_DEFAULT_SCALING', '1');
  vi.stubEnv('TUNARR_DISABLE_CRT_DIRECT_NV12', '1');
  const saved = FeatureFlagsSchema.parse({ vaapiDefaultScaling: true });
  const service = new FeatureFlagService({
    featureFlags: () => saved,
  } as unknown as ISettingsDB);

  expect(service.get('vaapiHableLut')).toBe(false);
  expect(service.get('vaapiDefaultScaling')).toBe(true);
  expect(service.get('disableCrtDirectNv12')).toBe(false);
  expect(service.getEnvOverrides()).toEqual({});
});
