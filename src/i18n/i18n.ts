import { RequestContext } from '../common/request-context.js';
import { en } from './messages/en.js';
import { lo } from './messages/lo.js';
import { th } from './messages/th.js';

export const LANGUAGES = ['lo', 'th', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const DEFAULT_LANG: Lang = 'lo';

const CATALOGS: Record<Lang, Record<string, string>> = { lo, th, en };

export const isLang = (v: unknown): v is Lang =>
  typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);

/** First supported language in an Accept-Language header ("th-TH,th;q=0.9,en;q=0.8"). */
export function fromAcceptLanguage(
  header: string | undefined,
): Lang | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return {
        lang: tag.trim().slice(0, 2).toLowerCase(),
        q: q ? Number(q.trim().slice(2)) : 1,
      };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.find((x) => isLang(x.lang))?.lang as Lang | undefined;
}

/**
 * The response language: ?lang → the user's own setting → Accept-Language → the
 * company default → Lao.
 */
export function currentLang(): Lang {
  const s = RequestContext.get();
  return (
    s?.lang ?? s?.userLang ?? s?.headerLang ?? s?.tenantLang ?? DEFAULT_LANG
  );
}

/** Translates a message key, filling {param} placeholders. Falls back to English, then the key. */
export function t(
  key: string,
  params: Record<string, unknown> = {},
  lang: Lang = currentLang(),
): string | undefined {
  const template = CATALOGS[lang][key] ?? CATALOGS.en[key];
  if (template === undefined) return undefined;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const raw = params[name];
    if (raw === undefined || raw === null) return '';
    const value =
      typeof raw === 'object' ? JSON.stringify(raw) : String(raw as string);
    // Feature and limit names are translated too.
    const named =
      name === 'feature'
        ? CATALOGS[lang][`feature.${value}`]
        : name === 'limit'
          ? CATALOGS[lang][`limit.${value}`]
          : undefined;
    return named ?? value;
  });
}

/** Picks the text for the current language from a {lo, th, en} map. */
export function localized(
  map: unknown,
  fallback: string,
  lang: Lang = currentLang(),
): string {
  if (map && typeof map === 'object') {
    const v = (map as Record<string, unknown>)[lang];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return fallback;
}
