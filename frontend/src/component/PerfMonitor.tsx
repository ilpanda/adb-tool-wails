import React, {useEffect, useMemo, useState} from 'react';
import {Alert, Button, ConfigProvider, message, Segmented, Select, Tooltip} from 'antd';
import {
    CloseOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    DownOutlined,
    ExportOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    RightOutlined,
} from '@ant-design/icons';
import {SaveFile, SaveFileAsCsv} from '../../wailsjs/go/main/App';
import {useDeviceStore} from '../store/deviceStore';
import {PerfMemInfo, PerfMemorySample, PerfProcEvent, usePerfMonitorStore} from '../store/perfMonitorStore';
import PageHeader, {Eyebrow} from './PageHeader';
import PackagePicker from './PackagePicker';
import {readStoredPackage, usePackageListStore} from '../store/packageListStore';
import {ChartContext, CoreGrid, CpuChart, FreqChart, MemoryChart, MemoryMode} from './perf/PerfCharts';
import {
    EVENT_META,
    formatDuration,
    formatMemory,
    formatMHz,
    formatPercent,
    formatTime,
    generatePerfCSV,
    KEY_OBJECTS,
    MEMORY_REGIONS,
    MONO,
    PAGE_THEME,
    processColor,
    shortProcessName,
    TEMP_COLOR,
} from './perf/perfFormat';

const WINDOW_OPTIONS = [
    {value: 60_000, label: '1 分钟'},
    {value: 5 * 60_000, label: '5 分钟'},
    {value: 15 * 60_000, label: '15 分钟'},
    {value: 0, label: '全部'},
];

const CARD = 'rounded-xl border border-[#ebebeb] bg-white';

const CardHeader: React.FC<{ eyebrow: string; title: string; children?: React.ReactNode }> = ({eyebrow, title, children}) => (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f2f2f2] px-5 py-3.5">
        <div>
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.2px] text-[#171717]">{title}</h2>
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
);

const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }> = ({label, value, sub, accent}) => (
    <div className={`${CARD} min-w-0 px-4 py-3.5`}>
        <div className="flex items-center gap-2">
            {accent && <span className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor: accent}}/>}
            <span className="truncate text-[12px] text-[#8f8f8f]">{label}</span>
        </div>
        <div className={`${MONO} mt-1.5 truncate text-[22px] font-semibold leading-7 tracking-[-0.5px] text-[#171717]`}>{value}</div>
        {sub && <div className="mt-1 truncate text-[12px] text-[#a1a1a1]">{sub}</div>}
    </div>
);

