import {
  clearProbedRuntimeCapabilitiesForTest,
  parseNativeNv12Output,
  parsePreservesConcatTimestamps,
  parseRuntimeCapabilities,
  probeRuntimeCapabilities,
  probeRuntimeCapabilitiesOnce,
  RuntimeProbeArgs,
} from './FfmpegRuntimeCapabilities.ts';

// `ffmpeg -hide_banner -h filter=libplacebo` from a build with the fork patch.
const patchedLibplacebo = `Filter libplacebo
  Apply various GPU filters from libplacebo
    Inputs:
        dynamic (depending on the options)
    Outputs:
       #0: default (video)
libplacebo AVOptions:
   inputs            <int>        ..FV....... Number of inputs (from 1 to INT_MAX) (default 1)
   w                 <string>     ..FV.....T. Output video frame width (default "iw")
   nv12_output       <int>        ..FV....... How to write nv12 output (from 0 to 1) (default auto)
     auto            0            ..FV....... Convert after rendering
     native          1            ..FV....... Write nv12 planes directly
   format            <string>     ..FV....... Output video format
   colorspace        <int>        ..FV.....T. select colorspace (from -1 to 17) (default auto)
     auto            -1           ..FV.....T. keep the same colorspace

This filter has support for timeline through the 'enable' option.
`;

// A stock build: libplacebo without the fork's nv12_output option.
const stockLibplacebo = `Filter libplacebo
  Apply various GPU filters from libplacebo
libplacebo AVOptions:
   inputs            <int>        ..FV....... Number of inputs (from 1 to INT_MAX) (default 1)
   w                 <string>     ..FV.....T. Output video frame width (default "iw")
   format            <string>     ..FV....... Output video format
   colorspace        <int>        ..FV.....T. select colorspace (from -1 to 17) (default auto)
     auto            -1           ..FV.....T. keep the same colorspace
     native          99           ..FV.....T. not an nv12_output value
`;

// A build without libplacebo prints this and no options block.
const unknownLibplacebo = `Unknown filter 'libplacebo'.
`;

const patchedConcat = `Filter concat
  Concatenate audio and video streams.
    Inputs:
        dynamic (depending on the options)
    Outputs:
        dynamic (depending on the options)
concat AVOptions:
   n                 <int64>      ..FVA...... specify the number of segments (from 1 to INT_MAX) (default 2)
   v                 <int64>      ..FV....... specify the number of video streams (from 0 to INT_MAX) (default 1)
   a                 <int64>      ..F.A...... specify the number of audio streams (from 0 to INT_MAX) (default 0)
   unsafe            <boolean>    ..FVA...... enable unsafe mode (default false)
   preserve_ts       <boolean>    ..FV....... keep segment timestamps (default false)
`;

const stockConcat = patchedConcat.replace(/^ {3}preserve_ts.*\n/m, '');

describe('runtime capability parsers', () => {
  test.each([
    ['patched libplacebo', patchedLibplacebo, true],
    ['stock libplacebo', stockLibplacebo, false],
    ['no libplacebo', unknownLibplacebo, false],
    ['empty output', '', false],
  ])('native NV12 from %s', (_name, help, expected) => {
    expect(parseNativeNv12Output(help)).toBe(expected);
  });

  test.each([
    ['patched concat', patchedConcat, true],
    ['stock concat', stockConcat, false],
    ['empty output', '', false],
  ])('concat preserve_ts from %s', (_name, help, expected) => {
    expect(parsePreservesConcatTimestamps(help)).toBe(expected);
  });

  test('the bundled -h full record reads the same sections', () => {
    const full = `AVCodecContext AVOptions:\n  -b                 <int64>      E..VA...... set bitrate\n${patchedConcat}${patchedLibplacebo}`;
    expect(parseRuntimeCapabilities(full)).toEqual({
      source: 'bundled',
      preservesConcatTimestamps: true,
      nativeNv12Output: true,
    });
  });
});

describe('probeRuntimeCapabilities', () => {
  const answers = (libplacebo: string, concat: string) =>
    vi.fn((args: string[]) =>
      Promise.resolve(args.includes('filter=libplacebo') ? libplacebo : concat),
    );

  test('reads each capability with one small query', async () => {
    const run = answers(patchedLibplacebo, patchedConcat);
    await expect(probeRuntimeCapabilities(run)).resolves.toEqual({
      source: 'custom',
      probed: true,
      nativeNv12Output: true,
      preservesConcatTimestamps: true,
    });
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      RuntimeProbeArgs.nativeNv12Output,
      RuntimeProbeArgs.preservesConcatTimestamps,
    ]);
    expect(run.mock.calls.flat(2)).not.toContain('full');
  });

  test('a stock build reports both patches missing', async () => {
    await expect(
      probeRuntimeCapabilities(answers(unknownLibplacebo, stockConcat)),
    ).resolves.toEqual({
      source: 'custom',
      probed: true,
      nativeNv12Output: false,
      preservesConcatTimestamps: false,
    });
  });

  test('a failed or timed-out query counts as missing and is named', async () => {
    const run = vi.fn((args: string[]) =>
      args.includes('filter=concat')
        ? Promise.reject(new Error('Command failed: timed out'))
        : Promise.resolve(patchedLibplacebo),
    );
    await expect(probeRuntimeCapabilities(run)).resolves.toEqual({
      source: 'custom',
      probed: true,
      nativeNv12Output: true,
      preservesConcatTimestamps: false,
      probeFailed: ['preservesConcatTimestamps'],
    });
  });
});

describe('probeRuntimeCapabilitiesOnce', () => {
  beforeEach(() => clearProbedRuntimeCapabilitiesForTest());

  test('queries once per binary and again only when its version changes', async () => {
    const run = vi.fn(() => Promise.resolve(patchedConcat));
    await probeRuntimeCapabilitiesOnce('/usr/bin/ffmpeg', 'v1', run);
    await probeRuntimeCapabilitiesOnce('/usr/bin/ffmpeg', 'v1', run);
    expect(run).toHaveBeenCalledTimes(2);

    await probeRuntimeCapabilitiesOnce('/usr/bin/ffmpeg', 'v2', run);
    expect(run).toHaveBeenCalledTimes(4);
  });

  test('a failed query is not retried for the same binary', async () => {
    const run = vi.fn(() => Promise.reject(new Error('boom')));
    const first = await probeRuntimeCapabilitiesOnce('/x/ffmpeg', 'v1', run);
    await probeRuntimeCapabilitiesOnce('/x/ffmpeg', 'v1', run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(first.probeFailed).toEqual([
      'nativeNv12Output',
      'preservesConcatTimestamps',
    ]);
  });
});
