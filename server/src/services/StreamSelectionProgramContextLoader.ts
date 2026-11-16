import { eq, or } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { EntityGenre, Genre } from '../db/schema/Genre.ts';
import type { DrizzleDBAccess } from '../db/schema/index.ts';
import { ProgramGrouping } from '../db/schema/ProgramGrouping.ts';
import { KEYS } from '../types/inject.ts';
import type { StreamSelectionCelContext } from './CelEvaluationService.ts';
import { rememberForRun } from './streamSelectionRunMemo.ts';

export type StreamSelectionProgramRef = {
  uuid: string;
  title: string;
  type: string;
  libraryId?: string | null;
  tvShowUuid?: string | null;
};

/**
 * Builds the `program` part of the stream selection CEL context. Episodes
 * also get their show's title, and their genres include the show's genres,
 * because media servers usually tag genres on the show rather than on each
 * episode.
 */
@injectable()
export class StreamSelectionProgramContextLoader {
  constructor(@inject(KEYS.DrizzleDB) private drizzle: DrizzleDBAccess) {}

  /**
   * Each remembered lookup is exactly one query. That keeps a run's count of
   * database reads equal to the queries it sent without anyone maintaining
   * the count by hand, and it lets the two questions be remembered on their
   * own terms: genres belong to the program, the title belongs to the show
   * and is read once for all of its episodes.
   */
  async load(
    program: StreamSelectionProgramRef,
  ): Promise<StreamSelectionCelContext['program']> {
    const showId =
      program.type === 'episode'
        ? (program.tvShowUuid ?? undefined)
        : undefined;

    const [genres, showTitle] = await Promise.all([
      rememberForRun(`program-genres:${program.uuid}:${showId ?? ''}`, () =>
        this.readGenres(program.uuid, showId),
      ),
      showId
        ? rememberForRun(`show-title:${showId}`, () =>
            this.readShowTitle(showId),
          )
        : '',
    ]);

    return {
      title: program.title,
      type: program.type,
      showTitle,
      genres,
      libraryId: program.libraryId ?? '',
    };
  }

  /** Genre names on the program and, for an episode, on its show. */
  private async readGenres(
    programId: string,
    showId: string | undefined,
  ): Promise<string[]> {
    const rows = await this.drizzle
      .selectDistinct({ name: Genre.name })
      .from(EntityGenre)
      .innerJoin(Genre, eq(EntityGenre.genreId, Genre.uuid))
      .where(
        showId
          ? or(
              eq(EntityGenre.programId, programId),
              eq(EntityGenre.groupId, showId),
            )
          : eq(EntityGenre.programId, programId),
      );
    return rows.map((row) => row.name);
  }

  private async readShowTitle(showId: string): Promise<string> {
    const [show] = await this.drizzle
      .select({ title: ProgramGrouping.title })
      .from(ProgramGrouping)
      .where(eq(ProgramGrouping.uuid, showId))
      .limit(1);
    return show?.title ?? '';
  }
}
