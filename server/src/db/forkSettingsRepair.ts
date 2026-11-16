import { ForkFeatureFlagMetadata, ForkFeatureFlagsShape } from '@tunarr/types';
import { isPlainObject } from 'lodash-es';
import { LoggerFactory } from '../util/logging/LoggerFactory.ts';

/**
 * Fork: values this fork stores in settings.json that a hand edit can break.
 *
 * Tunarr's settings loader replaces the whole file with defaults when any
 * value fails its schema, so one typo would also reset the FFmpeg path,
 * scan interval and the rest. These run before the schema reads the file:
 * an unreadable fork value is reset on its own, with a warning saying what
 * to fix, and startup writes the repaired file back. The web app and API
 * stay strict and refuse bad values outright.
 */

// The daily scan time a hand edit gets when it can't be read: overnight, and
// at half past so it doesn't start with the hourly library refresh. The
// Scanner page suggests the same time.
export const FallbackDailyScanTime = '03:30';

export function isDailyScanTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// An IANA zone name such as America/Chicago. Numeric offsets are refused:
// they don't follow daylight saving.
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || /^[+-]/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

type Warn = (message: string) => void;
const warnInLog: Warn = (message) => LoggerFactory.root.warn(message);

/**
 * The saved daily library scan (settings.mediaSource). A time that can't be
 * read becomes 03:30, and a zone that can't be read becomes the server's, so
 * a channel set up for a nightly scan keeps one. With no time set there is
 * no daily scan, and a leftover zone is cleared.
 */
export function repairDailyScan(
  raw: unknown,
  zoneForServer: string = serverTimeZone(),
  warn: Warn = warnInLog,
): unknown {
  if (!isPlainObject(raw)) return raw;
  const settings = raw as Record<string, unknown>;
  const time = settings.dailyScanTime;
  const zone = settings.dailyScanTimeZone;
  if (time === undefined || time === null) {
    return zone === undefined || zone === null
      ? raw
      : { ...settings, dailyScanTimeZone: null };
  }
  if (isDailyScanTime(time) && isIanaTimeZone(zone)) return raw;

  const fixedTime = isDailyScanTime(time) ? time : FallbackDailyScanTime;
  const fixedZone = isIanaTimeZone(zone) ? zone : zoneForServer;
  const unreadable = [
    isDailyScanTime(time) ? null : `daily scan time ${JSON.stringify(time)}`,
    isIanaTimeZone(zone)
      ? null
      : `daily scan time zone ${JSON.stringify(zone ?? null)}`,
  ].filter(Boolean);
  warn(
    `settings.json had an unreadable ${unreadable.join(' and ')}. ` +
      `The daily library scan is now ${fixedTime} ${fixedZone}; change it under Settings → Scanner.`,
  );
  return {
    ...settings,
    dailyScanTime: fixedTime,
    dailyScanTimeZone: fixedZone,
  };
}

/**
 * The fork's Settings → Features switches (featureFlags). A value that isn't
 * true or false turns the switch off, its default, rather than leaving a
 * feature on that the edit may have broken.
 */
export function repairForkFeatureFlags(
  raw: unknown,
  warn: Warn = warnInLog,
): unknown {
  if (!isPlainObject(raw)) return raw;
  const flags = raw as Record<string, unknown>;
  let repaired: Record<string, unknown> | undefined;
  for (const key of Object.keys(ForkFeatureFlagsShape)) {
    if (key in flags && typeof flags[key] !== 'boolean') {
      repaired ??= { ...flags };
      repaired[key] = false;
      const name =
        ForkFeatureFlagMetadata.find((meta) => meta.key === key)?.displayName ??
        key;
      warn(
        `settings.json had an unreadable value for the "${name}" switch (${JSON.stringify(flags[key])}). ` +
          'It is off now; turn it on again under Settings → Features if you want it.',
      );
    }
  }
  return repaired ?? raw;
}
