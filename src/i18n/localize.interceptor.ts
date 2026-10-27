import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { currentLang, localized, type Lang } from './i18n.js';

const MAX_DEPTH = 10;

function isPlain(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Replaces `name`/`description` with the request language's text from
 * `nameI18n`/`descriptionI18n`, wherever they appear in a response. The maps stay in the
 * response so edit screens can show every language.
 */
export function localizeDeep(value: unknown, lang: Lang, depth = 0): unknown {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    for (const item of value) localizeDeep(item, lang, depth + 1);
    return value;
  }
  if (!isPlain(value)) return value;
  if (value.nameI18n && typeof value.name === 'string')
    value.name = localized(value.nameI18n, value.name, lang);
  if (value.descriptionI18n && typeof value.description === 'string')
    value.description = localized(
      value.descriptionI18n,
      value.description,
      lang,
    );
  for (const v of Object.values(value)) {
    if (v !== null && typeof v === 'object') localizeDeep(v, lang, depth + 1);
  }
  return value;
}

@Injectable()
export class LocalizeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((body) => localizeDeep(body, currentLang())));
  }
}