// 点击内存曲线上的点后显示该时刻的完整 meminfo
const MemoryDetail: React.FC<{
    info: PerfMemInfo;
    sample: PerfMemorySample;
    packageName: string;
    onClose: () => void;
}> = ({info, sample, packageName, onClose}) => {
    const copy = async () => {
        if (!info.rawMemInfo) return;
        await navigator.clipboard.writeText(info.rawMemInfo);
        message.success('已复制到剪贴板');
    };
    const save = async () => {
        if (!info.rawMemInfo) return;
        const result = await SaveFile(info.rawMemInfo, `meminfo_${info.process.replace(/[:.]/g, '_')}`);
        if (result.error && !result.canceled) message.error(result.error);
    };
    return (
        <div className="absolute right-4 top-16 z-50 w-[340px] rounded-xl border border-[#ebebeb] bg-white" style={{boxShadow: PAGE_THEME.token.boxShadow}}>
            <div className="flex items-start justify-between border-b border-[#f2f2f2] px-4 py-3">
                <div className="min-w-0">
                    <Eyebrow>Snapshot · pid {info.pid}</Eyebrow>
                    <div className={`${MONO} mt-0.5 text-[15px] font-semibold text-[#171717]`}>{formatTime(sample.timestamp)}</div>
                    <div className="truncate font-mono text-[12px] text-[#8f8f8f]">{shortProcessName(info.process, packageName)}</div>
                </div>
                <Button type="text" size="small" icon={<CloseOutlined/>} onClick={onClose}/>
            </div>
            <div className="max-h-[340px] overflow-y-auto px-4 py-3">
                <div className="space-y-1.5">
                    {MEMORY_REGIONS.map(region => (
                        <div key={region.key} className="flex items-center justify-between text-[13px]">
                            <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{backgroundColor: region.color}}/>
                                <span className={region.key === 'totalPss' ? 'font-medium text-[#171717]' : 'text-[#4d4d4d]'}>{region.name}</span>
                            </div>
                            <span className={`${MONO} text-[#171717]`}>{formatMemory(info[region.key] as number)}</span>
                        </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-[#f2f2f2] pt-1.5 text-[13px]">
                        <span className="text-[#4d4d4d]">Swap PSS</span>
                        <span className={`${MONO} text-[#171717]`}>{formatMemory(info.swapPss)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[13px]">
                        <span className="text-[#4d4d4d]">Total RSS</span>
                        <span className={`${MONO} text-[#171717]`}>{formatMemory(info.totalRss)}</span>
                    </div>
                </div>
                {info.objects && Object.keys(info.objects).length > 0 && (
                    <div className="mt-3 border-t border-[#f2f2f2] pt-3">
                        <Eyebrow>Objects</Eyebrow>
                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
                            {KEY_OBJECTS.filter(k => info.objects[k] != null).map(k => (
                                <div key={k} className="flex justify-between text-[12.5px]">
                                    <span className="text-[#8f8f8f]">{k}</span>
                                    <span className={`${MONO} text-[#171717]`}>{info.objects[k]}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="flex gap-2 border-t border-[#f2f2f2] px-4 py-3">
                <Button icon={<CopyOutlined/>} onClick={copy} className="flex-1" disabled={!info.rawMemInfo}>复制原文</Button>
                <Button type="primary" icon={<DownloadOutlined/>} onClick={save} className="flex-1" disabled={!info.rawMemInfo}>导出原文</Button>
            </div>
            {!info.rawMemInfo && <div className="px-4 pb-3 text-[11.5px] text-[#a1a1a1]">只保留最近 60 次采样的原文</div>}
        </div>
    );
};

const EventTag: React.FC<{ event: PerfProcEvent }> = ({event}) => {
    const meta = EVENT_META[event.kind];
    return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium" style={{color: meta?.color, backgroundColor: meta?.soft}}>
            {meta?.label ?? event.kind}
        </span>
    );
};

const PerfMonitor: React.FC = () => {
    const {selectedDevice} = useDeviceStore();
    const {
        packageName, intervalMs, memIntervalMs, running, starting, error,
        samples, memory, events, processNames, hiddenProcesses,
        setPackageName, setIntervalMs, setMemIntervalMs, toggleProcess, start, stop, clear,
    } = usePerfMonitorStore();

    const [windowMs, setWindowMs] = useState(5 * 60_000);

    // 包名列表与快捷功能共用；还没选过包名时默认用快捷功能的目标应用
    useEffect(() => {
        if (!selectedDevice) return;
        const packageStore = usePackageListStore.getState();
        if (!packageStore.packagesByDevice[selectedDevice.id]) {
            void packageStore.fetchPackages(selectedDevice.id);
        }
        if (!usePerfMonitorStore.getState().packageName) {
            const stored = readStoredPackage(selectedDevice.id);
            if (stored) setPackageName(stored);
        }
    }, [selectedDevice?.id]);
    const [memoryMode, setMemoryMode] = useState<MemoryMode>('pss');
    const [focusProcess, setFocusProcess] = useState('');
    const [visibleRegions, setVisibleRegions] = useState<Record<string, boolean>>(
        () => Object.fromEntries(MEMORY_REGIONS.map(r => [r.key, true])));
    const [coresExpanded, setCoresExpanded] = useState(true);
    const [detail, setDetail] = useState<{ info: PerfMemInfo; sample: PerfMemorySample } | null>(null);

    const latest = samples[samples.length - 1];
    const latestMemory = memory[memory.length - 1];
    const firstTs = Math.min(samples[0]?.timestamp ?? Infinity, memory[0]?.timestamp ?? Infinity);
    const lastTs = Math.max(latest?.timestamp ?? 0, latestMemory?.timestamp ?? 0);
    const hasData = samples.length > 0;

    const to = lastTs || Date.now();
    // 数据不足一个窗口时从第一个点开始画，避免曲线挤在右侧
    const earliest = Number.isFinite(firstTs) ? firstTs : to - 60_000;
    const from = windowMs > 0 ? Math.max(to - windowMs, earliest) : earliest;
    const visibleSamples = useMemo(() => samples.filter(s => s.timestamp >= from - 2000), [samples, from]);
    const visibleMemory = useMemo(() => memory.filter(m => m.timestamp >= from - 10_000), [memory, from]);

    const ctx: ChartContext = {from, to, packageName, processNames, hidden: hiddenProcesses, events};
    const effectiveFocus = processNames.includes(focusProcess) ? focusProcess : (processNames[0] ?? packageName);

    const handleStart = async () => {
        if (!selectedDevice?.id) {
            message.error('请连接设备');
            return;
        }
        if (!packageName.trim()) {
            message.error('请输入应用包名');
            return;
        }
        try {
            await start(selectedDevice.id);
        } catch (e: any) {
            message.error(e?.toString() || '启动监控失败');
        }
    };

    const handleExport = async () => {
        const result = await SaveFileAsCsv(generatePerfCSV(packageName, samples, memory, events), `perf_${packageName}`);
        if (result.canceled) return;
        if (result.error) {
            message.error('导出失败：' + result.error);
            return;
        }
        message.success('已导出');
    };

    // 概览：只统计显示中的进程
    const shownProcesses = (latest?.processes ?? []).filter(p => !hiddenProcesses[p.name]);
    const procCpus = shownProcesses.map(p => p.cpu).filter((v): v is number => v != null);
    const procCpu = procCpus.length > 0 ? procCpus.reduce((a, b) => a + b, 0) : null;
    const shownMemory = (latestMemory?.processes ?? []).filter(p => !hiddenProcesses[p.process]);
    const totalPss = shownMemory.length > 0 ? shownMemory.reduce((sum, p) => sum + p.totalPss, 0) : null;
    const swapPss = shownMemory.reduce((sum, p) => sum + p.swapPss, 0);
    const thermal = latestMemory?.thermal;
    const abnormalEvents = events.filter(e => e.kind !== 'started');
    const lastEvent = events[events.length - 1];

    return (
        <ConfigProvider theme={PAGE_THEME}>
            <div className="h-full flex-1 overflow-y-auto bg-[#fafafa] px-8 py-7 text-left text-[#171717]">
                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    <PageHeader
                        eyebrow="Performance · /proc + dumpsys"
                        title="性能监控"
                        description="实时采集包名下所有进程的 CPU、内存与进程事件，Release 包可用，无需 root"
                        actions={<>
                            {!running ? (
                                <Button type="primary" icon={<PlayCircleOutlined/>} onClick={handleStart}>开始</Button>
                            ) : (
                                <Button danger icon={<PauseCircleOutlined/>} onClick={() => stop()} loading={starting}>停止</Button>
                            )}
                            <Button icon={<DeleteOutlined/>} onClick={() => {
                                clear();
                                setDetail(null);
                            }} disabled={!hasData && events.length === 0}>清除</Button>
                            <Button icon={<ExportOutlined/>} onClick={handleExport} disabled={!hasData}>导出 CSV</Button>
                        </>}
                    />

                    {/* 设置 */}
                    <div className={`${CARD} p-5`}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                            <div>
                                <label className="mb-1.5 block text-[13px] font-medium text-[#4d4d4d]">包名</label>
                                <PackagePicker value={packageName} onChange={setPackageName} disabled={running}/>
                                <p className="mt-1.5 text-[12px] text-[#a1a1a1]">监控包名下的所有进程，包括 :push 等子进程</p>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[13px] font-medium text-[#4d4d4d]">CPU 采样间隔</label>
                                <Select value={intervalMs} onChange={setIntervalMs} className="w-full" disabled={running}
                                        options={[{value: 1000, label: '1 秒'}, {value: 2000, label: '2 秒'}, {value: 5000, label: '5 秒'}]}/>
                                <p className="mt-1.5 text-[12px] text-[#a1a1a1]">CPU 占用、单核负载、频率、匿名内存 / Swap</p>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[13px] font-medium text-[#4d4d4d]">内存采样间隔</label>
                                <Select value={memIntervalMs} onChange={setMemIntervalMs} className="w-full" disabled={running}
                                        options={[{value: 5000, label: '5 秒'}, {value: 10000, label: '10 秒'}, {value: 30000, label: '30 秒'}]}/>
                                <p className="mt-1.5 text-[12px] text-[#a1a1a1]">
                                    <Tooltip title="dumpsys meminfo 每个进程约 0.7~1 秒，进程较多时实际间隔会变长">
                                        PSS 分类、Objects 计数、CPU 温度
                                    </Tooltip>
                                </p>
                            </div>
                        </div>
                    </div>

                    {error && <Alert type="error" showIcon message={error} closable/>}

                    {/* 概览 */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                        <StatCard
                            label="进程 CPU"
                            accent="#0070f3"
                            value={formatPercent(procCpu)}
                            sub={procCpu != null ? `单核口径 · 约 ${(procCpu / 100).toFixed(2)} 个核` : '单核口径'}
                        />
                        <StatCard
                            label="整机 CPU"
                            accent="#c4c4c4"
                            value={formatPercent(latest?.deviceCpu)}
                            sub={latest ? `整机口径 · ${latest.cpuCount} 核` : '整机口径'}
                        />
                        <StatCard
                            label="内存 PSS"
                            accent="#171717"
                            value={formatMemory(totalPss)}
                            sub={totalPss != null ? `另有 Swap PSS ${formatMemory(swapPss)}` : '每次内存采样更新'}
                        />
                        <StatCard
                            label="CPU 温度"
                            accent={TEMP_COLOR}
                            value={thermal?.cpuTemp ? `${thermal.cpuTemp.toFixed(1)} °C` : '--'}
                            sub={thermal?.throttleTemp ? `降频阈值 ${thermal.throttleTemp} °C` : '来自 thermalservice'}
                        />
                        <StatCard
                            label="进程事件"
                            accent={abnormalEvents.length > 0 ? '#e5484d' : '#46a758'}
                            value={abnormalEvents.length}
                            sub={lastEvent
                                ? `${formatTime(lastEvent.timestamp)} ${shortProcessName(lastEvent.process, packageName)} ${EVENT_META[lastEvent.kind]?.label}`
                                : '退出 / 重启 / ANR 次数'}
                        />
                    </div>

                    {/* 进程开关 + 显示范围 */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {processNames.length === 0 && (
                                <span className="text-[13px] text-[#a1a1a1]">
                                    {running ? '等待进程出现…' : '开始后会列出包名下的所有进程，点击可显示 / 隐藏'}
                                </span>
                            )}
                            {processNames.map(name => {
                                const proc = latest?.processes.find(p => p.name === name);
                                const mem = latestMemory?.processes.find(p => p.process === name);
                                const hidden = !!hiddenProcesses[name];
                                const color = processColor(processNames, name);
                                return (
                                    <button
                                        key={name}
                                        onClick={() => toggleProcess(name)}
                                        title={name}
                                        className={`flex items-center gap-2 rounded-full border bg-white py-1 pl-2.5 pr-3 text-[12.5px] transition-all hover:border-[#d4d4d4] ${
                                            hidden ? 'border-dashed border-[#ebebeb] opacity-45' : 'border-[#ebebeb]'
                                        }`}
                                    >
                                        <span className="h-2 w-2 rounded-full" style={{backgroundColor: hidden ? 'transparent' : color, boxShadow: `inset 0 0 0 1.5px ${color}`}}/>
                                        <span className="font-medium text-[#171717]">{shortProcessName(name, packageName)}</span>
                                        {proc ? (
                                            <span className={`${MONO} text-[#8f8f8f]`}>
                                                {proc.pid} · {formatPercent(proc.cpu)}{mem ? ` · ${formatMemory(mem.totalPss)}` : ''}
                                            </span>
                                        ) : (
                                            <span className="text-[#e5484d]">未运行</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-2">
                            {running && hasData && Number.isFinite(firstTs) && (
                                <span className="flex items-center gap-1.5 rounded-full border border-[#ebebeb] bg-white px-2.5 py-0.5 text-[12px] text-[#4d4d4d]">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0070f3]"/>
                                    已采集 {formatDuration(lastTs - firstTs)}
                                </span>
                            )}
                            <Segmented size="small" value={windowMs} onChange={(v) => setWindowMs(v as number)} options={WINDOW_OPTIONS}/>
                        </div>
                    </div>

                    {!hasData ? (
                        <div className={`${CARD} flex h-80 flex-col items-center justify-center gap-3 text-center`}>
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#ebebeb] text-[#8f8f8f]">
                                <PlayCircleOutlined/>
                            </div>
                            <p className="text-[14px] text-[#4d4d4d]">{running ? '正在采集…' : '点击「开始」监控应用的 CPU、内存与进程事件'}</p>
                            <code className="rounded-md border border-[#ebebeb] bg-[#fafafa] px-3 py-1.5 font-mono text-[12px] text-[#4d4d4d]">
                                <span className="text-[#a1a1a1]">$ </span>
                                cat /proc/stat /proc/&lt;pid&gt;/stat · dumpsys meminfo &lt;pid&gt; · logcat -b events
                            </code>
                        </div>
                    ) : (
                        <>
                            {/* 内存 */}
                            <div className={`${CARD} relative`}>
                                <CardHeader eyebrow="Memory" title="内存">
                                    {memoryMode === 'breakdown' && (
                                        <Select
                                            size="small"
                                            value={effectiveFocus}
                                            onChange={setFocusProcess}
                                            className="min-w-[140px]"
                                            options={processNames.map(name => ({value: name, label: shortProcessName(name, packageName)}))}
                                        />
                                    )}
                                    <Segmented
                                        size="small"
                                        value={memoryMode}
                                        onChange={(v) => setMemoryMode(v as MemoryMode)}
                                        options={[
                                            {value: 'pss', label: 'PSS · 按进程'},
                                            {value: 'breakdown', label: '分类明细'},
                                            {value: 'rss', label: '匿名内存 / Swap'},
                                        ]}
                                    />
                                </CardHeader>
                                {memoryMode === 'breakdown' && (
                                    <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                                        {MEMORY_REGIONS.map(region => {
                                            const on = visibleRegions[region.key];
                                            return (
                                                <button
                                                    key={region.key}
                                                    onClick={() => setVisibleRegions(prev => ({...prev, [region.key]: !prev[region.key]}))}
                                                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition-all hover:border-[#d4d4d4] ${
                                                        on ? 'border-[#ebebeb] text-[#4d4d4d]' : 'border-dashed border-[#ebebeb] text-[#a1a1a1] opacity-60'
                                                    }`}
                                                >
                                                    <span className="h-1.5 w-1.5 rounded-full" style={{backgroundColor: on ? region.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${region.color}`}}/>
                                                    {region.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                {detail && (
                                    <MemoryDetail info={detail.info} sample={detail.sample} packageName={packageName} onClose={() => setDetail(null)}/>
                                )}
                                <div className="h-72 px-3 pb-3 pt-3">
                                    {visibleMemory.length === 0 && memoryMode !== 'rss' ? (
                                        <div className="flex h-full items-center justify-center text-[13px] text-[#a1a1a1]">
                                            等待第一次 dumpsys meminfo…
                                        </div>
                                    ) : (
                                        <MemoryChart
                                            ctx={ctx}
                                            mode={memoryMode}
                                            samples={visibleSamples}
                                            memory={visibleMemory}
                                            focusProcess={effectiveFocus}
                                            visibleRegions={visibleRegions}
                                            onPick={(info, sample) => setDetail({info, sample})}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* CPU */}
                            <div className={CARD}>
                                <CardHeader eyebrow="CPU" title="CPU 占用">
                                    <span className="text-[12px] text-[#8f8f8f]">
                                        左轴：进程（单核口径，最高 {(latest?.cpuCount ?? 8) * 100}%）· 右轴：整机（0-100%）
                                    </span>
                                </CardHeader>
                                <div className="h-64 px-3 pb-3 pt-3">
                                    <CpuChart ctx={ctx} samples={visibleSamples}/>
                                </div>
                            </div>

                            {/* 单核负载 */}
                            <div className={CARD}>
                                <button
                                    className="flex w-full items-center justify-between border-b border-[#f2f2f2] px-5 py-3.5 text-left"
                                    onClick={() => setCoresExpanded(v => !v)}
                                >
                                    <div>
                                        <Eyebrow>Per core</Eyebrow>
                                        <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.2px] text-[#171717]">单核负载</h2>
                                    </div>
                                    <span className="text-[12px] text-[#8f8f8f]">
                                        {coresExpanded ? <DownOutlined/> : <RightOutlined/>}
                                    </span>
                                </button>
                                {coresExpanded && (
                                    <div className="p-4">
                                        <CoreGrid samples={visibleSamples} from={from} to={to}/>
                                    </div>
                                )}
                            </div>
                            {/* 频率与温度 */}
                            <div className={CARD}>
                                <CardHeader eyebrow="Frequency · Thermal" title="频率与温度">
                                    {latest?.clusters.map(c => (
                                        <span key={c.label} className={`${MONO} rounded-full border border-[#ebebeb] px-2.5 py-0.5 text-[12px] text-[#4d4d4d]`}>
                                            {c.label} {formatMHz(c.avgFreq)} / {formatMHz(c.maxFreq)}
                                        </span>
                                    ))}
                                </CardHeader>
                                <div className="h-56 px-3 pb-3 pt-3">
                                    <FreqChart ctx={ctx} samples={visibleSamples} memory={visibleMemory}/>
                                </div>
                            </div>

                        </>
                    )}

                    {/* 进程事件 */}
                    <div className={CARD}>
                        <CardHeader eyebrow="Process events" title="进程事件">
                            <span className="text-[12px] text-[#8f8f8f]">来源：轮询 pid + 启动时间、logcat events、exit-info</span>
                        </CardHeader>
                        {events.length === 0 ? (
                            <div className="px-5 py-6 text-center text-[13px] text-[#a1a1a1]">
                                暂无事件。进程启动、退出、重启和 ANR 会记录在这里，并在图表上标出竖线
                            </div>
                        ) : (
                            <div className="max-h-72 overflow-y-auto">
                                <table className="w-full text-[13px]">
                                    <thead className="sticky top-0 bg-white text-[12px] text-[#8f8f8f]">
                                    <tr className="border-b border-[#f2f2f2]">
                                        <th className="px-5 py-2 text-left font-normal">时间</th>
                                        <th className="px-2 py-2 text-left font-normal">类型</th>
                                        <th className="px-2 py-2 text-left font-normal">进程</th>
                                        <th className="px-2 py-2 text-left font-normal">PID</th>
                                        <th className="px-2 py-2 text-left font-normal">原因</th>
                                        <th className="px-5 py-2 text-left font-normal">详情</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {[...events].reverse().map(e => (
                                        <tr key={e.id} className="border-b border-[#f7f7f7] align-top last:border-0">
                                            <td className={`${MONO} whitespace-nowrap px-5 py-2 text-[#4d4d4d]`}>{formatTime(e.timestamp)}</td>
                                            <td className="px-2 py-2"><EventTag event={e}/></td>
                                            <td className="whitespace-nowrap px-2 py-2 font-medium" title={e.process}>{shortProcessName(e.process, packageName)}</td>
                                            <td className={`${MONO} whitespace-nowrap px-2 py-2 text-[#4d4d4d]`}>
                                                {e.oldPid ? `${e.oldPid} → ${e.pid}` : e.pid}
                                            </td>
                                            <td className="whitespace-nowrap px-2 py-2">{e.reason}</td>
                                            <td className="break-all px-5 py-2 font-mono text-[12px] text-[#8f8f8f]">{e.detail || '-'}</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#8f8f8f]">
                        <span>· 进程 CPU 为单核口径：一个核跑满 = 100%</span>
                        <span>· 匿名内存被换出到 zram 时 RSS 会下降，但并未释放，请结合 Swap 一起看</span>
                        <span>· 进程重启后曲线断开，不代表内存被释放</span>
                        <span>· 数据最多保留 1 小时，切换页面不影响采集</span>
                    </div>
                </div>
            </div>
        </ConfigProvider>
    );
};

export default PerfMonitor;
