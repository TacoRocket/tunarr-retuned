import { AsyncLocalStorage } from 'node:async_hooks';

type RunMemo = {
  answers: Map<string, Promise<unknown>>;
  asked: number;
  readAttempts: number;
};

export type RunMemoCounts = {
  /** Lookups made while the run was in progress. */
  asked: number;
  /** Reads started, counting ones that failed and their retries. */
  readAttempts: number;
};

const currentRun = new AsyncLocalStorage<RunMemo>();

/**
 * Runs `fn` with stream selection lookups answered once and remembered until
 * `fn` settles.
 *
 * PROBE: subtitle lookahead evaluates every filler clip against every channel.
 * On a 33-channel install that is about 24,500 selections an hour, each
 * re-reading the same profiles and the same program details: 151,000 SQL
 * statements for about 1,600 distinct answers. Nothing outside `fn` sees a
 * remembered answer, so playback still reads the database every time. An edit
 * made while `fn` runs is picked up by the next run.
 */
export async function runWithStreamSelectionMemo<T>(
  fn: () => Promise<T>,
  onDone?: (counts: RunMemoCounts) => void,
): Promise<T> {
  const run: RunMemo = { answers: new Map(), asked: 0, readAttempts: 0 };
  try {
    return await currentRun.run(run, fn);
  } finally {
    onDone?.({ asked: run.asked, readAttempts: run.readAttempts });
  }
}

/**
 * Inside {@link runWithStreamSelectionMemo}, returns the remembered answer
 * for `key`, reading it the first time. Outside one, always reads.
 */
export function rememberForRun<T>(
  key: string,
  read: () => Promise<T>,
): Promise<T> {
  const run = currentRun.getStore();
  if (!run) {
    return read();
  }
  run.asked++;
  const known = run.answers.get(key);
  if (known) {
    // The key names the reader, so the stored answer has the reader's type.
    return known as Promise<T>;
  }
  run.readAttempts++;
  const answer = read();
  run.answers.set(key, answer);
  // A failed read is asked again rather than remembered.
  answer.catch(() => run.answers.delete(key));
  return answer;
}
