import { EventEmitter } from 'node:events';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
// container.ts and TunarrWorkerPool.ts import each other. Entering the graph at
// the pool leaves the class in its temporal dead zone when the container tries
// to bind it, so the container has to be the entry point.
import '../container.ts';
import { TunarrWorkerPool } from './TunarrWorkerPool.ts';
import type { TunarrSubprocessService } from './TunarrSubprocessService.ts';

class FakeWorker extends EventEmitter {
  // Replies to every request unless told to hang, which stands in for a worker
  // stuck in a loop it never leaves.
  hang = false;
  postMessage = vi.fn((request: { requestId: string; type?: string }) => {
    if (this.hang) {
      return;
    }
    setImmediate(() =>
      this.emit('message', {
        type: 'success',
        requestId: request.requestId,
        data: { type: 'status', status: 'healthy' },
      }),
    );
  });
  terminate = vi.fn(() => {
    this.emit('exit', 0);
    return Promise.resolve(0);
  });

  announceReady() {
    this.emit('message', { type: 'event', eventType: 'started' });
  }
}

/**
 * The pool attaches its listeners synchronously after `createWorker` returns,
 * so a worker can only report ready on a later tick.
 */
function makeSubprocessService() {
  const created: FakeWorker[] = [];
  let readyOnSpawn = true;
  let hangOnSpawn = false;

  const createWorker = vi.fn(() => {
    const worker = new FakeWorker();
    worker.hang = hangOnSpawn;
    created.push(worker);
    if (readyOnSpawn) {
      setImmediate(() => worker.announceReady());
    }
    return worker;
  });

  return {
    created,
    service: { createWorker } as unknown as TunarrSubprocessService,
    createWorker,
    set spawnBusy(value: boolean) {
      hangOnSpawn = value;
    },
    set spawnHealthy(value: boolean) {
      readyOnSpawn = value;
    },
  };
}

// The pool reads its size once, when its module loads, so this runs before the
// imports. Two workers keeps the tests independent of the host's CPU count.
vi.hoisted(() => vi.stubEnv('TUNARR_WORKER_POOL_SIZE', '2'));
afterAll(() => vi.unstubAllEnvs());

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('TunarrWorkerPool', () => {
  test('startup OCR waits until the pool has been started', async () => {
    const fake = makeSubprocessService();
    const pool = new TunarrWorkerPool(fake.service);
    const ready = vi.fn();
    const waiting = pool.allReady().then(ready);
    await tick();
    expect(ready).not.toHaveBeenCalled();
    pool.start({ scheduling: false });
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
    await expect(
      pool.queueTask({
        type: 'pgs-ocr',
        request: {
          programId: 'startup-program',
          inputPath: '/media/program.mkv',
          revision: null,
          streamIndex: 2,
          cacheFolder: '/cache/subtitles',
          sdh: false,
          forced: false,
        },
      }),
    ).resolves.toBeDefined();
    await pool.shutdown();
  });
});

