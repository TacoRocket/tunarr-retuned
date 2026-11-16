import { AdPoolSchema } from '@tunarr/types/api';
import { z } from 'zod/v4';
import { adPools } from '../services/adPools.ts';
import type { RouterPluginAsyncCallback } from '../types/serverType.js';

// Fork: Library → Ad Pools. Filler lists that ad breaks draw from, with the
// channels whose breaks use them. Tagged with filler lists so their changes
// refresh it.
// eslint-disable-next-line @typescript-eslint/require-await
export const adPoolsApi: RouterPluginAsyncCallback = async (fastify) => {
  fastify.get(
    '/ad-pools',
    {
      schema: {
        tags: ['Filler Lists'],
        operationId: 'getAdPools',
        description:
          'Filler lists that ad breaks draw from: those linked to a Smart Collection, and those a channel’s saved after-show breaks or break recipe use.',
        response: { 200: z.array(AdPoolSchema) },
      },
    },
    async (req, res) => {
      const [fillers, lineups, collections] = await Promise.all([
        req.serverCtx.fillerDB.getAllFillers(),
        req.serverCtx.channelDB.loadAllLineupConfigs(),
        req.serverCtx.smartCollectionsDB.getAllRaw(),
      ]);
      const collectionNames = new Map(collections.map((c) => [c.uuid, c.name]));
      return res.send(
        adPools(
          fillers.map((f) => ({
            uuid: f.uuid,
            name: f.name,
            smartCollectionId: f.smartCollectionId ?? null,
            smartCollectionName: f.smartCollectionId
              ? (collectionNames.get(f.smartCollectionId) ?? null)
              : null,
            clipCount: f.content.length,
          })),
          Object.values(lineups),
        ),
      );
    },
  );
};
