import { z } from 'zod/v4';

// Fork: a pool is a filler list that ad breaks draw from: one linked to a
// Smart Collection, or one a channel's saved breaks or break recipe uses.
export const AdPoolChannelSchema = z.object({
  id: z.string(),
  number: z.number(),
  name: z.string(),
  // Ad spots in the channel's saved after-show breaks that draw from this pool.
  adSpots: z.number().int().nonnegative(),
  // Whether the channel's break recipe (Random Slots) names this pool.
  inRecipe: z.boolean(),
});

export const AdPoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  clipCount: z.number().int().nonnegative(),
  smartCollectionId: z.string().nullable(),
  smartCollectionName: z.string().nullable(),
  channels: z.array(AdPoolChannelSchema),
});

export type AdPool = z.infer<typeof AdPoolSchema>;
export type AdPoolChannel = z.infer<typeof AdPoolChannelSchema>;
