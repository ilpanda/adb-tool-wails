// store/appListStore.ts
import { create } from 'zustand';
import { CancelApplicationListLoading, GetApplicationListWithProgress } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';

export interface PackageInfo {
    packageName: string;
    label: string;
    icon: string;
    versionName: string;
    versionCode: number;
    firstInstallTime: number;
    lastUpdateTime: number;
    apkPath: string;
    apkSize: number;
    appSize: number;
    dataSize: number;
    cacheSize: number;
    enabled: boolean;
    system: boolean;
    minSdkVersion: number;
    targetSdkVersion: number;
    signatures: string[];
    signatureSha256s?: string[];
}

export interface ProgressInfo {
    total: number;
    current: number;
    completed: boolean;
}

// cached：直接用缓存；loaded：新加载完成；canceled：被取消或被新的加载取代
export type LoadResult =
    | { status: 'cached' | 'loaded'; count: number }
    | { status: 'canceled' }
    | { status: 'error'; error: string };

interface AppListStore {
    // 应用列表数据（按设备ID缓存）
    appListCache: Map<string, PackageInfo[]>;

    // 当前显示的应用列表
    apps: PackageInfo[];

    // 加载状态
    isLoading: boolean;

    // 进度信息
    progress: ProgressInfo | null;

    // 当前已加载的设备ID
    loadedDeviceId: string;

    // Actions
    // 加载指定设备的应用列表：有缓存直接用；同一设备已在加载时复用同一次加载（页面与后台预加载共享）
    load: (deviceId: string, options?: { force?: boolean }) => Promise<LoadResult>;
    // 取消正在进行的加载
    cancel: () => void;
    setApps: (deviceId: string, apps: PackageInfo[]) => void;
    // 卸载后从缓存与当前列表中移除
    removeApp: (deviceId: string, packageName: string) => void;
    getAppsFromCache: (deviceId: string) => PackageInfo[] | null;
    setLoading: (loading: boolean) => void;
    setProgress: (progress: ProgressInfo | null) => void;
    clearCache: (deviceId?: string) => void;
    clearAll: () => void;
}

// 生成缓存 key（按设备序列号区分）
const getCacheKey = (deviceId: string) => deviceId || '_default_';

// 加载由 store 持有，离开应用列表页面后继续在后台完成
let inflight: { deviceId: string; token: object; promise: Promise<LoadResult> } | null = null;
let progressSubscribed = false;

export const useAppListStore = create<AppListStore>((set, get) => ({
    appListCache: new Map(),
    apps: [],
    isLoading: false,
    progress: null,
    loadedDeviceId: '',

    load: (deviceId, options = {}) => {
        if (!progressSubscribed) {
            progressSubscribed = true;
            EventsOn('app-list-progress', (progress: ProgressInfo) => {
                if (inflight) set({ progress });
            });
        }

        const cached = get().getAppsFromCache(deviceId);
        if (!options.force && cached && cached.length > 0) {
            if (get().loadedDeviceId !== deviceId) {
                set({ apps: cached, loadedDeviceId: deviceId });
            }
            return Promise.resolve({ status: 'cached', count: cached.length });
        }
        if (inflight && inflight.deviceId === deviceId) {
            return inflight.promise;
        }

        // 后端开始新的加载时会自动取消上一次
        set({
            isLoading: true,
            progress: null,
            ...(get().loadedDeviceId !== deviceId ? { apps: [], loadedDeviceId: deviceId } : {}),
        });
        // 用独立的 token 判断这次加载是否仍是当前加载（被取消或被新的加载取代后不再写入状态）
        const token = {};
        const promise: Promise<LoadResult> = (async () => {
            try {
                const result = (await GetApplicationListWithProgress(deviceId)) ?? [];
                if (inflight?.token !== token) return { status: 'canceled' } as const;
                get().setApps(deviceId, result as PackageInfo[]);
                return { status: 'loaded', count: result.length } as const;
            } catch (error: any) {
                const errorStr = error?.toString() || '';
                if (inflight?.token !== token || errorStr.includes('cancel') || errorStr.includes('context')) {
                    return { status: 'canceled' } as const;
                }
                set({ isLoading: false, progress: null });
                return { status: 'error', error: errorStr } as const;
            } finally {
                if (inflight?.token === token) inflight = null;
            }
        })();
        inflight = { deviceId, token, promise };
        return promise;
    },

    cancel: () => {
        if (!inflight) return;
        inflight = null;
        set({ isLoading: false, progress: null });
        CancelApplicationListLoading().catch(() => {});
    },

    setApps: (deviceId, apps) => {
        const cacheKey = getCacheKey(deviceId);
        set((state) => {
            const newCache = new Map(state.appListCache);
            newCache.set(cacheKey, apps);
            return {
                appListCache: newCache,
                apps,
                loadedDeviceId: deviceId,
                isLoading: false,
                progress: null,
            };
        });
    },

    removeApp: (deviceId, packageName) => {
        set((state) => {
            const cacheKey = getCacheKey(deviceId);
            const newCache = new Map(state.appListCache);
            const cached = newCache.get(cacheKey);
            if (cached) newCache.set(cacheKey, cached.filter(app => app.packageName !== packageName));
            return {
                appListCache: newCache,
                apps: state.loadedDeviceId === deviceId ? state.apps.filter(app => app.packageName !== packageName) : state.apps,
            };
        });
    },

    getAppsFromCache: (deviceId) => {
        const cacheKey = getCacheKey(deviceId);
        return get().appListCache.get(cacheKey) || null;
    },

    setLoading: (loading) => set({ isLoading: loading }),

    setProgress: (progress) => set({ progress }),

    clearCache: (deviceId) => {
        set((state) => {
            const newCache = new Map(state.appListCache);
            if (deviceId !== undefined) {
                // 清除指定设备的缓存
                newCache.delete(getCacheKey(deviceId));
                // 如果清除的是当前显示的设备，也清空 apps
                if (state.loadedDeviceId === deviceId) {
                    return {
                        appListCache: newCache,
                        apps: [],
                        loadedDeviceId: '',
                    };
                }
                return { appListCache: newCache };
            }
            // 清除所有缓存
            return {
                appListCache: new Map(),
                apps: [],
                loadedDeviceId: '',
            };
        });
    },

    clearAll: () => set({
        appListCache: new Map(),
        apps: [],
        isLoading: false,
        progress: null,
        loadedDeviceId: '',
    }),
}));