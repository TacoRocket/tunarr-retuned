import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TranscodeConfigOrm } from '@/db/schema/TranscodeConfig.js';
import type { FeatureFlagKey } from '@tunarr/types';
import {
  crtShader,
  crtWorkerStage,
} from '../../ffmpeg/builder/filter/crt/CrtFilter.ts';
import { FrameSize } from '../../ffmpeg/builder/types.ts';
import { findIgnoredSettings } from './EtvNextChannelConfigMapper.ts';
import {
  applyForkChannelSettings,
  runtimeCapabilities,
  forkLiveFeedFallback,
  forkVaapiLowPower,
} from './EtvNextForkSettings.ts';
import type { ChannelConfig } from './generated/channelConfig.ts';
import { ChannelConfigSchema } from './generated/channelConfig.ts';

const workerConfig = (accel?: 'vaapi' | 'qsv', height = 1080) =>
  ({
    normalization: { video: { accel, width: (height * 16) / 9, height } },
  }) as unknown as ChannelConfig;

// Settings → Features as a test sets it; everything else is off.
const features = (on: Partial<Record<FeatureFlagKey, boolean>> = {}) => ({
  get: (flag: FeatureFlagKey) => on[flag] ?? false,
});

const apply = (
  config: ChannelConfig,
  channel: Parameters<typeof applyForkChannelSettings>[1],
  runtime?: Parameters<typeof applyForkChannelSettings>[2],
  flags = features(),
) => applyForkChannelSettings(config, channel, runtime, flags);

const fields = (ignored: { field: string }[]) => ignored.map((s) => s.field);

