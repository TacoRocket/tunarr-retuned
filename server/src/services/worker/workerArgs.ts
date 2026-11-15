import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LogLevels } from '../../util/logging/LoggerFactory.ts';

// Same flags `workerArgv()` in TunarrSubprocessService passes, read the way
// the CLI's yargs options read them.
export function readGlobalArgs() {
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
