import {useEffect} from 'react';
import {message} from 'antd';
import {create} from 'zustand';
import {OnFileDrop, OnFileDropOff} from '../../wailsjs/runtime/runtime';
import {useDeviceStore} from '../store/deviceStore';
import {runQuickAction} from '../actions/runQuickAction';

interface DropUploadTarget {
    // 拖拽时浮层上的提示
    hint: string;
    upload: (paths: string[]) => Promise<void>;
}

// 当前页面可以注册上传目标（文件管理注册为「上传到当前目录」）；没有注册时拖入 APK 即安装
export const useDropTargetStore = create<{ target: DropUploadTarget | null; setTarget: (target: DropUploadTarget | null) => void }>(set => ({
    target: null,
    setTarget: (target) => set({target}),
}));

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

async function installApks(paths: string[]) {
    const device = useDeviceStore.getState().selectedDevice;
    if (!device) {
        message.warning('请先连接设备');
        return;
    }
    const apks = paths.filter(path => path.toLowerCase().endsWith('.apk'));
    const others = paths.length - apks.length;
    if (apks.length === 0) {
        message.warning('拖入 APK 可直接安装；上传其他文件请在「文件管理」中拖入');
        return;
    }
    if (others > 0) {
        message.info(`已忽略 ${others} 个非 APK 文件，上传文件请在「文件管理」中拖入`);
    }
    // 逐个安装：版本降级时需要逐个确认
    for (const path of apks) {
        await runQuickAction(
            {icon: 'fa-box-open', label: `安装 ${baseName(path)}`, action: 'install-apk-file'},
            {packageName: '', deviceId: device.id, deviceName: device.name, files: [path]},
        );
    }
}

const DROP_TARGET_ACTIVE = 'wails-drop-target-active';

// 收起拖拽提示浮层。Wails 只在页面收到 drop / dragleave 时移除该 class，
// 但开启 DisableWebViewDrop 后 macOS 由原生层接管放下，页面收不到 drop，浮层会一直留着
function clearDropHighlight() {
    document.querySelectorAll(`.${DROP_TARGET_ACTIVE}`).forEach(el => el.classList.remove(DROP_TARGET_ACTIVE));
}

// 监听拖入窗口的文件。窗口根节点需设置 --wails-drop-target: drop，拖拽经过时 Wails 会加上 wails-drop-target-active
export function useFileDrop() {
    useEffect(() => {
        // 拖拽过程中 dragover 会持续触发（静止时也至少每几百毫秒一次），超过 1 秒没有就视为拖拽已结束
        let idleTimer = 0;
        const onDragOver = () => {
            window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(clearDropHighlight, 1000);
        };
        window.addEventListener('dragover', onDragOver, true);

        OnFileDrop((_x, _y, paths) => {
            window.clearTimeout(idleTimer);
            clearDropHighlight();
            if (!paths || paths.length === 0) return;
            const target = useDropTargetStore.getState().target;
            if (target) {
                if (!useDeviceStore.getState().selectedDevice) {
                    message.warning('请先连接设备');
                    return;
                }
                void target.upload(paths);
            } else {
                void installApks(paths);
            }
        }, true);
        return () => {
            window.removeEventListener('dragover', onDragOver, true);
            window.clearTimeout(idleTimer);
            OnFileDropOff();
        };
    }, []);
}

export function useDropHint(): string {
    const target = useDropTargetStore(state => state.target);
    return target?.hint ?? '松开安装 APK';
}
