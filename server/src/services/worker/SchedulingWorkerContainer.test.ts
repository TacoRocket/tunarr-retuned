import {
  RandomSlotScheduleSchema,
  TimeSlotScheduleSchema,
} from '@tunarr/types/api';
import { randomUUID } from 'node:crypto';
import tmp from 'tmp-promise';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { bootstrapTunarr } from '../../bootstrap.ts';
// The full container, for the side-by-side comparison. It also settles the
// container.ts <-> TunarrWorkerPool.ts import cycle before anything else loads.
import { container as fullContainer } from '../../container.ts';
import { DBAccess } from '../../db/DBAccess.ts';
import { CustomShow } from '../../db/schema/CustomShow.ts';
import { CustomShowContent } from '../../db/schema/CustomShowContent.ts';
import { MediaSource } from '../../db/schema/MediaSource.ts';
import { MediaSourceLibrary } from '../../db/schema/MediaSourceLibrary.ts';
import { Program } from '../../db/schema/Program.ts';
import { setGlobalOptions, setServerOptionsUnchecked } from '../../globals.ts';
import { copyPreMigratedDb } from '../../testing/testDbFactory.ts';
import { KEYS } from '../../types/inject.ts';
import { SlotSchedulerService } from '../scheduling/RandomSlotSchedulerService.ts';
import { TimeSlotSchedulerService } from '../scheduling/TimeSlotSchedulerService.ts';
import { TunarrWorker } from '../TunarrWorker.ts';
import { createSchedulingWorkerContainer } from './SchedulingWorkerContainer.ts';

const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PROGRAM_COUNT = 300;
// Fixed so both containers draw the same shuffle.
const SEED = [11, 22, 33, 44];
const START_TIME = Date.UTC(2026, 0, 5, 0, 0, 0);

let dir: tmp.DirectoryResult;
let programIds: string[];
// Every seeded program, in one custom show the slots draw from.
const customShowId = randomUUID();
// Fixed per run so both containers see byte-identical requests.
const slotIds = Array.from({ length: 13 }, () => randomUUID());

// Follows the seeding in scripts/worker-pool-ab.ts: programs without a media
// source and library row are skipped by materialization and the schedule
// comes back as one flex block, which would compare equal and prove nothing.
function seedPrograms(count: number): string[] {
  const drizzle = DBAccess.instance.drizzle!;
  const mediaSourceId = randomUUID();
  const sourceName = `lean-source-${mediaSourceId}`;
  const libraryId = randomUUID();
  const now = Date.now();
  drizzle
    .insert(MediaSource)
    .values({
      uuid: mediaSourceId as never,
      accessToken: 'lean-token',
      index: 0,
      name: sourceName as never,
      type: 'plex',
      uri: 'http://localhost:32400',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  drizzle
    .insert(MediaSourceLibrary)
    .values({
      uuid: libraryId,
      name: 'Lean Movies',
      mediaType: 'movies',
      mediaSourceId: mediaSourceId as never,
      externalKey: '1',
      enabled: true,
    })
    .run();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const uuid = randomUUID();
    ids.push(uuid);
    drizzle
      .insert(Program)
      .values({
        uuid,
        createdAt: now,
        updatedAt: now,
        title: `Lean Movie ${i}`,
        // Varied lengths so slot packing and flex placement are exercised.
        duration: HALF_HOUR_MS + (i % 7) * 60_000,
        type: 'movie',
        sourceType: 'plex',
        externalKey: `ext-${uuid}`,
        externalSourceId: sourceName as never,
        mediaSourceId: mediaSourceId as never,
        libraryId,
        canonicalId: `plex|${mediaSourceId}|ext-${uuid}`,
        state: 'ok',
        year: 2020,
        summary: 'lean',
      })
      .run();
  }
  drizzle
    .insert(CustomShow)
    .values({
      uuid: customShowId,
      name: 'Lean Show',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  ids.forEach((contentUuid, index) =>
    drizzle
      .insert(CustomShowContent)
      .values({ contentUuid, customShowUuid: customShowId, index })
      .run(),
  );
  return ids;
}

function timeSlotRequest() {
  return {
    type: 'programs' as const,
    programIds,
    seed: SEED,
    startTime: START_TIME,
    schedule: TimeSlotScheduleSchema.parse({
      type: 'time',
      flexPreference: 'distribute',
      latenessMs: 0,
      maxDays: 7,
      padMs: 1,
      period: 'day',
      timeZoneOffset: 0,
      slots: Array.from({ length: 12 }, (_, i) => ({
        type: 'custom-show',
        customShowId,
        startTime: (DAY_MS / 12) * i,
        order: 'shuffle',
        direction: 'asc',
        id: slotIds[i],
      })),
    }),
  };
}

function randomSlotRequest() {
  return {
    type: 'programs' as const,
    programIds,
    seed: SEED,
    startTime: START_TIME,
    schedule: RandomSlotScheduleSchema.parse({
      type: 'random',
      flexPreference: 'distribute',
      maxDays: 7,
      padMs: 1,
      padStyle: 'slot',
      randomDistribution: 'uniform',
      timeZoneOffset: 0,
      slots: [
        {
          type: 'custom-show',
          customShowId,
          id: slotIds[12],
          cooldownMs: 0,
          weight: 100,
          order: 'shuffle',
          direction: 'asc',
        },
      ],
    }),
  };
}

beforeAll(async () => {
  dir = await tmp.dir({ unsafeCleanup: true });
  await copyPreMigratedDb(dir.path);
  setGlobalOptions({ database: dir.path, log_level: 'error', verbose: 0 });
  setServerOptionsUnchecked({ port: 0 } as never);
  await bootstrapTunarr();
  programIds = seedPrograms(PROGRAM_COUNT);
});

afterAll(async () => {
  await dir?.cleanup();
});

describe('SchedulingWorkerContainer', () => {
  test('resolves the worker without the full server container', () => {
    expect(createSchedulingWorkerContainer().get(TunarrWorker)).toBeInstanceOf(
      TunarrWorker,
    );
  });

  test('time-slot schedule matches the full container', async () => {
    const lean = createSchedulingWorkerContainer().get(
      TimeSlotSchedulerService,
    );
    const full = fullContainer.get(TimeSlotSchedulerService);
    const leanResult = await lean.schedule(timeSlotRequest());
    const fullResult = await full.schedule(timeSlotRequest());
    // Guards against comparing two all-flex schedules.
    expect(
      leanResult.lineup.filter((item) => item.type !== 'flex').length,
    ).toBeGreaterThan(100);
    expect(leanResult).toEqual(fullResult);
  });

  test('random-slot schedule matches the full container', async () => {
    const lean = createSchedulingWorkerContainer().get(SlotSchedulerService);
    const full = fullContainer.get(SlotSchedulerService);
    const leanResult = await lean.schedule(randomSlotRequest());
    const fullResult = await full.schedule(randomSlotRequest());
    expect(
      leanResult.lineup.filter((item) => item.type !== 'flex').length,
    ).toBeGreaterThan(100);
    expect(leanResult).toEqual(fullResult);
  });

  test('services a worker never calls fail loudly, naming themselves', () => {
    const lean = createSchedulingWorkerContainer();
    for (const [key, name] of [
      [KEYS.MediaSourceApiFactory, 'MediaSourceApiFactory'],
      [KEYS.MediaSourceLibraryRefresher, 'MediaSourceLibraryRefresher'],
      [KEYS.WorkerPoolFactory, 'WorkerPool'],
    ] as const) {
      expect(() => lean.get<() => unknown>(key)()).toThrow(name);
    }
  });
});
