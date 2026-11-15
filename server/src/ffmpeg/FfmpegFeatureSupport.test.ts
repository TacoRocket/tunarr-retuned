import { FfmpegCapabilities } from './builder/capabilities/FfmpegCapabilities.ts';
import {
  clearLoggedFeatureSupportForTest,
  FeatureSupportIssueUrl,
  ffmpegFeatureSupport,
  logFeatureSupportOnce,
  UndetectableBundledFixes,
} from './FfmpegFeatureSupport.ts';
import type { FfmpegEncoder } from './ffmpegInfo.ts';
import type { FfmpegRuntimeCapabilities } from './FfmpegRuntimeCapabilities.ts';

const standardFilters = [
  'libplacebo',
  'scale_vulkan',
  'scale_vaapi',
  'overlay_vaapi',
  'tonemap_opencl',
  'tonemap_vaapi',
  'subtitles',
  'overlay',
];

function build(opts: {
  filters: string[];
  encoders?: string[];
  hwaccels?: string[];
  runtime: FfmpegRuntimeCapabilities;
}) {
  return new FfmpegCapabilities(
    new Set(),
    new Map<string, FfmpegEncoder>(
      (opts.encoders ?? ['h264_vaapi', 'hevc_vaapi', 'libx264']).map((e) => [
        e,
        { ffmpegName: e, name: e },
      ]),
    ),
    new Set(opts.filters),
    new Set(opts.hwaccels ?? ['vaapi', 'vulkan']),
    new Set(),
    opts.runtime,
  );
}

const bundled = build({
  filters: [...standardFilters, 'tonemap_vaapi_lut'],
  runtime: {
    source: 'bundled',
    nativeNv12Output: true,
    preservesConcatTimestamps: true,
  },
});

// A distro or "full" static build: the standard filters, none of our patches.
const genericFull = build({
  filters: standardFilters,
  runtime: {
    source: 'custom',
    probed: true,
    nativeNv12Output: false,
    preservesConcatTimestamps: false,
  },
});

const minimal = build({
  filters: ['scale', 'overlay', 'tonemap'],
  encoders: ['libx264'],
  hwaccels: [],
  runtime: {
    source: 'custom',
    probed: true,
    nativeNv12Output: false,
    preservesConcatTimestamps: false,
    probeFailed: ['nativeNv12Output'],
  },
});

function statuses(caps: FfmpegCapabilities) {
  return Object.fromEntries(
    ffmpegFeatureSupport(caps).map((f) => [
      f.id,
      { status: f.status, missing: f.missing, outcome: f.outcome },
    ]),
  );
}

describe('ffmpegFeatureSupport', () => {
  test.each([
    [
      'bundled build',
      bundled,
      {
        crt: { status: 'supported', missing: [] },
        'native-nv12': { status: 'supported', missing: [] },
        'credit-squeeze': { status: 'supported', missing: [] },
        'hdr-lut-tonemap': { status: 'supported', missing: [] },
        'burned-in-text-subtitles': { status: 'supported', missing: [] },
      },
    ],
    [
      'generic full build',
      genericFull,
      {
        crt: { status: 'supported', missing: [] },
        'native-nv12': {
          status: 'fallback',
          missing: ['libplacebo nv12_output=native'],
          outcome:
            'filtered NV12 through scale_vulkan, on both playback engines.',
        },
        'credit-squeeze': {
          status: 'unavailable',
          missing: ['concat preserve_ts'],
          outcome: 'Credits play full-screen, on both playback engines.',
        },
        'hdr-lut-tonemap': {
          status: 'fallback',
          missing: ['filter tonemap_vaapi_lut'],
          outcome:
            "the profile's hardware tone mapper (tonemap_opencl or tonemap_vaapi).",
        },
        'burned-in-text-subtitles': { status: 'supported', missing: [] },
      },
    ],
    [
      'minimal build',
      minimal,
      {
        crt: {
          status: 'unavailable',
          missing: [
            'hwaccel vaapi',
            'encoder h264_vaapi',
            'filter libplacebo',
            'filter scale_vulkan',
            'filter scale_vaapi',
          ],
          outcome: 'CRT channels fail to start a stream.',
        },
        'native-nv12': {
          status: 'unavailable',
          missing: [
            'hwaccel vaapi',
            'encoder h264_vaapi',
            'filter libplacebo',
            'filter scale_vulkan',
            'filter scale_vaapi',
            'libplacebo nv12_output=native (could not check)',
          ],
          outcome: 'Needs CRT support first.',
        },
        'credit-squeeze': {
          status: 'unavailable',
          missing: [
            'hwaccel vaapi',
            'encoder h264_vaapi or hevc_vaapi',
            'filter libplacebo',
            'filter scale_vulkan',
            'filter overlay_vaapi',
            'concat preserve_ts',
          ],
          outcome: 'Credits play full-screen, on both playback engines.',
        },
        'hdr-lut-tonemap': {
          status: 'fallback',
          missing: ['filter tonemap_vaapi_lut'],
          outcome: 'software tone mapping.',
        },
        'burned-in-text-subtitles': {
          status: 'unavailable',
          missing: ['filter subtitles'],
          outcome: 'Streams that burn in text subtitles fail.',
        },
      },
    ],
  ])('%s', (_name, caps, expected) => {
    expect(statuses(caps)).toMatchObject(expected);
  });

  test('an uninspected runtime counts as not checked, not as present', () => {
    const unknown = build({
      filters: standardFilters,
      runtime: { source: 'unknown' },
    });
    expect(statuses(unknown)['credit-squeeze']).toMatchObject({
      status: 'unavailable',
      missing: ['concat preserve_ts (could not check)'],
    });
  });
});

describe('logFeatureSupportOnce', () => {
  beforeEach(() => clearLoggedFeatureSupportForTest());
  const logger = () => ({ info: vi.fn(), warn: vi.fn() });

  test('the bundled build logs one info line', () => {
    const log = logger();
    logFeatureSupportOnce(log, '/usr/local/bin/ffmpeg', 'v1', bundled);
    logFeatureSupportOnce(log, '/usr/local/bin/ffmpeg', 'v1', bundled);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0]).toEqual([
      'FFmpeg at %s (%s build): all fork features supported.%s',
      '/usr/local/bin/ffmpeg',
      'bundled',
      '',
    ]);
  });

  test('a custom build warns once with what is missing and what to do', () => {
    const log = logger();
    logFeatureSupportOnce(log, '/usr/bin/ffmpeg', 'v7', genericFull);
    logFeatureSupportOnce(log, '/usr/bin/ffmpeg', 'v7', genericFull);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const text = log.warn.mock.calls[0]!.slice(1).join('\n');
    expect(text).toContain(
      '- Credit squeeze: unavailable. Credits play full-screen, on both playback engines. Missing: concat preserve_ts.',
    );
    expect(text).toContain(
      '- Native NV12 output (CRT, opt-in): falls back to filtered NV12',
    );
    expect(text).not.toContain('CRT looks');
    expect(text).toContain(UndetectableBundledFixes);
    expect(text).toContain(FeatureSupportIssueUrl);

    // A different version at the same path is a different binary.
    logFeatureSupportOnce(log, '/usr/bin/ffmpeg', 'v8', genericFull);
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});
