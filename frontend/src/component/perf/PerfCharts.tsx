import React, {useMemo} from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ComposedChart,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type {PerfMemInfo, PerfMemorySample, PerfProcEvent, PerfSample, PerfThread} from '../../store/perfMonitorStore';
import {
    AXIS_TICK,
    clusterColor,
    EVENT_META,
    formatMemory,
    formatMHz,
    formatPercent,
    formatTime,
    MEMORY_REGIONS,
    MONO,
    PAGE_THEME,
    processColor,
    shortProcessName,
    TEMP_COLOR,
} from './perfFormat';

const SYNC_ID = 'perf-monitor';
// 右侧留出空间，避免最后一个时间刻度被截断
const CHART_MARGIN = {top: 12, right: 28, left: 4, bottom: 0};

export interface ChartContext {
    from: number;
    to: number;
    packageName: string;
    processNames: string[];
    hidden: Record<string, boolean>;
    events: PerfProcEvent[];
}

// 一个进程的一段曲线：pid 变化（重启）后用新的 key，曲线自然断开
interface Segment {
    key: string;
    name: string;
    pid: number;
}

const segmentKey = (name: string, pid: number) => `${name}#${pid}`;

function addSegment(segments: Map<string, Segment>, name: string, pid: number): string {
    const key = segmentKey(name, pid);
    if (!segments.has(key)) segments.set(key, {key, name, pid});
    return key;
}

// 采样中断（如设备断开、会话被替换）时插入空行，让曲线断开而不是横跨空白
function withGaps(rows: Record<string, any>[]): Record<string, any>[] {
    if (rows.length < 3) return rows;
    const deltas = rows.slice(1).map((row, i) => row.t - rows[i].t).sort((a, b) => a - b);
    const threshold = Math.max(3000, deltas[Math.floor(deltas.length / 2)] * 3);
    const result: Record<string, any>[] = [rows[0]];
    for (let i = 1; i < rows.length; i++) {
        if (rows[i].t - rows[i - 1].t > threshold) {
            result.push({t: (rows[i].t + rows[i - 1].t) / 2});
        }
        result.push(rows[i]);
    }
    return result;
}

const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800].map(s => s * 1000);

// 按时间范围统一取整点刻度，几张图的刻度位置保持一致
function timeTicks(from: number, to: number): number[] {
    const step = TICK_STEPS.find(s => (to - from) / s <= 7) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const ticks: number[] = [];
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
    return ticks;
}

function timeAxis(ctx: ChartContext) {
    return (
        <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[ctx.from, ctx.to]}
            ticks={timeTicks(ctx.from, ctx.to)}
            allowDataOverflow
            stroke="#ebebeb"
            tick={AXIS_TICK}
            tickLine={false}
            tickFormatter={formatTime}
        />
    );
}

// 进程事件在所有图上画竖线；返回元素数组，保证 ReferenceLine 是图表的直接子元素
function eventLines(ctx: ChartContext, yAxisId?: string) {
    return ctx.events
        .filter(e => e.timestamp >= ctx.from && e.timestamp <= ctx.to && !ctx.hidden[e.process])
        .map(e => (
            <ReferenceLine
                key={`ev-${e.id}`}
                x={e.timestamp}
                yAxisId={yAxisId}
                stroke={EVENT_META[e.kind]?.color ?? '#a1a1a1'}
                strokeDasharray="4 3"
                strokeWidth={1.25}
                ifOverflow="hidden"
                label={{value: EVENT_META[e.kind]?.label, position: 'insideTopLeft', fontSize: 10, fill: EVENT_META[e.kind]?.color}}
            />
        ));
}

interface TooltipEntry {
    dataKey?: string | number;
    name?: string;
    value?: number | null;
    color?: string;
    payload?: any;
}

interface ChartTooltipProps {
    active?: boolean;
    payload?: TooltipEntry[];
    label?: number;
    format: (value: number, entry: TooltipEntry) => string;
    extra?: (entry: TooltipEntry) => React.ReactNode;
    hint?: string;
}

