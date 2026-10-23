import {useEffect} from 'react';
import {useDeviceStore} from '../store/deviceStore';
import {useAppListStore} from '../store/appListStore';

// 设备连接后稍等片刻再预加载，避开连接时设备信息等首批请求
const PRELOAD_DELAY_MS = 3000;

// 选中设备后在后台预加载应用列表，打开应用列表页时直接使用缓存；设备断开时取消加载并清空缓存
export function useAppListPreload() {
    const deviceId = useDeviceStore(state => state.selectedDevice?.id);

    useEffect(() => {
        const store = useAppListStore.getState();
        if (!deviceId) {
            store.cancel();
            store.clearCache();
            useAppListStore.setState({apps: [], isLoading: false, progress: null});
            return;
        }
        const timer = window.setTimeout(() => {
            store.load(deviceId).catch(() => {});
        }, PRELOAD_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, [deviceId]);
}
