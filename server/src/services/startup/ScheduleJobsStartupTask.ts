import { inject, injectable } from 'inversify';
import { filter, flatten, forEach, values } from 'lodash-es';
import { container } from '../../container.ts';
import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import { PrepareEpisodeEndingsTask } from '../../tasks/PrepareEpisodeEndingsTask.ts';
import { CleanupSessionsTask } from '../../tasks/CleanupSessionsTask.ts';
import { OnDemandChannelStateTask } from '../../tasks/OnDemandChannelStateTask.ts';
import { RefreshMediaSourceLibraryTask } from '../../tasks/RefreshMediaSourceLibraryTask.ts';
import {
  RollSeedChannelsTask,
  RollingSeedRefreshMinutes,
} from '../../tasks/RollSeedChannelsTask.ts';
import { IndexSimilarityTask } from '../../tasks/IndexSimilarityTask.ts';
import { ScheduledTask } from '../../tasks/ScheduledTask.ts';
import { SubtitleExtractorTask } from '../../tasks/SubtitleExtractorTask.ts';
import { SyncCollectionsTask } from '../../tasks/SyncCollectionsTask.ts';
import { SyncCustomShowsTask } from '../../tasks/SyncCustomShowsTask.ts';
import { UpdateXmlTvTask } from '../../tasks/UpdateXmlTvTask.ts';
import { autoFactoryKey, KEYS } from '../../types/inject.ts';
import { InjectLogger } from '../../util/inject.ts';
import type { Logger } from '../../util/logging/LoggerFactory.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import {
  GlobalScheduler,
  hoursCrontab,
  minutesCrontab,
  scheduleBackupJobs,
} from '../Scheduler.ts';
import { ChannelLineupMigratorStartupTask } from './ChannelLineupMigratorStartupTask.ts';
import { SimpleStartupTask } from './IStartupTask.ts';
import {
  libraryScanSchedule,
  scheduleLibraryScans,
} from './LibraryScanSchedule.ts';

@injectable()
export class ScheduleJobsStartupTask extends SimpleStartupTask {
  id = ScheduleJobsStartupTask.name;
  dependencies = [ChannelLineupMigratorStartupTask.name];

  @InjectLogger() declare private readonly logger: Logger;

  constructor(@inject(KEYS.SettingsDB) private settingsDB: ISettingsDB) {
    super();
  }

  getPromise(): Promise<void> {
    // Read first: invalid container variables stop scheduling before any job.
    const scanSchedule = libraryScanSchedule(this.settingsDB);
    const xmlTvSettings = this.settingsDB.xmlTvSettings();

    GlobalScheduler.scheduleTask(
      UpdateXmlTvTask.ID,
      new ScheduledTask(
        UpdateXmlTvTask,
        hoursCrontab(xmlTvSettings.refreshHours),
        container.get<() => UpdateXmlTvTask>(KEYS.UpdateXmlTvTaskFactory),
        {},
      ),
    );

    GlobalScheduler.scheduleTask(
      CleanupSessionsTask.ID,
      new ScheduledTask(
        CleanupSessionsTask,
        minutesCrontab(1),
        container.get<() => CleanupSessionsTask>(CleanupSessionsTask.KEY),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      OnDemandChannelStateTask.ID,
      new ScheduledTask(
        OnDemandChannelStateTask,
        minutesCrontab(1),
        container.get<() => OnDemandChannelStateTask>(
          OnDemandChannelStateTask.KEY,
        ),
        undefined,
        { runAtStartup: true },
      ),
    );

    GlobalScheduler.scheduleTask(
      PrepareEpisodeEndingsTask.ID,
      new ScheduledTask(
        PrepareEpisodeEndingsTask,
        hoursCrontab(1),
        () => container.get(PrepareEpisodeEndingsTask),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      SubtitleExtractorTask.ID,
      new ScheduledTask(
        SubtitleExtractorTask,
        hoursCrontab(1),
        container.get<() => SubtitleExtractorTask>(
          autoFactoryKey(SubtitleExtractorTask),
        ),
        {},
        {
          runAtStartup: true,
        },
      ),
    );

    GlobalScheduler.scheduleTask(
      RefreshMediaSourceLibraryTask.ID,
      new ScheduledTask(
        RefreshMediaSourceLibraryTask,
        hoursCrontab(1),
        () =>
          container.get<RefreshMediaSourceLibraryTask>(
            RefreshMediaSourceLibraryTask,
          ),
        undefined,
      ),
    );

    scheduleLibraryScans(this.settingsDB, scanSchedule);

    GlobalScheduler.scheduleTask(
      SyncCollectionsTask.ID,
      new ScheduledTask(
        SyncCollectionsTask,
        hoursCrontab(
          this.settingsDB.globalMediaSourceSettings().rescanIntervalHours,
        ),
        container.get<() => SyncCollectionsTask>(SyncCollectionsTask.KEY),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      SyncCustomShowsTask.ID,
      new ScheduledTask(
        SyncCustomShowsTask,
        hoursCrontab(
          this.settingsDB.globalMediaSourceSettings().rescanIntervalHours,
        ),
        container.get<() => SyncCustomShowsTask>(SyncCustomShowsTask.KEY),
        undefined,
      ),
    );

    GlobalScheduler.scheduleTask(
      RollSeedChannelsTask.ID,
      new ScheduledTask(
        RollSeedChannelsTask,
        minutesCrontab(RollingSeedRefreshMinutes),
        () => container.get(RollSeedChannelsTask),
        undefined,
        { runAtStartup: true },
      ),
    );

    // Hourly: only new and changed titles are sent, so most passes are tiny.
    // Not at startup: it would run before Meilisearch is up, and what was
    // already sent is remembered across restarts.
    GlobalScheduler.scheduleTask(
      IndexSimilarityTask.ID,
      new ScheduledTask(
        IndexSimilarityTask,
        hoursCrontab(1),
        () => container.get(IndexSimilarityTask),
        undefined,
      ),
    );

    scheduleBackupJobs(this.settingsDB.backup);

    forEach(
      filter(
        flatten(values(GlobalScheduler.scheduledJobsById)),
        (job) => job.runAtStartup,
      ),
      (job) => {
        this.logger.debug('Running startup task %s', job.name);
        job
          .runNow(true)
          .catch((e) =>
            LoggerFactory.root.error(
              e,
              'Error running job %s at startup',
              job.name,
            ),
          );
      },
    );

    return Promise.resolve();
  }
}
