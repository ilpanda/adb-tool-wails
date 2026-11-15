import english from './en.json';

export type Locale = 'zh-CN' | 'en';
export type LanguageMode = 'system' | Locale;
export const LANGUAGE_STORAGE_KEY = 'language_mode';

export function normalizeMode(value: unknown): LanguageMode {
    return value === 'zh-CN' || value === 'en' ? value : 'system';
}

export function resolveLocale(mode: LanguageMode, languages: readonly string[]): Locale {
    if (mode !== 'system') return mode;
    // The first preferred language is the user's system/WebView UI language.
    return /^zh(?:-|_|$)/i.test(languages[0] || '') ? 'zh-CN' : 'en';
}

export function translate(locale: Locale, key: string, values: readonly unknown[] = []): string {
    const template = locale === 'en' && Object.prototype.hasOwnProperty.call(english, key)
        ? (english as Record<string, string>)[key] : key;
    return template.replace(/\{(\d+)\}/g, (match, index) =>
        Number(index) < values.length ? String(values[Number(index)]) : match);
}
