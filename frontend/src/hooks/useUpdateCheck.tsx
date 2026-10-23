import {useEffect} from 'react';
import {Button, notification} from 'antd';
import {BrowserOpenURL} from '../../wailsjs/runtime/runtime';
import {useUpdateStore} from '../store/updateStore';

// 启动后稍等再检查，避免与设备连接等首批请求争抢；同一版本忽略后不再提示
const CHECK_DELAY_MS = 5000;

export function useUpdateCheck() {
    useEffect(() => {
        const timer = window.setTimeout(async () => {
            const store = useUpdateStore.getState();
            const info = await store.check();
            if (!info?.hasUpdate || store.dismissedVersion() === info.latest) return;
            const key = 'app-update';
            notification.info({
                key,
                message: `发现新版本 ${info.latest}`,
                description: `当前版本 ${info.current}，可前往 GitHub 下载最新安装包。`,
                duration: 0,
                actions: (
                    <div className="flex gap-2">
                        <Button size="small" onClick={() => {
                            store.dismiss(info.latest);
                            notification.destroy(key);
                        }}>
                            忽略此版本
                        </Button>
                        <Button size="small" type="primary" onClick={() => {
                            BrowserOpenURL(info.url);
                            notification.destroy(key);
                        }}>
                            查看更新
                        </Button>
                    </div>
                ),
            });
        }, CHECK_DELAY_MS);
        return () => window.clearTimeout(timer);
    }, []);
}
