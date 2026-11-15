import { tag } from '@tunarr/types';
import dayjs from 'dayjs';
import { now } from 'lodash-es';
import { anything, instance, mock, when } from 'ts-mockito';
import { expect, test, vi } from 'vitest';
import type { Lineup, LineupItem } from '../db/derived_types/Lineup.ts';
import type { IChannelDB } from '../db/interfaces/IChannelDB.ts';
import type { IFillerListDB } from '../db/interfaces/IFillerListDB.ts';
import type { IProgramDB } from '../db/interfaces/IProgramDB.ts';
import { calculateStartTimeOffsets } from '../db/lineupUtil.ts';
import { ProgramPlayHistoryDB } from '../db/ProgramPlayHistoryDB.ts';
import type { MediaSourceId } from '../db/schema/base.ts';
import type { IFillerPicker } from '../services/interfaces/IFillerPicker.ts';
import {
  createChannelOrm,
  createFakeProgram,
} from '../testing/fakes/entityCreators.ts';
import type { ScheduleSeedGrowth } from './ScheduleSeedGrowth.ts';
import { StreamProgramCalculator } from './StreamProgramCalculator.ts';

// Fork: a seed channel grows after it plays a program. The calculator asks the
// injected scheduler for that rather than importing the task scheduler, which
// would put the whole server into the scheduling worker's bundle.

const programId = 'program-1';
const lineupItems: LineupItem[] = [
  {
    type: 'content',
    durationMs: +dayjs.duration({ minutes: 22 }),
    id: programId,
  },
];

function calculator(seedGrowth: Lineup['seedGrowth']) {
  const channelDB = mock<IChannelDB>();
  const programDB = mock<IProgramDB>();
  const playHistoryDB = mock<ProgramPlayHistoryDB>();
  const startTime = dayjs(new Date(2026, 10, 15, 8));
  const channel = createChannelOrm({
    number: 1,
    startTime: +startTime.subtract(5, 'minutes'),
    duration: lineupItems[0]!.durationMs,
  });
  when(channelDB.getChannelOrm(1)).thenResolve(channel);
  when(channelDB.loadLineup(channel.uuid)).thenResolve({
    version: 1,
    items: lineupItems,
    startTimeOffsets: calculateStartTimeOffsets(lineupItems),
    lastUpdated: now(),
    seedGrowth,
  });
  when(programDB.getStreamProgramById(programId)).thenResolve(
    createFakeProgram({
      uuid: programId,
      duration: lineupItems[0]!.durationMs,
      mediaSourceId: tag<MediaSourceId>('mediasource-1'),
    }),
  );
  when(
    playHistoryDB.isProgramCurrentlyPlaying(anything(), anything(), anything()),
  ).thenResolve(false);
  when(playHistoryDB.create(anything())).thenResolve({
    uuid: 'history-1',
  } as Awaited<ReturnType<ProgramPlayHistoryDB['create']>>);

  const calc = new StreamProgramCalculator(
    instance(mock<IFillerListDB>()),
    instance(channelDB),
    instance(programDB),
    instance(mock<IFillerPicker>()),
    instance(playHistoryDB),
  );
  // Set by the container's property injection in the server.
  const scheduleSeedGrowth = vi.fn<ScheduleSeedGrowth>(() => Promise.resolve());
  Object.assign(calc, { scheduleSeedGrowth });
  return { calc, channel, scheduleSeedGrowth, startTime: +startTime };
}

test('playing a program on a seed channel schedules its growth for that play', async () => {
  const { calc, channel, scheduleSeedGrowth, startTime } = calculator({
    seedProgramIds: [programId],
    familiarity: 0,
    targetHours: 12,
    recommendationMode: 'balanced',
  } as Lineup['seedGrowth']);

  await calc.getCurrentLineupItem({
    allowSkip: false,
    channelId: 1,
    startTime,
  });

  expect(scheduleSeedGrowth).toHaveBeenCalledTimes(1);
  const [channelId, historyId, at] = scheduleSeedGrowth.mock.calls[0]!;
  expect([channelId, historyId]).toEqual([channel.uuid, 'history-1']);
  expect(at.getTime()).toBeGreaterThanOrEqual(startTime);
});

test('a channel without seed growth schedules nothing', async () => {
  const { calc, scheduleSeedGrowth, startTime } = calculator(undefined);

  await calc.getCurrentLineupItem({
    allowSkip: false,
    channelId: 1,
    startTime,
  });

  expect(scheduleSeedGrowth).not.toHaveBeenCalled();
});
