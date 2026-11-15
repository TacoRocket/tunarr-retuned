import type { StreamSelectionRule } from '@tunarr/types/schemas';
import { StreamSelectionRuleSchema } from '@tunarr/types/schemas';
import { z } from 'zod/v4';

const StoredRulesSchema = z.array(StreamSelectionRuleSchema);

/**
 * Fork: a stored profile with its rules as the API serves them.
 *
 * Rules are stored as JSON exactly as they were saved. Rules saved before
 * upstream #1874 (2026-11-05) have no `subtitleAction.preferTextBased`. The
 * schema defaults it to false when reading a request, but requires it when
 * checking a response, so serving those rows as stored failed with a 500 and
 * the profile list wouldn't load. Parsing applies the schema's defaults here;
 * nothing is written back, and the next save from the editor stores them.
 */
export function withRuleDefaults<T extends { rules: unknown }>(
  profile: T,
): Omit<T, 'rules'> & { rules: StreamSelectionRule[] } {
  return { ...profile, rules: StoredRulesSchema.parse(profile.rules) };
}
