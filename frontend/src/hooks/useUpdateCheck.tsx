import {useEffect} from 'react';
import {Button, notification} from 'antd';
import {BrowserOpenURL, EventsOn} from '../../wailsjs/runtime/runtime';
import {GetUpdateStatus, InstallUpdate} from '../../wailsjs/go/main/App';
import {update} from '../../wailsjs/go/models';
import {useUpdateStore} from '../store/updateStore';

// 启动后稍等再检查，避免与设备连接等首批请求争抢；同一版本忽略后不再自动下载和提示
const CHECK_DELAY_MS = 5000;
const NOTIFICATION_KEY = 'app-update';

// installUpdate 替换为已下载的新版本并重启；失败时提示原因，并可改为手动下载
export async function installUpdate() {
    try {
        await InstallUpdate();
    } catch (error) {
        const url = useUpdateStore.getState().info?.url;
        notification.error({
            key: NOTIFICATION_KEY,
            message: '更新失败',
            description: String(error),
            duration: 0,
            actions: url ? (
                <Button size="small" onClick={() => {
                    BrowserOpenURL(url);
                    notification.destroy(NOTIFICATION_KEY);
                }}>
                    前往 GitHub 下载
                </Button>
            ) : undefined,
        });
    }
}

function dismissButton(version: string) {
    return (
        <Button size="small" onClick={() => {
            useUpdateStore.getState().dismiss(version);
            notification.destroy(NOTIFICATION_KEY);
        }}>
            忽略此版本
        </Button>
    );
}

// 新版本已下载：提示重启更新
function notifyReady(info: update.Info) {
    notification.info({
        key: NOTIFICATION_KEY,
        message: `新版本 ${info.latest} 已下载`,
        description: '重启应用即可完成更新，也可以稍后点击左下角的更新按钮。',
        duration: 0,
        actions: (
            <div className="flex gap-2">
                {dismissButton(info.latest)}
                <Button size="small" type="primary" onClick={() => {
                    notification.destroy(NOTIFICATION_KEY);
                    void installUpdate();
                }}>
                    立即重启
                </Button>
            </div>
        ),
    });
}

// 无法在应用内更新（当前平台没有安装包或下载失败）：引导前往 GitHub 下载
function notifyAvailable(info: update.Info) {
    notification.info({
        key: NOTIFICATION_KEY,
        message: `发现新版本 ${info.latest}`,
        description: `当前版本 ${info.current}，可前往 GitHub 下载最新安装包。`,
        duration: 0,
        actions: (
            <div className="flex gap-2">
                {dismissButton(info.latest)}
                <Button size="small" type="primary" onClick={() => {
                    BrowserOpenURL(info.url);
                    notification.destroy(NOTIFICATION_KEY);
                }}>
                    查看更新
                </Button>
            </div>
        ),
    });
}

export function useUpdateCheck() {
    useEffect(() => {
        const {setStatus} = useUpdateStore.getState();
        GetUpdateStatus().then(setStatus);
        return EventsOn('update-status', setStatus);
    }, []);

    useEffect(() => {
        let unsubscribe: (() => void) | undefined;
        const timer = window.setTimeout(async () => {
            const store = useUpdateStore.getState();
            const info = await store.check();
            if (!info?.hasUpdate || store.dismissedVersion() === info.latest) return;
            if (!info.canInstall) {
                notifyAvailable(info);
                return;
            }
            // 后台下载，完成后再提示；下载失败时退回到手动下载
            let notified = false;
            const onStatus = (status: update.Status) => {
                if (notified || status.version !== info.latest) return;
                if (status.state === 'ready' || status.state === 'error') {
                    notified = true;
                    unsubscribe?.();
                    status.state === 'ready' ? notifyReady(info) : notifyAvailable(info);
                }
            };
            unsubscribe = useUpdateStore.subscribe(state => onStatus(state.status));
            await store.download();
            // 已下载完成的版本不会再推送状态变化，这里补查一次
            onStatus(useUpdateStore.getState().status);
        }, CHECK_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
            unsubscribe?.();
        };
    }, []);
}
