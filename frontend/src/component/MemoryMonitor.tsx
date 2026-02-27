import React, {useCallback, useEffect, useRef, useState} from 'react';
import {CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import {Button, Input, message, Select} from 'antd';
import {
    CloseOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    ExportOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    SettingOutlined,
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
    {key: 'javaHeap', name: 'Java Heap', color: '#f97316'},
    {key: 'nativeHeap', name: 'Native Heap', color: '#ef4444'},
    {key: 'code', name: 'Code', color: '#8b5cf6'},
    {key: 'stack', name: 'Stack', color: '#ec4899'},
    {key: 'graphics', name: 'Graphics', color: '#6366f1'},
    {key: 'privateOther', name: 'Private Other', color: '#14b8a6'},
    {key: 'system', name: 'System', color: '#22c55e'},
    {key: 'unknown', name: 'Unknown', color: '#64748b'},
    {key: 'totalPss', name: 'Total PSS', color: '#eab308'},
];

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
        <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-sm pointer-events-none">
            <p className="text-gray-800 font-semibold mb-2 pb-1 border-b border-gray-100">
                {label}
                <span className="text-xs text-gray-400 ml-2">点击圆点查看详情</span>
            </p>
            <div className="space-y-1">
                {payload.map((entry, index) => (
                    <div key={index} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <span
                                className="w-2 h-2 rounded-full"
                                style={{backgroundColor: entry.color}}
                            />
                            <span className="text-gray-600">{entry.name}</span>
                        </div>
                        <span className="text-gray-800 font-mono font-medium">
                            {formatMemory(entry.value)}
                        </span>
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
        <div className="absolute top-4 right-4 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <div>
                    <h3 className="font-semibold text-gray-800">内存详情</h3>
                    <p className="text-sm text-gray-500">{dataPoint.time}</p>
                </div>
                <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined/>}
                    onClick={onClose}
                />
            </div>

            <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {MEMORY_REGIONS.map((region) => (
                    <div key={region.key} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span
                                className="w-3 h-3 rounded-full"
                                style={{backgroundColor: region.color}}
                            />
                            <span className="text-gray-600 text-sm">{region.name}</span>
                        </div>
                        <span className="text-gray-800 font-mono font-medium text-sm">
                            {formatMemory(dataPoint[region.key] as number)}
                        </span>
                    </div>
                ))}
            </div>

            <div className="flex gap-2 p-4 border-t border-gray-100">
                <Button
                    icon={<CopyOutlined/>}
                    onClick={() => onCopy(dataPoint)}
                    className="flex-1"
                >
                    复制
                </Button>
                <Button
                    type="primary"
                    icon={<DownloadOutlined/>}
                    onClick={() => onExport(dataPoint)}
                    className="flex-1"
                >
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

    return (
        <div className="flex-1 h-full overflow-y-auto bg-gray-50 text-gray-800 p-4">
            <div className="max-w-7xl mx-auto">
                {/* 头部 */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <span className="text-blue-600 text-xl">📊</span>
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800">Android 内存监控</h1>
                            <p className="text-gray-500 text-sm">实时采集应用内存各区域变化</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isRunning ? (
                            <Button
                                type="primary"
                                icon={<PlayCircleOutlined/>}
                                onClick={handleStart}
                                style={{backgroundColor: '#22c55e', borderColor: '#22c55e'}}
                            >
                                开始
                            </Button>
                        ) : (
                            <Button
                                danger
                                icon={<PauseCircleOutlined/>}
                                onClick={handleStop}
                            >
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
                <div className="bg-white rounded-xl p-4 mb-6 border border-gray-200 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <SettingOutlined className="text-blue-500"/>
                        <h3 className="font-semibold text-gray-700">采集设置</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm text-gray-500 mb-1">进程名</label>
                            <Input
                                value={processName}
                                onChange={(e) => setProcessName(e.target.value)}
                                placeholder="com.example.app"
                                disabled={isRunning}
                                autoCapitalize="off"
                                autoCorrect="off"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                        <div>
                            <label className="block text-sm text-gray-500 mb-1">采集间隔</label>
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
                            <label className="block text-sm text-gray-500 mb-1">采集数据个数（数据点数 × 采集间隔 = 监控时长）</label>
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

                {/* 当前内存状态卡片 */}
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-6">
                    {MEMORY_REGIONS.map((region) => (
                        <button
                            key={region.key}
                            onClick={() => toggleRegion(region.key)}
                            className={`p-3 rounded-xl transition-all bg-white border-2 shadow-sm hover:shadow-md ${
                                visibleRegions[region.key] ? 'opacity-100' : 'opacity-40'
                            }`}
                            style={{
                                borderColor: visibleRegions[region.key] ? region.color : '#e5e7eb',
                            }}
                        >
                            <div
                                className="w-3 h-3 rounded-full mb-2"
                                style={{backgroundColor: region.color}}
                            />
                            <div className="text-xs text-gray-500 truncate">{region.name}</div>
                            <div className="text-sm font-semibold text-gray-800 truncate">
                                {latestData[region.key as keyof MemoryDataPoint] !== undefined
                                    ? formatMemory(latestData[region.key as keyof MemoryDataPoint] as number)
                                    : '--'}
                            </div>
                        </button>
                    ))}
                </div>

                {/* 图表区域 */}
                <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm relative">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-blue-500 text-lg">📈</span>
                            <h2 className="text-lg font-semibold text-gray-700">内存变化趋势</h2>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                                }`}
                            />
                            <span>{isRunning ? '采集中...' : '已暂停'}</span>
                            <span className="ml-2 text-gray-400">
                                {data.length}/{maxDataPoints}
                            </span>
                            {!autoScroll && data.length > viewWindow && (
                                <span className="ml-2 text-orange-500 text-xs">
                                    (查看历史)
                                </span>
                            )}
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

                    <div className="h-80">
                        {data.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={displayData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                                    <XAxis
                                        dataKey="time"
                                        stroke="#9ca3af"
                                        tick={{fontSize: 12}}
                                        interval="preserveStartEnd"
                                    />
                                    <YAxis
                                        stroke="#9ca3af"
                                        tick={{fontSize: 12}}
                                        tickFormatter={(value: number) => formatMemory(value)}
                                    />
                                    <Tooltip content={<SimpleTooltip/>}/>
                                    <Legend/>
                                    {MEMORY_REGIONS.map(
                                        (region) =>
                                            visibleRegions[region.key] && (
                                                <Line
                                                    key={region.key}
                                                    type="monotone"
                                                    dataKey={region.key}
                                                    name={region.name}
                                                    stroke={region.color}
                                                    strokeWidth={2}
                                                    dot={false}
                                                    activeDot={createActiveDot(region.color)}
                                                    isAnimationActive={false}
                                                />
                                            )
                                    )}
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400">
                                <div className="text-center">
                                    <div className="text-5xl mb-3 opacity-50">💾</div>
                                    <p>点击"开始"按钮开始采集内存数据</p>
                                    <p className="text-sm mt-2 font-mono bg-gray-100 px-3 py-1 rounded inline-block text-gray-600">
                                        adb shell dumpsys meminfo {processName || '<package>'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 时间轴滚动条 */}
                    {data.length > viewWindow && (
                        <div className="mt-4">
                            <div className="flex items-center gap-3 px-2 mb-1">
                                <span className="text-xs text-gray-400">
                                    {data[0]?.time}
                                </span>
                                <span className="flex-1"/>
                                <span className="text-xs text-gray-400">
                                    {data[data.length - 1]?.time}
                                </span>
                            </div>
                            <div
                                ref={scrollRef}
                                className="overflow-x-auto h-3 bg-gray-100 rounded"
                                onScroll={handleScroll}
                                style={{
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#6366f1 #e5e7eb'
                                }}
                            >
                                <div style={{width: scrollContentWidth, height: '1px'}}/>
                            </div>
                        </div>
                    )}
                </div>

                {/* 底部说明 */}
                <div className="mt-4 text-sm text-gray-400 text-center">
                    <p>
                        ℹ️ 数据通过 adb shell dumpsys meminfo 命令采集 | 点击上方内存区域卡片可显示/隐藏对应曲线 |
                        悬浮图表后点击圆点可导出该时刻的完整数据 | 暂停后可导出全部数据为 CSV
                    </p>
                </div>
            </div>
        </div>
    );
};

export default MemoryMonitor;