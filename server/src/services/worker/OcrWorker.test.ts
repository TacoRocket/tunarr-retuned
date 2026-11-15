import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { OcrWorker } from './OcrWorker.ts';

const { port, prepare } = vi.hoisted(() => ({
  port: { on: vi.fn(), postMessage: vi.fn() },
  prepare: vi.fn(),
}));
vi.mock('worker_threads', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parentPort: port,
}));
vi.mock('../subtitles/PgsSubtitlePreparation.ts', () => ({
  prepareCachedPgsSubtitle: prepare,
}));

function startWorker() {
  port.on.mockClear();
  port.postMessage.mockClear();
  new OcrWorker().start();
  const receive = port.on.mock.calls.find(
    ([event]) => event === 'message',
  )?.[1];
  if (typeof receive !== 'function')
    throw new Error('Missing message receiver');
  return receive as (message: unknown) => void;
}

const replyFor = (requestId: string) =>
  vi.waitFor(() => {
    const call = port.postMessage.mock.calls.find(
      ([msg]) => (msg as { requestId?: string }).requestId === requestId,
    );
    if (!call) throw new Error('no reply yet');
    return call[0] as Record<string, unknown>;
  });

test('reports started, then answers status', async () => {
  const receive = startWorker();
  expect(port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'event', eventType: 'started' }),
  );
  const requestId = randomUUID();
  receive({ type: 'status', requestId });
  expect(await replyFor(requestId)).toEqual({
    type: 'success',
    requestId,
    data: { type: 'status', status: 'healthy' },
  });
});

test('runs a PGS OCR job through the shared job runner', async () => {
  prepare.mockResolvedValueOnce({ status: 'cached', path: '/cache/x.srt' });
  const receive = startWorker();
  const requestId = randomUUID();
  receive({
    type: 'pgs-ocr',
    requestId,
    request: {
      programId: 'p',
      inputPath: '/media/x.mkv',
      revision: null,
      streamIndex: 2,
      forced: false,
      sdh: false,
      cacheFolder: '/cache',
    },
  });
  expect(await replyFor(requestId)).toEqual({
    type: 'success',
    requestId,
    data: {
      type: 'pgs-ocr',
      result: { status: 'cached', path: '/cache/x.srt' },
    },
  });
  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({ inputPath: '/media/x.mkv', streamIndex: 2 }),
  );
});

test('answers a request it does not serve with an error, not silence', async () => {
  const receive = startWorker();
  const requestId = randomUUID();
  receive({ type: 'time-slots', requestId, request: {} });
  expect(await replyFor(requestId)).toEqual(
    expect.objectContaining({
      type: 'error',
      requestId,
      message: 'The OCR worker serves only pgs-ocr, status and restart',
    }),
  );
});
