import { faker } from '@faker-js/faker';
import Database, { SqliteError } from 'better-sqlite3';
import tmp from 'tmp-promise';
import { v4 } from 'uuid';
import { afterEach, test as baseTest, describe, expect, vi } from 'vitest';
import { bootstrapTunarr } from '../../bootstrap.ts';
import { setGlobalOptions } from '../../globals.ts';
import { copyPreMigratedDb } from '../../testing/testDbFactory.ts';
import { DBAccess } from '../DBAccess.ts';
import type { DrizzleDBAccess } from '../schema/index.ts';
import { Program } from '../schema/Program.ts';
import { BasicProgramRepository } from './BasicProgramRepository.ts';

type Fixture = {
  db: string;
  drizzle: DrizzleDBAccess;
  repo: BasicProgramRepository;
};

const test = baseTest.extend<Fixture>({
  db: async ({}, use) => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    setGlobalOptions({
      database: dbResult.path,
      log_level: 'info',
      verbose: 0,
    });
    await bootstrapTunarr();
    await use(dbResult.path);
    await dbResult.cleanup();
  },
  drizzle: async ({ db: _ }, use) => {
    const drizzle = DBAccess.instance.drizzle;
    if (!drizzle) {
      throw new Error('Drizzle is not initialized');
    }
    await use(drizzle);
  },
  repo: async ({ drizzle }, use) => {
    const { db } = DBAccess.instance;
    if (!db) {
      throw new Error('Kysely is not initialized');
    }
    await use(new BasicProgramRepository(db, drizzle));
  },
});

async function insertProgram(drizzle: DrizzleDBAccess, title: string) {
  const uuid = v4();
  await drizzle.insert(Program).values({
    uuid,
    title,
    type: 'movie',
    duration: 30000,
    sourceType: 'plex',
    externalKey: faker.string.alphanumeric({ length: 16 }),
    externalSourceId: faker.string.alphanumeric({ length: 16 }),
  });
  return uuid;
}

describe('BasicProgramRepository.getProgramById', () => {
  // The tests share one database handle, so a spy left on it would keep
  // counting into the next test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The query joins a dozen relations. Composing its SQL costs more than
  // running it, and callers such as the subtitle lookahead load hundreds of
  // programs one after another.
  test('composes the query once and reuses it for every id', async ({
    drizzle,
    repo,
  }) => {
    const akira = await insertProgram(drizzle, 'Akira');
    const paprika = await insertProgram(drizzle, 'Paprika');
    const composed = vi.spyOn(drizzle.query.program, 'findFirst');

    const found = [
      await repo.getProgramById(akira),
      await repo.getProgramById(paprika),
      await repo.getProgramById(akira),
    ];
    const missing = await repo.getProgramById(v4());

    expect(found.map((program) => program?.title)).toEqual([
      'Akira',
      'Paprika',
      'Akira',
    ]);
    expect(found.map((program) => program?.uuid)).toEqual([
      akira,
      paprika,
      akira,
    ]);
    expect(missing).toBeUndefined();
    expect(composed).toHaveBeenCalledTimes(1);
  });

  // SQLite compiles the query when it is prepared, and that can fail for a
  // passing reason such as a locked database. A failed attempt must not be
  // kept as the one attempt.
  test('prepares the query again after preparing it failed', async ({
    drizzle,
    repo,
  }) => {
    const akira = await insertProgram(drizzle, 'Akira');
    const composed = vi.spyOn(drizzle.query.program, 'findFirst');
    vi.spyOn(Database.prototype, 'prepare').mockImplementationOnce(() => {
      throw new SqliteError('database is locked', 'SQLITE_BUSY');
    });

    await expect(repo.getProgramById(akira)).rejects.toThrow(
      'database is locked',
    );

    const afterFailure = await repo.getProgramById(akira);
    const reused = await repo.getProgramById(akira);

    expect(afterFailure?.uuid).toBe(akira);
    expect(reused?.uuid).toBe(akira);
    // Once for the failed attempt, once for the one that is kept.
    expect(composed).toHaveBeenCalledTimes(2);
  });
});