describe('fork-only settings on the ErsatzTV next backend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('VAAPI scaling follows the Features switch unless a CRT tier overrides it', () => {
    for (const enabled of [false, true]) {
      for (const processing of [
        null,
        'quality',
        'performance',
        'experimental',
      ] as const) {
        const config = workerConfig('vaapi');
        apply(
          config,
          {
            crt: processing
              ? { enabled: true, look: 'dvd-broadcast', processing }
              : null,
            creditSqueeze: null,
          },
          undefined,
          features({ vaapiDefaultScaling: enabled }),
        );
        const expected =
          processing === null ? enabled : processing !== 'quality';
        expect(config.normalization.video.filters?.scale_vaapi).toEqual(
          expected ? { mode: 'default' } : undefined,
        );
      }
    }
    const qsv = workerConfig('qsv');
    apply(qsv, { crt: null, creditSqueeze: null });
    expect(qsv.normalization.video.filters?.scale_vaapi).toBeUndefined();
  });

  test('credit squeeze is handled per item, not dropped from the channel', () => {
    const config = workerConfig('vaapi');
    const ignored = apply(config, {
      crt: { enabled: true, look: 'dvd-broadcast', processing: 'quality' },
      creditSqueeze: { enabled: true } as never,
    });

    expect(fields(ignored)).toEqual([]);
    expect(config.normalization.video.custom_shader).toBeDefined();
  });

  test('a CRT look reaches the worker as the shader Quality draws, on VAAPI', () => {
    const config = workerConfig('vaapi');
    const ignored = apply(config, {
      crt: { enabled: true, look: 'classic-flat', processing: 'quality' },
      creditSqueeze: null,
    });

    expect(config.normalization.video.custom_shader).toBe(
      crtShader(
        { enabled: true, look: 'classic-flat', processing: 'quality' },
        FrameSize.FHD,
      ),
    );
    expect(config.normalization.video.custom_shader).toContain('//!HOOK');
    expect(
      config.normalization.video.custom_shader_input_height,
    ).toBeUndefined();
    expect(config.normalization.video.custom_shader_options).toBeUndefined();
    expect(config.normalization.video.vaapi_low_power).toBeUndefined();
    expect(ignored).toEqual([]);
  });

  test('a broadcast look also sends the lines it first scales to, with its extras', () => {
    const crt = {
      enabled: true,
      look: 'dvd-broadcast',
      processing: 'quality',
      broadcastGrain: 'half',
      broadcastComposite: true,
      broadcastTexture: 'classic-flat',
    } as const;
    const config = workerConfig('vaapi');
    apply(config, { crt, creditSqueeze: null });

    expect(config.normalization.video.custom_shader).toBe(
      crtShader(crt, FrameSize.FHD),
    );
    expect(config.normalization.video.custom_shader_input_height).toBe(480);
    expect(
      crtWorkerStage({ ...crt, look: 'tv-broadcast' }, FrameSize.FHD, {
        directNv12Available: true,
        hableLut: false,
      }).inputHeight,
    ).toBe(360);
  });

  test.each([720, 1080, 2160])(
    'a faster tier sends its shader and runtime options at %ip',
    (height) => {
      const crt = {
        enabled: true,
        look: 'dvd-broadcast',
        processing: 'experimental',
        broadcastGrain: 'half',
        broadcastComposite: true,
        broadcastTexture: 'classic-flat',
      } as const;
      const config = workerConfig('vaapi', height);
      const frame = FrameSize.withDimensions((height * 16) / 9, height);
      const ignored = apply(
        config,
        { crt, creditSqueeze: null },
        { nativeNv12Output: true },
        features({ vaapiHableLut: true }),
      );
      const video = config.normalization.video;

      expect(video.custom_shader).toBe(crtShader(crt, frame));
      expect(video.custom_shader).not.toBe(
        crtShader({ ...crt, processing: 'quality' }, frame),
      );
      expect(video.custom_shader_input_height).toBe(480);
      expect(video.custom_shader_options).toEqual({
        input_scale_mode: 'default',
        native_nv12_output: true,
        direct_nv12_handoff: true,
        point_chroma: true,
        hdr_vaapi_lut: true,
      });
      expect(video.vaapi_low_power).toBe('always');
      expect(ignored).toEqual([]);
    },
  );

  test('a custom FFmpeg without native NV12 keeps the worker on filtered NV12', () => {
    const crt = {
      enabled: true,
      look: 'tv-broadcast',
      processing: 'performance',
    } as const;
    // Capabilities that could not be read: a stock FFmpeg would reject the option.
    const unread = workerConfig('vaapi', 720);
    apply(unread, { crt, creditSqueeze: null }, undefined);
    expect(unread.normalization.video.custom_shader_options).toEqual({
      input_scale_mode: 'default',
    });

    const custom = workerConfig('vaapi', 720);
    apply(custom, { crt, creditSqueeze: null }, { nativeNv12Output: false });
    expect(custom.normalization.video.custom_shader_options).toEqual({
      input_scale_mode: 'default',
    });

    const patched = workerConfig('vaapi', 720);
    apply(patched, { crt, creditSqueeze: null }, { nativeNv12Output: true });
    expect(patched.normalization.video.custom_shader_options).toEqual({
      input_scale_mode: 'default',
      native_nv12_output: true,
      direct_nv12_handoff: true,
    });
  });

  test('unreadable FFmpeg capabilities gate nothing', async () => {
    await expect(
      runtimeCapabilities({
        getCapabilities: () => Promise.reject(new Error('no ffmpeg')),
      }),
    ).resolves.toBeUndefined();
    await expect(runtimeCapabilities(undefined)).resolves.toBeUndefined();
  });

  test('direct NV12 is automatic on a faster tier, and the Features switch turns it off', () => {
    const crt = {
      enabled: true,
      look: 'tv-broadcast',
      processing: 'performance',
    } as const;
    const hd = workerConfig('vaapi', 720);
    apply(hd, { crt, creditSqueeze: null }, { nativeNv12Output: true });
    expect(hd.normalization.video.custom_shader_options).toEqual({
      input_scale_mode: 'default',
      native_nv12_output: true,
      direct_nv12_handoff: true,
    });

    const off = workerConfig('vaapi', 720);
    apply(
      off,
      { crt, creditSqueeze: null },
      { nativeNv12Output: true },
      features({ disableCrtDirectNv12: true }),
    );
    expect(off.normalization.video.custom_shader_options).toEqual({
      input_scale_mode: 'default',
    });
    expect(off.normalization.video.vaapi_low_power).toBe('always');
  });

  test('the fixed-Hable LUT follows the Features switch', () => {
    for (const on of [false, true]) {
      const config = workerConfig('vaapi');
      apply(
        config,
        { crt: null, creditSqueeze: null },
        undefined,
        features({ vaapiHableLut: on }),
      );
      expect(config.normalization.video.hdr_vaapi_lut).toBe(on);
    }
  });

  // A shared profile can be switched off VAAPI after the channel's CRT look
  // was saved; the look must not disappear unreported.
  test('without VAAPI the look is reported as not drawn, whatever the tier', () => {
    for (const processing of ['quality', 'experimental'] as const) {
      const config = workerConfig('qsv');
      const ignored = apply(config, {
        crt: { enabled: true, look: 'tv-broadcast', processing },
        creditSqueeze: null,
      });

      expect(config.normalization.video.custom_shader).toBeUndefined();
      expect(
        config.normalization.video.custom_shader_input_height,
      ).toBeUndefined();
      expect(ignored).toEqual([
        {
          field: 'crt',
          reason: 'the backend draws the CRT look only with VAAPI',
        },
      ]);
    }
  });

  test('settings that are off, or never set, are neither drawn nor listed', () => {
    const config = workerConfig('vaapi');
    expect(
      apply(config, {
        crt: { enabled: false, look: 'tv-broadcast', processing: 'quality' },
        creditSqueeze: null,
      }),
    ).toEqual([]);
    expect(config.normalization.video.custom_shader).toBeUndefined();
    expect(
      config.normalization.video.custom_shader_input_height,
    ).toBeUndefined();
    expect(
      apply(workerConfig('qsv'), {
        crt: null,
        creditSqueeze: null,
      }),
    ).toEqual([]);
  });

  test('VAAPI low power reaches the worker as `always` and is not reported as dropped', () => {
    expect(forkVaapiLowPower({ vaapiLowPower: true }, 'vaapi')).toEqual({
      vaapi_low_power: 'always',
    });
    const fields = findIgnoredSettings({
      threadCount: 0,
      audioVolumePercent: 100,
      hardwareAccelerationMode: 'vaapi',
      vaapiDriver: 'system',
      vaapiLowPower: true,
    } as TranscodeConfigOrm).map((s) => s.field);
    expect(fields).not.toContain('vaapiLowPower');
  });

  test('low power off, or not VAAPI, leaves the worker its own default', () => {
    expect(forkVaapiLowPower({ vaapiLowPower: false }, 'vaapi')).toEqual({});
    expect(forkVaapiLowPower({ vaapiLowPower: true }, 'qsv')).toEqual({});
    expect(forkVaapiLowPower({ vaapiLowPower: true }, undefined)).toEqual({});
  });
});

