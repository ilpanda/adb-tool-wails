import {create} from 'zustand';
import {EventsOn} from '../../wailsjs/runtime';
import type {ActionKind, ActionType} from '../data/quickActions';

export type TaskStatus = 'dialog' | 'running' | 'pulling' | 'success' | 'error' | 'canceled';

export interface ActionTask {
    id: string;
    action: ActionType;
    label: string;
    icon: string;
    kind: ActionKind;
    packageName: string;
    deviceName: string;
    status: TaskStatus;
    createdAt: number;
    endedAt?: number;
    // 停留在文件选择框等用户操作上的时间，不计入执行耗时
    dialogMs: number;
    dialogStartedAt?: number;
    cmd: string;
    output: string;
    error: string;
    localPath: string;
    // 失败后用户是否已查看，未查看前卡片保持失败态
    acknowledged: boolean;
}

export interface TaskResult {
    cmd?: string;
    res?: string;
    error?: string;
    canceled?: boolean;
    localPath?: string;
}

const MAX_TASKS = 200;

interface ActionTaskStore {
    tasks: ActionTask[];
    panelOpen: boolean;
    detailTaskId: string | null;
    addTask: (task: Pick<ActionTask, 'id' | 'action' | 'label' | 'icon' | 'kind' | 'packageName' | 'deviceName'>) => void;
    setStage: (id: string, stage: string) => void;
    finishTask: (id: string, result: TaskResult) => void;
    acknowledge: (id: string) => void;
    clearFinished: () => void;
    setPanelOpen: (open: boolean) => void;
    openDetail: (id: string | null) => void;
}

const ACTIVE: TaskStatus[] = ['dialog', 'running', 'pulling'];

export function isActive(task: ActionTask): boolean {
    return ACTIVE.includes(task.status);
}

// 执行耗时（毫秒），扣除等待用户选择文件的时间
export function elapsedMs(task: ActionTask, now = Date.now()): number {
    const end = task.endedAt ?? now;
    const pendingDialog = task.dialogStartedAt !== undefined ? end - task.dialogStartedAt : 0;
    return Math.max(0, end - task.createdAt - task.dialogMs - pendingDialog);
}

export function formatElapsed(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

export const useActionTaskStore = create<ActionTaskStore>((set) => ({
    tasks: [],
    panelOpen: false,
    detailTaskId: null,

    addTask: (task) => set(state => ({
        tasks: [
            ...state.tasks.slice(-(MAX_TASKS - 1)),
            {
                ...task,
                status: 'running',
                createdAt: Date.now(),
                dialogMs: 0,
                cmd: '',
                output: '',
                error: '',
                localPath: '',
                acknowledged: false,
            },
        ],
    })),

    setStage: (id, stage) => set(state => ({
        tasks: state.tasks.map(task => {
            if (task.id !== id || !isActive(task)) return task;
            const now = Date.now();
            const next = {...task};
            if (task.dialogStartedAt !== undefined && stage !== 'dialog') {
                next.dialogMs += now - task.dialogStartedAt;
                next.dialogStartedAt = undefined;
            }
            if (stage === 'dialog' && task.dialogStartedAt === undefined) {
                next.dialogStartedAt = now;
            }
            if (stage === 'dialog' || stage === 'running' || stage === 'pulling') {
                next.status = stage;
            }
            return next;
        }),
    })),

    finishTask: (id, result) => set(state => ({
        tasks: state.tasks.map(task => {
            if (task.id !== id) return task;
            const now = Date.now();
            const dialogMs = task.dialogStartedAt !== undefined ? task.dialogMs + now - task.dialogStartedAt : task.dialogMs;
            return {
                ...task,
                status: result.canceled ? 'canceled' : result.error ? 'error' : 'success',
                endedAt: now,
                dialogMs,
                dialogStartedAt: undefined,
                cmd: result.cmd ?? '',
                output: result.res ?? '',
                error: result.error ?? '',
                localPath: result.localPath ?? '',
            };
        }),
    })),

    acknowledge: (id) => set(state => ({
        tasks: state.tasks.map(task => task.id === id ? {...task, acknowledged: true} : task),
    })),

    clearFinished: () => set(state => ({
        tasks: state.tasks.filter(isActive),
        detailTaskId: null,
    })),

    setPanelOpen: (open) => set({panelOpen: open}),

    openDetail: (id) => set(state => ({
        detailTaskId: id,
        tasks: id ? state.tasks.map(task => task.id === id ? {...task, acknowledged: true} : task) : state.tasks,
    })),
}));

// 后端在等待文件选择、执行命令、拉取文件等阶段推送 action-stage 事件
try {
    EventsOn('action-stage', (data: {taskId: string; stage: string}) => {
        if (data?.taskId) useActionTaskStore.getState().setStage(data.taskId, data.stage);
    });
} catch (error) {
    // 非 Wails 环境（如单独运行 vite）没有 runtime，阶段事件不可用
    console.warn('action-stage listener unavailable', error);
}
