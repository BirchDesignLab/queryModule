export type MessageParams = Readonly<Record<string, string | number | boolean>>;

export interface LocaleBundle {
  readonly [key: string]: string | LocaleBundle;
}

export interface Translator {
  readonly locale: string;
  t(key: string, params?: MessageParams): string;
  has(key: string): boolean;
}

export function isLocaleBundle(value: unknown): value is LocaleBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string" || isLocaleBundle(v));
}

function lookup(bundle: LocaleBundle, key: string): string | undefined {
  const flat = bundle[key];
  if (typeof flat === "string") return flat;
  let node: string | LocaleBundle | undefined = bundle;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Every user-facing string is a key with params (NFR-001); plurals via Intl.PluralRules on `count`. */
export function createTranslator(locale: string, bundle: LocaleBundle): Translator {
  const plural = new Intl.PluralRules(locale);
  const number = new Intl.NumberFormat(locale);
  const resolve = (key: string, params?: MessageParams): string | undefined => {
    const count = params?.count;
    if (typeof count === "number") {
      const byCategory = lookup(bundle, `${key}.${plural.select(count)}`);
      if (byCategory !== undefined) return byCategory;
    }
    return lookup(bundle, key);
  };
  return {
    locale,
    has: (key) => resolve(key) !== undefined,
    t(key, params) {
      const template = resolve(key, params);
      if (template === undefined) return key;
      return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params?.[name];
        if (value === undefined) return match;
        return typeof value === "number" ? number.format(value) : String(value);
      });
    },
  };
}