const ChartTooltip: React.FC<ChartTooltipProps> = ({active, payload, label, format, extra, hint}) => {
    const entries = (payload ?? []).filter(e => e.value != null && !Number.isNaN(e.value));
    if (!active || entries.length === 0 || label == null) return null;
    return (
        <div
            className="pointer-events-none min-w-[220px] max-w-[360px] rounded-xl border border-[#ebebeb] bg-white p-3 text-[12.5px]"
            style={{boxShadow: PAGE_THEME.token.boxShadow}}
        >
            <div className="mb-2 flex items-baseline justify-between gap-4 border-b border-[#f2f2f2] pb-2">
                <span className={`${MONO} font-medium text-[#171717]`}>{formatTime(label)}</span>
                {hint && <span className="text-[11px] text-[#a1a1a1]">{hint}</span>}
            </div>
            <div className="space-y-1.5">
                {entries.map(entry => (
                    <div key={String(entry.dataKey)}>
                        <div className="flex items-center justify-between gap-5">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{backgroundColor: entry.color}}/>
                                <span className="truncate text-[#4d4d4d]">{entry.name}</span>
                            </div>
                            <span className={`${MONO} shrink-0 text-[#171717]`}>{format(entry.value as number, entry)}</span>
                        </div>
                        {extra?.(entry)}
                    </div>
                ))}
            </div>
        </div>
    );
};

const segmentLabel = (ctx: ChartContext, seg: Segment, segments: Segment[]) => {
    const short = shortProcessName(seg.name, ctx.packageName);
    // 同一进程有多段（重启过）时带上 pid 区分
    return segments.filter(s => s.name === seg.name).length > 1 ? `${short} (${seg.pid})` : short;
};

// ---------------------------------------------------------------- CPU

