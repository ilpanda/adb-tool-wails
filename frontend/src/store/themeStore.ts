// store/themeStore.ts
// 外观：跟随系统 / 浅色 / 深色。通过 <html class="dark"> 切换 style.css 中的 token 值
import {create} from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme_mode';
const media = window.matchMedia('(prefers-color-scheme: dark)');

function readMode(): ThemeMode {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
        return 'system';
    }
}

function resolve(mode: ThemeMode): ResolvedTheme {
    if (mode === 'system') return media.matches ? 'dark' : 'light';
    return mode;
}

function apply(theme: ResolvedTheme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

interface ThemeStore {
    mode: ThemeMode;
    resolved: ResolvedTheme;
    setMode: (mode: ThemeMode) => void;
}

// 模块加载时（首次渲染前）就应用，避免启动时先闪一下浅色
const initialMode = readMode();
apply(resolve(initialMode));

export const useThemeStore = create<ThemeStore>((set) => ({
    mode: initialMode,
    resolved: resolve(initialMode),
    setMode: (mode) => {
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // 存储不可用时只在本次运行生效
        }
        const resolved = resolve(mode);
        apply(resolved);
        set({mode, resolved});
    },
}));

media.addEventListener('change', () => {
    const {mode} = useThemeStore.getState();
    if (mode !== 'system') return;
    const resolved = resolve(mode);
    apply(resolved);
    useThemeStore.setState({resolved});
});
