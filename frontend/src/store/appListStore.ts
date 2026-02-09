// store/appListStore.ts
import { create } from 'zustand';

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
    setApps: (deviceId: string, apps: PackageInfo[]) => void;
    getAppsFromCache: (deviceId: string) => PackageInfo[] | null;
    setLoading: (loading: boolean) => void;
    setProgress: (progress: ProgressInfo | null) => void;
    clearCache: (deviceId?: string) => void;
    clearAll: () => void;
}

// 生成缓存 key（空字符串表示单设备模式）
const getCacheKey = (deviceId: string) => deviceId || '_default_';

export const useAppListStore = create<AppListStore>((set, get) => ({
    appListCache: new Map(),
    apps: [],
    isLoading: false,
    progress: null,
    loadedDeviceId: '',

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