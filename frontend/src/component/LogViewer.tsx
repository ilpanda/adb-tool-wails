import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Button, Empty, Input, Popconfirm, Segmented, Select, Spin, Tooltip, message} from 'antd';
import {
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    FolderOpenOutlined,
    ReloadOutlined,
    SearchOutlined,
} from '@ant-design/icons';
import {
    ClearLogFile,
    ExportLogs,
    GetLogStatus,
    ListLogFiles,
    OpenLogDirectory,
    ReadLogChunk
} from "../../wailsjs/go/main/App";
import {applog, types} from "../../wailsjs/go/models";
import PageHeader from "./PageHeader";

const CHUNK_BYTES = 256 * 1024;
const MAX_RENDER_LINES = 3000;

type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
type LevelFilter = 'all' | Level;

const LEVEL_OPTIONS: Array<{value: LevelFilter; label: string}> = [
    {value: 'all', label: '全部'},
    {value: 'ERROR', label: 'Error'},
    {value: 'WARN', label: 'Warn'},
    {value: 'INFO', label: 'Info'},
    {value: 'DEBUG', label: 'Debug'},
];

interface ParsedLine {
    raw: string;
    time?: string;
    level?: Level;
    category?: string;
    message: string;
}

// 匹配 applog 输出：2026/10/19 12:22:55.782153 [INFO] [pid=42437] [ACTION] message
const LINE_PATTERN = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})(?:\.\d+)?\s+\[(ERROR|WARN|INFO|DEBUG)]\s+(?:\[pid=\d+]\s+)?(?:\[([A-Z_]+)]\s?)?(.*)$/;

function parseLine(raw: string): ParsedLine {
    const match = raw.match(LINE_PATTERN);
    if (!match) {
        return {raw, message: raw};
    }
    const [, time, level, category, rest] = match;
    return {raw, time: time.slice(5), level: level as Level, category, message: rest};
}

