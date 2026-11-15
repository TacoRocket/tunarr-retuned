import type {
  StreamSelectionLevel,
  StreamSelectionProfile,
} from '@tunarr/types/schemas';
import { BuiltInStreamSelectionProfileId } from '@tunarr/types/schemas';
import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ISettingsDB } from '../db/interfaces/ISettingsDB.ts';
import { Channel } from '../db/schema/Channel.ts';
import { CustomShow } from '../db/schema/CustomShow.ts';
import { FillerShow } from '../db/schema/FillerShow.ts';
import type { DrizzleDBAccess } from '../db/schema/index.ts';
import { Program } from '../db/schema/Program.ts';
import { StreamSelectionProfile as StreamSelectionProfileTable } from '../db/schema/StreamSelectionProfile.ts';
import { KEYS } from '../types/inject.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';

export type StreamSelectionContext = {
  channelId: string;
  programId?: string;
  fillerListId?: string;
  customShowId?: string;
};

export type ResolvedStreamSelectionProfile = {
  level: StreamSelectionLevel;
  // The ID of the entity the profile was assigned to (program, custom show,
  // filler list, or channel). Undefined for the default and built-in levels.
  sourceId?: string;
  profile: StreamSelectionProfile;
};

// Used only if the seeded built-in row is missing from the database, so that
// the resolution chain always ends with a profile that matches.
export const BuiltInStreamSelectionProfile: StreamSelectionProfile = {
  uuid: BuiltInStreamSelectionProfileId,
  name: 'Tunarr Default',
  locked: true,
  rules: [
    {
      label: 'Default',
      condition: 'true',
      audioAction: { type: 'default' },
      subtitleAction: { type: 'disable' },
    },
  ],
};

function profileMayPickSubtitles(
  profile: Pick<StreamSelectionProfile, 'rules'>,
): boolean {
  return profile.rules.some((rule) => rule.subtitleAction.type !== 'disable');
}

type ProfileLookup = Promise<StreamSelectionProfile | undefined>;

type RememberedProfiles = {
  lookups: Map<string, ProfileLookup>;
  asked: number;
};

const profileColumns = {
  uuid: StreamSelectionProfileTable.uuid,
  name: StreamSelectionProfileTable.name,
  rules: StreamSelectionProfileTable.rules,
  locked: StreamSelectionProfileTable.locked,
};

@injectable()
export class StreamSelectionProfileResolver {
  @InjectLogger() declare private readonly logger: Logger;

  #remembered = new AsyncLocalStorage<RememberedProfiles>();

  constructor(
    @inject(KEYS.DrizzleDB) private drizzle: DrizzleDBAccess,
    @inject(KEYS.SettingsDB) private settingsDB: ISettingsDB,
  ) {}

  /**
   * Runs `fn` with each profile lookup answered from the database once and
   * remembered until `fn` settles.
   *
   * PROBE: subtitle lookahead resolves a chain for every filler clip on every
   * channel, about 150,000 chain resolutions an hour on a 33-channel install,
   * each up to five single-row reads for the same few dozen answers. Nothing
   * outside `fn` sees remembered answers, so playback still reads the
   * database every time. A profile edited while `fn` runs is picked up by the
   * next run.
   */
  async withRememberedProfiles<T>(fn: () => Promise<T>): Promise<T> {
    const remembered: RememberedProfiles = { lookups: new Map(), asked: 0 };
    try {
      return await this.#remembered.run(remembered, fn);
    } finally {
      this.logger.info(
        'Stream selection profile lookups: %d asked, %d read from the database',
        remembered.asked,
        remembered.lookups.size,
      );
    }
  }

  private lookup(key: string, read: () => ProfileLookup): ProfileLookup {
    const remembered = this.#remembered.getStore();
    if (!remembered) {
      return read();
    }
    remembered.asked++;
    const known = remembered.lookups.get(key);
    if (known) {
      return known;
    }
    const lookup = read();
    remembered.lookups.set(key, lookup);
    // A failed read is asked again rather than remembered.
    lookup.catch(() => remembered.lookups.delete(key));
    return lookup;
  }

