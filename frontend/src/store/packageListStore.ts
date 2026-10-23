// store/packageListStore.ts
// 设备上已安装的包名列表，按设备缓存，快捷功能与性能监控共用
import {create} from 'zustand';
import {ExecuteAction} from '../../wailsjs/go/main/App';

export const EMPTY_PACKAGES: string[] = [];

interface PackageListStore {
    packagesByDevice: Record<string, string[]>;
    // 读取设备的包名列表；同一设备已在读取时复用同一次请求。读取失败时保留已有列表
    fetchPackages: (deviceId: string) => Promise<string[]>;
}

const inflight = new Map<string, Promise<string[]>>();

export const usePackageListStore = create<PackageListStore>((set, get) => ({
    packagesByDevice: {},

    fetchPackages: (deviceId) => {
        const running = inflight.get(deviceId);
        if (running) return running;
        const promise = (async () => {
            try {
                const result = await ExecuteAction({action: 'get-all-packages', targetPackageName: '', deviceId});
                const packages = (result.res || '').split('\n').map(line => line.trim()).filter(Boolean);
                if (packages.length === 0) {
                    return get().packagesByDevice[deviceId] ?? EMPTY_PACKAGES;
                }
                set(state => ({packagesByDevice: {...state.packagesByDevice, [deviceId]: packages}}));
                return packages;
            } finally {
                inflight.delete(deviceId);
            }
        })();
        inflight.set(deviceId, promise);
        return promise;
    },
}));

// 快捷功能「目标应用」按设备记住的包名
const PACKAGE_STORAGE_KEY = 'selectedPackage';

export function readStoredPackage(deviceId: string): string | null {
    try {
        const data = JSON.parse(localStorage.getItem(PACKAGE_STORAGE_KEY) || 'null');
        return data && data.selectedDevice === deviceId ? data.selectedPackage : null;
    } catch {
        return null;
    }
}

export function writeStoredPackage(deviceId: string, packageName: string) {
    try {
        localStorage.setItem(PACKAGE_STORAGE_KEY, JSON.stringify({selectedDevice: deviceId, selectedPackage: packageName}));
    } catch {
        // 存储不可用时只保留在内存中
    }
}

// 读取手机前台应用的包名，失败时抛出带原因的错误
export async function getForegroundPackage(deviceId: string): Promise<string> {
    const result = await ExecuteAction({action: 'view-package', targetPackageName: '', deviceId});
    const pkg = (result.res || '').trim();
    if (result.error || !pkg) {
        throw new Error(result.error || '没有输出');
    }
    return pkg;
}