describe('HLS Direct v2 keeps direct play on the ErsatzTV next backend', () => {
  const withAudio = (loudnorm = false) => {
    const config = workerConfig('vaapi');
    (config.normalization as { audio: unknown }).audio = {
      format: 'aac',
      ...(loudnorm ? { normalize_loudness: true } : {}),
    };
    return config;
  };

  test('copies video and audio, leaving the worker to transcode items it cannot copy', () => {
    const config = withAudio();
    const ignored = apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });

    expect(config.normalization.video.mode).toBe('copy');
    expect(config.normalization.audio.mode).toBe('copy');
    expect(ignored).toEqual([]);
  });

  test('other stream modes keep transcoding every item', () => {
    for (const streamMode of ['hls', 'mpegts'] as const) {
      const config = withAudio();
      apply(config, {
        crt: null,
        creditSqueeze: null,
        streamMode,
      });

      expect(config.normalization.video.mode).toBeUndefined();
      expect(config.normalization.audio.mode).toBeUndefined();
    }
  });

  test('a CRT look keeps the video transcoding so it is still drawn', () => {
    const config = withAudio();
    apply(config, {
      crt: { enabled: true, look: 'classic-flat', processing: 'quality' },
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });

    expect(config.normalization.video.custom_shader).toBeDefined();
    expect(config.normalization.video.mode).toBeUndefined();
    expect(config.normalization.audio.mode).toBe('copy');
  });

  test('a CRT look the worker cannot draw does not stop the copy', () => {
    const config = workerConfig('qsv');
    apply(config, {
      crt: { enabled: true, look: 'classic-flat', processing: 'quality' },
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });

    expect(config.normalization.video.custom_shader).toBeUndefined();
    expect(config.normalization.video.mode).toBe('copy');
  });

  test('loudness normalization keeps the audio transcoding', () => {
    const config = withAudio(true);
    apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });

    expect(config.normalization.video.mode).toBe('copy');
    expect(config.normalization.audio.mode).toBeUndefined();
  });
});

describe('copied audio keeps the source surround on items the worker re-encodes', () => {
  const profileAudio = (extra: Record<string, unknown> = {}) => {
    const config = workerConfig('vaapi');
    (config.normalization as { audio: unknown }).audio = {
      format: 'aac',
      channels: 2,
      bitrate_kbps: 192,
      buffer_kbps: 384,
      sample_rate_hz: 48000,
      ...extra,
    };
    return config;
  };

  test('HLS Direct v2 re-encodes what it cannot copy as AC-3 in the source layout', () => {
    const config = profileAudio();
    apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });

    expect(config.normalization.audio).toEqual({ mode: 'copy', format: 'ac3' });
  });

  // AC-3 encodes 32, 44.1 and 48 kHz only; `-ar 96000` makes FFmpeg refuse it.
  test("a profile's 96 kHz does not reach the AC-3 fallback", () => {
    const config = profileAudio({ sample_rate_hz: 96000 });
    apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });

    expect(config.normalization.audio.sample_rate_hz).toBeUndefined();
    expect(config.normalization.audio.format).toBe('ac3');
  });

  test('a copy profile does the same in any stream mode', () => {
    const config = profileAudio({ mode: 'copy' });
    apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls',
    });

    expect(config.normalization.audio).toEqual({ mode: 'copy', format: 'ac3' });
  });

  test("transcoded audio keeps the profile's format, channels, bitrate and sample rate", () => {
    const plain = profileAudio();
    apply(plain, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls',
    });
    expect(plain.normalization.audio).toMatchObject({
      format: 'aac',
      channels: 2,
      bitrate_kbps: 192,
      sample_rate_hz: 48000,
    });
    expect(plain.normalization.audio.mode).toBeUndefined();

    const leveled = profileAudio({ normalize_loudness: true });
    apply(leveled, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls_direct_v2',
    });
    expect(leveled.normalization.audio).toMatchObject({
      format: 'aac',
      channels: 2,
      bitrate_kbps: 192,
    });
    expect(leveled.normalization.audio.mode).toBeUndefined();
  });
});

