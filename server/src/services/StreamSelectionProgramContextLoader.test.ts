import { faker } from '@faker-js/faker';
import tmp from 'tmp-promise';
import { v4 } from 'uuid';
import { test as baseTest, vi } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { DBAccess } from '../db/DBAccess.ts';
import { EntityGenre, Genre } from '../db/schema/Genre.ts';
import type { DrizzleDBAccess } from '../db/schema/index.ts';
import { Program } from '../db/schema/Program.ts';
import { ProgramGrouping } from '../db/schema/ProgramGrouping.ts';
import { setGlobalOptions } from '../globals.ts';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { StreamSelectionProgramContextLoader } from './StreamSelectionProgramContextLoader.ts';
import { runWithStreamSelectionMemo } from './streamSelectionRunMemo.ts';

type Fixture = {
  db: string;
  drizzle: DrizzleDBAccess;
  loader: StreamSelectionProgramContextLoader;
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
    await DBAccess.instance.closeConnection(`${dbResult.path}/db.db`);
    await dbResult.cleanup();
  },
  drizzle: async ({ db: _ }, use) => {
    const drizzle = DBAccess.instance.drizzle;
    if (!drizzle) {
      throw new Error('Drizzle was not initialized');
    }
    await use(drizzle);
  },
  loader: async ({ drizzle }, use) => {
    await use(new StreamSelectionProgramContextLoader(drizzle));
  },
});

async function insertProgram(
  drizzle: DrizzleDBAccess,
  values: { type: 'movie' | 'episode'; title: string; tvShowUuid?: string },
) {
  const uuid = v4();
  await drizzle.insert(Program).values({
    uuid,
    duration: 30000,
    sourceType: 'plex',
    externalKey: faker.string.alphanumeric({ length: 16 }),
    externalSourceId: faker.string.alphanumeric({ length: 16 }),
    ...values,
  });
  return uuid;
}

async function insertGenre(
  drizzle: DrizzleDBAccess,
  name: string,
  target: { programId: string } | { groupId: string },
) {
  const uuid = v4();
  await drizzle.insert(Genre).values({ uuid, name });
  await drizzle.insert(EntityGenre).values({ genreId: uuid, ...target });
  return uuid;
}