function LogViewer() {
    const [status, setStatus] = useState<applog.StatusDTO | null>(null);
    const [files, setFiles] = useState<applog.FileDTO[]>([]);
    const [selectedFile, setSelectedFile] = useState('');
    const [content, setContent] = useState('');
    const [nextCursor, setNextCursor] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
    const [errorText, setErrorText] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    // 读取最新内容后滚到底部；加载更早内容后保持当前阅读位置
    const scrollIntent = useRef<{type: 'bottom'} | {type: 'keep'; height: number} | null>(null);

    useEffect(() => {
        void initialize();
    }, []);

    const initialize = async () => {
        setLoading(true);
        setErrorText('');
        try {
            const [nextStatus, nextFiles] = await Promise.all([
                GetLogStatus(),
                ListLogFiles(),
            ]);

            setStatus(nextStatus);
            setFiles(nextFiles);

            const defaultFile = nextFiles.find(file => file.name === selectedFile)?.name
                ?? nextFiles.find(file => file.isCurrent)?.name
                ?? nextFiles[0]?.name
                ?? '';
            setSelectedFile(defaultFile);

            if (defaultFile) {
                await loadLatest(defaultFile);
            } else {
                setContent('');
                setHasMore(false);
                setNextCursor(0);
            }
        } catch (error) {
            console.error(error);
            setErrorText('加载日志信息失败');
        } finally {
            setLoading(false);
        }
    };

    const loadLatest = async (fileName: string) => {
        if (!fileName) {
            return;
        }

        setLoading(true);
        setErrorText('');
        try {
            const chunk = await ReadLogChunk(fileName, 0, CHUNK_BYTES);
            scrollIntent.current = {type: 'bottom'};
            applyChunk(chunk, false);
            setSelectedFile(fileName);
        } catch (error) {
            console.error(error);
            setErrorText('读取日志失败');
        } finally {
            setLoading(false);
        }
    };

    const loadOlder = async () => {
        if (!selectedFile || !hasMore || loadingOlder) {
            return;
        }

        setLoadingOlder(true);
        setErrorText('');
        try {
            const chunk = await ReadLogChunk(selectedFile, nextCursor, CHUNK_BYTES);
            scrollIntent.current = {type: 'keep', height: scrollRef.current?.scrollHeight ?? 0};
            applyChunk(chunk, true);
        } catch (error) {
            console.error(error);
            setErrorText('读取更早日志失败');
        } finally {
            setLoadingOlder(false);
        }
    };

    const applyChunk = (chunk: applog.ChunkDTO, prepend: boolean) => {
        setContent(prev => {
            if (!prepend) {
                return chunk.content;
            }
            if (!prev) {
                return chunk.content;
            }
            if (!chunk.content) {
                return prev;
            }
            return `${chunk.content}${prev}`;
        });
        setNextCursor(chunk.nextCursor);
        setHasMore(chunk.hasMore);
    };

    const allLines = useMemo(() => {
        if (!content) {
            return [];
        }
        return content
            .split(/\r?\n/)
            .filter((line, index, arr) => !(index === arr.length - 1 && line === ''))
            .map(parseLine);
    }, [content]);

    const levelCounts = useMemo(() => {
        const counts: Record<Level, number> = {ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0};
        allLines.forEach(line => {
            if (line.level) counts[line.level] += 1;
        });
        return counts;
    }, [allLines]);

    const filteredLines = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        return allLines.filter(line => {
            if (levelFilter !== 'all' && line.level !== levelFilter) {
                return false;
            }
            if (!keyword) {
                return true;
            }
            return line.raw.toLowerCase().includes(keyword);
        });
    }, [allLines, levelFilter, searchTerm]);

    const visibleLines = useMemo(() => {
        if (filteredLines.length <= MAX_RENDER_LINES) {
            return filteredLines;
        }
        return filteredLines.slice(filteredLines.length - MAX_RENDER_LINES);
    }, [filteredLines]);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        const intent = scrollIntent.current;
        if (!el || !intent || loading) return;
        el.scrollTop = intent.type === 'bottom' ? el.scrollHeight : el.scrollTop + el.scrollHeight - intent.height;
        scrollIntent.current = null;
    }, [visibleLines, loading]);

    const handleExport = async () => {
        const result = await ExportLogs();
        showExecResult(result, '日志已导出');
    };

    const handleClear = async () => {
        if (!selectedFile) {
            return;
        }

        const result = await ClearLogFile(selectedFile);
        if (result.error) {
            message.error(result.error);
            return;
        }

        setContent('');
        setNextCursor(0);
        setHasMore(false);
        setErrorText('');

        const [nextStatus, nextFiles] = await Promise.all([
            GetLogStatus(),
            ListLogFiles(),
        ]);
        setStatus(nextStatus);
        setFiles(nextFiles);

        message.success('当前日志已清空');
    };

    const handleOpenDir = async () => {
        const result = await OpenLogDirectory();
        showExecResult(result, '已打开日志目录');
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(visibleLines.map(line => line.raw).join('\n'));
        message.success(`已复制 ${visibleLines.length} 行`);
    };

    const handleCopyDir = async () => {
        if (!status?.directory) return;
        await navigator.clipboard.writeText(status.directory);
        message.success('已复制日志目录');
    };

    const showExecResult = (result: types.ExecResult, successText: string) => {
        if (result.error) {
            message.error(result.error);
            return;
        }
        message.success(successText);
    };

    const selectedMeta = files.find(file => file.name === selectedFile);
    const truncated = filteredLines.length > MAX_RENDER_LINES;

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col gap-5 overflow-hidden bg-canvas px-8 py-7 text-left text-ink">
            <PageHeader
                eyebrow="Diagnostics · app log"
                title="诊断日志"
                description="ADB Tool 自身的运行日志，反馈问题时可导出附上"
                actions={<>
                    <Button icon={<FolderOpenOutlined/>} onClick={handleOpenDir}>打开目录</Button>
                    <Button type="primary" icon={<DownloadOutlined/>} onClick={handleExport}>导出 ZIP</Button>
                </>}
            />

                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-elevated shadow-whisper">
                    <div className="flex flex-col gap-2.5 border-b border-hairline-soft px-4 py-3">
                        <div className="flex items-center gap-3">
                            <Select
                                value={selectedFile || undefined}
                                placeholder={loading ? '正在加载...' : '还没有日志文件'}
                                onChange={(name: string) => void loadLatest(name)}
                                popupMatchSelectWidth={false}
                                className="w-60 [&_.ant-select-selection-item]:font-mono [&_.ant-select-selection-item]:text-[13px]"
                                options={files.map(file => ({
                                    value: file.name,
                                    label: file.name,
                                    file,
                                }))}
                                optionRender={option => {
                                    const file = option.data.file as applog.FileDTO;
                                    return (
                                        <div className="flex min-w-[280px] items-center gap-3 py-0.5">
                                            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{file.name}</span>
                                            {file.isCurrent && <CurrentBadge/>}
                                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
                                                {formatBytes(file.size)} · {formatTime(file.modifiedAt)}
                                            </span>
                                        </div>
                                    );
                                }}
                            />
                            <div className="mr-auto flex min-w-0 items-center gap-2 font-mono text-[11px] tabular-nums text-faint">
                                {selectedMeta?.isCurrent && <CurrentBadge/>}
                                <span className="truncate">
                                    {selectedMeta ? `${formatBytes(selectedMeta.size)} · 更新于 ${formatTime(selectedMeta.modifiedAt)}` : ''}
                                </span>
                            </div>

                            <div className="flex items-center gap-1">
                                <Tooltip title="刷新文件列表与最新内容">
                                    <Button type="text" icon={<ReloadOutlined spin={loading}/>} onClick={() => void initialize()} disabled={loading}/>
                                </Tooltip>
                                <Tooltip title="复制当前显示的行">
                                    <Button type="text" icon={<CopyOutlined/>} onClick={handleCopy} disabled={visibleLines.length === 0}/>
                                </Tooltip>
                                <Popconfirm
                                    title="清空当前日志文件？"
                                    description="清空后无法恢复。"
                                    okText="清空"
                                    cancelText="取消"
                                    okButtonProps={{danger: true}}
                                    onConfirm={() => void handleClear()}
                                    disabled={!selectedFile || loading}
                                >
                                    <Tooltip title="清空日志">
                                        <Button type="text" danger icon={<DeleteOutlined/>} disabled={!selectedFile || loading}/>
                                    </Tooltip>
                                </Popconfirm>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Input
                                allowClear
                                prefix={<SearchOutlined className="text-faint"/>}
                                placeholder="搜索已加载内容"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="min-w-[140px] flex-1"
                            />
                            <Segmented
                                size="small"
                                className="shrink-0"
                                options={LEVEL_OPTIONS.map(option => ({
                                    value: option.value,
                                    label: (
                                        <span className="flex items-center gap-1.5 px-0.5">
                                            {option.value !== 'all' && <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLE[option.value].dot}`}/>}
                                            {option.label}
                                            {option.value !== 'all' && levelCounts[option.value] > 0 && (
                                                <span className="font-mono text-[11px] tabular-nums text-faint">{levelCounts[option.value]}</span>
                                            )}
                                        </span>
                                    ),
                                }))}
                                value={levelFilter}
                                onChange={(value) => setLevelFilter(value as LevelFilter)}
                            />
                        </div>
                    </div>

                    {(errorText || truncated) && (
                        <div className={`border-b px-4 py-2 text-[12px] ${errorText ? 'border-error-soft bg-error-soft text-error' : 'border-warning-soft bg-warning-soft text-warning-deep'}`}>
                            {errorText || `匹配结果较多，仅显示最后 ${MAX_RENDER_LINES} 行`}
                        </div>
                    )}

                    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
                        {loading ? (
                            <div className="flex h-full items-center justify-center">
                                <Spin/>
                            </div>
                        ) : visibleLines.length === 0 ? (
                            <div className="flex h-full items-center justify-center">
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={allLines.length > 0 ? '没有匹配的日志' : '日志为空'}/>
                            </div>
                        ) : (
                            <div className="py-1">
                                {hasMore && !truncated && (
                                    <div className="flex justify-center py-2">
                                        <Button size="small" type="text" loading={loadingOlder} onClick={() => void loadOlder()} className="!text-mute">
                                            加载更早的 {formatBytes(CHUNK_BYTES)}
                                        </Button>
                                    </div>
                                )}
                                {visibleLines.map((line, index) => (
                                    <LogRow key={`${index}-${line.raw.slice(0, 40)}`} line={line}/>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-4 border-t border-hairline-soft px-4 py-2 font-mono text-[11px] tabular-nums text-faint">
                        <button
                            type="button"
                            onClick={() => void handleCopyDir()}
                            title={status?.directory ? `${status.directory}\n点击复制` : undefined}
                            className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                            <span className="truncate group-hover:text-ink">{status?.directory || '-'}</span>
                            <CopyOutlined className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"/>
                        </button>
                        <span className="shrink-0">
                            已加载 {allLines.length} 行 · 匹配 {filteredLines.length} 行{hasMore ? '' : ' · 已到文件开头'}
                        </span>
                    </div>
                </section>
        </div>
    );
}

const LEVEL_STYLE: Record<Level, {dot: string; badge: string; row: string}> = {
    ERROR: {dot: 'bg-error', badge: 'text-error', row: 'bg-error-soft/50 hover:bg-error-soft'},
    WARN: {dot: 'bg-warning', badge: 'text-warning-deep', row: 'bg-warning-soft/50 hover:bg-warning-soft'},
    INFO: {dot: 'bg-link', badge: 'text-link', row: 'hover:bg-canvas'},
    DEBUG: {dot: 'bg-faint', badge: 'text-mute', row: 'hover:bg-canvas'},
};

function CurrentBadge() {
    return (
        <span className="shrink-0 rounded-full bg-link-soft px-1.5 py-px font-sans text-[10px] font-medium text-link-deep">
            当前
        </span>
    );
}

function LogRow({line}: { line: ParsedLine }) {
    if (!line.level) {
        return <div className="whitespace-pre-wrap break-all px-4 py-px text-body hover:bg-canvas">{line.raw}</div>;
    }

    const style = LEVEL_STYLE[line.level];
    return (
        <div className={`grid grid-cols-[108px_40px_minmax(0,1fr)] gap-2 px-4 py-px ${style.row}`}>
            <span className="whitespace-nowrap tabular-nums text-faint">{line.time}</span>
            <span className={`font-medium ${style.badge}`}>{line.level}</span>
            <span className="whitespace-pre-wrap break-all">
                {line.category && <span className="mr-1.5 text-mute">{line.category}</span>}
                {renderMessage(line.message)}
            </span>
        </div>
    );
}

// 消息格式为 "event key=value key=value"，事件名高亮，键名弱化
function renderMessage(text: string) {
    const [event, ...rest] = text.split(' ');
    if (!event || event.includes('=')) {
        return <span className="text-body">{renderPairs(text)}</span>;
    }
    return (
        <>
            <span className="text-ink">{event}</span>
            {rest.length > 0 && <span className="text-body"> {renderPairs(rest.join(' '))}</span>}
        </>
    );
}

function renderPairs(text: string) {
    return text.split(/(\s+)/).map((token, index) => {
        const eq = token.indexOf('=');
        if (eq <= 0) return token;
        return (
            <span key={index}>
                <span className="text-faint">{token.slice(0, eq + 1)}</span>
                {token.slice(eq + 1)}
            </span>
        );
    });
}

function formatBytes(size: number) {
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string) {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default LogViewer;
