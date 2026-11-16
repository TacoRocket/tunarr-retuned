import type { GlobalMediaSourceSettings } from '@tunarr/types/schemas';
import parser from 'cron-parser';
import { RecurrenceRule } from 'node-schedule';
import { container } from '../../container.ts';
import {
  isDailyScanTime,
  isIanaTimeZone,
} from '../../db/forkSettingsRepair.ts';
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
  if (!isDailyScanTime(time)) {
    throw new Error('The daily scan time must use HH:mm (00:00–23:59)');
  }
  if (!isIanaTimeZone(timeZone)) {
    throw new Error('The daily scan time zone must be a valid IANA time zone');
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

type ScanFields = Pick<
  GlobalMediaSourceSettings,
  'rescanIntervalHours' | 'dailyScanTime' | 'dailyScanTimeZone'
>;

// The interval also drives collection and custom show syncing. It is checked
// with the scheduler's own cron parser, which refuses 0 and fractions.
function checkRescanInterval(hours: number) {
  try {
    parser.parseExpression(hoursCrontab(hours, 30));
  } catch (cause) {
    throw new Error(
      'The rescan interval must be a whole number of hours, 1 or more',
      { cause },
    );
  }
}

// Checks a scanner settings save before anything is saved or unscheduled, so
// a refused save leaves the running library scan as it was. It checks what
// the save changes and, when the daily time changes, the schedule that will
// replace the running one; an older value the save doesn't touch is left to
// the startup fallback rather than blocking an unrelated save.
export function checkLibraryScanSave(
  current: ScanFields,
  changes: Partial<ScanFields>,
) {
  const next = { ...current, ...changes };
  if (changes.rescanIntervalHours !== undefined) {
    checkRescanInterval(next.rescanIntervalHours);
  }
  if (
    changes.dailyScanTime !== undefined ||
    changes.dailyScanTimeZone !== undefined
  ) {
    const daily = dailyLibraryScanRule(
      next.dailyScanTime,
      next.dailyScanTimeZone,
    );
    if (!daily) checkRescanInterval(next.rescanIntervalHours);
  }
}

// Replaces the scheduled library scan, at startup and after the daily time is
// saved, so a new time applies without a restart. The new schedule is worked
// out before the running one is cancelled.
export function scheduleLibraryScans(
  settingsDB: Pick<ISettingsDB, 'globalMediaSourceSettings'>,
) {
  const schedule = libraryScanSchedule(settingsDB);
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
