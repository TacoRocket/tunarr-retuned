import { RecurrenceRule } from 'node-schedule';
import { container } from '../../container.ts';
import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import { ScanLibrariesTask } from '../../tasks/ScanLibrariesTask.ts';
import { ScheduledTask } from '../../tasks/ScheduledTask.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { GlobalScheduler, hoursCrontab } from '../Scheduler.ts';

// The daily time saved in Settings → Scanner, as a calendar rule in its time
// zone. Undefined when no daily time is set.
export function dailyLibraryScanRule(
  time: string | null,
  timeZone: string | null,
): RecurrenceRule | undefined {
  if (time === null && timeZone === null) {
    return undefined;
  }
  if (time === null || timeZone === null) {
    throw new Error('Set both a daily scan time and its time zone');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('The daily scan time must use HH:mm (00:00–23:59)');
  }
  try {
    if (/^[+-]/.test(timeZone)) {
      throw new Error('Numeric offsets are not IANA time zones');
    }
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch (cause) {
    throw new Error('The daily scan time zone must be a valid IANA time zone', {
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

// When automatic library scans run: the daily time saved in Settings →
// Scanner, else upstream's interval with its half-hour offset from the hourly
// library refresh.
//
// A saved time is checked when it is saved. One edited by hand into
// settings.json and unreadable falls back to the interval with a warning
// instead of stopping every scheduled job.
export function libraryScanSchedule(
  settingsDB: Pick<ISettingsDB, 'globalMediaSourceSettings'>,
): RecurrenceRule | string {
  const settings = settingsDB.globalMediaSourceSettings();
  const interval = hoursCrontab(settings.rescanIntervalHours, 30);
  try {
    return (
      dailyLibraryScanRule(
        settings.dailyScanTime,
        settings.dailyScanTimeZone,
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
) {
  GlobalScheduler.clearTasks(ScanLibrariesTask.ID);
  GlobalScheduler.scheduleTask(
    ScanLibrariesTask.ID,
    new ScheduledTask(
      ScanLibrariesTask,
      libraryScanSchedule(settingsDB),
      container.get<() => ScanLibrariesTask>(ScanLibrariesTask.KEY),
      undefined,
    ),
  );
}
