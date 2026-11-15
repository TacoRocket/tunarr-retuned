import { FfmpegCapabilities } from '../../ffmpeg/builder/capabilities/FfmpegCapabilities.ts';
import { FeatureSupportIssueUrl } from '../../ffmpeg/FfmpegFeatureSupport.ts';
import type { FfmpegRuntimeCapabilities } from '../../ffmpeg/FfmpegRuntimeCapabilities.ts';
import { FfmpegFeatureSupportHealthCheck } from './FfmpegFeatureSupportHealthCheck.ts';

function check(runtime: FfmpegRuntimeCapabilities) {
  const capabilities = new FfmpegCapabilities(
    new Set(),
    new Map([['h264_vaapi', { ffmpegName: 'h264_vaapi', name: 'VAAPI' }]]),
    new Set([
      'libplacebo',
      'scale_vulkan',
      'scale_vaapi',
      'overlay_vaapi',
      'tonemap_vaapi_lut',
      'subtitles',
    ]),
    new Set(['vaapi']),
    new Set(),
    runtime,
  );
  const getCapabilities = vi.fn(() => Promise.resolve(capabilities));
  return {
    getCapabilities,
    healthCheck: new FfmpegFeatureSupportHealthCheck({ getCapabilities }),
  };
}

describe('FfmpegFeatureSupportHealthCheck', () => {
  test('the bundled build is healthy', async () => {
    const { healthCheck } = check({
      source: 'bundled',
      nativeNv12Output: true,
      preservesConcatTimestamps: true,
    });
    await expect(healthCheck.getStatus()).resolves.toEqual({
      type: 'healthy',
    });
  });

  test('a build without the fork patches warns with what to do', async () => {
    const { healthCheck, getCapabilities } = check({
      source: 'custom',
      probed: true,
      nativeNv12Output: false,
      preservesConcatTimestamps: false,
    });
    const result = await healthCheck.getStatus();
    await healthCheck.getStatus();

    expect(result.type).toBe('warning');
    expect(result.context).toContain(
      'Credit squeeze: unavailable. Credits play full-screen, on both playback engines. Missing: concat preserve_ts.',
    );
    expect(result.context).toContain('Native NV12 output (CRT, opt-in)');
    expect(result.context).toContain("use the image's bundled FFmpeg");
    expect(result.context).toContain(FeatureSupportIssueUrl);
    // Each poll reads the shared capability cache; it never runs FFmpeg itself.
    expect(getCapabilities).toHaveBeenCalledTimes(2);
  });
});
