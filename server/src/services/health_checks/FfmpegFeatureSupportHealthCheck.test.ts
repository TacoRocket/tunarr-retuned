import { readFile } from 'node:fs/promises';
import { FfmpegCapabilities } from '../../ffmpeg/builder/capabilities/FfmpegCapabilities.ts';
import {
  clearLoggedFeatureSupportForTest,
  FeatureSupportIssueUrl,
} from '../../ffmpeg/FfmpegFeatureSupport.ts';
import { FfmpegInfo } from '../../ffmpeg/ffmpegInfo.ts';
import {
  clearProbedRuntimeCapabilitiesForTest,
  type FfmpegRuntimeCapabilities,
} from '../../ffmpeg/FfmpegRuntimeCapabilities.ts';
import { ChildProcessHelper } from '../../util/ChildProcessHelper.ts';
import { FfmpegFeatureSupportHealthCheck } from './FfmpegFeatureSupportHealthCheck.ts';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}));

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
    healthCheck: new FfmpegFeatureSupportHealthCheck(() => ({
      getCapabilities,
    })),
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

// Two executables a user might switch between in Settings: the same standard
// build, one with the fork's patches and one without.
describe('FfmpegFeatureSupportHealthCheck after the FFmpeg setting changes', () => {
  const filters = [
    'libplacebo',
    'scale_vulkan',
    'scale_vaapi',
    'overlay_vaapi',
    'tonemap_vaapi_lut',
    'subtitles',
  ];
  const libplaceboHelp = (patched: boolean) =>
    `libplacebo AVOptions:
   w                 <string>     ..FV.....T. Output video frame width
${patched ? '   nv12_output       <int>        ..FV....... nv12 output\n     native          1            ..FV....... direct\n' : ''}`;
  const concatHelp = (patched: boolean) =>
    `concat AVOptions:
   n                 <int>        ..FVA...... number of segments
${patched ? '   preserve_ts       <boolean>    ..FV....... keep timestamps\n' : ''}`;
  const answer = (executable: string, args: string[]) => {
    const patched = executable === '/opt/patched/ffmpeg';
    if (args.includes('-version'))
      return `ffmpeg version ${patched ? '8.1-patched' : '8.1'} Copyright (c) 2000-2026\n`;
    if (args.includes('-encoders'))
      return 'Encoders:\n V....D h264_vaapi           H.264/AVC (VAAPI) (codec h264)\n';
    if (args.includes('-filters'))
      return `Filters:\n${filters.map((f) => ` ... ${f}  V->V  x`).join('\n')}\n`;
    if (args.includes('-hwaccels'))
      return 'Hardware acceleration methods:\nvaapi\n';
    if (args.includes('filter=libplacebo')) return libplaceboHelp(patched);
    if (args.includes('filter=concat')) return concatHelp(patched);
    return '';
  };

  beforeEach(() => {
    for (const cache of ['capabilitiesCache', 'resultCache'] as const) {
      (Reflect.get(FfmpegInfo, cache) as { flushAll(): void }).flushAll();
    }
    clearProbedRuntimeCapabilitiesForTest();
    clearLoggedFeatureSupportForTest();
    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('each poll reports the executable configured now', async () => {
    const getStdout = vi
      .spyOn(ChildProcessHelper.prototype, 'getStdout')
      .mockImplementation((executable, args) =>
        Promise.resolve(answer(executable, args)),
      );
    const configured = { path: '/usr/bin/ffmpeg' };
    // What the container's auto factory does: a new FfmpegInfo for the
    // configured path each time it is called.
    const healthCheck = new FfmpegFeatureSupportHealthCheck(
      () => new FfmpegInfo(configured.path, '/usr/bin/ffprobe'),
    );

    const before = await healthCheck.getStatus();
    configured.path = '/opt/patched/ffmpeg';
    const after = await healthCheck.getStatus();
    configured.path = '/usr/bin/ffmpeg';
    const back = await healthCheck.getStatus();

    expect(before.type).toBe('warning');
    expect(before.context).toContain('Missing: concat preserve_ts.');
    expect(after.type).toBe('healthy');
    expect(back).toEqual(before);
    // One probe per binary: switching back reuses the first answer.
    const probes = getStdout.mock.calls
      .filter(([, args]) => args.includes('-h'))
      .map(([executable, args]) => `${executable} ${args.at(-1)}`);
    expect(probes).toEqual([
      '/usr/bin/ffmpeg filter=libplacebo',
      '/usr/bin/ffmpeg filter=concat',
      '/opt/patched/ffmpeg filter=libplacebo',
      '/opt/patched/ffmpeg filter=concat',
    ]);
  });
});
