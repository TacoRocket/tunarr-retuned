import { z } from 'zod/v4';

// Fork runtime options on upstream's Settings → Features page. Each was a
// container variable only; the same variable still works and, when set, wins
// and locks the switch. Kept in their own file so upstream syncs touch only
// the two spreads in FeatureFlags.ts.
export const ForkFeatureFlagsShape = {
  vaapiHableLut: z.boolean().default(false),
  vaapiDefaultScaling: z.boolean().default(false),
  disableCrtDirectNv12: z.boolean().default(false),
};

export type ForkFeatureFlagKey = keyof typeof ForkFeatureFlagsShape;

export const ForkFeatureFlagMetadata: {
  key: ForkFeatureFlagKey;
  displayName: string;
  description: string;
  envVar: string;
  category: 'experimental' | 'escape-hatch';
}[] = [
  {
    key: 'vaapiHableLut',
    displayName: 'Fast HDR Conversion (VAAPI)',
    description:
      "Convert HDR10 to SDR on the GPU's video engine with a fixed Hable curve instead of OpenCL, so a small Intel box can run more 4K HDR channels. The curve doesn't adapt scene by scene, so the picture differs slightly. CRT channels use it only on Performance or Experimental. Needs this fork's FFmpeg; without it, the usual tone mapper is used.",
    envVar: 'TUNARR_VAAPI_HABLE_LUT',
    category: 'experimental',
  },
  {
    key: 'vaapiDefaultScaling',
    displayName: 'Driver-Default VAAPI Scaling',
    description:
      'Ask the VAAPI driver for its default scaler instead of high quality, so Intel GPUs can resize on their dedicated scaler and spend less GPU time. Pixels can differ slightly. CRT channels follow their own processing setting instead.',
    envVar: 'TUNARR_VAAPI_DEFAULT_SCALING',
    category: 'experimental',
  },
  {
    key: 'disableCrtDirectNv12',
    displayName: 'Disable Direct NV12 for CRT',
    description:
      "CRT channels on Performance or Experimental write their picture straight to NV12 when this fork's FFmpeg supports it, skipping one conversion with the same picture. Turn this on if a GPU shows a broken or miscolored CRT picture.",
    envVar: 'TUNARR_DISABLE_CRT_DIRECT_NV12',
    category: 'escape-hatch',
  },
];
