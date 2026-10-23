import {Button, Modal, message, notification} from 'antd';
import {ExecuteAction, GetTerminalOpenMode, RevealPath} from '../../wailsjs/go/main/App';
import {ACTION_META, QuickAction} from '../data/quickActions';
import {ActionTask, TaskResult, useActionTaskStore} from '../store/actionTaskStore';

interface RunContext {
    packageName: string;
    // 单设备时传空字符串，与后端原有约定一致
    deviceId: string;
    deviceName: string;
    // 本地文件路径，例如拖入窗口的 APK
    files?: string[];
}

function newTaskId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function firstLine(text: string, max = 80): string {
    const line = text.trim().split('\n')[0] ?? '';
    return line.length > max ? `${line.slice(0, max)}…` : line;
}

function confirmDanger(item: QuickAction, packageName: string): Promise<boolean> {
    const text = ACTION_META[item.action].danger;
    if (!text) return Promise.resolve(true);
    return new Promise(resolve => {
        Modal.confirm({
            title: `${item.label}？`,
            content: text.replace('{pkg}', packageName || '当前应用'),
            okText: item.label,
            cancelText: '取消',
            okButtonProps: {danger: true},
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

export async function revealLocalPath(path: string) {
    const result = await RevealPath(path);
    if (result.error) message.error(`无法打开: ${result.error}`);
}

function presentResult(task: ActionTask) {
    const {openDetail} = useActionTaskStore.getState();
    const meta = ACTION_META[task.action];
    const key = `task-${task.id}`;

    if (task.status === 'canceled') {
        message.info(`已取消${task.label}`);
        return;
    }

    if (task.status === 'error') {
        notification.error({
            key,
            message: `${task.label}失败`,
            description: firstLine(task.error, 120),
            actions: <Button size="small" onClick={() => {
                notification.destroy(key);
                openDetail(task.id);
            }}>查看详情</Button>,
            duration: 6,
        });
        return;
    }

    switch (meta.kind) {
        case 'query':
            openDetail(task.id);
            return;
        case 'file':
            notification.success({
                key,
                message: `${task.label}完成`,
                description: task.localPath ? <span className="break-all font-mono text-[12px]">{task.localPath}</span> : firstLine(task.output),
                actions: task.localPath ? <Button size="small" onClick={() => {
                    notification.destroy(key);
                    void revealLocalPath(task.localPath);
                }}>在访达中显示</Button> : undefined,
                duration: 6,
            });
            return;
        case 'instant': {
            const summary = firstLine(task.output, 60);
            // 输出较短时直接展示，例如开关类命令返回的当前状态
            message.success(summary && !summary.includes('\n') && summary.length <= 60 && summary !== 'success'
                ? `${task.label}：${summary}`
                : `${task.label}已执行`);
            return;
        }
        default:
    }
}

/**
 * 执行一个快捷功能：危险操作先确认，创建任务记录，执行完成后按类型展示结果。
 * 返回 null 表示用户在确认框中取消。
 */
export async function runQuickAction(item: QuickAction, ctx: RunContext): Promise<{task: ActionTask; result: TaskResult} | null> {
    if (!(await confirmDanger(item, ctx.packageName))) return null;

    const store = useActionTaskStore.getState();
    const meta = ACTION_META[item.action];
    const id = newTaskId();
    store.addTask({
        id,
        action: item.action,
        label: item.label,
        icon: item.icon,
        kind: meta.kind,
        packageName: meta.needsPackage ? ctx.packageName : '',
        deviceName: ctx.deviceName,
    });

    let result: TaskResult;
    try {
        result = await ExecuteAction({
            action: item.action,
            targetPackageName: ctx.packageName,
            deviceId: ctx.deviceId,
            taskId: id,
            files: ctx.files,
        });
    } catch (error: any) {
        result = {error: error?.message || String(error) || '执行失败'};
    }

    useActionTaskStore.getState().finishTask(id, result);
    const task = useActionTaskStore.getState().tasks.find(t => t.id === id)!;

    // 每次只用一种方式反馈结果：展开了执行记录就不再弹通知或结果面板，避免同时弹出
    const mode = await GetTerminalOpenMode().catch(() => 'error');
    const openPanel = mode === 'always' || (mode === 'error' && task.status === 'error');
    if (openPanel) {
        useActionTaskStore.getState().setPanelOpen(true);
    } else if (meta.kind !== 'modal' || task.status !== 'success') {
        presentResult(task);
    }
    return {task, result};
}
