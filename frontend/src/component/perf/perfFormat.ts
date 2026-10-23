import type {PerfEventKind, PerfMemInfo, PerfMemorySample, PerfProcEvent, PerfSample} from '../../store/perfMonitorStore';

// 页面局部主题：近黑主色 + 细边框 + 6px 圆角（与其他页面一致）
export const PAGE_THEME = {
    token: {
        colorPrimary: '#171717',
        colorBorder: '#ebebeb',
        colorText: '#171717',
        colorTextPlaceholder: '#a1a1a1',
        borderRadius: 6,
        controlHeight: 34,
        boxShadow: '0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.08)',
    },
};

export const MONO = 'font-mono tabular-nums';
export const AXIS_TICK = {fontSize: 11, fill: '#8f8f8f', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'};

// 进程按出现顺序取色，主进程固定第一个颜色
const PROCESS_COLORS = ['#0070f3', '#e5484d', '#12a594', '#f5a623', '#7928ca', '#eb367f', '#46a758', '#3976c5', '#ac751d', '#8f8f8f'];

export function processColor(processNames: string[], name: string): string {
    const idx = processNames.indexOf(name);
    return PROCESS_COLORS[(idx < 0 ? 0 : idx) % PROCESS_COLORS.length];
}

// 主进程显示「主进程」，子进程只显示冒号后的部分
export function shortProcessName(name: string, packageName: string): string {
    if (name === packageName) return '主进程';
    if (name.startsWith(packageName + ':')) return name.slice(packageName.length);
    return name;
}

// 与线程调度弹窗一致：按簇性能从低到高取色
export const CLUSTER_COLORS: Record<string, string> = {
    '小核': '#46a758',
    '中核': '#12a594',
    '大核': '#f5a623',
    '超大核': '#e5484d',
};

export function clusterColor(label: string): string {
    return CLUSTER_COLORS[label] ?? '#0070f3';
}

export const TEMP_COLOR = '#7928ca';

export const EVENT_META: Record<PerfEventKind, { label: string; color: string; soft: string }> = {
    started: {label: '启动', color: '#46a758', soft: '#e9f6ea'},
    died: {label: '退出', color: '#e5484d', soft: '#ffe5e5'},
    restarted: {label: '重启', color: '#f5a623', soft: '#ffefcf'},
    anr: {label: 'ANR', color: '#eb367f', soft: '#fde8f1'},
};

export interface MemoryRegion {
    key: keyof PerfMemInfo;
    name: string;
    color: string;
}

export const MEMORY_REGIONS: MemoryRegion[] = [
    {key: 'javaHeap', name: 'Java Heap', color: '#0070f3'},
    {key: 'nativeHeap', name: 'Native Heap', color: '#e5484d'},
    {key: 'code', name: 'Code', color: '#f5a623'},
    {key: 'stack', name: 'Stack', color: '#eb367f'},
    {key: 'graphics', name: 'Graphics', color: '#7928ca'},
    {key: 'privateOther', name: 'Private Other', color: '#12a594'},
    {key: 'system', name: 'System', color: '#46a758'},
    {key: 'unknown', name: 'Unknown', color: '#a1a1a1'},
    {key: 'totalPss', name: 'Total PSS', color: '#171717'},
];

// dumpsys meminfo Objects 中与泄漏判断最相关的计数
export const KEY_OBJECTS = ['Activities', 'ViewRootImpl', 'Views', 'AppContexts', 'WebViews', 'Local Binders', 'Proxy Binders', 'Death Recipients'];

export const formatMemory = (kb: number | null | undefined): string => {
    if (kb == null || Number.isNaN(kb)) return '--';
    const MB = 1024;
    const GB = 1024 * 1024;
    if (kb >= GB) return `${(kb / GB).toFixed(2)} GB`;
    if (kb >= MB) return `${(kb / MB).toFixed(1)} MB`;
    return `${kb.toFixed(0)} KB`;
};

export const formatPercent = (value: number | null | undefined, digits = 1): string =>
    value == null || Number.isNaN(value) ? '--' : `${value.toFixed(digits)}%`;

export const formatMHz = (khz: number | null | undefined): string =>
    khz == null || khz <= 0 ? '--' : `${Math.round(khz / 1000)} MHz`;

export const formatTime = (timestamp: number): string =>
    new Date(timestamp).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});

export const formatDuration = (ms: number): string => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
};

const escapeCSVCell = (value: string | number | null | undefined): string => {
    if (value === undefined || value === null) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
};

const csvLine = (cells: Array<string | number | null | undefined>) => cells.map(escapeCSVCell).join(',');

const formatDateTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', {hour12: false});

// 导出为一个 CSV，按「CPU 与 RSS / 内存 PSS / 进程事件」三段排列
export function generatePerfCSV(packageName: string, samples: PerfSample[], memory: PerfMemorySample[], events: PerfProcEvent[]): string {
    const lines: string[] = [
        `# 包名: ${packageName}`,
        `# 导出时间: ${new Date().toLocaleString('zh-CN', {hour12: false})}`,
        '# CPU 为单核口径（一个核满载 = 100%），整机 CPU 为整机口径（全部核满载 = 100%），内存单位 KB',
        '',
        '# CPU 与 RSS（高频采样）',
        csvLine(['时间', '进程', 'PID', 'CPU(%)', '整机CPU(%)', 'RssAnon', 'RssFile', 'RssShmem', 'Swap', '线程数', 'CPU 占用最高的线程']),
    ];
    for (const sample of samples) {
        for (const p of sample.processes) {
            const threads = (p.topThreads ?? []).map(t => `${t.name}(${t.tid}) ${t.cpu.toFixed(1)}%`).join(' / ');
            lines.push(csvLine([
                formatDateTime(sample.timestamp), p.name, p.pid,
                p.cpu == null ? '' : p.cpu.toFixed(2),
                sample.deviceCpu == null ? '' : sample.deviceCpu.toFixed(2),
                p.rssAnon, p.rssFile, p.rssShmem, p.swap, p.threads, threads,
            ]));
        }
    }

    lines.push('', '# 内存 PSS（dumpsys meminfo）');
    lines.push(csvLine(['时间', '进程', 'PID', ...MEMORY_REGIONS.map(r => r.name), 'Swap PSS', 'Total RSS', 'CPU温度(°C)', ...KEY_OBJECTS]));
    for (const sample of memory) {
        for (const p of sample.processes) {
            lines.push(csvLine([
                formatDateTime(sample.timestamp), p.process, p.pid,
                ...MEMORY_REGIONS.map(r => p[r.key] as number),
                p.swapPss, p.totalRss,
                sample.thermal.cpuTemp || '',
                ...KEY_OBJECTS.map(k => p.objects?.[k]),
            ]));
        }
    }

    lines.push('', '# 进程事件');
    lines.push(csvLine(['时间', '类型', '进程', 'PID', '旧 PID', '原因', '详情', '来源']));
    for (const e of events) {
        lines.push(csvLine([
            formatDateTime(e.timestamp), EVENT_META[e.kind]?.label ?? e.kind, e.process, e.pid, e.oldPid || '', e.reason, e.detail, e.source,
        ]));
    }
    return '﻿' + lines.join('\n');
}
