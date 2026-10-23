// store/perfMonitorStore.ts
// 性能监控数据放在 store 中：切换页面后后端继续采样，回到页面数据仍在
import {create} from 'zustand';
import {EventsOn} from '../../wailsjs/runtime';
import {StartPerfMonitor, StopPerfMonitor} from '../../wailsjs/go/main/App';

// 以下类型与 adb/perf_*.go 中推送的结构对应
export interface PerfThread {
    tid: number;
    name: string;
    cpu: number;
}

export interface PerfProcess {
    name: string;
    pid: number;
    cpu: number | null; // 单核口径 %
    rssAnon: number;
    rssFile: number;
    rssShmem: number;
    swap: number;
    threads: number;
    topThreads: PerfThread[] | null;
}

export interface PerfCore {
    cpu: number;
    load: number | null;
    freq: number; // kHz
}

export interface PerfCluster {
    label: string;
    cpus: number[];
    maxFreq: number;
    curFreq: number;
    avgFreq: number;
}

export interface PerfSample {
    timestamp: number;
    cpuCount: number;
    deviceCpu: number | null; // 整机口径 0-100
    cores: PerfCore[];
    clusters: PerfCluster[];
    processes: PerfProcess[];
}

export interface PerfMemInfo {
    timestamp: number;
    pid: number;
    process: string;
    javaHeap: number;
    nativeHeap: number;
    code: number;
    stack: number;
    graphics: number;
    privateOther: number;
    system: number;
    unknown: number;
    totalPss: number;
    totalRss: number;
    swapPss: number;
    objects: Record<string, number>;
    rawMemInfo?: string;
}

export interface PerfThermal {
    cpuTemp: number;
    throttleTemp: number;
    thermalStatus: number;
}

export interface PerfMemorySample {
    timestamp: number;
    processes: PerfMemInfo[];
    thermal: PerfThermal;
}

export type PerfEventKind = 'started' | 'died' | 'restarted' | 'anr';

export interface PerfProcEvent {
    id: number;
    timestamp: number;
    kind: PerfEventKind;
    process: string;
    pid: number;
    oldPid: number;
    reason: string;
    detail: string;
    source: string;
}

interface PerfStatus {
    running: boolean;
    packageName: string;
    deviceId: string;
    error: string;
}

const STORAGE_KEY_PACKAGE = 'perf_monitor_package_name';
// 兼容旧版内存监控保存的包名
const LEGACY_STORAGE_KEY_PACKAGE = 'memory_monitor_process_name';

// 采样数据最多保留 1 小时
export const PERF_RETENTION_MS = 60 * 60 * 1000;
// 原始 meminfo 文本较大，只为最近的低频采样保留
const RAW_MEMINFO_KEEP = 60;

function loadPackageName(): string {
    try {
        return localStorage.getItem(STORAGE_KEY_PACKAGE) || localStorage.getItem(LEGACY_STORAGE_KEY_PACKAGE) || '';
    } catch {
        return '';
    }
}

interface PerfMonitorState {
    packageName: string;
    intervalMs: number;
    memIntervalMs: number;
    running: boolean;
    starting: boolean;
    deviceId: string;
    error: string;

    samples: PerfSample[];
    memory: PerfMemorySample[];
    events: PerfProcEvent[];
    processNames: string[]; // 按首次出现排序，主进程在前
    hiddenProcesses: Record<string, boolean>;

    setPackageName: (name: string) => void;
    setIntervalMs: (ms: number) => void;
    setMemIntervalMs: (ms: number) => void;
    toggleProcess: (name: string) => void;
    start: (deviceId: string) => Promise<void>;
    stop: () => Promise<void>;
    clear: () => void;
}

function trimByTime<T extends { timestamp: number }>(items: T[], now: number): T[] {
    const from = now - PERF_RETENTION_MS;
    if (items.length === 0 || items[0].timestamp >= from) {
        return items;
    }
    return items.filter(item => item.timestamp >= from);
}

