import { isNonEmptyString } from '@tunarr/shared/util';
import { bindingScopeValues, injectable } from 'inversify';
import { randomBytes } from 'node:crypto';
import type { FfmpegRuntimeCapabilities } from '../../ffmpeg/FfmpegRuntimeCapabilities.ts';
import type { Maybe } from '../../types/util.ts';
import { safeEqual } from '../../util/basicAuth.ts';
import type { EtvNextSessionType } from './EtvNextRouting.ts';

/** What a valid token grants access to. */
type EtvNextTokenGrant = {
  channelUuid: string;
  channelNumber: number;
  /** Which of the channel's worker sessions the token was minted for. */
  sessionType: EtvNextSessionType;
  /**
   * Fork: what the executable the session launched its worker with can do, so
   * the callback decides for that binary even after the setting changes.
   */
  ffmpegRuntime?: FfmpegRuntimeCapabilities;
};

type Registration = EtvNextTokenGrant & { token: string };

/**
 * The bearer tokens the dynamic resolver accepts, one per running session.
 *
 * A token is minted when a session starts and dropped when it stops, so
 * nothing is persisted and a token cannot outlive the worker it was issued
 * for. The channel it grants comes from the registration rather than from the
 * request, which keeps the worker's `x-etv-channel` header out of the
 * authorization decision.
 *
 * Singleton-scoped, or a session would mint its token into a registry the
 * resolver does not read.
 */
@injectable(bindingScopeValues.Singleton)
export class EtvNextDynamicTokenRegistry {
  // Keyed by channel and session type: an fMP4 channel can run its HLS worker
  // and its MPEG-TS copy at once, and each holds its own token.
  #bySession = new Map<string, Registration>();

  /**
   * Mints a token for one of a channel's worker sessions, replacing any token
   * that session type already held.
   */
  issue(
    channelUuid: string,
    channelNumber: number,
    sessionType: EtvNextSessionType = 'etv_next',
    ffmpegRuntime?: FfmpegRuntimeCapabilities,
  ): string {
    const token = randomBytes(32).toString('base64url');
    this.#bySession.set(registrationKey(channelUuid, sessionType), {
      channelUuid,
      channelNumber,
      sessionType,
      token,
      ...(ffmpegRuntime ? { ffmpegRuntime } : {}),
    });
    return token;
  }

  /**
   * Drops a session's token, but only if it is still the one given. A session
   * stopping late must not revoke the token of the session that replaced it.
   */
  revoke(
    channelUuid: string,
    token: string,
    sessionType: EtvNextSessionType = 'etv_next',
  ): void {
    const key = registrationKey(channelUuid, sessionType);
    if (this.#bySession.get(key)?.token === token) {
      this.#bySession.delete(key);
    }
  }

  get size(): number {
    return this.#bySession.size;
  }

  /**
   * Finds what a presented token grants, or nothing.
   *
   * Every candidate is compared in constant time, so a caller cannot learn a
   * token by measuring how long a rejection takes.
   */
  resolve(token: Maybe<string>): Maybe<EtvNextTokenGrant> {
    if (!isNonEmptyString(token)) {
      return;
    }

    for (const registration of this.#bySession.values()) {
      if (safeEqual(token, registration.token)) {
        return {
          channelUuid: registration.channelUuid,
          channelNumber: registration.channelNumber,
          sessionType: registration.sessionType,
          ...(registration.ffmpegRuntime
            ? { ffmpegRuntime: registration.ffmpegRuntime }
            : {}),
        };
      }
    }

    return;
  }
}

function registrationKey(
  channelUuid: string,
  sessionType: EtvNextSessionType,
): string {
  return `${channelUuid}_${sessionType}`;
}

/** Pulls the credential out of an `Authorization: Bearer <token>` header. */
export function parseBearerToken(header: Maybe<string>): Maybe<string> {
  if (!isNonEmptyString(header)) {
    return;
  }

  const prefix = 'bearer ';
  if (!header.toLowerCase().startsWith(prefix)) {
    return;
  }

  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : undefined;
}
