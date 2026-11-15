import type { FfmpegCapabilities } from './builder/capabilities/FfmpegCapabilities.ts';
import { KnownFfmpegFilters } from './builder/options/KnownFfmpegOptions.ts';
import type {
  FfmpegRuntimeCapabilities,
  RuntimeCapabilityName,
} from './FfmpegRuntimeCapabilities.ts';

// Which fork features one FFmpeg build can run, read from the capability data
// Tunarr already collects. Each requirement mirrors the check the playback code
// makes, so this table says what playback will do rather than predicting it.

export type FeatureSupportStatus = 'supported' | 'fallback' | 'unavailable';

export type FeatureSupport = {
  id: string;
  name: string;
  status: FeatureSupportStatus;
  /** What this build lacks, e.g. `filter overlay_vaapi`. */
  missing: string[];
  /** For `fallback`: what plays instead. For `unavailable`: what happens. */
  outcome?: string;
};

export const FeatureSupportIssueUrl =
  'https://github.com/TacoRocket/tunarr-retuned/issues/new';

export const UndetectableBundledFixes =
  'Some fixes in the bundled FFmpeg cannot be detected from any FFmpeg output, so a custom build may lack them: readable ASS captions in WebVTT subtitles, hardware-decoded files whose color tags change partway, and audio/video sync with -shortest.';

const RuntimeLabels: Record<RuntimeCapabilityName, string> = {
  nativeNv12Output: 'libplacebo nv12_output=native',
  preservesConcatTimestamps: 'concat preserve_ts',
};

function runtimeMissing(
  runtime: Readonly<FfmpegRuntimeCapabilities>,
  name: RuntimeCapabilityName,
): string[] {
  if (runtime[name] === true) return [];
  const notChecked =
    runtime[name] === undefined || runtime.probeFailed?.includes(name);
  return [`${RuntimeLabels[name]}${notChecked ? ' (could not check)' : ''}`];
}

function filtersMissing(caps: FfmpegCapabilities, filters: string[]) {
  return filters.filter((f) => !caps.hasFilter(f)).map((f) => `filter ${f}`);
}

function vaapiEncodeMissing(caps: FfmpegCapabilities, encoders: string[]) {
  return [
    ...(caps.hasHardwareAccel('vaapi') ? [] : ['hwaccel vaapi']),
    ...(encoders.some((e) => caps.hasVideoEncoder(e))
      ? []
      : [`encoder ${encoders.join(' or ')}`]),
  ];
}

function feature(
  id: string,
  name: string,
  missing: string[],
  whenMissing: { status: 'fallback' | 'unavailable'; outcome: string },
): FeatureSupport {
  return missing.length === 0
    ? { id, name, status: 'supported', missing }
    : { id, name, missing, ...whenMissing };
}