describe('a live feed drop shows the channel offline picture', () => {
  const databaseDirectory = () => '/config/tunarr';
  const withFallback = () =>
    ({ fallback: { show_error: true, duration_seconds: 35 } }) as ChannelConfig;

  test('without its own picture, the channel uses the generic offline screen', () => {
    const config = withFallback();
    forkLiveFeedFallback(config, { picture: '' }, databaseDirectory);

    expect(config.fallback).toEqual({
      show_error: false,
      duration_seconds: 35,
      background_image: expect.stringMatching(
        /resources\/images\/generic-offline-screen\.png$/,
      ),
    });
    // The worker reads the file directly, so the path must name a real file.
    expect(existsSync(config.fallback?.background_image ?? '')).toBe(true);
  });

  test('an uploaded offline picture is read from the uploads folder', () => {
    const config = withFallback();
    forkLiveFeedFallback(
      config,
      { picture: 'http://192.0.2.10:8000/images/uploads/offline%20card.png' },
      databaseDirectory,
    );

    expect(config.fallback?.background_image).toBe(
      '/config/tunarr/images/uploads/offline card.png',
    );
  });

  test('a local file is used as it is', () => {
    const config = withFallback();
    forkLiveFeedFallback(
      config,
      { picture: '/media/offline.png' },
      databaseDirectory,
    );

    expect(config.fallback?.background_image).toBe('/media/offline.png');
  });

  test.each([
    'https://example.com/offline.png',
    'http://192.0.2.10:8000/images/uploads/..%2Fsettings.json',
  ])('%s falls back to the generic offline screen', (picture) => {
    const config = withFallback();
    forkLiveFeedFallback(config, { picture }, databaseDirectory);

    expect(config.fallback?.background_image).toMatch(
      /generic-offline-screen\.png$/,
    );
  });
});

describe('HLS segment type on the ErsatzTV next backend', () => {
  // The smallest config the vendored schema accepts, so the written JSON is
  // checked against what the worker reads.
  const minimalConfig = (): ChannelConfig => ({
    ffmpeg: {},
    normalization: {
      video: { format: 'h264', width: 1920, height: 1080 },
      audio: { format: 'aac' },
    },
    playout: { folder: '/tmp/etv/1' },
  });

  test('fMP4 reaches the worker as hls.segment_type', () => {
    const config = minimalConfig();
    const ignored = apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'hls',
      hlsSegmentType: 'fmp4',
    });

    expect(config.hls).toEqual({ segment_type: 'fmp4' });
    expect(ChannelConfigSchema.parse(config)).toEqual({
      ffmpeg: {},
      hls: { segment_type: 'fmp4' },
      normalization: {
        // Written either way, as the mapper wrote it before it moved here.
        video: {
          format: 'h264',
          width: 1920,
          height: 1080,
          hdr_vaapi_lut: false,
        },
        audio: { format: 'aac' },
      },
      playout: { folder: '/tmp/etv/1' },
    });
    expect(ignored).toEqual([]);
  });

  // An existing channel must write the same channel.json it wrote before the
  // setting existed.
  test('MPEG-TS, or a channel that never set it, leaves the hls key out', () => {
    for (const hlsSegmentType of ['mpegts', undefined] as const) {
      const config = minimalConfig();
      apply(config, {
        crt: null,
        creditSqueeze: null,
        streamMode: 'hls',
        hlsSegmentType,
      });

      expect(Object.keys(config)).not.toContain('hls');
    }
  });

  // MPEG-TS mode re-wraps the worker's HLS into one MPEG-TS stream with
  // FFmpeg, whose HLS reader keeps the first program's fMP4 header and decodes
  // every later program against it.
  test('MPEG-TS stream mode keeps MPEG-TS segments and says why', () => {
    const config = minimalConfig();
    const ignored = apply(config, {
      crt: null,
      creditSqueeze: null,
      streamMode: 'mpegts',
      hlsSegmentType: 'fmp4',
    });

    expect(Object.keys(config)).not.toContain('hls');
    expect(fields(ignored)).toEqual(['hlsSegmentType']);
  });
});
