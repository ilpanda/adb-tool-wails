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
    signatureSha256s?: string[];
}

export interface ProgressInfo {
    total: number;
    current: number;
    completed: boolean;
}

// 加载中途推送的一批结果（app-list-batch 事件）
interface AppListBatch {
    deviceId: string;
    apps: PackageInfo[];
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

    // apps 是否为正在分批加载中的不完整列表（列表为空时开始的加载会边加载边显示）
    partial: boolean;

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

// 加载由 store 持有，离开应用列表页面后继续在后台完成。
// streamed：已收到的分批结果；为 null 表示这次加载不分批显示（刷新时保留旧列表，完成后整体替换）
let inflight: {
    deviceId: string;
    token: object;
    promise: Promise<LoadResult>;
    streamed: PackageInfo[] | null;
    seen: Set<string>;
} | null = null;
let eventsSubscribed = false;

export const useAppListStore = create<AppListStore>((set, get) => ({
    appListCache: new Map(),
    apps: [],
    isLoading: false,
    partial: false,
    progress: null,
    loadedDeviceId: '',

    load: (deviceId, options = {}) => {
        if (!eventsSubscribed) {
            eventsSubscribed = true;
            EventsOn('app-list-progress', (progress: ProgressInfo) => {
                if (inflight) set({ progress });
            });
            EventsOn('app-list-batch', (batch: AppListBatch) => {
                const current = inflight;
                if (!current?.streamed || current.deviceId !== batch.deviceId) return;
                // 去重：被取消的上一次加载可能还有事件在途
                const fresh = (batch.apps ?? []).filter(app => !current.seen.has(app.packageName));
                if (fresh.length === 0) return;
                fresh.forEach(app => current.seen.add(app.packageName));
                current.streamed.push(...fresh);
                // 用户已切到其他设备的列表时只记录，切回来再显示
                if (get().loadedDeviceId === batch.deviceId) {
                    set({ apps: [...current.streamed] });
                }
            });
        }

        const cached = get().getAppsFromCache(deviceId);
        if (!options.force && cached && cached.length > 0) {
            if (get().loadedDeviceId !== deviceId) {
                set({ apps: cached, loadedDeviceId: deviceId, partial: false });
            }
            return Promise.resolve({ status: 'cached', count: cached.length });
        }
        if (inflight && inflight.deviceId === deviceId) {
            // 切回仍在加载的设备：先显示已收到的部分
            if (get().loadedDeviceId !== deviceId) {
                const streamed = inflight.streamed;
                set({ apps: streamed ? [...streamed] : [], loadedDeviceId: deviceId, partial: true });
            }
            return inflight.promise;
        }

        // 当前没有显示这台设备的列表（或列表为空）时边加载边显示；已有列表时保留旧列表，完成后整体替换
        const state = get();
        const streaming = state.loadedDeviceId !== deviceId || state.apps.length === 0;
        // 后端开始新的加载时会自动取消上一次
        set({
            isLoading: true,
            partial: streaming,
            progress: null,
            ...(streaming ? { apps: [], loadedDeviceId: deviceId } : {}),
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
                // 已被本窗口的新加载取代：状态由新加载负责
                if (inflight?.token !== token) return { status: 'canceled' } as const;
                // 仍是当前加载却出错或被取消（例如开发模式下浏览器与原生窗口共用后端，另一窗口的加载会取消这次），
                // 复位加载状态，否则进度条会一直停在被取消时的位置。
                // 分批显示的不完整列表不保留，避免被当成完整结果
                set(s => ({
                    isLoading: false,
                    progress: null,
                    partial: false,
                    apps: s.partial ? (s.getAppsFromCache(deviceId) ?? []) : s.apps,
                }));
                if (errorStr.includes('cancel') || errorStr.includes('context')) {
                    return { status: 'canceled' } as const;
                }
                return { status: 'error', error: errorStr } as const;
            } finally {
                if (inflight?.token === token) inflight = null;
            }
        })();
        inflight = { deviceId, token, promise, streamed: streaming ? [] : null, seen: new Set() };
        return promise;
    },

    cancel: () => {
        if (!inflight) return;
        inflight = null;
        set(s => ({
            isLoading: false,
            progress: null,
            partial: false,
            apps: s.partial ? (s.getAppsFromCache(s.loadedDeviceId) ?? []) : s.apps,
        }));
        CancelApplicationListLoading().catch(() => {});
    },

    setApps: (deviceId, apps) => {
        const cacheKey = getCacheKey(deviceId);
        set((state) => {
            const newCache = new Map(state.appListCache);
            newCache.set(cacheKey, apps);
            // 加载期间用户切到了其他设备时只写缓存，不替换当前显示的列表
            const showing = state.loadedDeviceId === deviceId || state.loadedDeviceId === '';
            return {
                appListCache: newCache,
                ...(showing ? { apps, loadedDeviceId: deviceId, partial: false } : {}),
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
        partial: false,
        progress: null,
        loadedDeviceId: '',
    }),
}));