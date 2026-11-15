import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';

/** File name of the bundled scheduling worker, beside `bundle.cjs`. */
export const SCHEDULING_WORKER_BUNDLE = 'tunarr-worker.cjs';

let resolved: string | undefined;

/**
 * Picks the file a scheduling worker thread runs.
 *
 * The bundled server (`bundle.cjs`) ships the lean worker as a sibling
 * `tunarr-worker.cjs`; a source checkout runs `schedulingWorkerEntry.ts`
 * through the same loader as the server. When the lean entry is not on disk —
 * a packaging that does not ship it, such as a native executable — workers run
 * the CLI entry with `start-worker`, as they did before it existed. That is
 * logged once per process.
 *
 * The answer cannot change while the process runs, so it is computed once.
 */
export function schedulingWorkerEntry(cliEntry: string): string {
  if (resolved !== undefined) return resolved;
  const lean = cliEntry.endsWith('.cjs')
    ? path.join(path.dirname(cliEntry), SCHEDULING_WORKER_BUNDLE)
    : fileURLToPath(new URL('./schedulingWorkerEntry.ts', import.meta.url));
  if (existsSync(lean)) {
    resolved = lean;
  } else {
    LoggerFactory.root.warn(
      'Scheduling worker entry %s not found; workers will boot the full server from %s',
      lean,
      cliEntry,
    );
    resolved = cliEntry;
  }
  return resolved;
}
