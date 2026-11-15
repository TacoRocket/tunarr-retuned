import { z } from 'zod/v4';

// The worker request shapes that do not depend on the scheduling services.
// worker_schemas.ts builds the full request union from these; the OCR worker
// entry parses only these, so it never loads the schedulers.

export const BaseWorkerRequest = z.object({
  requestId: z.uuid(),
});

export const WorkerRestartRequest = BaseWorkerRequest.extend({
  type: z.literal('restart'),
  code: z.number().optional(),
});

export const WorkerStatusRequest = BaseWorkerRequest.extend({
  type: z.literal('status'),
});

export const WorkerPgsOcrRequest = BaseWorkerRequest.extend({
  type: z.literal('pgs-ocr'),
  request: z.object({
    programId: z.string(),
    inputPath: z.string(),
    revision: z.string().nullable(),
    streamIndex: z.number().int().nonnegative(),
    forced: z.boolean(),
    sdh: z.boolean(),
    cacheFolder: z.string(),
  }),
});
export type WorkerPgsOcrRequest = z.infer<typeof WorkerPgsOcrRequest>;

export const WorkerCancelRequest = BaseWorkerRequest.extend({
  type: z.literal('cancel'),
});

/** Everything the OCR worker accepts. */
export const OcrWorkerInput = z.discriminatedUnion('type', [
  WorkerRestartRequest,
  WorkerStatusRequest,
  WorkerPgsOcrRequest,
  WorkerCancelRequest,
]);