describe('StreamSelectionProgramContextLoader', () => {
  // The database handle is shared between tests, so a spy left on it would
  // carry its call count into the next one.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('adds show title and show genres for an episode', async ({
    drizzle,
    loader,
  }) => {
    const showUuid = v4();
    await drizzle
      .insert(ProgramGrouping)
      .values({ uuid: showUuid, title: 'Cowboy Bebop', type: 'show' });
    const programId = await insertProgram(drizzle, {
      type: 'episode',
      title: 'Asteroid Blues',
      tvShowUuid: showUuid,
    });

    const anime = await insertGenre(drizzle, 'Anime', { groupId: showUuid });
    await drizzle.insert(EntityGenre).values({ genreId: anime, programId });
    await insertGenre(drizzle, 'Science Fiction', { groupId: showUuid });
    await insertGenre(drizzle, 'Western', { programId });

    const context = await loader.load({
      uuid: programId,
      title: 'Asteroid Blues',
      type: 'episode',
      tvShowUuid: showUuid,
      libraryId: 'lib-1',
    });

    expect(context.title).toBe('Asteroid Blues');
    expect(context.showTitle).toBe('Cowboy Bebop');
    expect(context.libraryId).toBe('lib-1');
    expect([...context.genres].sort()).toEqual([
      'Anime',
      'Science Fiction',
      'Western',
    ]);
  });

  test('uses only the program for a movie', async ({ drizzle, loader }) => {
    const programId = await insertProgram(drizzle, {
      type: 'movie',
      title: 'Spirited Away',
    });
    await insertGenre(drizzle, 'Fantasy', { programId });

    const context = await loader.load({
      uuid: programId,
      title: 'Spirited Away',
      type: 'movie',
    });

    expect(context).toEqual({
      title: 'Spirited Away',
      type: 'movie',
      showTitle: '',
      genres: ['Fantasy'],
      libraryId: '',
    });
  });

  test('returns empty genres when none are tagged', async ({
    drizzle,
    loader,
  }) => {
    const programId = await insertProgram(drizzle, {
      type: 'movie',
      title: 'Untagged',
    });

    const context = await loader.load({
      uuid: programId,
      title: 'Untagged',
      type: 'movie',
    });

    expect(context.genres).toEqual([]);
  });

  test('loads a program’s details once inside a stream selection run', async ({
    drizzle,
    loader,
  }) => {
    const programId = await insertProgram(drizzle, {
      type: 'movie',
      title: 'Akira',
    });
    await insertGenre(drizzle, 'Anime', { programId });
    const program = { uuid: programId, title: 'Akira', type: 'movie' };
    const reads = vi.spyOn(drizzle, 'selectDistinct');

    const contexts = await runWithStreamSelectionMemo(async () => [
      await loader.load(program),
      await loader.load(program),
    ]);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(contexts.map((context) => context.genres)).toEqual([
      ['Anime'],
      ['Anime'],
    ]);

    await loader.load(program);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  // An episode's details are two questions: its genres, and its show's title.
  test('counts both queries of an episode’s first load and none for a repeat', async ({
    drizzle,
    loader,
  }) => {
    const showUuid = v4();
    await drizzle
      .insert(ProgramGrouping)
      .values({ uuid: showUuid, title: 'Cowboy Bebop', type: 'show' });
    const programId = await insertProgram(drizzle, {
      type: 'episode',
      title: 'Asteroid Blues',
      tvShowUuid: showUuid,
    });
    await insertGenre(drizzle, 'Anime', { groupId: showUuid });
    const episode = {
      uuid: programId,
      title: 'Asteroid Blues',
      type: 'episode',
      tvShowUuid: showUuid,
    };
    const genreReads = vi.spyOn(drizzle, 'selectDistinct');
    const titleReads = vi.spyOn(drizzle, 'select');
    const summary = vi.fn();

    const contexts = await runWithStreamSelectionMemo(
      async () => [await loader.load(episode), await loader.load(episode)],
      summary,
    );

    expect(genreReads).toHaveBeenCalledTimes(1);
    expect(titleReads).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledExactlyOnceWith({
      asked: 4,
      readAttempts: 2,
    });
    expect(contexts.map((context) => context.showTitle)).toEqual([
      'Cowboy Bebop',
      'Cowboy Bebop',
    ]);
    expect(contexts.map((context) => context.genres)).toEqual([
      ['Anime'],
      ['Anime'],
    ]);
  });

  test('reads a show’s title once for all of its episodes', async ({
    drizzle,
    loader,
  }) => {
    const showUuid = v4();
    await drizzle
      .insert(ProgramGrouping)
      .values({ uuid: showUuid, title: 'Cowboy Bebop', type: 'show' });
    const episodes = [];
    for (const title of ['Asteroid Blues', 'Stray Dog Strut']) {
      const uuid = await insertProgram(drizzle, {
        type: 'episode',
        title,
        tvShowUuid: showUuid,
      });
      episodes.push({ uuid, title, type: 'episode', tvShowUuid: showUuid });
    }
    const titleReads = vi.spyOn(drizzle, 'select');
    const summary = vi.fn();

    const contexts = await runWithStreamSelectionMemo(async () => {
      const loaded = [];
      for (const episode of episodes) {
        loaded.push(await loader.load(episode));
      }
      return loaded;
    }, summary);

    expect(titleReads).toHaveBeenCalledTimes(1);
    expect(summary).toHaveBeenCalledExactlyOnceWith({
      asked: 4,
      readAttempts: 3,
    });
    expect(contexts.map((context) => context.showTitle)).toEqual([
      'Cowboy Bebop',
      'Cowboy Bebop',
    ]);
  });
});
