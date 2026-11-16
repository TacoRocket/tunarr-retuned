import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import z from 'zod';
import { ScheduledTask } from './ScheduledTask.ts';
import { Task2 } from './Task.ts';

const TestTaskRequest = z
  .object({
    channelId: z.string().optional(),
  })
  .optional();

type TestTaskRequest = z.infer<typeof TestTaskRequest>;

class RecordingTask extends Task2<typeof TestTaskRequest, void> {
  public readonly ID = 'RecordingTask';
  readonly schema = TestTaskRequest;

  constructor(public readonly received: TestTaskRequest[]) {
    super();
  }

  protected runInternal(request: TestTaskRequest): Promise<void> {
    this.received.push(request);
    return Promise.resolve();
  }
}

describe('ScheduledTask', () => {
  const scheduled: ScheduledTask<typeof TestTaskRequest, void>[] = [];

  // Schedule far enough out that the job never fires on its own; every run in
  // these tests is an explicit runNow.
  function makeTask(name: string, presetArgs: TestTaskRequest) {
    const received: TestTaskRequest[] = [];
    const task = new ScheduledTask<typeof TestTaskRequest, void>(
      name,
      dayjs().add(10, 'year').toDate(),
      () => new RecordingTask(received),
      presetArgs,
    );
    scheduled.push(task);
    return { task, received };
  }

  afterEach(() => {
    while (scheduled.length > 0) {
      scheduled.pop()?.removeFromSchedule();
    }
  });

  test('passes an explicit request through to the task', async () => {
    const { task, received } = makeTask('explicit-request', {});

    await task.runNow(false, { channelId: 'channel-1' });

    expect(received).toEqual([{ channelId: 'channel-1' }]);
  });

  test('falls back to presetArgs when no request is given', async () => {
    const { task, received } = makeTask('preset-fallback', {
      channelId: 'preset-channel',
    });

    await task.runNow(false);

    expect(received).toEqual([{ channelId: 'preset-channel' }]);
  });

  test('an explicit request overrides presetArgs', async () => {
    const { task, received } = makeTask('override', {
      channelId: 'preset-channel',
    });

    await task.runNow(false, { channelId: 'explicit-channel' });

    expect(received).toEqual([{ channelId: 'explicit-channel' }]);
  });

  test('resolves presetArgs lazily when they are a function', async () => {
    const received: TestTaskRequest[] = [];
    let calls = 0;
    const task = new ScheduledTask<typeof TestTaskRequest, void>(
      'lazy-preset',
      dayjs().add(10, 'year').toDate(),
      () => new RecordingTask(received),
      () => ({ channelId: `call-${++calls}` }),
    );
    scheduled.push(task);

    await task.runNow(false);
    await task.runNow(false);

    expect(received).toEqual([
      { channelId: 'call-1' },
      { channelId: 'call-2' },
    ]);
  });
});

class SlowTask extends Task2<typeof TestTaskRequest, void> {
  public readonly ID = 'SlowTask';
  readonly schema = TestTaskRequest;

  constructor(
    private readonly received: TestTaskRequest[],
    private readonly runMs: number,
  ) {
    super();
  }

  protected async runInternal(request: TestTaskRequest): Promise<void> {
    this.received.push(request);
    await new Promise((resolve) => setTimeout(resolve, this.runMs));
  }
}

describe('ScheduledTask.runNow for a run that does less than the scheduled one', () => {
  const EveryHour = '0 0 * * * *';
  let task: ScheduledTask<typeof TestTaskRequest, void> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    task?.removeFromSchedule();
    task = undefined;
    vi.useRealTimers();
  });

  // runNow holds the schedule back until its run ends. When that run is only
  // part of the scheduled work, the scheduled run it held back still has to
  // happen.
  test('runs the scheduled run afterwards when it came due meanwhile', async () => {
    const received: TestTaskRequest[] = [];
    const hourly = new ScheduledTask<typeof TestTaskRequest, void>(
      'hour-boundary',
      EveryHour,
      () => new SlowTask(received, 2000),
      {},
    );
    task = hourly;
    const due = hourly.nextExecution();
    if (!due) throw new Error('The hourly job has no next run');
    // One second before the scheduled run, whatever the machine's time zone.
    await vi.advanceTimersByTimeAsync(due.getTime() - Date.now() - 1000);

    const partial = hourly.runNow(
      true,
      { channelId: 'partial' },
      { standsInForScheduledRun: false },
    );
    await vi.advanceTimersByTimeAsync(2000);
    await partial;
    await vi.advanceTimersByTimeAsync(2000);

    expect(received).toEqual([{ channelId: 'partial' }, {}]);
    expect(hourly.nextExecution()?.getTime()).toBe(due.getTime() + 3600000);
  });
});
