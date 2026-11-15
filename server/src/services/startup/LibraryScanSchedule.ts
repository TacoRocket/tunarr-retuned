import { RecurrenceRule } from 'node-schedule';
import { container } from '../../container.ts';
import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import { ScanLibrariesTask } from '../../tasks/ScanLibrariesTask.ts';
import { ScheduledTask } from '../../tasks/ScheduledTask.ts';
import { getEnvVar, TUNARR_ENV_VARS } from '../../util/env.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { GlobalScheduler, hoursCrontab } from '../Scheduler.ts';

// How each source names the two values in its error messages.
const Names = {
  environment: {
    both: 'Set both TUNARR_LIBRARY_SCAN_DAILY_TIME and TUNARR_LIBRARY_SCAN_TIME_ZONE',
    time: 'TUNARR_LIBRARY_SCAN_DAILY_TIME',
    zone: 'TUNARR_LIBRARY_SCAN_TIME_ZONE',
  },
  settings: {
    both: 'Set both a daily scan time and its time zone',
    time: 'The daily scan time',
    zone: 'The daily scan time zone',
  },
} as const;

export function dailyLibraryScanRule(
  time: string | null,
  timeZone: string | null,
  source: keyof typeof Names = 'environment',
): RecurrenceRule | undefined {
  const names = Names[source];
  if (time === null && timeZone === null) {
    return undefined;
  }
  if (time === null || timeZone === null) {
    throw new Error(names.both);
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`${names.time} must use HH:mm (00:00–23:59)`);
  }
  try {
    if (/^[+-]/.test(timeZone)) {
      throw new Error('Numeric offsets are not IANA time zones');
    }
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch (cause) {
    throw new Error(`${names.zone} must be a valid IANA time zone`, {
      cause,
    });
  }

  const rule = new RecurrenceRule();
  rule.hour = Number(time.slice(0, 2));
  rule.minute = Number(time.slice(3));
  rule.second = 0;
  rule.tz = timeZone;
  return rule;
}

// The container variables, when either is set, decide as they always have and
// lock the Scanner settings fields.
export function dailyScanSetByEnvironment(): boolean {
  return (
    getEnvVar(TUNARR_ENV_VARS.LIBRARY_SCAN_DAILY_TIME) !== null ||
    getEnvVar(TUNARR_ENV_VARS.LIBRARY_SCAN_TIME_ZONE) !== null
  );
}

// When automatic library scans run: the container variables, else the daily
// time saved in Settings → Scanner, else upstream's interval with its
// half-hour offset from the hourly library refresh.
//
// Invalid container variables stop startup scheduling, as documented. A saved
// time is checked when it is saved; one edited by hand into settings.json and
// unreadable falls back to the interval with a warning instead of stopping
// every scheduled job.
export function libraryScanSchedule(
  settingsDB: Pick<ISettingsDB, 'globalMediaSourceSettings'>,
): RecurrenceRule | string {
  const settings = settingsDB.globalMediaSourceSettings();
  const interval = hoursCrontab(settings.rescanIntervalHours, 30);
  if (dailyScanSetByEnvironment()) {
    return (
      dailyLibraryScanRule(
        getEnvVar(TUNARR_ENV_VARS.LIBRARY_SCAN_DAILY_TIME),
        getEnvVar(TUNARR_ENV_VARS.LIBRARY_SCAN_TIME_ZONE),
      ) ?? interval
    );
  }
  try {
    return (
      dailyLibraryScanRule(
        settings.dailyScanTime,
        settings.dailyScanTimeZone,
        'settings',
      ) ?? interval
    );
  } catch (e) {
    LoggerFactory.root.warn(
      e,
      'Ignoring the saved daily library scan time; scanning every %d hours instead',
      settings.rescanIntervalHours,
    );
    return interval;
  }
}

// Replaces the scheduled library scan, at startup and after the daily time is
// saved, so a new time applies without a restart.
export function scheduleLibraryScans(
  settingsDB: Pick<ISettingsDB, 'globalMediaSourceSettings'>,
  schedule: RecurrenceRule | string = libraryScanSchedule(settingsDB),
) {
  GlobalScheduler.clearTasks(ScanLibrariesTask.ID);
  GlobalScheduler.scheduleTask(
    ScanLibrariesTask.ID,
    new ScheduledTask(
      ScanLibrariesTask,
      schedule,
      container.get<() => ScanLibrariesTask>(ScanLibrariesTask.KEY),
      undefined,
    ),
  );
}
