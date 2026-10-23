// store/updateStore.ts
// 版本更新：启动后后台检查一次，设置页可手动检查；有新版本时在应用内下载，下载完成后重启即可更新
import {create} from 'zustand';
import {CheckUpdate, DownloadUpdate} from '../../wailsjs/go/main/App';
import {update} from '../../wailsjs/go/models';

const DISMISSED_KEY = 'update_dismissed_version';

interface UpdateStore {
    info: update.Info | null;
    checking: boolean;
    // 新版本下载状态，由后端 update-status 事件推送
    status: update.Status;
    check: () => Promise<update.Info | null>;
    download: () => Promise<void>;
    setStatus: (status: update.Status) => void;
    dismissedVersion: () => string;
    dismiss: (version: string) => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
    info: null,
    checking: false,
    status: update.Status.createFrom({state: 'idle', version: '', downloaded: 0, total: 0}),

    check: async () => {
        if (get().checking) return get().info;
        set({checking: true});
        try {
            const info = await CheckUpdate();
            set({info});
            return info;
        } catch {
            return null;
        } finally {
            set({checking: false});
        }
    },

    download: async () => {
        try {
            await DownloadUpdate();
        } catch (error) {
            set({status: update.Status.createFrom({...get().status, state: 'error', error: String(error)})});
        }
    },

    setStatus: (status) => set({status}),

    dismissedVersion: () => {
        try {
            return localStorage.getItem(DISMISSED_KEY) || '';
        } catch {
            return '';
        }
    },

    dismiss: (version) => {
        try {
            localStorage.setItem(DISMISSED_KEY, version);
        } catch {
            // 存储不可用时下次启动仍会提示
        }
    },
}));

// downloadPercent 下载进度百分比
export function downloadPercent(status: update.Status) {
    return status.total > 0 ? Math.min(100, Math.floor(status.downloaded * 100 / status.total)) : 0;
}
