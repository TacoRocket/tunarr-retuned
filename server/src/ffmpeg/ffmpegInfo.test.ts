import { readFile } from 'node:fs/promises';
import type { MockInstance } from 'vitest';
import { ChildProcessHelper } from '../util/ChildProcessHelper.ts';
import { clearLoggedFeatureSupportForTest } from './FfmpegFeatureSupport.ts';
import { FfmpegInfo, parseVideoDecoderNames } from './ffmpegInfo.ts';
import { clearProbedRuntimeCapabilitiesForTest } from './FfmpegRuntimeCapabilities.ts';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn(),
}));

const decodersOutput = `Decoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10
 V..... libdav1d             dav1d AV1 decoder by VideoLAN (codec av1)
 V....D libaom-av1           libaom AV1 (codec av1)
 V....D av1                  Alliance for Open Media AV1
 V..... av1_cuvid            Nvidia CUVID AV1 decoder (codec av1)
 A....D aac                  AAC (Advanced Audio Coding)
 S..... srt                  SubRip subtitle
`;

describe('parseVideoDecoderNames', () => {
  test('returns only video decoder names', () => {
    expect(parseVideoDecoderNames(decodersOutput)).toEqual([
      'h264',
      'libdav1d',
      'libaom-av1',
      'av1',
      'av1_cuvid',
    ]);
  });

  test('returns nothing for empty output', () => {
    expect(parseVideoDecoderNames('')).toEqual([]);
  });
});

describe('FfmpegInfo runtime capabilities', () => {
  const versionOutput =
    'ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n';
  const bundledRecord = `AVCodecContext AVOptions:
  -b                 <int64>      E..VA...... set bitrate
concat AVOptions:
   preserve_ts       <boolean>    ..FV....... keep segment timestamps
libplacebo AVOptions:
   nv12_output       <int>        ..FV....... nv12 output
     native          1            ..FV....... direct
`;
  let getStdout: MockInstance<ChildProcessHelper['getStdout']>;
  const helpQueries = () =>
    getStdout.mock.calls.filter(([, args]) => args.includes('-h'));
  // What the hourly capability and result caches look like once expired.
  const expireTimedCaches = () => {
    for (const cache of ['capabilitiesCache', 'resultCache'] as const) {
      (Reflect.get(FfmpegInfo, cache) as { flushAll(): void }).flushAll();
    }
  };

  beforeEach(() => {
    expireTimedCaches();
    clearProbedRuntimeCapabilitiesForTest();
    clearLoggedFeatureSupportForTest();
    getStdout = vi
      .spyOn(ChildProcessHelper.prototype, 'getStdout')
      .mockImplementation((_executable, args) =>
        Promise.resolve(
          args.includes('-version')
            ? versionOutput
            : args.includes('filter=libplacebo')
              ? "Unknown filter 'libplacebo'.\n"
              : '',
        ),
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a custom build is queried once, even after the capability cache expires', async () => {
    vi.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    const info = new FfmpegInfo('/usr/bin/ffmpeg', '/usr/bin/ffprobe');

    const first = await info.getCapabilities();
    expect(first.runtime).toEqual({
      source: 'custom',
      probed: true,
      nativeNv12Output: false,
      preservesConcatTimestamps: false,
    });
    expect(helpQueries().map(([, args]) => args)).toEqual([
      ['-hide_banner', '-h', 'filter=libplacebo'],
      ['-hide_banner', '-h', 'filter=concat'],
    ]);

    await info.getCapabilities();
    expireTimedCaches();
    const later = await new FfmpegInfo(
      '/usr/bin/ffmpeg',
      '/usr/bin/ffprobe',
    ).getCapabilities();
    expect(later.runtime).toEqual(first.runtime);
    expect(helpQueries()).toHaveLength(2);
  });

  test('the bundled build reads its record and runs no help query', async () => {
    vi.mocked(readFile).mockImplementation(
      (path) =>
        Promise.resolve(
          path === '/opt/tunarr/ffmpeg-version.txt'
            ? versionOutput
            : bundledRecord,
        ) as never,
    );
    const info = new FfmpegInfo('/usr/local/bin/ffmpeg', '/usr/bin/ffprobe');

    const caps = await info.getCapabilities();
    expect(caps.runtime).toEqual({
      source: 'bundled',
      nativeNv12Output: true,
      preservesConcatTimestamps: true,
    });
    expect(helpQueries()).toEqual([]);
  });
});
