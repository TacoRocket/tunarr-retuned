import { describe, expect, test, vi } from 'vitest';
import {
  repairDailyScan,
  repairForkFeatureFlags,
} from './forkSettingsRepair.ts';

describe('repairing hand-edited fork settings', () => {
  test('an unreadable time becomes 03:30 and says what to fix', () => {
    const warn = vi.fn();
    expect(
      repairDailyScan(
        {
          rescanIntervalHours: 9,
          dailyScanTime: 330,
          dailyScanTimeZone: 'UTC',
        },
        'America/Chicago',
        warn,
      ),
    ).toEqual({
      rescanIntervalHours: 9,
      dailyScanTime: '03:30',
      dailyScanTimeZone: 'UTC',
    });
    expect(warn).toHaveBeenCalledWith(
      'settings.json had an unreadable daily scan time 330. The daily library scan is now 03:30 UTC; change it under Settings → Scanner.',
    );
  });

  test("a missing zone takes the server's", () => {
    const warn = vi.fn();
    expect(
      repairDailyScan(
        { dailyScanTime: '04:15', dailyScanTimeZone: null },
        'America/Chicago',
        warn,
      ),
    ).toEqual({ dailyScanTime: '04:15', dailyScanTimeZone: 'America/Chicago' });
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /unreadable daily scan time zone null/,
    );
  });

  test('good values and no daily scan are left alone', () => {
    const warn = vi.fn();
    const good = { dailyScanTime: '03:30', dailyScanTimeZone: 'UTC' };
    expect(repairDailyScan(good, 'UTC', warn)).toBe(good);
    const off = { dailyScanTime: null, dailyScanTimeZone: null };
    expect(repairDailyScan(off, 'UTC', warn)).toBe(off);
    // A zone left without a time has nothing to schedule.
    expect(
      repairDailyScan(
        { dailyScanTime: null, dailyScanTimeZone: 'UTC' },
        'UTC',
        warn,
      ),
    ).toEqual({ dailyScanTime: null, dailyScanTimeZone: null });
    expect(warn).not.toHaveBeenCalled();
  });

  test('a fork switch that is not true or false turns off, by name', () => {
    const warn = vi.fn();
    expect(
      repairForkFeatureFlags(
        { vaapiHableLut: 'yes', vaapiDefaultScaling: true, proxyArtwork: 'x' },
        warn,
      ),
    ).toEqual({
      vaapiHableLut: false,
      vaapiDefaultScaling: true,
      // Upstream's own flags are left to upstream's schema.
      proxyArtwork: 'x',
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(
      /"Fast HDR Conversion \(VAAPI\)" switch \("yes"\)\. It is off now/,
    );
  });
});
