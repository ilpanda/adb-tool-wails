import {create} from 'zustand';
import {SetLanguage} from '../../wailsjs/go/main/App';
import {LANGUAGE_STORAGE_KEY, LanguageMode, Locale, normalizeMode, resolveLocale, translate} from './core';
export type {LanguageMode, Locale} from './core';

function readMode(): LanguageMode {
    try { return normalizeMode(localStorage.getItem(LANGUAGE_STORAGE_KEY)); }
    catch { return 'system'; }
}

function systemLanguages(): readonly string[] {
    return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function apply(locale: Locale) {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}

interface LanguageState {
    mode: LanguageMode;
    resolved: Locale;
    setMode: (mode: LanguageMode) => Promise<void>;
}

// Serialize backend updates so rapid selections cannot apply out of order.
let pendingSync: Promise<void> = Promise.resolve();
async function syncBackend(locale: Locale) {
    if (!(window as unknown as {go?: {main?: {App?: unknown}}}).go?.main?.App) return; // Standalone Vite preview.
    await SetLanguage(locale);
}

const initialMode = readMode();
const initialLocale = resolveLocale(initialMode, systemLanguages());
apply(initialLocale);
// Track intent before the asynchronous bridge finishes. System events must not
// override an explicit selection that is still waiting for backend sync.
let requestedMode = initialMode;
let latestRequest = 0;

export const useLanguageStore = create<LanguageState>((set) => ({
    mode: initialMode,
    resolved: initialLocale,
    setMode: (mode) => {
        requestedMode = mode;
        const request = ++latestRequest;
        const change = pendingSync.catch(() => {}).then(async () => {
            const resolved = resolveLocale(mode, systemLanguages());
            await syncBackend(resolved);
            try { localStorage.setItem(LANGUAGE_STORAGE_KEY, mode); } catch { /* Session-only preference. */ }
            apply(resolved);
            set({mode, resolved});
        }).catch(error => {
            if (request === latestRequest) requestedMode = useLanguageStore.getState().mode;
            throw error;
        });
        pendingSync = change;
        return change;
    },
}));

export const getLocale = (): Locale => useLanguageStore.getState().resolved;
export const useLocale = (): Locale => useLanguageStore(state => state.resolved);
export const t = (key: string, values?: readonly unknown[]): string => translate(getLocale(), key, values);

export async function initializeLanguage(): Promise<void> {
    const change = pendingSync.catch(() => {}).then(() => syncBackend(getLocale()));
    pendingSync = change;
    await change;
}

window.addEventListener('languagechange', () => {
    if (requestedMode === 'system') {
        void useLanguageStore.getState().setMode('system').catch(error => console.error('Language sync failed', error));
    }
});
