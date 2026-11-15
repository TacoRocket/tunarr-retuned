import { readFile } from 'node:fs/promises';

export type RuntimeCapabilityName =
  | 'nativeNv12Output'
  | 'preservesConcatTimestamps';

export type FfmpegRuntimeCapabilities = {
  // `bundled`: read from the image's build-time record. `custom`: any other
  // build; `probed` says each capability came from one small help query.
  source: 'bundled' | 'custom' | 'unknown';
  probed?: boolean;
  /** Queries that failed or timed out. Each one's capability is `false`. */
  probeFailed?: readonly RuntimeCapabilityName[];
  preservesConcatTimestamps?: boolean;
  nativeNv12Output?: boolean;
};

// One `<class> AVOptions:` block of `ffmpeg -h full` or `ffmpeg -h filter=X`.
// Both print the same block; an unknown filter prints none.
function avOptions(help: string, className: string): string {
  return (
    help.match(
      new RegExp(
        `^${className} AVOptions:\\r?\\n((?:[ \\t].*\\r?\\n|\\r?\\n)*)`,
        'm',
      ),
    )?.[1] ?? ''
  );
}

/** libplacebo's `nv12_output` option lists a `native` value (fork patch). */
export function parseNativeNv12Output(help: string): boolean {
  const nativeOption = avOptions(help, 'libplacebo').match(
    /^\s+nv12_output\s+<int>[^\n]*\n((?:(?!\s+\S+\s+<)[ \t].*\n)*)/m,
  );
  return /^\s+native\s+\d+\s/m.test(nativeOption?.[1] ?? '');
}

/** The concat filter has `preserve_ts` (fork patch), used by credit squeeze. */
export function parsePreservesConcatTimestamps(help: string): boolean {
  return /^\s+preserve_ts\s+<boolean>/m.test(avOptions(help, 'concat'));
}

export function parseRuntimeCapabilities(
  help: string,
): FfmpegRuntimeCapabilities {
  if (!/^AVCodecContext AVOptions:/m.test(help)) {
    throw new Error('FFmpeg full help did not contain codec options');
  }
  return {
    source: 'bundled',
    preservesConcatTimestamps: parsePreservesConcatTimestamps(help),
    nativeNv12Output: parseNativeNv12Output(help),
  };
}

export async function bundledFfmpegHelp(
  version: string,
): Promise<string | undefined> {
  try {
    const bundledVersion = await readFile(
      '/opt/tunarr/ffmpeg-version.txt',
      'utf8',
    );
    if (version.trim() !== bundledVersion.trim()) return;
    return await readFile('/opt/tunarr/ffmpeg-help.txt', 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return;
    throw error;
  }
}

// A few KB each, instead of the multi-MB `-h full` (#211).
export const RuntimeProbeArgs: Record<RuntimeCapabilityName, string[]> = {
  nativeNv12Output: ['-hide_banner', '-h', 'filter=libplacebo'],
  preservesConcatTimestamps: ['-hide_banner', '-h', 'filter=concat'],
};

const RuntimeProbeParsers: Record<
  RuntimeCapabilityName,
  (help: string) => boolean
> = {
  nativeNv12Output: parseNativeNv12Output,
  preservesConcatTimestamps: parsePreservesConcatTimestamps,
};

export type RunFfmpeg = (args: string[]) => Promise<string>;

/**
 * Reads the fork capabilities of a build without a bundled record. A query
 * that fails counts as the capability missing, so playback takes the fallback
 * instead of requesting an option the build may not have.
 */
export async function probeRuntimeCapabilities(
  run: RunFfmpeg,
): Promise<FfmpegRuntimeCapabilities> {
  const names = Object.keys(RuntimeProbeArgs) as RuntimeCapabilityName[];
  const results = await Promise.all(
    names.map((name) =>
      run([...RuntimeProbeArgs[name]]).then(
        (help) => RuntimeProbeParsers[name](help),
        () => undefined,
      ),
    ),
  );
  const failed = names.filter((_, i) => results[i] === undefined);
  return {
    source: 'custom',
    probed: true,
    nativeNv12Output: results[names.indexOf('nativeNv12Output')] ?? false,
    preservesConcatTimestamps:
      results[names.indexOf('preservesConcatTimestamps')] ?? false,
    ...(failed.length > 0 ? { probeFailed: failed } : {}),
  };
}

// One entry per FFmpeg path, replaced when that path's version output changes,
// so the queries run once per binary for the process lifetime and never on a
// cache timer. The cap only matters if the configured path keeps changing.
const MaxProbedBinaries = 8;
const probedBinaries = new Map<
  string,
  { version: string; result: Promise<FfmpegRuntimeCapabilities> }
>();

export function probeRuntimeCapabilitiesOnce(
  ffmpegPath: string,
  version: string,
  run: RunFfmpeg,
): Promise<FfmpegRuntimeCapabilities> {
  const cached = probedBinaries.get(ffmpegPath);
  if (cached?.version === version) return cached.result;
  probedBinaries.delete(ffmpegPath);
  if (probedBinaries.size >= MaxProbedBinaries) {
    const oldest = probedBinaries.keys().next().value;
    if (oldest !== undefined) probedBinaries.delete(oldest);
  }
  const result = probeRuntimeCapabilities(run);
  probedBinaries.set(ffmpegPath, { version, result });
  return result;
}

export function clearProbedRuntimeCapabilitiesForTest() {
  probedBinaries.clear();
}
