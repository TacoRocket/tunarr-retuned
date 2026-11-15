import { isEqual } from 'lodash-es';

type Location = { fullPath: string; params: unknown };

// Index routes report their full path with a trailing slash.
const withoutTrailingSlash = (path: string) =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;

/**
 * Whether leaving `current` for `next` skips the unsaved-changes prompt.
 *
 * A form that spans several tabs or pages lists those pages so moving between
 * them doesn't prompt. They are exempt only for the same entity: the route
 * pattern `/channels/$channelId/edit` also matches another channel's editor,
 * and leaving a dirty form for a different channel must still ask.
 */
export function isExemptNavigation(
  current: Location,
  next: Location,
  exceptTargetPaths: readonly string[] | undefined,
): boolean {
  if (!exceptTargetPaths?.length) return false;
  const target = withoutTrailingSlash(String(next.fullPath));
  const listed = exceptTargetPaths.some(
    (path) => target === withoutTrailingSlash(String(path)),
  );
  return listed && isEqual(current.params, next.params);
}
