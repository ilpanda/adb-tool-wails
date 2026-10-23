// store/updateStore.ts
// 版本更新检查：启动后后台检查一次，设置页可手动检查
import {create} from 'zustand';
import {CheckUpdate} from '../../wailsjs/go/main/App';
import {main} from '../../wailsjs/go/models';

const DISMISSED_KEY = 'update_dismissed_version';

interface UpdateStore {
    info: main.UpdateInfo | null;
    checking: boolean;
    check: () => Promise<main.UpdateInfo | null>;
    dismissedVersion: () => string;
    dismiss: (version: string) => void;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
    info: null,
    checking: false,

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