function mergeProcessNames(current: string[], names: string[], packageName: string): string[] {
    const added = names.filter(name => !current.includes(name));
    if (added.length === 0) {
        return current;
    }
    return [...current, ...added].sort((a, b) => {
        if ((a === packageName) !== (b === packageName)) {
            return a === packageName ? -1 : 1;
        }
        const ia = current.indexOf(a);
        const ib = current.indexOf(b);
        return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || a.localeCompare(b);
    });
}

let subscribed = false;

export const usePerfMonitorStore = create<PerfMonitorState>((set, get) => {
    // 后端推送的事件只订阅一次，生命周期与应用一致
    const subscribe = () => {
        if (subscribed) return;
        subscribed = true;

        EventsOn('perf-status', (status: PerfStatus) => {
            if (status.packageName !== get().packageName) return;
            set({
                running: status.running,
                starting: false,
                error: status.error || '',
            });
        });

        EventsOn('perf-sample', (raw: PerfSample) => {
            if (!get().running) return;
            const sample: PerfSample = {...raw, cores: raw.cores ?? [], clusters: raw.clusters ?? [], processes: raw.processes ?? []};
            set(state => ({
                samples: trimByTime([...state.samples, sample], sample.timestamp),
                processNames: mergeProcessNames(state.processNames, sample.processes.map(p => p.name), state.packageName),
            }));
        });

        EventsOn('perf-memory', (raw: PerfMemorySample) => {
            if (!get().running) return;
            const sample: PerfMemorySample = {...raw, processes: raw.processes ?? []};
            set(state => {
                const memory = trimByTime([...state.memory, sample], sample.timestamp);
                const dropRawBefore = memory.length - RAW_MEMINFO_KEEP;
                if (dropRawBefore > 0 && memory[dropRawBefore - 1].processes.some(p => p.rawMemInfo)) {
                    const old = memory[dropRawBefore - 1];
                    memory[dropRawBefore - 1] = {
                        ...old,
                        processes: old.processes.map(({rawMemInfo: _, ...rest}) => rest),
                    };
                }
                return {memory};
            });
        });

        EventsOn('perf-event', (event: PerfProcEvent) => {
            if (!get().running) return;
            set(state => ({
                events: [...state.events, event].sort((a, b) => a.timestamp - b.timestamp),
            }));
        });
    };

    return {
        packageName: loadPackageName(),
        intervalMs: 1000,
        memIntervalMs: 5000,
        running: false,
        starting: false,
        deviceId: '',
        error: '',

        samples: [],
        memory: [],
        events: [],
        processNames: [],
        hiddenProcesses: {},

        setPackageName: (name) => {
            try {
                localStorage.setItem(STORAGE_KEY_PACKAGE, name);
            } catch {
                // 存储不可用时只是下次不会自动填充
            }
            set({packageName: name});
        },
        setIntervalMs: (ms) => set({intervalMs: ms}),
        setMemIntervalMs: (ms) => set({memIntervalMs: ms}),
        toggleProcess: (name) => set(state => ({
            hiddenProcesses: {...state.hiddenProcesses, [name]: !state.hiddenProcesses[name]},
        })),

        start: async (deviceId) => {
            subscribe();
            const {packageName, intervalMs, memIntervalMs} = get();
            // 换了包名或设备则清空旧数据，否则接着之前的数据继续
            const sameTarget = get().deviceId === deviceId && get().processNames.every(
                name => name === packageName || name.startsWith(packageName + ':'));
            set({
                starting: true,
                running: true,
                error: '',
                deviceId,
                ...(sameTarget ? {} : {samples: [], memory: [], events: [], processNames: [], hiddenProcesses: {}}),
            });
            try {
                await StartPerfMonitor({deviceId, packageName, intervalMs, memIntervalMs});
            } catch (e: any) {
                set({running: false, starting: false, error: e?.toString() || '启动监控失败'});
                throw e;
            }
        },

        stop: async () => {
            set({running: false});
            await StopPerfMonitor();
        },

        clear: () => set({samples: [], memory: [], events: [], processNames: [], hiddenProcesses: {}}),
    };
});
