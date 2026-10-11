import React, {useCallback, useEffect, useRef, useState} from 'react';
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {Button, ConfigProvider, Input, message, Select} from 'antd';
import {
    CloseOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    ExportOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
} from '@ant-design/icons';
import {ExecuteAction, SaveFile, SaveFileAsCsv} from "../../wailsjs/go/main/App";
import {useDeviceStore} from "../store/deviceStore";

// 内存信息接口（与后端对应）
interface MemInfo {
    timestamp: number;
    javaHeap: number;
    nativeHeap: number;
    code: number;
    stack: number;
    graphics: number;
    privateOther: number;
    system: number;
    unknown: number;
    totalPss: number;
    rawMemInfo?: string;
}

// 图表数据点
interface MemoryDataPoint extends MemInfo {
    time: string;
}

interface MemoryRegion {
    key: keyof MemInfo;
    name: string;
    color: string;
}

const MEMORY_REGIONS: MemoryRegion[] = [
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

// 页面局部主题：近黑主色 + 细边框 + 6px 圆角
const PAGE_THEME = {
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

const MONO = 'font-mono tabular-nums';

const formatDuration = (ms: number): string => {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} 分钟`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小时`;
};

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({children}) => (
    <div className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[#8f8f8f]">
        {children}
    </div>
);

const STORAGE_KEY_PROCESS_NAME = 'memory_monitor_process_name';

const formatMemory = (value: number): string => {
    const MB = 1024;
    const GB = 1024 * 1024;
    if (value >= GB) return `${(value / GB).toFixed(1)} GB`;
    if (value >= MB) return `${(value / MB).toFixed(1)} MB`;
    return `${value.toFixed(0)} KB`;
};

const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
};

// 生成 CSV 内容（Excel 兼容）
const generateCSV = (data: MemoryDataPoint[], packageName: string): string => {
    // BOM 头，确保 Excel 正确识别 UTF-8
    const BOM = '\uFEFF';

    // CSV 单元格转义函数
    const escapeCSVCell = (value: string | number | undefined): string => {
        if (value === undefined || value === null) {
            return '';
        }
        const str = String(value);
        // 如果包含逗号、双引号、换行符，需要用双引号包裹，并将内部双引号转义
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    // 表头
    const headers = [
        '时间',
        'Total PSS (KB)',
        'Java Heap (KB)',
        'Native Heap (KB)',
        'Code (KB)',
        'Stack (KB)',
        'Graphics (KB)',
        'Private Other (KB)',
        'System (KB)',
        'Unknown (KB)',
        '简要信息',
        'Raw Memory Info'
    ];

    // 生成每行数据
    const rows = data.map((point) => {
        const summary = `Total:${formatMemory(point.totalPss)} Java:${formatMemory(point.javaHeap)} Native:${formatMemory(point.nativeHeap)}`;

        return [
            point.time,
            point.totalPss,
            point.javaHeap,
            point.nativeHeap,
            point.code,
            point.stack,
            point.graphics,
            point.privateOther,
            point.system,
            point.unknown,
            summary,
            point.rawMemInfo
        ].map(escapeCSVCell).join(',');
    });

    // 添加元信息行
    const metaInfo = [
        `# 包名: ${packageName}`,
        `# 导出时间: ${new Date().toLocaleString('zh-CN')}`,
        `# 数据点数量: ${data.length}`,
        ''
    ];

    return BOM + metaInfo.join('\n') + headers.join(',') + '\n' + rows.join('\n');
};

// 简化的 Tooltip
const SimpleTooltip: React.FC<{
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: string;
}> = ({active, payload, label}) => {
    if (!active || !payload || payload.length === 0) {
        return null;
    }

    return (
        <div
            className="pointer-events-none min-w-[200px] rounded-xl border border-[#ebebeb] bg-white p-3 text-[13px]"
            style={{boxShadow: PAGE_THEME.token.boxShadow}}
        >
            <div className="mb-2 flex items-baseline justify-between gap-4 border-b border-[#f2f2f2] pb-2">
                <span className={`${MONO} font-medium text-[#171717]`}>{label}</span>
                <span className="text-[11px] text-[#a1a1a1]">点击圆点查看详情</span>
            </div>
            <div className="space-y-1.5">
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center justify-between gap-6">
                        <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{backgroundColor: entry.color}}/>
                            <span className="text-[#4d4d4d]">{entry.name}</span>
                        </div>
                        <span className={`${MONO} text-[#171717]`}>{formatMemory(entry.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// 详情面板组件
interface DetailPanelProps {
    dataPoint: MemoryDataPoint | null;
    visible: boolean;
    onClose: () => void;
    onExport: (data: MemoryDataPoint) => void;
    onCopy: (data: MemoryDataPoint) => void;
}

const DetailPanel: React.FC<DetailPanelProps> = ({dataPoint, visible, onClose, onExport, onCopy}) => {
    if (!visible || !dataPoint) return null;

    return (
        <div
            className="absolute right-4 top-14 z-50 w-80 rounded-xl border border-[#ebebeb] bg-white"
            style={{boxShadow: PAGE_THEME.token.boxShadow}}
        >
            <div className="flex items-start justify-between border-b border-[#f2f2f2] px-4 py-3">
                <div>
                    <Eyebrow>Snapshot</Eyebrow>
                    <div className={`${MONO} mt-0.5 text-[15px] font-semibold text-[#171717]`}>{dataPoint.time}</div>
                </div>
                <Button type="text" size="small" icon={<CloseOutlined/>} onClick={onClose}/>
            </div>

            <div className="max-h-52 space-y-2 overflow-y-auto px-4 py-3">
                {MEMORY_REGIONS.map((region) => (
                    <div key={region.key} className="flex items-center justify-between text-[13px]">
                        <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{backgroundColor: region.color}}/>
                            <span className={region.key === 'totalPss' ? 'font-medium text-[#171717]' : 'text-[#4d4d4d]'}>
                                {region.name}
                            </span>
                        </div>
                        <span className={`${MONO} text-[#171717]`}>
                            {formatMemory(dataPoint[region.key] as number)}
                        </span>
                    </div>
                ))}
            </div>

            <div className="flex gap-2 border-t border-[#f2f2f2] px-4 py-3">
                <Button icon={<CopyOutlined/>} onClick={() => onCopy(dataPoint)} className="flex-1">
                    复制
                </Button>
                <Button type="primary" icon={<DownloadOutlined/>} onClick={() => onExport(dataPoint)} className="flex-1">
                    导出
                </Button>
            </div>
        </div>
    );
};

const MemoryMonitor: React.FC = () => {
    const [data, setData] = useState<MemoryDataPoint[]>([]);
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [intervalTime, setIntervalTime] = useState<number>(1000);
    const [processName, setProcessName] = useState<string>(() => {
        try {
            return localStorage.getItem(STORAGE_KEY_PROCESS_NAME) || '';
        } catch {
            return '';
        }
    });
    const [visibleRegions, setVisibleRegions] = useState<Record<string, boolean>>(
        MEMORY_REGIONS.reduce((acc, region) => ({...acc, [region.key]: true}), {})
    );
    const [maxDataPoints, setMaxDataPoints] = useState<number>(60);
    const [selectedDataPoint, setSelectedDataPoint] = useState<MemoryDataPoint | null>(null);
    const [showDetailPanel, setShowDetailPanel] = useState<boolean>(false);
    const [viewWindow] = useState<number>(300); // 固定显示窗口大小
    const [scrollPosition, setScrollPosition] = useState<number>(0);
    const [autoScroll, setAutoScroll] = useState<boolean>(true);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const {selectedDevice} = useDeviceStore();

    // 当 processName 变化时保存到 localStorage
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY_PROCESS_NAME, processName);
        } catch (e) {
            console.warn('Failed to save package name to localStorage:', e);
        }
    }, [processName]);

    const fetchMemoryData = useCallback(async () => {
        try {
            if (selectedDevice?.id == null) {
                return;
            }
            const result = await ExecuteAction({
                action: 'format-sys-info',
                targetPackageName: processName,
                deviceId: selectedDevice.id,
            });

            if (result && !result.error) {
                const memInfo: MemInfo = JSON.parse(result.res);

                const newDataPoint: MemoryDataPoint = {
                    ...memInfo,
                    time: formatTime(memInfo.timestamp || Date.now()),
                    timestamp: memInfo.timestamp || Date.now(),
                    rawMemInfo: memInfo.rawMemInfo,
                };

                setData((prevData) => {
                    const updated = [...prevData, newDataPoint];
                    if (updated.length > maxDataPoints) {
                        return updated.slice(-maxDataPoints);
                    }
                    return updated;
                });
            }
        } catch (error) {
            console.error('获取内存数据失败:', error);
            message.error('获取内存数据失败');
        }
    }, [processName, maxDataPoints, selectedDevice?.id]);

    useEffect(() => {
        if (isRunning) {
            fetchMemoryData();
            timerRef.current = setInterval(fetchMemoryData, intervalTime);
        }
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isRunning, intervalTime, fetchMemoryData]);

    const handleStart = async () => {
        if (selectedDevice?.id == null) {
            message.error('请连接设备');
            return;
        }
        if (!processName) {
            message.error("请输入应用包名");
            return;
        }
        const result = await ExecuteAction({
            action: 'dump-pid',
            targetPackageName: processName,
            deviceId: selectedDevice.id,
        });

        if (result.error) {
            message.error(result.error);
            return;
        }

        setIsRunning(true);
    };

    const handleStop = () => {
        setIsRunning(false);
    };

    const toggleRegion = (key: string): void => {
        setVisibleRegions((prev) => ({...prev, [key]: !prev[key]}));
    };

    const clearData = (): void => {
        setData([]);
        setSelectedDataPoint(null);
        setShowDetailPanel(false);
        setScrollPosition(0);
        setAutoScroll(true);
    };

    // 导出全部数据为 CSV
    const handleExportAll = async () => {
        if (data.length === 0) {
            message.warning('没有可导出的数据');
            return;
        }

        const csvContent = generateCSV(data, processName);
        const fileName = `memory_${processName}`;

        try {
            await SaveFileAsCsv(csvContent, fileName);
            message.success(`成功导出 ${data.length} 条数据`);
        } catch (error) {
            console.error('导出失败:', error);
            message.error('导出失败' + error);
        }
    };

    // 点击数据点的处理
    const handleDotClick = useCallback((dataPoint: MemoryDataPoint) => {
        setSelectedDataPoint(dataPoint);
        setShowDetailPanel(true);
    }, []);

    const handleCopyDataPoint = (dataPoint: MemoryDataPoint) => {
        if (dataPoint.rawMemInfo != null) {
            navigator.clipboard.writeText(dataPoint.rawMemInfo);
            message.success('已复制到剪贴板');
        }
    };

    const handleExportDataPoint = async (dataPoint: MemoryDataPoint) => {
        if (dataPoint.rawMemInfo != null) {
            await SaveFile(dataPoint.rawMemInfo, "memory_info");
        }
    };

    // 原生滚动条处理
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const target = e.target as HTMLDivElement;
        const maxScrollLeft = target.scrollWidth - target.clientWidth;
        const currentScroll = target.scrollLeft;

        // 计算对应的数据索引
        const maxIndex = Math.max(0, data.length - viewWindow);
        const newPosition = maxScrollLeft > 0
            ? Math.round((currentScroll / maxScrollLeft) * maxIndex)
            : 0;

        setScrollPosition(newPosition);

        // 检查是否滚动到最右边（允许2px误差）
        if (currentScroll >= maxScrollLeft - 2) {
            setAutoScroll(true);
        } else {
            setAutoScroll(false);
        }
    }, [data.length, viewWindow]);

    // 自动滚动到最新
    useEffect(() => {
        if (autoScroll && scrollRef.current && data.length > viewWindow) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [autoScroll, data.length, viewWindow]);

    // 计算显示的数据切片
    const displayData = data.length <= viewWindow
        ? data
        : data.slice(scrollPosition, scrollPosition + viewWindow);

    // 滚动条内容宽度（模拟数据量）
    const scrollContentWidth = data.length > viewWindow
        ? `${(data.length / viewWindow) * 100}%`
        : '100%';

    const latestData: Partial<MemoryDataPoint> = data[data.length - 1] || {};

    // 创建自定义 activeDot 渲染函数，使用对应线条的颜色
    const createActiveDot = useCallback(
        (color: string) => {
            return (props: any) => {
                const {cx, cy, payload} = props;
                if (cx === undefined || cy === undefined || !payload) return null;

                return (
                    <circle
                        cx={cx}
                        cy={cy}
                        r={6}
                        fill={color}
                        stroke="#fff"
                        strokeWidth={2}
                        style={{cursor: 'pointer'}}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDotClick(payload);
                        }}
                    />
                );
            };
        },
        [handleDotClick]
    );

    const totalRegion = MEMORY_REGIONS.find((region) => region.key === 'totalPss')!;
    const subRegions = MEMORY_REGIONS.filter((region) => region.key !== 'totalPss');
    const regionValue = (key: keyof MemInfo): string => latestData[key as keyof MemoryDataPoint] !== undefined
        ? formatMemory(latestData[key as keyof MemoryDataPoint] as number)
        : '--';

    return (
        <ConfigProvider theme={PAGE_THEME}>
            <div className="h-full flex-1 overflow-y-auto bg-[#fafafa] px-8 py-7 text-left text-[#171717]">
                <div className="mx-auto flex max-w-7xl flex-col gap-5">
                    {/* 头部 */}
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
                        <div>
                            <Eyebrow>Memory · dumpsys meminfo</Eyebrow>
                            <h1 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.4px] text-[#171717]">
                                内存监控
                            </h1>
                            <p className="mt-1 text-[13px] text-[#8f8f8f]">实时采集应用内存各区域变化</p>
                        </div>

                        <div className="flex items-center gap-2">
                            {!isRunning ? (
                                <Button type="primary" icon={<PlayCircleOutlined/>} onClick={handleStart}>
                                    开始
                                </Button>
                            ) : (
                                <Button danger icon={<PauseCircleOutlined/>} onClick={handleStop}>
                                    暂停
                                </Button>
                            )}
                            <Button icon={<DeleteOutlined/>} onClick={clearData}>
                                清除
                            </Button>
                            <Button
                                icon={<ExportOutlined/>}
                                onClick={handleExportAll}
                                disabled={isRunning || data.length === 0}
                                title={isRunning ? '请先暂停采集' : '导出全部数据为 CSV'}
                            >
                                导出 CSV
                            </Button>
                        </div>
                    </div>

                    {/* 设置面板 */}
                    <div className="rounded-xl border border-[#ebebeb] bg-white p-5">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
                            <div>
                                <label className="mb-1.5 block text-[13px] font-medium text-[#4d4d4d]">进程名</label>
                                <Input
                                    value={processName}
                                    onChange={(e) => setProcessName(e.target.value)}
                                    placeholder="com.example.app"
                                    disabled={isRunning}
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="font-mono"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-[13px] font-medium text-[#4d4d4d]">采集间隔</label>
                                <Select
                                    value={intervalTime}
                                    onChange={(value) => setIntervalTime(value)}
                                    className="w-full"
                                    disabled={isRunning}
                                    options={[
                                        {value: 1000, label: '1秒'},
                                        {value: 2000, label: '2秒'},
                                        {value: 5000, label: '5秒'},
                                    ]}
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-[#4d4d4d]">
                                    <span>数据点数</span>
                                    <span className="text-[12px] font-normal text-[#a1a1a1]">
                                        监控时长 ≈ {formatDuration(maxDataPoints * intervalTime)}
                                    </span>
                                </label>
                                <Select
                                    value={maxDataPoints}
                                    disabled={isRunning}
                                    onChange={(value) => setMaxDataPoints(value)}
                                    className="w-full"
                                    options={[
                                        {value: 30, label: '30 点'},
                                        {value: 60, label: '60 点'},
                                        {value: 120, label: '120 点'},
                                        {value: 300, label: '300 点'},
                                        {value: 900, label: '900 点'},
                                    ]}
                                />
                            </div>
                        </div>
                    </div>

                    {/* 当前内存状态：点击切换曲线显示 */}
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_3fr]">
                        <button
                            onClick={() => toggleRegion(totalRegion.key)}
                            className={`flex flex-col justify-between rounded-xl border bg-white p-5 text-left transition-all hover:border-[#d4d4d4] ${
                                visibleRegions[totalRegion.key] ? 'border-[#ebebeb]' : 'border-dashed border-[#ebebeb] opacity-45'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <Eyebrow>{totalRegion.name}</Eyebrow>
                                <span
                                    className="h-2 w-2 rounded-full"
                                    style={{backgroundColor: visibleRegions[totalRegion.key] ? totalRegion.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${totalRegion.color}`}}
                                />
                            </div>
                            <div className={`${MONO} mt-4 text-[32px] font-semibold leading-10 tracking-[-1px] text-[#171717]`}>
                                {regionValue(totalRegion.key)}
                            </div>
                            <div className="mt-1 truncate font-mono text-[12px] text-[#a1a1a1]">
                                {processName || '<package>'}
                            </div>
                        </button>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {subRegions.map((region) => (
                                <button
                                    key={region.key}
                                    onClick={() => toggleRegion(region.key)}
                                    className={`rounded-xl border bg-white px-4 py-3 text-left transition-all hover:border-[#d4d4d4] ${
                                        visibleRegions[region.key] ? 'border-[#ebebeb]' : 'border-dashed border-[#ebebeb] opacity-45'
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{backgroundColor: visibleRegions[region.key] ? region.color : 'transparent', boxShadow: `inset 0 0 0 1.5px ${region.color}`}}
                                        />
                                        <span className="truncate text-[12px] text-[#8f8f8f]">{region.name}</span>
                                    </div>
                                    <div className={`${MONO} mt-1.5 truncate text-[17px] font-semibold text-[#171717]`}>
                                        {regionValue(region.key)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 图表区域 */}
                    <div className="relative rounded-xl border border-[#ebebeb] bg-white">
                        <div className="flex items-center justify-between border-b border-[#f2f2f2] px-5 py-3.5">
                            <div>
                                <Eyebrow>Trend</Eyebrow>
                                <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.2px] text-[#171717]">内存变化趋势</h2>
                            </div>
                            <div className="flex items-center gap-2">
                                {!autoScroll && data.length > viewWindow && (
                                    <span className="rounded-full bg-[#ffefcf] px-2.5 py-0.5 text-[12px] text-[#ab570a]">
                                        查看历史
                                    </span>
                                )}
                                <span className="flex items-center gap-1.5 rounded-full border border-[#ebebeb] px-2.5 py-0.5 text-[12px] text-[#4d4d4d]">
                                    <span className={`h-1.5 w-1.5 rounded-full ${isRunning ? 'animate-pulse bg-[#0070f3]' : 'bg-[#a1a1a1]'}`}/>
                                    {isRunning ? '采集中' : '已暂停'}
                                </span>
                                <span className={`${MONO} rounded-full border border-[#ebebeb] px-2.5 py-0.5 text-[12px] text-[#4d4d4d]`}>
                                    {data.length} / {maxDataPoints}
                                </span>
                            </div>
                        </div>

                        {/* 详情面板 */}
                        <DetailPanel
                            dataPoint={selectedDataPoint}
                            visible={showDetailPanel}
                            onClose={() => setShowDetailPanel(false)}
                            onExport={handleExportDataPoint}
                            onCopy={handleCopyDataPoint}
                        />

                        <div className="h-80 px-3 pb-2 pt-4">
                            {data.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={displayData} margin={{top: 8, right: 28, left: 8, bottom: 0}}>
                                        <CartesianGrid stroke="#f2f2f2" vertical={false}/>
                                        <XAxis
                                            dataKey="time"
                                            stroke="#ebebeb"
                                            tick={{fontSize: 11, fill: '#8f8f8f', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'}}
                                            tickLine={false}
                                            interval="preserveStartEnd"
                                        />
                                        <YAxis
                                            stroke="#ebebeb"
                                            axisLine={false}
                                            tickLine={false}
                                            width={80}
                                            tick={{fontSize: 11, fill: '#8f8f8f', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'}}
                                            tickFormatter={(value: number) => formatMemory(value)}
                                        />
                                        <Tooltip content={<SimpleTooltip/>} cursor={{stroke: '#d4d4d4', strokeDasharray: '3 3'}}/>
                                        <Legend
                                            iconType="circle"
                                            iconSize={7}
                                            wrapperStyle={{fontSize: 12, color: '#4d4d4d', paddingTop: 8}}
                                        />
                                        {MEMORY_REGIONS.map(
                                            (region) =>
                                                visibleRegions[region.key] && (
                                                    <Line
                                                        key={region.key}
                                                        type="monotone"
                                                        dataKey={region.key}
                                                        name={region.name}
                                                        stroke={region.color}
                                                        strokeWidth={region.key === 'totalPss' ? 2.25 : 1.5}
                                                        dot={false}
                                                        activeDot={createActiveDot(region.color)}
                                                        isAnimationActive={false}
                                                    />
                                                )
                                        )}
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#ebebeb] text-[#8f8f8f]">
                                        <PlayCircleOutlined/>
                                    </div>
                                    <p className="text-[14px] text-[#4d4d4d]">点击「开始」采集内存数据</p>
                                    <code className="rounded-md border border-[#ebebeb] bg-[#fafafa] px-3 py-1.5 font-mono text-[12px] text-[#4d4d4d]">
                                        <span className="text-[#a1a1a1]">$ </span>
                                        adb shell dumpsys meminfo {processName || '<package>'}
                                    </code>
                                </div>
                            )}
                        </div>

                        {/* 时间轴滚动条 */}
                        {data.length > viewWindow && (
                            <div className="px-5 pb-4">
                                <div className="mb-1 flex items-center justify-between">
                                    <span className={`${MONO} text-[11px] text-[#a1a1a1]`}>{data[0]?.time}</span>
                                    <span className={`${MONO} text-[11px] text-[#a1a1a1]`}>{data[data.length - 1]?.time}</span>
                                </div>
                                <div
                                    ref={scrollRef}
                                    className="h-3 overflow-x-auto rounded-full bg-[#f2f2f2]"
                                    onScroll={handleScroll}
                                    style={{
                                        scrollbarWidth: 'thin',
                                        scrollbarColor: '#171717 #f2f2f2'
                                    }}
                                >
                                    <div style={{width: scrollContentWidth, height: '1px'}}/>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 底部说明 */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[#8f8f8f]">
                        <span>· 数据来源 <code className="font-mono text-[#4d4d4d]">dumpsys meminfo</code></span>
                        <span>· 点击上方卡片显示 / 隐藏对应曲线</span>
                        <span>· 悬浮图表后点击圆点可导出该时刻完整数据</span>
                        <span>· 暂停后可导出全部数据为 CSV</span>
                    </div>
                </div>
            </div>
        </ConfigProvider>
    );
};

export default MemoryMonitor;