import { z } from 'zod/v4';
import { GlobalMediaSourceSettingsSchema } from '@tunarr/types/schemas';
import {
  dailyLibraryScanRule,
  dailyScanSetByEnvironment,
  scheduleLibraryScans,
} from '../services/startup/LibraryScanSchedule.ts';
import type { RouterPluginAsyncCallback } from '../types/serverType.js';

const fields = GlobalMediaSourceSettingsSchema.shape;

// Fork: the Scanner page locks the daily time while the container variables
// decide it.
const MediaSourceSettingsResponseSchema =
  GlobalMediaSourceSettingsSchema.extend({
    dailyScanSetByEnvironment: z.boolean(),
  });

// eslint-disable-next-line @typescript-eslint/require-await
export const settingsApi: RouterPluginAsyncCallback = async (fastify) => {
  fastify.get(
    '/settings/media-source',
    {
      schema: {
        tags: ['Settings'],
        response: {
          200: MediaSourceSettingsResponseSchema,
        },
      },
    },
    async (req, res) => {
      const settings = req.serverCtx.settings.globalMediaSourceSettings();
      return res.send({
        ...settings,
        dailyScanSetByEnvironment: dailyScanSetByEnvironment(),
      });
    },
  );

  fastify.put(
    '/settings/media-source',
    {
      schema: {
        tags: ['Settings'],
        body: z
          .object({
            plexNotificationsEnabled:
              fields.plexNotificationsEnabled.removeDefault(),
            rescanIntervalHours: fields.rescanIntervalHours.removeDefault(),
            repairReaddedItems: fields.repairReaddedItems.removeDefault(),
            repairReaddedItemsOnStartup:
              fields.repairReaddedItemsOnStartup.removeDefault(),
            dailyScanTime: fields.dailyScanTime.removeDefault(),
            dailyScanTimeZone: fields.dailyScanTimeZone.removeDefault(),
          })
          .partial(),
        // No 400 schema: fastify's own validation errors are objects, and a
        // string schema would turn them into 500s.
        response: {
          200: MediaSourceSettingsResponseSchema,
        },
      },
    },
    async (req, res) => {
      const { dailyScanTime, dailyScanTimeZone } = req.body;
      const changesDailyScan =
        dailyScanTime !== undefined || dailyScanTimeZone !== undefined;
      if (changesDailyScan) {
        // The pair is checked as it will be saved, so a saved time always
        // schedules.
        const current = req.serverCtx.settings.globalMediaSourceSettings();
        try {
          dailyLibraryScanRule(
            dailyScanTime === undefined ? current.dailyScanTime : dailyScanTime,
            dailyScanTimeZone === undefined
              ? current.dailyScanTimeZone
              : dailyScanTimeZone,
            'settings',
          );
        } catch (e) {
          return res.status(400).send((e as Error).message);
        }
      }
      await req.serverCtx.settings.directUpdate((file) => {
        Object.assign(file.settings.mediaSource, req.body);
      });
      if (changesDailyScan) {
        scheduleLibraryScans(req.serverCtx.settings);
      }
      return res.send({
        ...req.serverCtx.settings.globalMediaSourceSettings(),
        dailyScanSetByEnvironment: dailyScanSetByEnvironment(),
      });
    },
  );
};