describe('TunarrWorkerPool task timeouts', () => {
  const pools: TunarrWorkerPool[] = [];

  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.shutdown(100)));
  });

  /** Starts a pool and runs one job, leaving one idle scheduling worker. */
  async function startedPool() {
    const subprocess = makeSubprocessService();
    const pool = new TunarrWorkerPool(subprocess.service);
    pools.push(pool);
    pool.start();
    await pool.allReady();
    await pool.queueTask({ type: 'status' });
    const [first] = subprocess.created;
    if (first === undefined) {
      throw new Error('The pool started no workers');
    }
    first.postMessage.mockClear();
    return { subprocess, pool, first };
  }

  test('a timed-out task frees its worker for later tasks', async () => {
    const { subprocess, pool, first } = await startedPool();
    const workerCount = subprocess.created.length;
    first.hang = true;

    await expect(pool.queueTask({ type: 'status' }, 50)).rejects.toThrow(
      /timeout/i,
    );

    // The hung worker is replaced, so later tasks do not wait behind it.
    for (let i = 0; i < workerCount; i++) {
      await expect(pool.queueTask({ type: 'status' }, 5_000)).resolves.toEqual({
        type: 'status',
        status: 'healthy',
      });
    }

    expect(first.postMessage).toHaveBeenCalledOnce();
    expect(first.terminate).toHaveBeenCalledTimes(1);
    expect(subprocess.createWorker).toHaveBeenCalledTimes(workerCount + 1);
  }, 15_000);

  const ocrRequest = {
    type: 'pgs-ocr' as const,
    request: {
      programId: 'test-program',
      inputPath: '/test/movie.mkv',
      revision: null,
      streamIndex: 2,
      forced: false,
      sdh: true,
      cacheFolder: '/test/cache',
    },
  };

  test.each(['abort', 'deadline'] as const)(
    'OCR %s waits for cleanup on an exclusive worker, preserving scheduling capacity',
    async (mode) => {
      const { subprocess, pool, first } = await startedPool();
      const workerCount = subprocess.created.length;
      subprocess.spawnBusy = true;
      const controller = new AbortController();
      const ocr = pool.queueTask(ocrRequest, mode === 'deadline' ? 50 : 5_000, {
        signal: controller.signal,
      });
      const rejected = expect(ocr).rejects.toThrow(
        mode === 'deadline' ? /timeout/i : /canceled/i,
      );
      await vi.waitFor(() =>
        expect(subprocess.created).toHaveLength(workerCount + 1),
      );
      const nativeWorker = subprocess.created[workerCount]!;
      await vi.waitFor(() =>
        expect(nativeWorker.postMessage).toHaveBeenCalled(),
      );
      await expect(pool.queueTask(ocrRequest)).rejects.toThrow(
        /OCR worker is busy/,
      );
      await expect(pool.queueTask({ type: 'status' })).resolves.toEqual({
        type: 'status',
        status: 'healthy',
      });
      expect(first.postMessage).toHaveBeenCalled();
      if (mode === 'abort') controller.abort();
      await vi.waitFor(() =>
        expect(
          nativeWorker.postMessage.mock.calls.some(
            ([r]) => r.type === 'cancel',
          ),
        ).toBe(true),
      );
      expect(nativeWorker.terminate).not.toHaveBeenCalled();
      const [request] = nativeWorker.postMessage.mock.calls.find(
        ([r]) => r.type === 'pgs-ocr',
      )!;
      nativeWorker.emit('message', {
        type: 'error',
        requestId: request.requestId,
        message: 'Native cleanup finished',
      });
      await rejected;
      expect(nativeWorker.terminate).not.toHaveBeenCalled();
      expect(first.terminate).not.toHaveBeenCalled();
      expect(
        nativeWorker.postMessage.mock.calls.every(
          ([r]) => r.type === 'pgs-ocr' || r.type === 'cancel',
        ),
      ).toBe(true);
    },
  );

  test.each(['abort', 'deadline'] as const)(
    'unresponsive OCR %s is bounded by the cleanup grace without killing scheduling',
    async (mode) => {
      const { subprocess, pool, first } = await startedPool();
      const schedulingWorkers = subprocess.created.length;
      subprocess.spawnBusy = true;
      first.hang = true;
      const scheduled = pool.queueTask({ type: 'status' }, 60_000);
      const survived = expect(scheduled).resolves.toEqual({
        type: 'status',
        status: 'healthy',
      });
      const controller = new AbortController();
      // The warm-up job armed the first worker's idle timer before the clock
      // was faked; let the fake clock clear that real timer.
      vi.useFakeTimers({ shouldClearNativeTimers: true });
      try {
        const ocr = pool.queueTask(
          ocrRequest,
          mode === 'deadline' ? 100 : 60_000,
          { signal: controller.signal },
        );
        const rejected = expect(ocr).rejects.toThrow(
          /did not acknowledge cancellation within 30000ms/,
        );
        await vi.advanceTimersByTimeAsync(1);
        const nativeWorker = subprocess.created[schedulingWorkers]!;
        if (mode === 'abort') controller.abort();
        else await vi.advanceTimersByTimeAsync(99);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(nativeWorker.terminate).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(nativeWorker.terminate).toHaveBeenCalledTimes(1);
        expect(first.terminate).not.toHaveBeenCalled();
        const [request] = first.postMessage.mock.calls[0]!;
        first.emit('message', {
          type: 'success',
          requestId: request.requestId,
          data: { type: 'status', status: 'healthy' },
        });
        await survived;
        // The replacement is on demand, not a permanently added worker.
        await vi.advanceTimersByTimeAsync(1_001);
        expect(subprocess.created).toHaveLength(schedulingWorkers + 1);
        const next = pool.queueTask(ocrRequest, 60_000);
        await vi.advanceTimersByTimeAsync(1);
        const replacement = subprocess.created[schedulingWorkers + 1]!;
        const [nextRequest] = replacement.postMessage.mock.calls[0]!;
        replacement.emit('message', {
          type: 'success',
          requestId: nextRequest.requestId,
          data: {
            type: 'pgs-ocr',
            result: { status: 'cached', path: '/test/cache/subtitle.srt' },
          },
        });
        await expect(next).resolves.toMatchObject({
          type: 'pgs-ocr',
          result: { status: 'cached' },
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(replacement.terminate).toHaveBeenCalledTimes(1);
        // Idle scheduling workers retire on the same one-minute clock.
        expect(first.terminate).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test('tasks queued behind a timed-out task are released', async () => {
    const { subprocess, pool, first } = await startedPool();
    first.hang = true;
    subprocess.spawnBusy = true;

    // With both workers busy, `queuedBehind` goes to the least loaded one,
    // which is the hung worker in slot 0.
    const timedOut = pool.queueTask({ type: 'status' }, 50);
    const other = pool.queueTask({ type: 'status' }, 5_000);
    const queuedBehind = pool.queueTask({ type: 'status' }, 10_000);
    await vi.waitFor(() => {
      expect(first.postMessage).toHaveBeenCalledTimes(2);
      expect(subprocess.created[1]?.postMessage).toHaveBeenCalledOnce();
    });
    const second = subprocess.created[1]!;
    const [request] = second.postMessage.mock.calls[0]!;
    second.emit('message', {
      type: 'success',
      requestId: request.requestId,
      data: { type: 'status', status: 'healthy' },
    });

    await Promise.all([
      expect(timedOut).rejects.toThrow(/timeout/i),
      expect(queuedBehind).rejects.toThrow(/exited/i),
      expect(other).resolves.toEqual({ type: 'status', status: 'healthy' }),
    ]);
    expect(first.postMessage).toHaveBeenCalledTimes(2);
  }, 10_000);

  test('shutdown after replacing a timed-out worker starts no further workers', async () => {
    const { subprocess, pool, first } = await startedPool();
    const workerCount = subprocess.created.length;
    first.hang = true;
    await expect(pool.queueTask({ type: 'status' }, 50)).rejects.toThrow(
      /timeout/i,
    );
    await vi.waitFor(
      () =>
        expect(subprocess.createWorker).toHaveBeenCalledTimes(workerCount + 1),
      { timeout: 3_000 },
    );
    const replacement = subprocess.created.at(-1);

    await pool.shutdown(100);
    await tick();

    expect(subprocess.createWorker).toHaveBeenCalledTimes(workerCount + 1);
    expect(replacement?.terminate).toHaveBeenCalled();
  });
});

describe('TunarrWorkerPool on-demand lifecycle', () => {
  test('shutdown cancels a cold job instead of dispatching it after restart', async () => {
    const subprocess = makeSubprocessService();
    subprocess.spawnHealthy = false;
    const pool = new TunarrWorkerPool(subprocess.service);
    try {
      pool.start();
      const job = pool.queueTask({ type: 'status' });
      const result = expect(job).rejects.toThrow();
      await tick();
      await pool.shutdown(100);
      subprocess.spawnHealthy = true;
      pool.start();
      await result;
      expect(subprocess.created).toHaveLength(1);
    } finally {
      await pool.shutdown(100);
    }
  });

  test('allocates for work, keeps busy workers, retires idle ones after a minute, and recreates for the next job', async () => {
    vi.useFakeTimers();
    const subprocess = makeSubprocessService();
    const pool = new TunarrWorkerPool(subprocess.service);
    try {
      pool.start();
      pool.start();
      await pool.allReady();
      expect(subprocess.created).toHaveLength(0);
      subprocess.spawnBusy = true;
      // A deadline well past the idle timeout, so only retirement could end
      // these workers while their jobs run.
      const jobs = [
        pool.queueTask({ type: 'status' }, 300_000),
        pool.queueTask({ type: 'status' }, 300_000),
      ];
      await vi.advanceTimersByTimeAsync(1);
      expect(subprocess.created).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(120_000);
      for (const worker of subprocess.created) {
        expect(worker.terminate).not.toHaveBeenCalled();
        const request = worker.postMessage.mock.calls[0]?.[0];
        expect(request).toBeDefined();
        worker.emit('message', {
          type: 'success',
          requestId: request?.requestId,
          data: { type: 'status', status: 'healthy' },
        });
      }
      await expect(Promise.all(jobs)).resolves.toHaveLength(2);
      await vi.advanceTimersByTimeAsync(59_999);
      for (const worker of subprocess.created)
        expect(worker.terminate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      for (const worker of subprocess.created)
        expect(worker.terminate).toHaveBeenCalledTimes(1);
      // Retiring a worker must not trigger the crash-replacement timer.
      await vi.advanceTimersByTimeAsync(31_000);
      expect(subprocess.created).toHaveLength(2);
      subprocess.spawnBusy = false;
      const next = pool.queueTask({ type: 'status' });
      await vi.advanceTimersByTimeAsync(1);
      await expect(next).resolves.toEqual({
        type: 'status',
        status: 'healthy',
      });
      expect(subprocess.created).toHaveLength(3);
    } finally {
      vi.useRealTimers();
      await pool.shutdown(100);
    }
  });
});
