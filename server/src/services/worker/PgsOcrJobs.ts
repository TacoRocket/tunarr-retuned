import type PQueue from 'p-queue';
import { parentPort } from 'worker_threads';
import type {
  WorkerPgsOcrRequest,
  WorkerSuccessReply,
} from '../../types/worker_schemas.ts';
import { prepareCachedPgsSubtitle } from '../subtitles/PgsSubtitlePreparation.ts';

export type WorkerReplies = {
  sendSuccessReply(requestId: string, data: WorkerSuccessReply['data']): void;
  replyWithError(requestId: string, error: Error): void;
};

/**
 * PGS OCR jobs on a worker thread: queueing, cooperative cancellation and
 * progress. Moved out of TunarrWorker unchanged so the OCR worker entry and
 * TunarrWorker run the same code.
 *
 * Owns one AbortController per queued or running job, removed when the job
 * settles; the pool admits one OCR job per OCR worker at a time.
 */
export class PgsOcrJobs {
  #jobs = new Map<string, AbortController>();

  constructor(
    private readonly queue: PQueue,
    private readonly replies: WorkerReplies,
  ) {}

  cancel(requestId: string) {
    this.#jobs.get(requestId)?.abort();
  }

  queueOcr(request: WorkerPgsOcrRequest) {
    const controller = new AbortController();
    this.#jobs.set(request.requestId, controller);
    let running = false;
    controller.signal.addEventListener(
      'abort',
      () => {
        if (!running) {
          this.#jobs.delete(request.requestId);
          this.replies.replyWithError(
            request.requestId,
            new Error('PGS OCR canceled before starting'),
          );
        }
      },
      { once: true },
    );
    this.queue
      .add(async () => {
        // PQueue checks a queued signal only when capacity becomes available.
        // Reply to queued cancellation above; leave only this inert queue entry.
        if (controller.signal.aborted) return;
        running = true;
        try {
          const result = await prepareCachedPgsSubtitle({
            ...request.request,
            signal: controller.signal,
            onProgress: (message) =>
              parentPort?.postMessage({
                type: 'progress',
                requestId: request.requestId,
                message,
              }),
          });
          this.replies.sendSuccessReply(request.requestId, {
            type: 'pgs-ocr',
            result,
          });
        } finally {
          this.#jobs.delete(request.requestId);
        }
      })
      .catch((error: unknown) => {
        this.replies.replyWithError(
          request.requestId,
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }
}