  /**
   * Returns every profile that applies to the context, from most to least
   * specific: program → source (custom show or filler list) → channel →
   * default → built-in. The evaluator walks this chain and stops at the
   * first profile with a matching rule. A profile appears at most once, at
   * its most specific level.
   */
  async resolveChain(
    ctx: StreamSelectionContext,
  ): Promise<ResolvedStreamSelectionProfile[]> {
    const chain: ResolvedStreamSelectionProfile[] = [];
    const seen = new Set<string>();
    const push = (
      level: StreamSelectionLevel,
      profile: StreamSelectionProfile | undefined,
      sourceId?: string,
    ) => {
      if (!profile || seen.has(profile.uuid)) {
        return;
      }
      seen.add(profile.uuid);
      chain.push({ level, sourceId, profile });
    };

    const { programId, fillerListId, customShowId, channelId } = ctx;
    if (programId) {
      push(
        'program',
        await this.lookup(`program:${programId}`, () =>
          this.getProfileForProgram(programId),
        ),
        ctx.programId,
      );
    }

    // Custom shows and filler lists form a single "source" level. An item
    // is scheduled from one or the other, never both.
    if (ctx.fillerListId && ctx.customShowId) {
      this.logger.warn(
        'Stream selection context has both a filler list (%s) and a custom show (%s); using the filler list',
        ctx.fillerListId,
        ctx.customShowId,
      );
    }

    if (fillerListId) {
      push(
        'filler',
        await this.lookup(`filler:${fillerListId}`, () =>
          this.getProfileForFillerList(fillerListId),
        ),
        ctx.fillerListId,
      );
    } else if (customShowId) {
      push(
        'custom_show',
        await this.lookup(`custom_show:${customShowId}`, () =>
          this.getProfileForCustomShow(customShowId),
        ),
        ctx.customShowId,
      );
    }

    push(
      'channel',
      await this.lookup(`channel:${channelId}`, () =>
        this.getProfileForChannel(channelId),
      ),
      ctx.channelId,
    );

    const defaultProfileId =
      this.settingsDB.streamSelectionSettings().defaultProfileId;
    if (defaultProfileId !== BuiltInStreamSelectionProfileId) {
      const defaultProfile = await this.lookup(`id:${defaultProfileId}`, () =>
        this.getProfileById(defaultProfileId),
      );
      if (!defaultProfile) {
        this.logger.warn(
          'Default stream selection profile %s does not exist; falling back to the built-in profile',
          defaultProfileId,
        );
      }
      push('default', defaultProfile);
    }

    push(
      'built_in',
      (await this.lookup(`id:${BuiltInStreamSelectionProfileId}`, () =>
        this.getProfileById(BuiltInStreamSelectionProfileId),
      )) ?? BuiltInStreamSelectionProfile,
    );

    return chain;
  }

  /**
   * Whether any profile in the context's chain could select a subtitle.
   * Used to decide whether subtitles are worth preparing ahead of time, so
   * it over-approximates: a rule that never matches still counts.
   */
  async mayPickSubtitles(ctx: StreamSelectionContext): Promise<boolean> {
    const chain = await this.resolveChain(ctx);
    return chain.some(({ profile }) => profileMayPickSubtitles(profile));
  }

  /**
   * Whether a filler list's programs could get a subtitle on any of the given
   * channels. Filler is picked at playtime, so its programs are prepared by
   * list. Slot schedules can play a list a channel never assigns, so every
   * channel counts.
   */
  async fillerListMayPickSubtitles(
    fillerListId: string,
    channelIds: ReadonlyArray<string>,
  ): Promise<boolean> {
    for (const channelId of channelIds) {
      if (await this.mayPickSubtitles({ channelId, fillerListId })) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether any stored profile could select a subtitle. A false result means
   * no context can pick one, whatever profiles are assigned.
   */
  async anyProfileMayPickSubtitles(): Promise<boolean> {
    const profiles = await this.drizzle
      .select({ rules: StreamSelectionProfileTable.rules })
      .from(StreamSelectionProfileTable);
    return profiles.some(profileMayPickSubtitles);
  }

  private async getProfileById(
    id: string,
  ): Promise<StreamSelectionProfile | undefined> {
    const [result] = await this.drizzle
      .select(profileColumns)
      .from(StreamSelectionProfileTable)
      .where(eq(StreamSelectionProfileTable.uuid, id))
      .limit(1);
    return result;
  }

  private async getProfileForProgram(
    programId: string,
  ): Promise<StreamSelectionProfile | undefined> {
    const [result] = await this.drizzle
      .select(profileColumns)
      .from(Program)
      .innerJoin(
        StreamSelectionProfileTable,
        eq(Program.streamSelectionProfileId, StreamSelectionProfileTable.uuid),
      )
      .where(eq(Program.uuid, programId))
      .limit(1);
    return result;
  }

  private async getProfileForCustomShow(
    customShowId: string,
  ): Promise<StreamSelectionProfile | undefined> {
    const [result] = await this.drizzle
      .select(profileColumns)
      .from(CustomShow)
      .innerJoin(
        StreamSelectionProfileTable,
        eq(
          CustomShow.streamSelectionProfileId,
          StreamSelectionProfileTable.uuid,
        ),
      )
      .where(eq(CustomShow.uuid, customShowId))
      .limit(1);
    return result;
  }

  private async getProfileForFillerList(
    fillerListId: string,
  ): Promise<StreamSelectionProfile | undefined> {
    const [result] = await this.drizzle
      .select(profileColumns)
      .from(FillerShow)
      .innerJoin(
        StreamSelectionProfileTable,
        eq(
          FillerShow.streamSelectionProfileId,
          StreamSelectionProfileTable.uuid,
        ),
      )
      .where(eq(FillerShow.uuid, fillerListId))
      .limit(1);
    return result;
  }

  private async getProfileForChannel(
    channelId: string,
  ): Promise<StreamSelectionProfile | undefined> {
    const [result] = await this.drizzle
      .select(profileColumns)
      .from(Channel)
      .innerJoin(
        StreamSelectionProfileTable,
        eq(Channel.streamSelectionProfileId, StreamSelectionProfileTable.uuid),
      )
      .where(eq(Channel.uuid, channelId))
      .limit(1);
    return result;
  }
}
