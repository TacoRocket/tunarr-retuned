import { GlobalMediaSourceSettingsSchema } from '@tunarr/types/schemas';
import type { RecurrenceRule } from 'node-schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dailyLibraryScanRule,
  dailyScanSetByEnvironment,
  libraryScanSchedule,
} from './LibraryScanSchedule.ts';

describe('daily library scan schedule', () => {
  it('leaves the existing interval schedule in place when unset', () => {
    expect(dailyLibraryScanRule(null, null)).toBeUndefined();
  });

  it.each([
    ['2026-07-01T00:00:00Z', '2026-07-01T08:00:00.000Z'],
    ['2026-12-01T00:00:00Z', '2026-12-01T09:00:00.000Z'],
    ['2026-03-08T00:00:00Z', '2026-03-08T08:00:00.000Z'],
    ['2026-11-01T00:00:00Z', '2026-11-01T09:00:00.000Z'],
  ])(
    'runs at 03:00 Chicago from %s, independent of host timezone',
    (start, expected) => {
      const rule = dailyLibraryScanRule('03:00', 'America/Chicago');
      expect(rule?.nextInvocationDate(new Date(start))?.toISOString()).toBe(
        expected,
      );
    },
  );
});

describe('when automatic library scans run', () => {
  const settings = (
    dailyScanTime: string | null,
    dailyScanTimeZone: string | null,
  ) => ({
    globalMediaSourceSettings: () =>
      GlobalMediaSourceSettingsSchema.parse({
        rescanIntervalHours: 6,
        dailyScanTime,
        dailyScanTimeZone,
      }),
  });
  const nextRun = (schedule: string | RecurrenceRule) => {
    if (typeof schedule === 'string') return schedule;
    return schedule
      .nextInvocationDate(new Date('2026-07-01T00:00:00Z'))
      ?.toISOString();
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps the interval, offset half an hour, when nothing is set', () => {
    expect(libraryScanSchedule(settings(null, null))).toBe('0 30 */6 * * *');
  });

  it('runs at the time saved in Settings → Scanner', () => {
    expect(
      nextRun(libraryScanSchedule(settings('03:30', 'America/Chicago'))),
    ).toBe('2026-07-01T08:30:00.000Z');
  });

  it('lets the container variables decide over a saved time', () => {
    vi.stubEnv('TUNARR_LIBRARY_SCAN_DAILY_TIME', '05:00');
    vi.stubEnv('TUNARR_LIBRARY_SCAN_TIME_ZONE', 'UTC');
    expect(dailyScanSetByEnvironment()).toBe(true);
    expect(
      nextRun(libraryScanSchedule(settings('03:30', 'America/Chicago'))),
    ).toBe('2026-07-01T05:00:00.000Z');
  });

  it('still refuses partial container variables', () => {
    vi.stubEnv('TUNARR_LIBRARY_SCAN_DAILY_TIME', '05:00');
    expect(() => libraryScanSchedule(settings(null, null))).toThrow(
      'Set both TUNARR_LIBRARY_SCAN_DAILY_TIME and TUNARR_LIBRARY_SCAN_TIME_ZONE',
    );
  });

  it('falls back to the interval when a saved time cannot be read', () => {
    const handEdited = {
      globalMediaSourceSettings: () => ({
        ...settings(null, null).globalMediaSourceSettings(),
        dailyScanTime: '03:30',
        dailyScanTimeZone: 'Not/AZone',
      }),
    };
    expect(libraryScanSchedule(handEdited)).toBe('0 30 */6 * * *');
  });

  it('names the setting, not a variable, when a saved pair is wrong', () => {
    expect(() => dailyLibraryScanRule('03:30', null, 'settings')).toThrow(
      'Set both a daily scan time and its time zone',
    );
    expect(() =>
      dailyLibraryScanRule('03:30', 'Not/AZone', 'settings'),
    ).toThrow('The daily scan time zone must be a valid IANA time zone');
  });
});
