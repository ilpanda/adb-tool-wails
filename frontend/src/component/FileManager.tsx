import {startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState} from 'react';
import {Button, Dropdown, Empty, Input, Modal, Segmented, Spin, Tooltip, message} from 'antd';
import type {MenuProps} from 'antd';
import {
    DeleteOutlined,
    DownloadOutlined,
    EyeOutlined,
    FolderOpenOutlined,
    LoadingOutlined,
    ReloadOutlined,
    StarFilled,
    StarOutlined,
    UploadOutlined,
} from '@ant-design/icons';
import {
    DeleteRemoteFile,
    DownloadFile,
    GetBookmarkPaths,
    ListDirectory,
    ReadFileContent,
    SetBookmarkPaths,
    UploadFile,
} from "../../wailsjs/go/main/App";
import {useDeviceStore} from "../store/deviceStore";

interface FileEntry {
    permissions: string;
    size: string;
    sizeRaw: number;
    date: string;
    name: string;
    isDirectory: boolean;
    fullPath: string;
}

function formatSize(raw: number): string {
    if (raw < 0) return '-';
    if (raw < 1024) return `${raw} B`;
    if (raw < 1024 * 1024) return `${(raw / 1024).toFixed(1)} KB`;
    if (raw < 1024 * 1024 * 1024) return `${(raw / (1024 * 1024)).toFixed(1)} MB`;
    return `${(raw / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) return '/';
    const normalized = trimmed.replace(/\/+/g, '/');
    if (normalized === '/') return '/';
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function getParentPath(path: string): string {
    const normalized = normalizePath(path);
    if (normalized === '/') return '/';
    return normalized.slice(0, normalized.lastIndexOf('/')) || '/';
}

function parseLsLine(line: string, parentPath: string): FileEntry | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total')) return null;
    if (trimmed.startsWith('ls:') || trimmed.includes('No such file') || trimmed.includes('Permission denied')) {
        return null;
    }

    const androidStyleMatch = trimmed.match(/^(\S+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
    const gnuStyleMatch = trimmed.match(/^(\S+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4}))\s+(.+)$/);
    const compactStyleMatch = trimmed.match(/^(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);

    const match = androidStyleMatch || gnuStyleMatch || compactStyleMatch;
    if (!match) {
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) return null;

        const permissions = parts[0];
        if (permissions.startsWith('l')) return null;

        const fallbackName = parts[parts.length - 1];
        if (!fallbackName || fallbackName === '.' || fallbackName === '..') return null;

        const normalizedParent = normalizePath(parentPath);
        return {
            permissions,
            size: permissions.startsWith('d') ? '-' : '',
            sizeRaw: permissions.startsWith('d') ? -1 : 0,
            date: '',
            name: fallbackName,
            isDirectory: permissions.startsWith('d'),
            fullPath: normalizedParent === '/' ? `/${fallbackName}` : `${normalizedParent}/${fallbackName}`,
        };
    }

    const [, permissions, sizeText, date, namePart] = match;
    if (!namePart || namePart === '.' || namePart === '..') return null;
    if (permissions.startsWith('l')) return null;

    const normalizedParent = normalizePath(parentPath);
    const isDirectory = permissions.startsWith('d');
    const sizeNum = parseInt(sizeText, 10);
    const sizeRaw = isDirectory ? -1 : (Number.isNaN(sizeNum) ? -1 : sizeNum);

    return {
        permissions,
        size: formatSize(sizeRaw),
        sizeRaw,
        date,
        name: namePart,
        isDirectory,
        fullPath: normalizedParent === '/' ? `/${namePart}` : `${normalizedParent}/${namePart}`,
    };
}

function parseLsOutput(output: string, parentPath: string): FileEntry[] {
    const lines = output.split('\n');
    const entries: FileEntry[] = [];

    for (const line of lines) {
        const entry = parseLsLine(line, parentPath);
        if (entry) entries.push(entry);
    }

    entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, 'zh-CN');
    });

    return entries;
}

function buildBreadcrumbItems(path: string): Array<{label: string; path: string}> {
    const normalized = normalizePath(path);
    if (normalized === '/') {
        return [{label: '/', path: '/'}];
    }

    const segments = normalized.split('/').filter(Boolean);
    let current = '';

    return [
        {label: '/', path: '/'},
        ...segments.map(segment => {
            current += `/${segment}`;
            return {label: segment, path: current};
        }),
    ];
}

function FileManager() {
    const {selectedDevice} = useDeviceStore();
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [viewingFileName, setViewingFileName] = useState('');
    const [fileLoading, setFileLoading] = useState(false);
    const [currentPath, setCurrentPath] = useState('/');
    const [pathInput, setPathInput] = useState('/');
    const [filterText, setFilterText] = useState('');
    const [uploading, setUploading] = useState(false);
    const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
    const [bookmarks, setBookmarks] = useState<string[]>([]);
    const [pathPending, setPathPending] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const deferredFilterText = useDeferredValue(filterText);

    const handleView = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;
        setFileLoading(true);
        setViewingFileName(entry.name);
        setFileContent(null);

        ReadFileContent(selectedDevice.id, entry.fullPath).then((result: any) => {
            if (result.error) {
                message.error(`读取失败: ${result.error}`);
                return;
            }
            setFileContent(result.res);
        }).catch((e: any) => {
            message.error(`读取失败: ${e.message || e}`);
        }).finally(() => setFileLoading(false));
    }, [selectedDevice]);

    const loadEntries = useCallback(async (path: string): Promise<FileEntry[]> => {
        if (!selectedDevice) return [];

        const normalized = normalizePath(path);
        const result = await ListDirectory(selectedDevice.id, normalized);
        if (result.error) {
            message.error(`加载失败: ${result.error}`);
            return [];
        }
        return parseLsOutput(result.res, normalized);
    }, [selectedDevice]);

    const openPath = useCallback(async (path: string) => {
        const normalized = normalizePath(path);
        setLoading(true);
        setPathPending(normalized);
        setCurrentPath(normalized);
        setPathInput(normalized);
        setFilterText('');

        try {
            const nextEntries = await loadEntries(normalized);
            setEntries(nextEntries);
        } finally {
            setLoading(false);
            setPathPending(null);
        }
    }, [loadEntries]);

    const refreshCurrentPath = useCallback(async () => {
        await openPath(currentPath);
    }, [currentPath, openPath]);

    const handleDelete = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;

        DeleteRemoteFile(selectedDevice.id, entry.fullPath).then((result: any) => {
            if (result.error) {
                message.error(`删除失败: ${result.error}`);
                return;
            }
            message.success(`已删除: ${entry.name}`);
            refreshCurrentPath();
        }).catch((e: any) => message.error(`删除失败: ${e.message || e}`));
    }, [refreshCurrentPath, selectedDevice]);

    const handleDownload = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;

        DownloadFile(selectedDevice.id, entry.fullPath).then((result: any) => {
            if (result.error) {
                if (result.error !== '已取消') message.error(`下载失败: ${result.error}`);
                return;
            }
            message.success(`下载完成: ${entry.name}`);
        }).catch((e: any) => message.error(`下载失败: ${e.message || e}`));
    }, [selectedDevice]);

    const handleOpenDirectory = useCallback(async (entry: FileEntry) => {
        if (!entry.isDirectory) {
            handleView(entry);
            return;
        }

        setLoadingKeys(prev => new Set(prev).add(entry.fullPath));
        try {
            await openPath(entry.fullPath);
        } finally {
            setLoadingKeys(prev => {
                const next = new Set(prev);
                next.delete(entry.fullPath);
                return next;
            });
        }
    }, [handleView, openPath]);

    const toggleBookmark = useCallback((path: string) => {
        if (path === '/') return;

        setBookmarks(prev => {
            const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
            SetBookmarkPaths(next);
            return next;
        });
    }, []);

    useEffect(() => {
        if (!selectedDevice) {
            setEntries([]);
            setCurrentPath('/');
            setPathInput('/');
            return;
        }

        openPath('/');
    }, [openPath, selectedDevice?.id]);

    useEffect(() => {
        GetBookmarkPaths().then((paths: string[] | null | undefined) => setBookmarks(paths || []));
    }, []);

    const handlePathSubmit = () => {
        if (!selectedDevice) return;
        openPath(pathInput);
    };

    const handleUpload = async () => {
        if (!selectedDevice) {
            message.warning('请先连接设备');
            return;
        }

        setUploading(true);
        try {
            const result = await UploadFile(selectedDevice.id, currentPath);
            if (result.error) {
                if (result.error !== '已取消') message.error(`上传失败: ${result.error}`);
                return;
            }

            message.success('上传成功');
            await refreshCurrentPath();
        } catch (e: any) {
            message.error(`上传失败: ${e.message || e}`);
        } finally {
            setUploading(false);
        }
    };

    const filteredEntries = useMemo(() => {
        if (!deferredFilterText.trim()) return entries;
        const lower = deferredFilterText.toLowerCase();
        return entries.filter(entry => entry.name.toLowerCase().includes(lower));
    }, [deferredFilterText, entries]);

    const breadcrumbItems = useMemo(() => buildBreadcrumbItems(currentPath), [currentPath]);

    const bookmarkMenuItems: MenuProps['items'] = bookmarks.length > 0
        ? bookmarks.map((path, index) => ({
            key: `${index}-${path}`,
            label: (
                <div className="flex items-center justify-between gap-3 min-w-[220px]">
                    <span className="truncate font-mono text-sm">{path}</span>
                    <Tooltip title="取消收藏">
                        <DeleteOutlined
                            className="flex-shrink-0 text-gray-400 hover:text-red-500"
                            onClick={event => {
                                event.stopPropagation();
                                toggleBookmark(path);
                            }}
                        />
                    </Tooltip>
                </div>
            ),
            onClick: () => openPath(path),
        }))
        : [{key: 'empty', label: <span className="text-sm text-gray-400">暂无收藏路径</span>, disabled: true}];

    const buildEntryContextMenu = useCallback((entry: FileEntry): NonNullable<MenuProps['items']> => {
        const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

        const items: NonNullable<MenuProps['items']> = [];
        if (entry.isDirectory) {
            items.push({
                key: 'bookmark',
                label: isFav ? '取消收藏' : '收藏路径',
                icon: isFav ? <StarFilled /> : <StarOutlined />,
                onClick: () => toggleBookmark(entry.fullPath),
            });
        }
        if (!entry.isDirectory) {
            items.push({
                key: 'view',
                label: '查看',
                icon: <EyeOutlined />,
                onClick: () => handleView(entry),
            });
        }
        items.push({
            key: 'download',
            label: '下载',
            icon: <DownloadOutlined />,
            onClick: () => handleDownload(entry),
        });
        items.push({
            key: 'delete',
            label: <span className="text-red-500">删除</span>,
            icon: <DeleteOutlined className="!text-red-500" />,
            onClick: () => {
                Modal.confirm({
                    title: '确认删除',
                    content: `确定要删除 ${entry.name} 吗？`,
                    okText: '删除',
                    cancelText: '取消',
                    okButtonProps: {danger: true},
                    onOk: async () => handleDelete(entry),
                });
            },
        });

        return items;
    }, [bookmarks, handleDelete, handleDownload, handleView, toggleBookmark]);

    const showParentShortcut = currentPath !== '/' && !deferredFilterText.trim();

    return (
        <div className="flex h-full flex-1 flex-col overflow-hidden bg-slate-50">
            <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="flex items-center gap-2 xl:min-w-[120px]">
                        <i className="fa-solid fa-folder-open text-lg text-amber-500"/>
                        <span className="text-base font-medium text-slate-800">文件管理</span>
                    </div>

                    <Input
                        size="middle"
                        value={pathInput}
                        onChange={e => setPathInput(e.target.value)}
                        onPressEnter={handlePathSubmit}
                        placeholder="输入路径跳转，如 /sdcard/Download"
                        className="flex-1"
                        style={{fontFamily: 'monospace'}}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                        <Dropdown menu={{items: bookmarkMenuItems}} trigger={['click']}>
                            <Button size="middle" icon={<StarOutlined/>}>
                                收藏
                            </Button>
                        </Dropdown>
                        <Button
                            size="middle"
                            icon={<FolderOpenOutlined/>}
                            onClick={handlePathSubmit}
                        >
                            打开
                        </Button>
                        <Button
                            size="middle"
                            icon={<UploadOutlined/>}
                            onClick={handleUpload}
                            loading={uploading}
                        >
                            上传
                        </Button>
                        <Button
                            size="middle"
                            icon={<ReloadOutlined/>}
                            onClick={refreshCurrentPath}
                            loading={loading}
                        >
                            刷新
                        </Button>
                    </div>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        {breadcrumbItems.map((item, index) => {
                            const isLast = index === breadcrumbItems.length - 1;
                            const isRoot = item.path === '/';
                            const isPending = pathPending === item.path;

                            return (
                                <div key={item.path} className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => openPath(item.path)}
                                        className={`shrink-0 rounded-md px-2 py-1 text-sm transition ${
                                            isLast
                                                ? 'bg-slate-900 text-white'
                                                : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                                        }`}
                                    >
                                        <span className="flex min-w-[2.5rem] items-center justify-center gap-1.5">
                                            <span className="flex h-3.5 w-3.5 items-center justify-center">
                                                {isPending ? (
                                                    <LoadingOutlined className="text-xs" />
                                                ) : isRoot ? (
                                                    <i className="fa-solid fa-house text-[11px]" />
                                                ) : null}
                                            </span>
                                            <span className={`${isRoot ? 'w-0 overflow-hidden' : ''}`}>
                                                {isRoot ? '/' : item.label}
                                            </span>
                                        </span>
                                    </button>
                                    {!isLast && <span className="text-xs text-slate-400">/</span>}
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2">
                        <Segmented<'grid' | 'list'>
                            value={viewMode}
                            onChange={value => {
                                startTransition(() => {
                                    setViewMode(value);
                                });
                            }}
                            options={[
                                {label: '图标', value: 'grid'},
                                {label: '列表', value: 'list'},
                            ]}
                        />
                        {currentPath !== '/' && (
                            <Button onClick={() => openPath(getParentPath(currentPath))}>
                                返回上一级
                            </Button>
                        )}
                        <Input
                            size="middle"
                            placeholder="过滤文件名..."
                            value={filterText}
                            onChange={e => setFilterText(e.target.value)}
                            allowClear
                            prefix={<i className="fa-solid fa-filter text-gray-400"/>}
                            className="w-full lg:w-72"
                        />
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
                {!selectedDevice ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty description="请先连接设备"/>
                    </div>
                ) : loading && entries.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <Spin tip="加载中..."/>
                    </div>
                ) : filteredEntries.length === 0 && !showParentShortcut ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty description={filterText ? '无匹配文件' : '目录为空'}/>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-9">
                        {showParentShortcut && (
                            <button
                                type="button"
                                onClick={() => openPath(getParentPath(currentPath))}
                                className="group flex flex-col items-center gap-1.5 rounded-lg px-2 py-2 text-center transition hover:bg-slate-100"
                            >
                                <div className="flex h-10 w-10 items-center justify-center text-[26px] text-slate-500">
                                    {pathPending === getParentPath(currentPath)
                                        ? <LoadingOutlined/>
                                        : <i className="fa-solid fa-arrow-turn-up"/>}
                                </div>
                                <div className="line-clamp-2 break-all text-xs leading-4 text-slate-700">..</div>
                            </button>
                        )}

                        {filteredEntries.map(entry => {
                            const isBusy = loadingKeys.has(entry.fullPath);
                            const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

                            return (
                                <Dropdown
                                    key={entry.fullPath}
                                    trigger={['contextMenu']}
                                    menu={{items: buildEntryContextMenu(entry)}}
                                >
                                    <button
                                        type="button"
                                        onClick={() => entry.isDirectory ? handleOpenDirectory(entry) : handleView(entry)}
                                        className="group flex flex-col items-center gap-1.5 rounded-lg px-2 py-2 text-center transition hover:bg-slate-100"
                                        title={entry.name}
                                    >
                                        <div
                                            className={`relative flex h-10 w-10 shrink-0 items-center justify-center text-[28px] transition ${
                                                entry.isDirectory
                                                    ? 'text-amber-500'
                                                    : 'text-sky-500'
                                            }`}
                                        >
                                            <i className={`fa-solid ${entry.isDirectory ? 'fa-folder' : 'fa-file-lines'}`}/>
                                            {isBusy && (
                                                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] text-sky-500 shadow-sm">
                                                    <LoadingOutlined />
                                                </span>
                                            )}
                                            {isFav && (
                                                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] text-yellow-500 shadow-sm">
                                                    <StarFilled />
                                                </span>
                                            )}
                                        </div>

                                        <div className="w-full min-w-0">
                                            <div className="line-clamp-2 break-all text-xs leading-4 text-slate-700">
                                                {entry.name}
                                            </div>
                                        </div>
                                    </button>
                                </Dropdown>
                            );
                        })}
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="grid grid-cols-[minmax(0,1fr)_140px_120px_120px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                            <span>名称</span>
                            <span>修改时间</span>
                            <span>大小</span>
                            <span>操作</span>
                        </div>

                        {showParentShortcut && (
                            <button
                                type="button"
                                onClick={() => openPath(getParentPath(currentPath))}
                                className="grid w-full grid-cols-[minmax(0,1fr)_140px_120px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50"
                            >
                                <span className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-8 w-8 items-center justify-center text-slate-500">
                                        {pathPending === getParentPath(currentPath)
                                            ? <LoadingOutlined />
                                            : <i className="fa-solid fa-arrow-turn-up text-lg"/>}
                                    </span>
                                    <span className="truncate text-sm text-slate-800">..</span>
                                </span>
                                <span className="text-xs text-slate-400">-</span>
                                <span className="text-xs text-slate-400">-</span>
                                <span className="text-xs text-slate-400">返回上一级</span>
                            </button>
                        )}

                        {filteredEntries.map(entry => {
                            const isBusy = loadingKeys.has(entry.fullPath);
                            const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

                            return (
                                <Dropdown
                                    key={entry.fullPath}
                                    trigger={['contextMenu']}
                                    menu={{items: buildEntryContextMenu(entry)}}
                                >
                                    <button
                                        type="button"
                                        onClick={() => entry.isDirectory ? handleOpenDirectory(entry) : handleView(entry)}
                                        className="grid w-full grid-cols-[minmax(0,1fr)_140px_120px_120px] gap-3 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 last:border-b-0"
                                    >
                                        <span className="flex min-w-0 items-center gap-3">
                                            <span className={`flex h-8 w-8 items-center justify-center text-lg ${entry.isDirectory ? 'text-amber-500' : 'text-sky-500'}`}>
                                                <i className={`fa-solid ${entry.isDirectory ? 'fa-folder' : 'fa-file-lines'}`}/>
                                            </span>
                                            <span className="min-w-0 truncate text-sm text-slate-800">{entry.name}</span>
                                            {isBusy && <LoadingOutlined className="text-xs text-sky-500" />}
                                            {isFav && <StarFilled className="text-xs text-yellow-500" />}
                                        </span>
                                        <span className="truncate text-xs text-slate-500">{entry.date || '-'}</span>
                                        <span className="truncate text-xs text-slate-500">{entry.isDirectory ? '-' : entry.size}</span>
                                        <span className="text-xs text-slate-400">右键操作</span>
                                    </button>
                                </Dropdown>
                            );
                        })}
                    </div>
                )}
            </div>

            <Modal
                title={
                    <div className="flex items-center gap-2">
                        <i className="fa-regular fa-file text-blue-400"/>
                        <span>{viewingFileName}</span>
                    </div>
                }
                open={fileContent !== null || fileLoading}
                onCancel={() => {
                    setFileContent(null);
                    setViewingFileName('');
                }}
                footer={null}
                width={720}
            >
                {fileLoading ? (
                    <div className="flex justify-center py-8">
                        <Spin tip="读取中..."/>
                    </div>
                ) : (
                    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-900 p-4 text-xs font-mono text-green-400">
                        {fileContent}
                    </pre>
                )}
            </Modal>
        </div>
    );
}

export default FileManager;
