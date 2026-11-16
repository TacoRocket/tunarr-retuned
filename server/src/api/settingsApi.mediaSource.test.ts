/**
 * Route test for `PUT /settings/media-source` (fork #254): a save the
 * scheduler can't use is refused before anything is saved or unscheduled.
 */
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/util/logging/LoggerFactory.js', () => {
  const stubLogger: Record<string, unknown> = {};
  for (const level of ['error', 'warn', 'info', 'debug', 'trace', 'fatal']) {
    stubLogger[level] = () => {};
  }
  stubLogger.child = () => stubLogger;
  return {
    LoggerFactory: {
      child: () => stubLogger,
      root: stubLogger,
      get: () => stubLogger,
    },
    Logger: stubLogger,
  };
});

vi.mock('../container.ts', () => ({
  container: { get: () => () => ({}) },
}));

const scheduler = vi.hoisted(() => ({
  clearTasks: vi.fn(),
  scheduleTask: vi.fn(),
}));
vi.mock('../services/Scheduler.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  GlobalScheduler: scheduler,
}));

import { settingsApi } from './settingsApi.js';

describe('PUT /settings/media-source', () => {
  let app: ReturnType<typeof Fastify>;
  let saved: Record<string, unknown>;
  const directUpdate = vi.fn();

  beforeEach(async () => {
    saved = {
      plexNotificationsEnabled: false,
      rescanIntervalHours: 6,
      repairReaddedItems: false,
      repairReaddedItemsOnStartup: false,
      dailyScanTime: '03:30',
      dailyScanTimeZone: 'UTC',
    };
    directUpdate.mockReset();
    directUpdate.mockImplementation(
      async (fn: (file: { settings: { mediaSource: object } }) => void) =>
        fn({ settings: { mediaSource: saved } }),
    );
    scheduler.clearTasks.mockReset();
    scheduler.scheduleTask.mockReset();

    app = Fastify()
      .setValidatorCompiler(validatorCompiler)
      .setSerializerCompiler(serializerCompiler)
      .withTypeProvider<ZodTypeProvider>();
    app.decorateRequest('serverCtx', null);
    app.addHook('onRequest', (req, _res, done) => {
      (req as unknown as { serverCtx: unknown }).serverCtx = {
        settings: {
          globalMediaSourceSettings: () => saved,
          directUpdate,
        },
      };
      done();
    });
    await app.register(settingsApi);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const put = (payload: object) =>
    app.inject({ method: 'PUT', url: '/settings/media-source', payload });

  // Codex review of #254: this returned 500, saved the zero interval and
  // left no library scan scheduled.
  it('refuses an interval the scheduler cannot use, keeping the daily scan', async () => {
    const res = await put({
      dailyScanTime: null,
      dailyScanTimeZone: null,
      rescanIntervalHours: 0,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: expect.stringMatching(/interval/) });
    expect(directUpdate).not.toHaveBeenCalled();
    expect(scheduler.clearTasks).not.toHaveBeenCalled();
    expect(saved).toMatchObject({
      rescanIntervalHours: 6,
      dailyScanTime: '03:30',
      dailyScanTimeZone: 'UTC',
    });
  });

  it('refuses a fractional interval on its own', async () => {
    const res = await put({ rescanIntervalHours: 1.5 });

    expect(res.statusCode).toBe(400);
    expect(directUpdate).not.toHaveBeenCalled();
  });

  // The saved value accepts any text so settings.json always loads; saves
  // are still checked.
  it('refuses a daily time that is not HH:mm', async () => {
    const res = await put({ dailyScanTime: '25:00' });

    expect(res.statusCode).toBe(400);
    expect(directUpdate).not.toHaveBeenCalled();
  });

  it('saves a usable schedule and replaces the library scan', async () => {
    const res = await put({ dailyScanTime: '04:15' });

    expect(res.statusCode).toBe(200);
    expect(saved.dailyScanTime).toBe('04:15');
    expect(scheduler.clearTasks).toHaveBeenCalledOnce();
    expect(scheduler.scheduleTask).toHaveBeenCalledOnce();
    // The real job the stand-in scheduler would have owned.
    (
      scheduler.scheduleTask.mock.calls[0]?.[1] as {
        removeFromSchedule: () => void;
      }
    ).removeFromSchedule();
  });
});
