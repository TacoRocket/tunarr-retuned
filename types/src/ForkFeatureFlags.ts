import { z } from 'zod/v4';

// Fork runtime options on upstream's Settings → Features page. Each was a
// container variable only. They are user choices, so they have no variable
// now: Settings → Features (or the feature-flags API) is the one place they
// are set. Kept in their own file so upstream syncs touch only the two spreads
// in FeatureFlags.ts.
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
  category: 'experimental' | 'escape-hatch';
}[] = [
  {
    key: 'vaapiHableLut',
    displayName: 'Fast HDR Conversion (VAAPI)',
    description:
      "Convert HDR10 to SDR on the GPU's video engine with a fixed Hable curve instead of OpenCL, so a small Intel box can run more 4K HDR channels. The curve doesn't adapt scene by scene, so the picture differs slightly. CRT channels use it only on Performance or Experimental. Needs this fork's FFmpeg; without it, the usual tone mapper is used.",
    category: 'experimental',
  },
  {
    key: 'vaapiDefaultScaling',
    displayName: 'Driver-Default VAAPI Scaling',
    description:
      'Ask the VAAPI driver for its default scaler instead of high quality, so Intel GPUs can resize on their dedicated scaler and spend less GPU time. Pixels can differ slightly. CRT channels follow their own processing setting instead.',
    category: 'experimental',
  },
  {
    key: 'disableCrtDirectNv12',
    displayName: 'Disable Direct NV12 for CRT',
    description:
      "CRT channels on Performance or Experimental write their picture straight to NV12 when this fork's FFmpeg supports it, skipping one conversion with the same picture. Turn this on if a GPU shows a broken or miscolored CRT picture.",
    category: 'escape-hatch',
  },
];
