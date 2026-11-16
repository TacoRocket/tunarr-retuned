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

const SlowTaskRequest = z
  .object({
    name: z.string(),
    runMs: z.number(),
  })
  .optional();

type SlowTaskRequest = z.infer<typeof SlowTaskRequest>;

// Records the name it was started with and takes runMs to finish. The
// scheduled run has no request, so it is recorded as 'scheduled'.
class SlowTask extends Task2<typeof SlowTaskRequest, void> {
  public readonly ID = 'SlowTask';
  readonly schema = SlowTaskRequest;

  constructor(private readonly started: string[]) {
    super();
  }

  protected async runInternal(request: SlowTaskRequest): Promise<void> {
    this.started.push(request?.name ?? 'scheduled');
    await new Promise((resolve) => setTimeout(resolve, request?.runMs ?? 1000));
  }
}

describe('ScheduledTask.runBesideSchedule', () => {
  const EveryHour = '0 0 * * * *';
  const OneHourMs = 3600000;
  let task: ScheduledTask<typeof SlowTaskRequest, void> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    task?.removeFromSchedule();
    task = undefined;
    vi.useRealTimers();
  });

  // Starts an hourly job and moves the clock to msBefore before its next run,
  // whatever the machine's time zone.
  async function hourlyJob(name: string, msBefore: number) {
    const started: string[] = [];
    const hourly = new ScheduledTask<typeof SlowTaskRequest, void>(
      name,
      EveryHour,
      () => new SlowTask(started),
      undefined,
    );
    task = hourly;
    const due = hourly.nextExecution();
    if (!due) throw new Error('The hourly job has no next run');
    await vi.advanceTimersByTimeAsync(due.getTime() - Date.now() - msBefore);
    return { hourly, started, due: due.getTime() };
  }

  // A run that does only part of the scheduled work cannot stand in for the
  // scheduled run, so it must leave the schedule exactly as it found it.
  test('a run that crosses the hour leaves the scheduled run in place', async () => {
    const { hourly, started, due } = await hourlyJob('one-crossing', 1000);

    const partial = hourly.runBesideSchedule({ name: 'partial', runMs: 2000 });
    await vi.advanceTimersByTimeAsync(5000);
    await partial;

    expect(started).toEqual(['partial', 'scheduled']);
    expect(hourly.nextExecution()?.getTime()).toBe(due + OneHourMs);
  });

  test('overlapping runs that finish out of order still give one scheduled run', async () => {
    const { hourly, started, due } = await hourlyJob('two-overlapping', 2000);

    // 09:59:58, ends 10:00:02.
    const long = hourly.runBesideSchedule({ name: 'long', runMs: 4000 });
    await vi.advanceTimersByTimeAsync(1000);
    // 09:59:59, ends before the hour.
    const short = hourly.runBesideSchedule({ name: 'short', runMs: 500 });
    await vi.advanceTimersByTimeAsync(9000);
    await Promise.all([long, short]);

    expect(started).toEqual(['long', 'short', 'scheduled']);
    expect(hourly.nextExecution()?.getTime()).toBe(due + OneHourMs);
  });
});