export const CpuChart: React.FC<{ ctx: ChartContext; samples: PerfSample[] }> = ({ctx, samples}) => {
    const {rows, segments} = useMemo(() => {
        const segs = new Map<string, Segment>();
        const rows = samples.map(sample => {
            const row: Record<string, any> = {t: sample.timestamp, device: sample.deviceCpu, threads: {}};
            for (const p of sample.processes) {
                if (ctx.hidden[p.name]) continue;
                const key = addSegment(segs, p.name, p.pid);
                row[key] = p.cpu;
                row.threads[key] = p.topThreads;
            }
            return row;
        });
        return {rows: withGaps(rows), segments: Array.from(segs.values())};
    }, [samples, ctx.hidden]);

    const threadList = (entry: TooltipEntry) => {
        const threads: PerfThread[] | null | undefined = entry.payload?.threads?.[entry.dataKey as string];
        if (!threads || threads.length === 0) return null;
        return (
            <div className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-[#f2f2f2] pl-2">
                {threads.slice(0, 3).map(t => (
                    <div key={t.tid} className="flex justify-between gap-4 text-[11.5px] text-[#8f8f8f]">
                        <span className="truncate font-mono">{t.name} <span className="text-[#c4c4c4]">{t.tid}</span></span>
                        <span className={MONO}>{t.cpu.toFixed(1)}%</span>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={CHART_MARGIN} syncId={SYNC_ID} syncMethod="value">
                <CartesianGrid stroke="#f2f2f2" vertical={false}/>
                {timeAxis(ctx)}
                <YAxis
                    yAxisId="proc"
                    stroke="#ebebeb"
                    axisLine={false}
                    tickLine={false}
                    width={52}
                    tick={AXIS_TICK}
                    domain={[0, (max: number) => Math.max(10, Math.ceil(max / 10) * 10)]}
                    tickFormatter={(v: number) => `${v}%`}
                />
                <YAxis
                    yAxisId="device"
                    orientation="right"
                    stroke="#ebebeb"
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tick={AXIS_TICK}
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                    cursor={{stroke: '#d4d4d4', strokeDasharray: '3 3'}}
                    content={<ChartTooltip format={(v) => formatPercent(v)} extra={threadList} hint="进程为单核口径"/>}
                />
                <Area
                    yAxisId="device"
                    dataKey="device"
                    name="整机 CPU（右轴）"
                    type="linear"
                    stroke="#c4c4c4"
                    fill="#f2f2f2"
                    strokeWidth={1}
                    isAnimationActive={false}
                />
                {segments.map(seg => (
                    <Line
                        key={seg.key}
                        yAxisId="proc"
                        dataKey={seg.key}
                        name={segmentLabel(ctx, seg, segments)}
                        type="linear"
                        stroke={processColor(ctx.processNames, seg.name)}
                        strokeWidth={seg.name === ctx.packageName ? 2 : 1.5}
                        dot={false}
                        isAnimationActive={false}
                    />
                ))}
                {eventLines(ctx, 'proc')}
            </ComposedChart>
        </ResponsiveContainer>
    );
};

// ---------------------------------------------------------------- 内存

export type MemoryMode = 'pss' | 'breakdown' | 'rss';

interface MemoryChartProps {
    ctx: ChartContext;
    mode: MemoryMode;
    samples: PerfSample[];
    memory: PerfMemorySample[];
    focusProcess: string;
    visibleRegions: Record<string, boolean>;
    onPick: (info: PerfMemInfo, sample: PerfMemorySample) => void;
}

export const MemoryChart: React.FC<MemoryChartProps> = ({ctx, mode, samples, memory, focusProcess, visibleRegions, onPick}) => {
    const {rows, lines} = useMemo(() => {
        const segs = new Map<string, Segment>();
        if (mode === 'rss') {
            const rows = samples.map(sample => {
                const row: Record<string, any> = {t: sample.timestamp};
                for (const p of sample.processes) {
                    if (ctx.hidden[p.name]) continue;
                    const key = addSegment(segs, p.name, p.pid);
                    row[`anon|${key}`] = p.rssAnon;
                    row[`swap|${key}`] = p.swap;
                }
                return row;
            });
            const segments = Array.from(segs.values());
            const lines = segments.flatMap(seg => [
                {key: `anon|${seg.key}`, name: `${segmentLabel(ctx, seg, segments)} 匿名内存`, color: processColor(ctx.processNames, seg.name), dashed: false, seg},
                {key: `swap|${seg.key}`, name: `${segmentLabel(ctx, seg, segments)} Swap`, color: processColor(ctx.processNames, seg.name), dashed: true, seg},
            ]);
            return {rows: withGaps(rows), lines};
        }

        if (mode === 'breakdown') {
            const rows = memory.map(sample => {
                const row: Record<string, any> = {t: sample.timestamp};
                const info = sample.processes.find(p => p.process === focusProcess);
                if (info) {
                    for (const region of MEMORY_REGIONS) {
                        row[`${region.key}|${info.pid}`] = info[region.key];
                    }
                    addSegment(segs, info.process, info.pid);
                }
                return row;
            });
            const segments = Array.from(segs.values());
            const lines = segments.flatMap(seg => MEMORY_REGIONS
                .filter(region => visibleRegions[region.key])
                .map(region => ({
                    key: `${region.key}|${seg.pid}`,
                    name: segments.length > 1 ? `${region.name} (${seg.pid})` : region.name,
                    color: region.color,
                    dashed: false,
                    seg,
                })));
            return {rows: withGaps(rows), lines};
        }

        const rows = memory.map(sample => {
            const row: Record<string, any> = {t: sample.timestamp};
            for (const p of sample.processes) {
                if (ctx.hidden[p.process]) continue;
                row[addSegment(segs, p.process, p.pid)] = p.totalPss;
            }
            return row;
        });
        const segments = Array.from(segs.values());
        const lines = segments.map(seg => ({
            key: seg.key,
            name: segmentLabel(ctx, seg, segments),
            color: processColor(ctx.processNames, seg.name),
            dashed: false,
            seg,
        }));
        return {rows: withGaps(rows), lines};
    }, [mode, samples, memory, focusProcess, visibleRegions, ctx.hidden, ctx.processNames, ctx.packageName]);

    // PSS 与分类明细的点可点击查看该时刻完整 meminfo
    const pickable = mode !== 'rss';
    const activeDot = (seg: Segment, color: string) => (props: any) => {
        const {cx, cy, payload} = props;
        if (cx == null || cy == null || !payload) return <g/>;
        return (
            <circle
                cx={cx}
                cy={cy}
                r={pickable ? 5.5 : 4}
                fill={color}
                stroke="#fff"
                strokeWidth={2}
                style={{cursor: pickable ? 'pointer' : 'default'}}
                onClick={(e) => {
                    if (!pickable) return;
                    e.stopPropagation();
                    const sample = memory.find(m => m.timestamp === payload.t);
                    const info = sample?.processes.find(p => p.pid === seg.pid && p.process === seg.name);
                    if (sample && info) onPick(info, sample);
                }}
            />
        );
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={CHART_MARGIN} syncId={SYNC_ID} syncMethod="value">
                <CartesianGrid stroke="#f2f2f2" vertical={false}/>
                {timeAxis(ctx)}
                <YAxis
                    stroke="#ebebeb"
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tick={AXIS_TICK}
                    tickFormatter={(v: number) => formatMemory(v)}
                />
                <Tooltip
                    cursor={{stroke: '#d4d4d4', strokeDasharray: '3 3'}}
                    content={<ChartTooltip format={(v) => formatMemory(v)} hint={pickable ? '点击圆点查看完整 meminfo' : undefined}/>}
                />
                {lines.map(line => (
                    <Line
                        key={line.key}
                        dataKey={line.key}
                        name={line.name}
                        type="monotone"
                        stroke={line.color}
                        strokeWidth={line.key.startsWith('totalPss') || (mode === 'pss' && line.seg.name === ctx.packageName) ? 2.25 : 1.5}
                        strokeDasharray={line.dashed ? '5 4' : undefined}
                        dot={false}
                        activeDot={activeDot(line.seg, line.color)}
                        isAnimationActive={false}
                    />
                ))}
                {eventLines(ctx)}
            </LineChart>
        </ResponsiveContainer>
    );
};

// ---------------------------------------------------------------- 频率与温度

export const FreqChart: React.FC<{ ctx: ChartContext; samples: PerfSample[]; memory: PerfMemorySample[] }> = ({ctx, samples, memory}) => {
    const {rows, clusters, maxFreq, throttleTemp} = useMemo(() => {
        // 温度采样频率低，取每个高频采样点之前最近的一次，悬停时频率与温度能同时显示
        const temps = memory.filter(m => m.thermal.cpuTemp > 0);
        let ti = -1;
        const rows: Record<string, any>[] = samples.map(sample => {
            while (ti + 1 < temps.length && temps[ti + 1].timestamp <= sample.timestamp) ti++;
            const row: Record<string, any> = {t: sample.timestamp, temp: ti >= 0 ? temps[ti].thermal.cpuTemp : null};
            for (const c of sample.clusters) row[`cl|${c.label}`] = Math.round(c.avgFreq / 1000);
            return row;
        });
        const throttleTemp = memory.reduce((v, m) => m.thermal.throttleTemp || v, 0);
        const gapped = withGaps(rows);
        const clusters = samples.length > 0 ? samples[samples.length - 1].clusters : [];
        const maxFreq = Math.max(0, ...clusters.map(c => c.maxFreq));
        return {rows: gapped, clusters, maxFreq, throttleTemp};
    }, [samples, memory]);

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={CHART_MARGIN} syncId={SYNC_ID} syncMethod="value">
                <CartesianGrid stroke="#f2f2f2" vertical={false}/>
                {timeAxis(ctx)}
                <YAxis
                    yAxisId="freq"
                    stroke="#ebebeb"
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tick={AXIS_TICK}
                    domain={[0, maxFreq > 0 ? Math.ceil(maxFreq / 1000 / 500) * 500 : 'auto']}
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(1)} GHz`}
                />
                <YAxis
                    yAxisId="temp"
                    orientation="right"
                    stroke="#ebebeb"
                    axisLine={false}
                    tickLine={false}
                    width={44}
                    tick={AXIS_TICK}
                    domain={[20, (max: number) => Math.max(60, Math.ceil(max / 10) * 10)]}
                    tickFormatter={(v: number) => `${v}°`}
                />
                <Tooltip
                    cursor={{stroke: '#d4d4d4', strokeDasharray: '3 3'}}
                    content={<ChartTooltip format={(v, e) => (e.dataKey === 'temp' ? `${v.toFixed(1)} °C` : `${v} MHz`)} hint="频率为区间平均值"/>}
                />
                {clusters.map(c => (
                    <ReferenceLine
                        key={`max-${c.label}`}
                        yAxisId="freq"
                        y={Math.round(c.maxFreq / 1000)}
                        stroke={clusterColor(c.label)}
                        strokeOpacity={0.35}
                        strokeDasharray="2 4"
                        ifOverflow="extendDomain"
                    />
                ))}
                {clusters.map(c => (
                    <Line
                        key={c.label}
                        yAxisId="freq"
                        dataKey={`cl|${c.label}`}
                        name={`${c.label} ${c.cpus.length > 1 ? `${c.cpus[0]}-${c.cpus[c.cpus.length - 1]}` : c.cpus[0]}`}
                        type="stepAfter"
                        stroke={clusterColor(c.label)}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                    />
                ))}
                <Line
                    yAxisId="temp"
                    dataKey="temp"
                    name="CPU 温度（右轴）"
                    type="stepAfter"
                    stroke={TEMP_COLOR}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                />
                {throttleTemp > 0 && (
                    <ReferenceLine
                        yAxisId="temp"
                        y={throttleTemp}
                        stroke={TEMP_COLOR}
                        strokeOpacity={0.5}
                        strokeDasharray="6 4"
                        ifOverflow="hidden"
                        label={{value: `降频阈值 ${throttleTemp}°C`, position: 'insideTopRight', fontSize: 10, fill: TEMP_COLOR}}
                    />
                )}
                {eventLines(ctx, 'freq')}
            </LineChart>
        </ResponsiveContainer>
    );
};

// ---------------------------------------------------------------- 每核网格（参考 aya 的每核小图）

export const CoreGrid: React.FC<{ samples: PerfSample[]; from: number; to: number }> = ({samples, from, to}) => {
    const latest = samples[samples.length - 1];
    const coreRows = useMemo(() => withGaps(samples.map(s => {
        const row: Record<string, any> = {t: s.timestamp};
        for (const core of s.cores) row[`c${core.cpu}`] = core.load;
        return row;
    })), [samples]);
    if (!latest) return null;

    const clusterOf = (cpu: number) => latest.clusters.find(c => c.cpus.includes(cpu));
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#ebebeb] bg-[#ebebeb] sm:grid-cols-4">
            {latest.cores.map(core => {
                const cluster = clusterOf(core.cpu);
                const color = cluster ? clusterColor(cluster.label) : '#0070f3';
                return (
                    <div key={core.cpu} className="bg-white px-3 pb-1 pt-2.5">
                        <div className="flex items-baseline justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{backgroundColor: color}}/>
                                <span className="font-mono text-[12px] font-medium text-[#171717]">CPU{core.cpu}</span>
                                {cluster && <span className="truncate text-[11px] text-[#a1a1a1]">{cluster.label}</span>}
                            </div>
                            <span className={`${MONO} text-[12px] text-[#171717]`}>{formatPercent(core.load, 0)}</span>
                        </div>
                        <div className={`${MONO} mt-0.5 text-[11px] text-[#8f8f8f]`}>{formatMHz(core.freq)}</div>
                        <div className="h-12">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={coreRows} margin={{top: 4, right: 0, left: 0, bottom: 0}}>
                                    <XAxis dataKey="t" type="number" domain={[from, to]} allowDataOverflow hide/>
                                    <YAxis domain={[0, 100]} hide/>
                                    <Area
                                        dataKey={`c${core.cpu}`}
                                        type="monotone"
                                        stroke={color}
                                        fill={color}
                                        fillOpacity={0.15}
                                        strokeWidth={1.25}
                                        isAnimationActive={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
