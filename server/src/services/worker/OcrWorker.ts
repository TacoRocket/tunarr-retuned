import PQueue from 'p-queue';
import { parentPort } from 'worker_threads';
import { TypedError, unwrapError } from '../../types/errors.ts';
import { OcrWorkerInput } from '../../types/worker_ocr_schemas.ts';
import type {
  WorkerEvent,
  WorkerReply,
  WorkerSuccessReply,
} from '../../types/worker_schemas.ts';
import { LoggerFactory } from '../../util/logging/LoggerFactory.ts';
import { PgsOcrJobs } from './PgsOcrJobs.ts';

/**
 * The worker the pool's dedicated OCR slot runs. It serves what that slot is
 * sent — pgs-ocr, cancel, status and restart — with the same OCR job code as
 * TunarrWorker, and loads no scheduler, database or search client.
 *
 * Any other request that carries a request ID gets an immediate error reply
 * instead of silence, so a misrouted task fails fast rather than waiting out
 * the pool's timeout.
 */
export class OcrWorker {
  // Same concurrency as TunarrWorker's queue; the pool sends this slot one
  // OCR job at a time.
  #queue = new PQueue({ concurrency: 2 });
  #logger = LoggerFactory.child({ className: 'OcrWorker' });
  #ocr = new PgsOcrJobs(this.#queue, {
    sendSuccessReply: (requestId, data) =>
      this.sendSuccessReply(requestId, data),
    replyWithError: (requestId, error) => this.replyWithError(requestId, error),
  });

  start() {
    this.#logger.info('Tunarr OCR worker started');
    parentPort?.postMessage({
      type: 'event',
      eventType: 'started',
      message: 'Worker successfully started!',
    } satisfies WorkerEvent);

    parentPort?.on('message', (message: unknown) => {
      const parsed = OcrWorkerInput.safeParse(message);
      if (parsed.error) {
        const requestId = (message as { requestId?: unknown } | null)
          ?.requestId;
        if (typeof requestId === 'string') {
          this.replyWithError(
            requestId,
            new Error('The OCR worker serves only pgs-ocr, status and restart'),
          );
        } else {
          this.#logger.error(
            parsed.error,
            'Error parsing worker request message',
          );
        }
        return;
      }
      const request = parsed.data;
      switch (request.type) {
        case 'cancel':
          this.#ocr.cancel(request.requestId);
          return;
        case 'pgs-ocr':
          this.#ocr.queueOcr(request);
          return;
        case 'status':
          this.sendSuccessReply(request.requestId, {
            type: 'status',
            status: 'healthy',
          });
          return;
        case 'restart':
          process.exit(request.code ?? 1);
      }
    });
  }

  private sendSuccessReply(
    requestId: string,
    data: WorkerSuccessReply['data'],
  ) {
    this.sendReply({ type: 'success', data, requestId });
  }

  private replyWithError(requestId: string, wrapped: Error) {
    const error = unwrapError(wrapped);
    this.#logger.error(error);
    this.sendReply({
      type: 'error',
      requestId,
      message: error.message,
      httpCode: error instanceof TypedError ? error.httpCode : undefined,
    });
  }

  private sendReply(reply: WorkerReply) {
    parentPort?.postMessage(reply);
  }
}
