/**
 * Fork: schedules a seed channel's growth task after the channel plays a
 * program.
 *
 * Bound in container.ts, which loads the task scheduler only when this is
 * called. Scheduler.ts loads the whole server container, so a static or lazy
 * import of it from the stream code put the entire server into any bundle that
 * reaches StreamProgramCalculator.ts, including the scheduling worker's.
 */
export type ScheduleSeedGrowth = (
  channelId: string,
  historyId: string,
  at: Date,
) => Promise<void>;
