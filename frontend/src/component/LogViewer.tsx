import {useEffect, useMemo, useState} from 'react';
import {
    Alert,
    Button,
    Card,
    Empty,
    Input,
    List,
    Segmented,
    Space,
    Spin,
    Tag,
    Tooltip,
    Typography,
    message
} from 'antd';
import {
    CopyOutlined,
    DownloadOutlined,
    FolderOpenOutlined,
    ReloadOutlined,
    SearchOutlined,
    UpOutlined
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

const {Paragraph, Text, Title} = Typography;

const CHUNK_BYTES = 256 * 1024;
const MAX_RENDER_LINES = 3000;

type LevelFilter = 'all' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LEVEL_OPTIONS: Array<{value: LevelFilter; label: string}> = [
    {value: 'all', label: '全部级别'},
    {value: 'ERROR', label: 'ERROR'},
    {value: 'WARN', label: 'WARN'},
    {value: 'INFO', label: 'INFO'},
    {value: 'DEBUG', label: 'DEBUG'},
];

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

            const defaultFile = nextFiles.find(file => file.isCurrent)?.name ?? nextFiles[0]?.name ?? '';
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
            .filter((line, index, arr) => !(index === arr.length - 1 && line === ''));
    }, [content]);

    const filteredLines = useMemo(() => {
        const keyword = searchTerm.trim().toLowerCase();
        return allLines.filter(line => {
            if (levelFilter !== 'all' && !line.includes(levelFilter)) {
                return false;
            }
            if (!keyword) {
                return true;
            }
            return line.toLowerCase().includes(keyword);
        });
    }, [allLines, levelFilter, searchTerm]);

    const visibleLines = useMemo(() => {
        if (filteredLines.length <= MAX_RENDER_LINES) {
            return filteredLines;
        }
        return filteredLines.slice(filteredLines.length - MAX_RENDER_LINES);
    }, [filteredLines]);

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
        await navigator.clipboard.writeText(visibleLines.join('\n'));
        message.success('已复制当前可见日志');
    };

    const showExecResult = (result: types.ExecResult, successText: string) => {
        if (result.error) {
            message.error(result.error);
            return;
        }
        message.success(successText);
    };

    return (
        <div className="flex-1 h-full overflow-hidden bg-slate-100/70 p-6">
            <div className="mx-auto grid h-full max-w-7xl grid-cols-[320px_minmax(0,1fr)] gap-6">
                <Card
                    className="h-full overflow-hidden"
                    bodyStyle={{padding: 0, height: '100%', display: 'flex', flexDirection: 'column'}}
                >
                    <div className="border-b border-slate-200 px-5 py-4">
                        <Title level={4} className="!mb-1">诊断日志</Title>
                        <Text type="secondary">应用自身的本地滚动日志，默认只读取文件尾部。</Text>
                    </div>

                    <div className="border-b border-slate-200 px-5 py-4">
                        <Space direction="vertical" size={12} className="w-full">
                            <div className="flex items-center justify-between gap-3">
                                <Text type="secondary">日志目录</Text>
                                <Button type="link" icon={<FolderOpenOutlined/>} onClick={handleOpenDir} className="!px-0">
                                    打开目录
                                </Button>
                            </div>
                            <Paragraph copyable className="!mb-0 text-xs !text-slate-600">
                                {status?.directory || '-'}
                            </Paragraph>
                            <Button type="primary" icon={<DownloadOutlined/>} block onClick={handleExport}>
                                导出日志 ZIP
                            </Button>
                        </Space>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <List
                            dataSource={files}
                            locale={{emptyText: loading ? '正在加载...' : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有日志文件"/>}}
                            renderItem={(file) => (
                                <List.Item
                                    className={`!cursor-pointer !px-5 !py-4 transition-colors ${
                                        selectedFile === file.name ? 'bg-blue-50' : 'hover:bg-slate-50'
                                    }`}
                                    onClick={() => void loadLatest(file.name)}
                                >
                                    <div className="w-full min-w-0">
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <Text strong ellipsis={{tooltip: file.name}} className="max-w-[180px]">
                                                {file.name}
                                            </Text>
                                            {file.isCurrent && <Tag color="blue" className="!mr-0">当前</Tag>}
                                        </div>
                                        <div className="flex items-center justify-between gap-3 text-xs">
                                            <Text type="secondary">{formatBytes(file.size)}</Text>
                                            <Text type="secondary">{formatTime(file.modifiedAt)}</Text>
                                        </div>
                                    </div>
                                </List.Item>
                            )}
                        />
                    </div>
                </Card>

                <Card
                    className="h-full overflow-hidden"
                    bodyStyle={{padding: 0, height: '100%', display: 'flex', flexDirection: 'column'}}
                >
                    <div className="border-b border-slate-200 px-6 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <Title level={4} className="!mb-1">{selectedFile || '未选择日志文件'}</Title>
                                <Text type="secondary">搜索仅作用于已加载内容，避免在大文件上做全量扫描。</Text>
                            </div>
                            <Space wrap>
                                <Button icon={<ReloadOutlined/>} onClick={() => void loadLatest(selectedFile)} disabled={!selectedFile || loading}>
                                    刷新
                                </Button>
                                <Button danger disabled={!selectedFile || loading} onClick={() => void handleClear()}>
                                    清空日志
                                </Button>
                                <Button icon={<CopyOutlined/>} onClick={handleCopy} disabled={visibleLines.length === 0}>
                                    复制可见内容
                                </Button>
                            </Space>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Input
                                allowClear
                                prefix={<SearchOutlined className="text-slate-400"/>}
                                placeholder="搜索已加载日志"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="max-w-sm"
                            />
                            <Segmented
                                options={LEVEL_OPTIONS.map(option => ({label: option.label, value: option.value}))}
                                value={levelFilter}
                                onChange={(value) => setLevelFilter(value as LevelFilter)}
                            />
                            <Tag bordered={false} color="default" className="!m-0 !px-3 !py-1 text-sm">
                                已加载 {allLines.length} 行，匹配 {filteredLines.length} 行
                            </Tag>
                        </div>
                    </div>

                    <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <Text type="secondary">单次读取 {formatBytes(CHUNK_BYTES)}，按需向前翻页。</Text>
                            <Button
                                icon={<UpOutlined/>}
                                onClick={() => void loadOlder()}
                                disabled={!hasMore || loadingOlder}
                                loading={loadingOlder}
                            >
                                {hasMore ? '加载更早内容' : '没有更早内容'}
                            </Button>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden p-5">
                        {errorText && (
                            <Alert
                                type="error"
                                message={errorText}
                                showIcon
                                className="mb-4"
                            />
                        )}

                        {filteredLines.length > MAX_RENDER_LINES && (
                            <Alert
                                type="warning"
                                showIcon
                                className="mb-4"
                                message={`为保证渲染性能，当前仅显示最后 ${MAX_RENDER_LINES} 行匹配结果。`}
                            />
                        )}

                        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#0f172a]">
                            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                                <Space size={8}>
                                    <Tag color="processing" className="!mr-0">日志输出</Tag>
                                    <Text className="!text-slate-400">按级别着色，保留原始行顺序</Text>
                                </Space>
                                <Tooltip title="当前视图只渲染可见结果，避免一次性绘制过多文本">
                                    <Text className="!text-slate-500">性能模式</Text>
                                </Tooltip>
                            </div>

                            <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-6">
                                {loading ? (
                                    <div className="flex h-full items-center justify-center">
                                        <Spin tip="正在读取日志..."/>
                                    </div>
                                ) : visibleLines.length === 0 ? (
                                    <div className="flex h-full items-center justify-center">
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={<span className="text-slate-400">没有可显示的日志内容</span>}
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-0.5">
                                        {visibleLines.map((line, index) => (
                                            <div key={`${index}-${line.slice(0, 32)}`} className="break-all whitespace-pre-wrap">
                                                {highlightLine(line)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}

function highlightLine(line: string) {
    const tone = line.includes('ERROR')
        ? 'text-red-300'
        : line.includes('WARN')
            ? 'text-amber-300'
            : line.includes('INFO')
                ? 'text-emerald-300'
                : line.includes('DEBUG')
                    ? 'text-cyan-300'
                    : 'text-slate-100';
    return <span className={tone}>{line}</span>;
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
    return new Date(value).toLocaleString();
}

export default LogViewer;
