import type { ParseResult } from '@marcbachmann/cel-js';
import { Environment } from '@marcbachmann/cel-js';
import { injectable } from 'inversify';
import { isNativeError } from 'node:util/types';
import { z } from 'zod';
import { BadRequestError } from '../types/errors.ts';
import type { Maybe } from '../types/util.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import { LanguageService } from './LanguageService.ts';

export type StreamSelectionCelContext = {
  audio: {
    streams: Array<{
      index: number;
      language: string;
      codec: string;
      channels: number;
      title: string;
      default: boolean;
      selected: boolean;
    }>;
    languages: string[];
  };
  subtitle: {
    streams: Array<{
      index: number;
      language: string;
      codec: string;
      type: string;
      title: string;
      default: boolean;
      forced: boolean;
      sdh: boolean;
    }>;
    languages: string[];
  };
  channel: { name: string; number: number };
  program: {
    title: string;
    type: string;
    // Empty unless the program is an episode.
    showTitle: string;
    // Genre names on the program and, for episodes, on its show.
    genres: string[];
    libraryId: string;
  };
};

const BooleanResult = z.boolean();

// Rule conditions are a handful of strings evaluated against many contexts.
// The cap only guards against a caller that generates conditions.
const MaxParsedExpressions = 500;

@injectable()
export class CelEvaluationService {
  @InjectLogger() declare private readonly logger: Logger;

  private currentContext!: StreamSelectionCelContext;
  private env: Environment;
  // Parsing depends only on the expression text and the environment, which
  // is built once per service.
  private parsed = new Map<string, ParseResult>();

  constructor() {
    this.env = this.buildEnvironment();
  }

  evaluate(expression: string, context: StreamSelectionCelContext): boolean {
    try {
      this.currentContext = context;
      const result = this.parse(expression)(context) as unknown;
      return BooleanResult.parse(result);
    } catch (err) {
      this.logger.warn(
        { err, expression },
        'CEL expression evaluation failed, treating as false',
      );
      return false;
    }
  }

  private parse(expression: string): ParseResult {
    const known = this.parsed.get(expression);
    if (known) {
      return known;
    }
    const parsed = this.env.parse(expression);
    if (this.parsed.size >= MaxParsedExpressions) {
      this.parsed.clear();
    }
    this.parsed.set(expression, parsed);
    return parsed;
  }

  validate(expression: string): Maybe<CelEvaluationError> {
    try {
      this.env.parse(expression);
      return;
    } catch (err) {
      const errorMessage = isNativeError(err)
        ? err.message
        : JSON.stringify(err);
      return new CelEvaluationError(errorMessage);
    }
  }

  private buildEnvironment(): Environment {
    return new Environment({ unlistedVariablesAreDyn: true })
      .registerFunction('hasAudioLang(string): bool', (lang) =>
        this.matchLanguageInList(
          lang as string,
          this.currentContext.audio.languages,
        ),
      )
      .registerFunction('hasSubtitleLang(string): bool', (lang) =>
        this.matchLanguageInList(
          lang as string,
          this.currentContext.subtitle.languages,
        ),
      )
      .registerFunction('hasLang(string): bool', (lang) => {
        const langStr = lang as string;
        return (
          this.matchLanguageInList(
            langStr,
            this.currentContext.audio.languages,
          ) ||
          this.matchLanguageInList(
            langStr,
            this.currentContext.subtitle.languages,
          )
        );
      })
      .registerFunction('isMultiLanguage(): bool', () => {
        const normalized = new Set<string>();
        for (const lang of this.currentContext.audio.languages) {
          const n = LanguageService.normalizeToAlpha3T(lang);
          normalized.add(n ?? lang.toLowerCase());
        }
        return normalized.size >= 2;
      });
  }

  private matchLanguageInList(input: string, languages: string[]): boolean {
    const normalizedInput = LanguageService.normalizeToAlpha3T(input);
    if (normalizedInput === undefined) {
      // Can't normalize the input — fall back to case-insensitive exact match
      const inputLower = input.toLowerCase();
      return languages.some((lang) => lang.toLowerCase() === inputLower);
    }

    return languages.some((lang) => {
      const normalizedLang = LanguageService.normalizeToAlpha3T(lang);
      return normalizedLang === normalizedInput;
    });
  }
}

export class CelEvaluationError extends BadRequestError {
  constructor(...params: ConstructorParameters<ErrorConstructor>) {
    super(...params);
  }
}