export function ffmpegFeatureSupport(
  caps: FfmpegCapabilities,
): FeatureSupport[] {
  const runtime = caps.runtime;
  // VaapiPipelineBuilder: CRT needs VAAPI encoding, libplacebo and
  // scale_vulkan; the broadcast looks pre-scale with scale_vaapi. The faster
  // tiers encode H.264 in low power.
  const crtMissing = [
    ...vaapiEncodeMissing(caps, ['h264_vaapi']),
    ...filtersMissing(caps, [
      KnownFfmpegFilters.Libplacebo,
      KnownFfmpegFilters.ScaleVulkan,
      'scale_vaapi',
    ]),
  ];
  // VaapiPipelineBuilder + FfmpegStreamFactory: VAAPI encoding, the three
  // filters, and the concat preserve_ts patch.
  const squeezeMissing = [
    ...vaapiEncodeMissing(caps, ['h264_vaapi', 'hevc_vaapi']),
    ...filtersMissing(caps, [
      KnownFfmpegFilters.Libplacebo,
      KnownFfmpegFilters.ScaleVulkan,
      'overlay_vaapi',
    ]),
    ...runtimeMissing(runtime, 'preservesConcatTimestamps'),
  ];
  const nativeNv12Missing = runtimeMissing(runtime, 'nativeNv12Output');
  // selectHardwareTonemap: the LUT, then tonemap_opencl / tonemap_vaapi per
  // the profile's preference, then software.
  const hardwareTonemap = [
    KnownFfmpegFilters.TonemapOpencl,
    KnownFfmpegFilters.TonemapVaapi,
  ].filter((f) => caps.hasFilter(f));

  return [
    feature('crt', 'CRT looks', crtMissing, {
      status: 'unavailable',
      outcome: 'CRT channels fail to start a stream.',
    }),
    crtMissing.length > 0
      ? {
          id: 'native-nv12',
          name: 'Native NV12 output (CRT, opt-in)',
          status: 'unavailable',
          missing: [...crtMissing, ...nativeNv12Missing],
          outcome: 'Needs CRT support first.',
        }
      : feature(
          'native-nv12',
          'Native NV12 output (CRT, opt-in)',
          nativeNv12Missing,
          {
            status: 'fallback',
            outcome:
              'filtered NV12 through scale_vulkan, on both playback engines.',
          },
        ),
    feature('credit-squeeze', 'Credit squeeze', squeezeMissing, {
      status: 'unavailable',
      outcome: 'Credits play full-screen, on both playback engines.',
    }),
    feature(
      'hdr-lut-tonemap',
      'VAAPI HDR LUT tone mapping (opt-in)',
      filtersMissing(caps, [KnownFfmpegFilters.TonemapVaapiLut]),
      {
        status: 'fallback',
        outcome:
          hardwareTonemap.length > 0
            ? `the profile's hardware tone mapper (${hardwareTonemap.join(' or ')}).`
            : 'software tone mapping.',
      },
    ),
    feature(
      'burned-in-text-subtitles',
      'Burned-in text subtitles',
      filtersMissing(caps, ['subtitles']),
      {
        status: 'unavailable',
        outcome: 'Streams that burn in text subtitles fail.',
      },
    ),
  ];
}

export function allFeaturesSupported(features: FeatureSupport[]) {
  return features.every((f) => f.status === 'supported');
}

export function describeFeature(f: FeatureSupport): string {
  const missing =
    f.missing.length > 0 ? ` Missing: ${f.missing.join(', ')}.` : '';
  return f.status === 'fallback'
    ? `${f.name}: falls back to ${f.outcome}${missing}`
    : `${f.name}: unavailable. ${f.outcome ?? ''}${missing}`;
}

export function featureSupportAdvice(runtime: FfmpegRuntimeCapabilities) {
  return [
    runtime.source === 'bundled' ? undefined : UndetectableBundledFixes,
    "To get every feature, use the image's bundled FFmpeg, or a build with the missing pieces named above.",
    `Problems can be reported at ${FeatureSupportIssueUrl}`,
  ].filter((line) => line !== undefined);
}

type SummaryLogger = {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
};

// One summary per FFmpeg path and version for the process lifetime, however
// often the capability cache refreshes.
const MaxLoggedBinaries = 8;
const loggedBinaries = new Set<string>();

export function logFeatureSupportOnce(
  logger: SummaryLogger,
  ffmpegPath: string,
  version: string,
  caps: FfmpegCapabilities,
) {
  const key = `${ffmpegPath}\n${version}`;
  if (loggedBinaries.has(key)) return;
  if (loggedBinaries.size >= MaxLoggedBinaries) loggedBinaries.clear();
  loggedBinaries.add(key);
  const features = ffmpegFeatureSupport(caps);
  const build = caps.runtime.source === 'bundled' ? 'bundled' : 'custom';
  if (allFeaturesSupported(features)) {
    logger.info(
      'FFmpeg at %s (%s build): all fork features supported.%s',
      ffmpegPath,
      build,
      build === 'bundled' ? '' : ` ${UndetectableBundledFixes}`,
    );
    return;
  }
  logger.warn(
    'FFmpeg at %s (%s build) lacks pieces some fork features need:\n%s\n%s',
    ffmpegPath,
    build,
    features
      .filter((f) => f.status !== 'supported')
      .map((f) => `- ${describeFeature(f)}`)
      .join('\n'),
    featureSupportAdvice(caps.runtime).join('\n'),
  );
}

export function clearLoggedFeatureSupportForTest() {
  loggedBinaries.clear();
}
