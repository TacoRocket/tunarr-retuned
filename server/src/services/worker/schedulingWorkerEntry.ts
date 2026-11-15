// Must stay first. Zod only compiles schemas constructed after this loads.
import 'zod/compile';

import 'reflect-metadata';

import { dayjsMod } from '@tunarr/shared/util';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { bootstrapTunarr } from '../../bootstrap.ts';
import type { ServerOptions } from '../../globals.ts';
import { setGlobalOptions, setServerOptionsUnchecked } from '../../globals.ts';
import type { LogLevels } from '../../util/logging/LoggerFactory.ts';
import { resolveSchedulingWorker } from './SchedulingWorkerContainer.ts';

/**
 * Entry point for scheduling worker threads.
 *
 * A worker used to re-execute the server's CLI entry with `start-worker`. That
 * entry statically imports every command, so each worker loaded the HTTP
 * server, API routes, streaming, FFmpeg pipeline, guide, tasks, fixers and
 * media-source scanners, and built the server's full dependency container, to
 * run five request types that need none of them.
 *
 * This entry does what the `start-worker` path did, in the same order — CLI
 * middleware (global options, bootstrap), then the command handler (server
 * options, resolve and start `TunarrWorker`) — against a container holding only
 * the worker's own dependency graph.
 *
 * If any of that throws before the worker reports ready, it logs once and hands
 * the thread to the CLI entry the parent runs, which boots exactly as before.
 */

type SchedulingWorkerData = {
  serverOptions: ServerOptions;
  // The parent's CLI entry. Present when the parent started this entry.
  fallbackEntry?: string;
};

dayjs.extend(duration);
dayjs.extend(dayjsMod);

// Same flags `workerArgv()` in TunarrSubprocessService passes, read the way
// the CLI's yargs options read them.
function readGlobalArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      database: { type: 'string' },
      log_level: { type: 'string' },
      hide_banner: { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });
  if (typeof values.database !== 'string') {
    throw new Error('Scheduling worker started without --database');
  }
  return {
    database: path.normalize(
      fileURLToPath(new URL(`file://${values.database}`)),
    ),
    log_level:
      typeof values.log_level === 'string'
        ? (values.log_level as LogLevels)
        : undefined,
    verbose: 0,
  };
}

async function startLean(data: SchedulingWorkerData) {
  setGlobalOptions(readGlobalArgs());
  await bootstrapTunarr();
  setServerOptionsUnchecked(data.serverOptions);
  resolveSchedulingWorker().start();
}

async function main() {
  if (isMainThread || !parentPort) {
    console.error('This module is only meant to be run as a worker thread.');
    process.exit(1);
  }
  const data = workerData as SchedulingWorkerData;
  try {
    await startLean(data);
  } catch (error) {
    if (!data.fallbackEntry) throw error;
    // Logged once per worker start: the lean boot either works for a thread or
    // it does not, and the thread then runs the full boot for its lifetime.
    console.warn(
      'Scheduling worker could not start on its own container; falling back to the full server boot. This is a bug in SchedulingWorkerContainer.',
      error,
    );
    await import(pathToFileURL(data.fallbackEntry).href);
  }
}

// Not top-level await: the bundle is CommonJS. A rejection here leaves the
// worker without a 'started' event, which the pool already handles as a
// failed start (timeout, terminate, backoff).
main().catch((error: unknown) => {
  console.error('Scheduling worker failed to start', error);
  process.exit(1);
});
