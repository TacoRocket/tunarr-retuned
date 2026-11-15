import { search } from '@tunarr/shared/util';
import type { Factory } from 'inversify';
import { Container, ContainerModule } from 'inversify';
import type { DeepPartial } from 'ts-essentials';
import { dbContainer } from '../../db/DBModule.ts';
import type { ISettingsDB } from '../../db/interfaces/ISettingsDB.ts';
import type { SettingsFile } from '../../db/SettingsDB.ts';
import { SettingsDBFactory } from '../../db/SettingsDBFactory.ts';
import {
  globalOptions,
  type GlobalOptions,
  serverOptions,
  type ServerOptions,
} from '../../globals.ts';
import { KEYS } from '../../types/inject.ts';
import { ChildProcessHelper } from '../../util/ChildProcessHelper.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { FileSystemService } from '../FileSystemService.ts';
import { MeilisearchService } from '../MeilisearchService.ts';
import { TunarrWorker } from '../TunarrWorker.ts';

/**
 * The dependency container a scheduling worker runs on.
 *
 * A worker thread serves five request types (status, restart, time-slots,
 * schedule-slots, pgs-ocr). All of them are handled by `TunarrWorker`, whose
 * dependency graph is the two slot schedulers, the search client and the
 * database facades they read from. The server's full container also loads the
 * stream, FFmpeg, guide, task, fixer, health-check, media-source scanner and
 * startup modules; nothing a worker serves resolves any of them.
 *
 * Every binding here is copied from `container.ts` with the same scope, so a
 * service resolves to the same implementation it would in the full container.
 * Anything not listed is autobound, exactly as the full container does.
 *
 * Built once per worker thread and owned by the worker entry. It holds the
 * singletons a worker already held under the full container — fewer of them.
 */
const SchedulingWorkerModule = new ContainerModule(({ bind }) => {
  bind<GlobalOptions>(KEYS.GlobalOptions).toDynamicValue(() => globalOptions());
  bind<ServerOptions>(KEYS.ServerOptions).toDynamicValue(() => serverOptions());

  bind(SettingsDBFactory).toSelf().inSingletonScope();
  bind<Factory<ISettingsDB>>('Factory<ISettingsDB>').toFactory((context) => {
    const inst = context.get(SettingsDBFactory);
    return (dbPath: string, initialSettings: DeepPartial<SettingsFile>) =>
      inst.get(dbPath, initialSettings);
  });
  bind<ISettingsDB>(KEYS.SettingsDB).toDynamicValue((ctx) => {
    return ctx.get<() => ISettingsDB>('Factory<ISettingsDB>')();
  });

  bind<typeof LoggerFactory>(KEYS.LoggerFactory).toConstantValue(LoggerFactory);

  bind(FileSystemService).toSelf().inSingletonScope();
  bind(MeilisearchService).toSelf().inSingletonScope();
  bind(KEYS.SearchService).toService(MeilisearchService);
  bind(ChildProcessHelper).toSelf().inSingletonScope();
  bind(search.SearchParser).to(search.SearchParser);

  // MediaSourceDB takes this factory for one call, dropping a cached API
  // client after a media source is edited or deleted. Workers never edit media
  // sources. Binding the real factory would load every Plex, Jellyfin and Emby
  // client into each worker for a call it cannot make.
  bind(KEYS.MediaSourceApiFactory).toConstantValue(
    unavailableInWorker('MediaSourceApiFactory'),
  );
  // Same constructor, same story: called only after a media source is added
  // or updated, to start a library scan.
  bind(KEYS.MediaSourceLibraryRefresher).toConstantValue(
    unavailableInWorker('MediaSourceLibraryRefresher'),
  );
  // LineupRepository dispatches lineup saves to the pool. A worker is the
  // pool's far end: it never saves a lineup, and under the full container this
  // resolved to a second, never-started pool inside the worker.
  bind(KEYS.WorkerPoolFactory).toConstantValue(
    unavailableInWorker('WorkerPool'),
  );
});

/**
 * A factory for a service the worker's tasks never call. If one is ever
 * called, the task fails with an error naming it rather than running against a
 * half-built service. Logged once per worker.
 */
function unavailableInWorker(name: string): () => never {
  return () => {
    const error = new Error(
      `${name} is not loaded in the scheduling worker. The worker's tasks are not expected to need it; this is a bug in SchedulingWorkerContainer.`,
    );
    if (!reportedUnavailable.has(name)) {
      reportedUnavailable.add(name);
      LoggerFactory.root.error(error);
    }
    throw error;
  };
}

// One entry per stubbed factory name, so at most a handful of strings.
const reportedUnavailable = new Set<string>();

export function createSchedulingWorkerContainer(): Container {
  const container = new Container({ autobind: true });
  container.load(SchedulingWorkerModule);
  container.load(dbContainer);
  return container;
}

/**
 * Resolves the worker from the lean container. Throws if the container is
 * missing a binding the worker's graph needs, which the entry treats as the
 * signal to fall back to the full server boot.
 */
export function resolveSchedulingWorker(): TunarrWorker {
  return createSchedulingWorkerContainer().get<TunarrWorker>(TunarrWorker);
}
