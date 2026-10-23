// store/navStore.ts
// 当前页面放在 store 中，其他页面可以直接跳转（如应用列表「去性能监控」）
import {create} from 'zustand';

export const VIEW = {
    quickActions: '1',
    faq: '2',
    settings: '3',
    appList: '4',
    perfMonitor: '5',
    fileManager: '6',
    logs: '7',
} as const;

interface NavStore {
    view: string;
    setView: (view: string) => void;
}

export const useNavStore = create<NavStore>(set => ({
    view: VIEW.quickActions,
    setView: (view) => set({view}),
}));
