import {startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {Button, Dropdown, Empty, Input, Modal, Segmented, Spin, Tooltip, message} from 'antd';
import type {MenuProps} from 'antd';
import {
    AppstoreOutlined,
    ArrowUpOutlined,
    BarsOutlined,
    CloseOutlined,
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    EyeOutlined,
    FolderOpenOutlined,
    LoadingOutlined,
    ReloadOutlined,
    SearchOutlined,
    StarFilled,
    StarOutlined,
    UploadOutlined,
} from '@ant-design/icons';
import {
    DeleteRemoteFile,
    DownloadFile,
    GetBookmarkPaths,
    ListDirectory,
    SetBookmarkPaths,
    UploadFile,
} from "../../wailsjs/go/main/App";
import {useDeviceStore} from "../store/deviceStore";
import PageHeader from "./PageHeader";
import FilePreviewModal from "./FilePreviewModal";

interface FileEntry {
    permissions: string;
    size: string;
    sizeRaw: number;
    date: string;
    name: string;
    isDirectory: boolean;
    // 符号链接的指向，非链接为 undefined
    linkTarget?: string;
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

function joinPath(parent: string, name: string): string {
    const normalizedParent = normalizePath(parent);
    return normalizedParent === '/' ? `/${name}` : `${normalizedParent}/${name}`;
}

const LS_PATTERNS = [
    // toybox: drwxrwx--x 4 0 0 4096 2026-10-15 21:36 name
    /^(\S+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/,
    // GNU: drwxr-xr-x 4 0 0 4096 Oct 15 21:36 name
    /^(\S+)\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4}))\s+(.+)$/,
    /^(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/,
];

function parseLsLine(line: string, parentPath: string, dirLinks: Set<string>): FileEntry | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('total')) return null;
    if (trimmed.startsWith('ls:') || trimmed.includes('No such file') || trimmed.includes('Permission denied')) {
        return null;
    }

    const match = LS_PATTERNS.map(pattern => trimmed.match(pattern)).find(Boolean);
    // 无权限的条目只有 "d????????? ? ? ? ? ? name" 形式
    const [permissions, sizeText, date, namePart] = match
        ? match.slice(1)
        : (() => {
            const parts = trimmed.split(/\s+/);
            return parts.length < 2 ? [] : [parts[0], '', '', parts[parts.length - 1]];
        })();
    if (!permissions || !namePart) return null;

    const isLink = permissions.startsWith('l');
    const [name, linkTarget] = isLink && namePart.includes(' -> ')
        ? [namePart.slice(0, namePart.indexOf(' -> ')), namePart.slice(namePart.indexOf(' -> ') + 4)]
        : [namePart, undefined];
    if (name === '.' || name === '..') return null;

    const isDirectory = permissions.startsWith('d') || (isLink && dirLinks.has(name));
    const sizeNum = parseInt(sizeText, 10);
    const sizeRaw = isDirectory || isLink || Number.isNaN(sizeNum) ? -1 : sizeNum;

    return {
        permissions,
        size: formatSize(sizeRaw),
        sizeRaw,
        date,
        name,
        isDirectory,
        linkTarget: isLink ? (linkTarget ?? '') : undefined,
        fullPath: joinPath(parentPath, name),
    };
}

function parseLsOutput(output: string, parentPath: string, dirLinks: string[]): FileEntry[] {
    const links = new Set(dirLinks);
    const entries = output
        .split('\n')
        .map(line => parseLsLine(line, parentPath, links))
        .filter((entry): entry is FileEntry => entry !== null);

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

const DEFAULT_PATH = '/sdcard';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'svg'];
// 后端 PreviewFile 支持直接预览的图片格式
const PREVIEWABLE_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

function getExt(name: string): string {
    return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

function isImageEntry(entry: FileEntry): boolean {
    return PREVIEWABLE_IMAGE_EXT.includes(getExt(entry.name));
}
const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp'];
const AUDIO_EXT = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'amr'];
const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'xz', 'jar', 'aar'];
const CODE_EXT = ['xml', 'json', 'js', 'ts', 'java', 'kt', 'sh', 'py', 'html', 'css', 'prop', 'rc', 'yaml', 'yml'];
const TEXT_EXT = ['txt', 'log', 'md', 'csv', 'conf', 'cfg', 'ini', 'trace'];

function getEntryIcon(entry: FileEntry): {icon: string; tone: string} {
    if (entry.isDirectory) return {icon: 'fa-folder', tone: 'text-[#7cb4f5]'};
    const ext = getExt(entry.name);
    if (ext === 'apk' || ext === 'apks' || ext === 'xapk') return {icon: 'fa-android fa-brands', tone: 'text-[#3ddc84]'};
    if (IMAGE_EXT.includes(ext)) return {icon: 'fa-file-image', tone: 'text-[#7928ca]'};
    if (VIDEO_EXT.includes(ext)) return {icon: 'fa-file-video', tone: 'text-[#eb367f]'};
    if (AUDIO_EXT.includes(ext)) return {icon: 'fa-file-audio', tone: 'text-[#eb367f]'};
    if (ARCHIVE_EXT.includes(ext)) return {icon: 'fa-file-zipper', tone: 'text-warning'};
    if (CODE_EXT.includes(ext)) return {icon: 'fa-file-code', tone: 'text-mute'};
    if (TEXT_EXT.includes(ext)) return {icon: 'fa-file-lines', tone: 'text-mute'};
    if (ext === 'db' || ext === 'sqlite') return {icon: 'fa-database', tone: 'text-mute'};
    return {icon: 'fa-file', tone: 'text-faint'};
}

function EntryIcon({entry, className = ''}: { entry: FileEntry; className?: string }) {
    const {icon, tone} = getEntryIcon(entry);
    const family = icon.includes('fa-brands') ? '' : 'fa-solid';
    return <i className={`${family} ${icon} ${tone} ${className}`}/>;
}

function FileManager() {
    const {selectedDevice} = useDeviceStore();
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewingFile, setViewingFile] = useState<FileEntry | null>(null);
    const [currentPath, setCurrentPath] = useState(DEFAULT_PATH);
    const [pathInput, setPathInput] = useState(DEFAULT_PATH);
    const [editingPath, setEditingPath] = useState(false);
    const [filterText, setFilterText] = useState('');
    const [uploading, setUploading] = useState(false);
    const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
    const [bookmarks, setBookmarks] = useState<string[]>([]);
    const [pathPending, setPathPending] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const deferredFilterText = useDeferredValue(filterText);
    const breadcrumbRef = useRef<HTMLDivElement>(null);

    const handleView = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;
        setViewingFile(entry);
    }, [selectedDevice]);

    const loadEntries = useCallback(async (path: string): Promise<FileEntry[]> => {
        if (!selectedDevice) return [];

        const normalized = normalizePath(path);
        const result = await ListDirectory(selectedDevice.id, normalized);
        if (result.error) {
            message.error(`加载失败: ${result.error}`);
            return [];
        }
        return parseLsOutput(result.output, normalized, result.dirLinks || []);
    }, [selectedDevice]);

    const openPath = useCallback(async (path: string) => {
        const normalized = normalizePath(path);
        setLoading(true);
        setPathPending(normalized);
        setCurrentPath(normalized);
        setPathInput(normalized);
        setEditingPath(false);
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

    const confirmDelete = useCallback((entry: FileEntry) => {
        Modal.confirm({
            title: `删除${entry.isDirectory ? '文件夹' : '文件'}「${entry.name}」？`,
            content: entry.isDirectory ? '文件夹内的所有内容都会被删除，且无法恢复。' : '删除后无法恢复。',
            okText: '删除',
            cancelText: '取消',
            okButtonProps: {danger: true},
            onOk: async () => handleDelete(entry),
        });
    }, [handleDelete]);

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
            setCurrentPath(DEFAULT_PATH);
            setPathInput(DEFAULT_PATH);
            return;
        }

        openPath(DEFAULT_PATH);
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

    const imageEntries = useMemo(
        () => filteredEntries.filter(entry => !entry.isDirectory && isImageEntry(entry)),
        [filteredEntries],
    );

    const stats = useMemo(() => {
        const dirs = filteredEntries.filter(entry => entry.isDirectory).length;
        return {dirs, files: filteredEntries.length - dirs};
    }, [filteredEntries]);

    const breadcrumbItems = useMemo(() => buildBreadcrumbItems(currentPath), [currentPath]);

    // 路径较深时让面包屑停在末尾，保证当前目录可见
    useEffect(() => {
        const el = breadcrumbRef.current;
        if (el) el.scrollLeft = el.scrollWidth;
    }, [currentPath, editingPath, pathPending]);

    const bookmarkMenuItems: MenuProps['items'] = bookmarks.length > 0
        ? bookmarks.map((path, index) => ({
            key: `${index}-${path}`,
            label: (
                <div className="flex min-w-[240px] items-center justify-between gap-3">
                    <span className="truncate font-mono text-[12px] text-body">{path}</span>
                    <Tooltip title="取消收藏">
                        <CloseOutlined
                            className="shrink-0 text-[11px] text-faint hover:text-error"
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
        : [{key: 'empty', label: <span className="text-[12px] text-faint">暂无收藏，可在文件夹右键菜单中收藏</span>, disabled: true}];

    const buildEntryContextMenu = useCallback((entry: FileEntry): NonNullable<MenuProps['items']> => {
        const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

        const items: NonNullable<MenuProps['items']> = [];
        if (entry.isDirectory) {
            items.push({
                key: 'open',
                label: '打开',
                icon: <FolderOpenOutlined/>,
                onClick: () => handleOpenDirectory(entry),
            });
            items.push({
                key: 'bookmark',
                label: isFav ? '取消收藏' : '收藏路径',
                icon: isFav ? <StarFilled/> : <StarOutlined/>,
                onClick: () => toggleBookmark(entry.fullPath),
            });
        } else {
            items.push({
                key: 'view',
                label: '查看内容',
                icon: <EyeOutlined/>,
                onClick: () => handleView(entry),
            });
        }
        items.push({
            key: 'download',
            label: '下载到电脑',
            icon: <DownloadOutlined/>,
            onClick: () => handleDownload(entry),
        });
        items.push({
            key: 'copy-path',
            label: '复制路径',
            icon: <CopyOutlined/>,
            onClick: () => {
                navigator.clipboard.writeText(entry.fullPath);
                message.success('已复制路径');
            },
        });
        items.push({type: 'divider'});
        items.push({
            key: 'delete',
            label: '删除',
            danger: true,
            icon: <DeleteOutlined/>,
            onClick: () => confirmDelete(entry),
        });

        return items;
    }, [bookmarks, confirmDelete, handleDownload, handleOpenDirectory, handleView, toggleBookmark]);

    const parentPath = getParentPath(currentPath);
    const showParentShortcut = currentPath !== '/' && !deferredFilterText.trim();
    const isCurrentFav = bookmarks.includes(currentPath);

    const renderBody = () => {
        if (!selectedDevice) {
            return (
                <div className="flex h-full items-center justify-center">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先连接设备"/>
                </div>
            );
        }
        if (loading && entries.length === 0) {
            return (
                <div className="flex h-full items-center justify-center">
                    <Spin/>
                </div>
            );
        }
        if (filteredEntries.length === 0 && !showParentShortcut) {
            return (
                <div className="flex h-full items-center justify-center">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filterText ? '没有匹配的文件' : '目录为空'}/>
                </div>
            );
        }

        if (viewMode === 'grid') {
            return (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1 p-3">
                    {showParentShortcut && (
                        <button
                            type="button"
                            onClick={() => openPath(parentPath)}
                            className="flex flex-col items-center gap-2 rounded-lg px-2 pb-2 pt-3 text-center transition-colors hover:bg-canvas"
                        >
                            <span className="flex h-9 items-center text-[26px] text-faint">
                                {pathPending === parentPath ? <LoadingOutlined className="text-[18px]"/> : <i className="fa-solid fa-turn-up"/>}
                            </span>
                            <span className="text-[12px] text-mute">上一级</span>
                        </button>
                    )}

                    {filteredEntries.map(entry => {
                        const isBusy = loadingKeys.has(entry.fullPath);
                        const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

                        return (
                            <Dropdown key={entry.fullPath} trigger={['contextMenu']} menu={{items: buildEntryContextMenu(entry)}}>
                                <button
                                    type="button"
                                    onClick={() => handleOpenDirectory(entry)}
                                    title={entry.linkTarget ? `${entry.name} → ${entry.linkTarget}` : entry.name}
                                    className="flex flex-col items-center gap-2 rounded-lg px-2 pb-2 pt-3 text-center transition-colors hover:bg-canvas focus-visible:bg-hairline-soft focus-visible:outline-none"
                                >
                                    <span className="relative flex h-9 items-center text-[30px] leading-none">
                                        <EntryIcon entry={entry}/>
                                        {entry.linkTarget !== undefined && (
                                            <span className="absolute -bottom-0.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-hairline bg-elevated text-[8px] text-mute">
                                                <i className="fa-solid fa-link"/>
                                            </span>
                                        )}
                                        {(isBusy || isFav) && (
                                            <span className="absolute -right-2 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-hairline bg-elevated text-[9px]">
                                                {isBusy ? <LoadingOutlined className="text-link"/> : <StarFilled className="text-warning"/>}
                                            </span>
                                        )}
                                    </span>
                                    <span className="line-clamp-2 w-full break-all text-[12px] leading-4 text-body">
                                        {entry.name}
                                    </span>
                                </button>
                            </Dropdown>
                        );
                    })}
                </div>
            );
        }

        const columns = 'grid-cols-[minmax(0,1fr)_124px_72px_88px_84px]';
        return (
            <div className="text-[13px]">
                <div className={`sticky top-0 z-[1] grid ${columns} gap-3 border-b border-hairline-soft bg-elevated px-4 py-2`}>
                    {['名称', '修改时间', '大小', '权限', ''].map((label, index) => (
                        <span key={index} className={`font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-mute ${index === 2 ? 'text-right' : ''}`}>
                            {label}
                        </span>
                    ))}
                </div>

                {showParentShortcut && (
                    <button
                        type="button"
                        onClick={() => openPath(parentPath)}
                        className={`grid w-full ${columns} gap-3 border-b border-hairline-soft px-4 py-2 text-left transition-colors hover:bg-canvas`}
                    >
                        <span className="flex items-center gap-3 text-mute">
                            <span className="flex w-5 justify-center">
                                {pathPending === parentPath ? <LoadingOutlined/> : <i className="fa-solid fa-turn-up"/>}
                            </span>
                            上一级
                        </span>
                    </button>
                )}

                {filteredEntries.map(entry => {
                    const isBusy = loadingKeys.has(entry.fullPath);
                    const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

                    return (
                        <Dropdown key={entry.fullPath} trigger={['contextMenu']} menu={{items: buildEntryContextMenu(entry)}}>
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => handleOpenDirectory(entry)}
                                onKeyDown={event => event.key === 'Enter' && handleOpenDirectory(entry)}
                                className={`group grid cursor-pointer ${columns} items-center gap-3 border-b border-hairline-soft px-4 py-1.5 transition-colors last:border-b-0 hover:bg-canvas focus-visible:bg-hairline-soft focus-visible:outline-none`}
                            >
                                <span className="flex min-w-0 items-center gap-3">
                                    <span className="flex w-5 shrink-0 justify-center text-[16px]">
                                        <EntryIcon entry={entry}/>
                                    </span>
                                    <span className="min-w-0 truncate text-ink" title={entry.name}>{entry.name}</span>
                                    {entry.linkTarget && (
                                        <span className="min-w-0 shrink truncate font-mono text-[11px] text-faint" title={entry.linkTarget}>
                                            → {entry.linkTarget}
                                        </span>
                                    )}
                                    {isBusy && <LoadingOutlined className="text-[12px] text-link"/>}
                                    {isFav && <StarFilled className="text-[11px] text-warning"/>}
                                </span>
                                <span className="truncate font-mono text-[12px] tabular-nums text-mute">{entry.date || '-'}</span>
                                <span className="truncate text-right font-mono text-[12px] tabular-nums text-mute">{entry.isDirectory ? '—' : entry.size}</span>
                                <span className="truncate font-mono text-[12px] text-faint">{entry.permissions}</span>
                                <span className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                    {!entry.isDirectory && (
                                        <RowAction title="查看内容" onClick={() => handleView(entry)} icon={<EyeOutlined/>}/>
                                    )}
                                    <RowAction title="下载到电脑" onClick={() => handleDownload(entry)} icon={<DownloadOutlined/>}/>
                                    <RowAction title="删除" danger onClick={() => confirmDelete(entry)} icon={<DeleteOutlined/>}/>
                                </span>
                            </div>
                        </Dropdown>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col gap-5 overflow-hidden bg-canvas px-8 py-7 text-left text-ink">
            <PageHeader
                eyebrow="Files · adb shell"
                title="文件管理"
                description={selectedDevice ? `浏览 ${selectedDevice.name} 上的文件，右键条目查看更多操作` : '连接设备后浏览设备文件'}
                actions={<>
                    <Dropdown menu={{items: bookmarkMenuItems}} trigger={['click']} placement="bottomRight">
                        <Button icon={<StarOutlined/>}>收藏夹{bookmarks.length > 0 ? ` · ${bookmarks.length}` : ''}</Button>
                    </Dropdown>
                    <Button type="primary" icon={<UploadOutlined/>} onClick={handleUpload} loading={uploading} disabled={!selectedDevice}>
                        上传到此处
                    </Button>
                </>}
            />

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-hairline bg-elevated shadow-whisper">
                {/* 路径与工具栏 */}
                <div className="flex items-center gap-2 border-b border-hairline-soft px-3 py-2.5">
                    <Tooltip title="上一级">
                        <Button type="text" icon={<ArrowUpOutlined/>} disabled={currentPath === '/' || !selectedDevice} onClick={() => openPath(parentPath)}/>
                    </Tooltip>
                    <Tooltip title="刷新">
                        <Button type="text" icon={<ReloadOutlined spin={loading}/>} disabled={!selectedDevice} onClick={refreshCurrentPath}/>
                    </Tooltip>

                    <div className="mx-1 h-5 w-px bg-hairline"/>

                    {editingPath ? (
                        <Input
                            autoFocus
                            size="small"
                            value={pathInput}
                            onChange={e => setPathInput(e.target.value)}
                            onPressEnter={handlePathSubmit}
                            onBlur={() => {
                                setEditingPath(false);
                                setPathInput(currentPath);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Escape') {
                                    setEditingPath(false);
                                    setPathInput(currentPath);
                                }
                            }}
                            placeholder="输入路径后回车，如 /sdcard/Download"
                            className="min-w-0 flex-1 !font-mono !text-[13px]"
                        />
                    ) : (
                        <div
                            onDoubleClick={() => selectedDevice && setEditingPath(true)}
                            className="group flex h-8 min-w-0 flex-1 items-center rounded-md hover:bg-canvas"
                        >
                            <div ref={breadcrumbRef} className="flex min-w-0 flex-1 items-center overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {breadcrumbItems.map((item, index) => {
                                const isLast = index === breadcrumbItems.length - 1;
                                const isRoot = item.path === '/';
                                return (
                                    <span key={item.path} className="flex shrink-0 items-center">
                                        <button
                                            type="button"
                                            onClick={() => openPath(item.path)}
                                            className={`rounded px-1.5 py-0.5 font-mono text-[13px] transition-colors ${
                                                isLast ? 'font-medium text-ink' : 'text-mute hover:bg-hairline-soft hover:text-ink'
                                            }`}
                                        >
                                            {pathPending === item.path
                                                ? <LoadingOutlined className="text-[11px]"/>
                                                : isRoot ? <i className="fa-solid fa-hard-drive text-[11px]"/> : item.label}
                                        </button>
                                        {!isLast && <span className="px-0.5 font-mono text-[13px] text-faint">/</span>}
                                    </span>
                                );
                            })}
                            </div>
                            <Tooltip title="编辑路径（双击路径栏）">
                                <button
                                    type="button"
                                    onClick={() => selectedDevice && setEditingPath(true)}
                                    className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                                >
                                    <EditOutlined className="text-[12px]"/>
                                </button>
                            </Tooltip>
                        </div>
                    )}

                    <Tooltip title={isCurrentFav ? '取消收藏当前路径' : '收藏当前路径'}>
                        <Button
                            type="text"
                            disabled={currentPath === '/' || !selectedDevice}
                            onClick={() => toggleBookmark(currentPath)}
                            icon={isCurrentFav ? <StarFilled className="!text-warning"/> : <StarOutlined/>}
                        />
                    </Tooltip>

                    <div className="mx-1 h-5 w-px bg-hairline"/>

                    <Input
                        size="small"
                        placeholder="过滤当前目录"
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        allowClear
                        prefix={<SearchOutlined className="text-faint"/>}
                        className="!w-40"
                    />
                    <Segmented<'grid' | 'list'>
                        size="small"
                        value={viewMode}
                        onChange={value => startTransition(() => setViewMode(value))}
                        options={[
                            {value: 'grid', icon: <AppstoreOutlined/>, title: '图标'},
                            {value: 'list', icon: <BarsOutlined/>, title: '列表'},
                        ]}
                    />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {renderBody()}
                </div>

                <div className="flex items-center justify-between border-t border-hairline-soft px-4 py-2 font-mono text-[11px] tabular-nums text-faint">
                    <span>{stats.dirs} 个文件夹 · {stats.files} 个文件{deferredFilterText.trim() ? ` · 已过滤（共 ${entries.length} 项）` : ''}</span>
                    <span className="truncate pl-4">{selectedDevice?.id ?? '-'}</span>
                </div>
            </section>

            <FilePreviewModal
                deviceId={selectedDevice?.id ?? ''}
                target={viewingFile}
                icon={viewingFile && <EntryIcon entry={viewingFile}/>}
                siblings={imageEntries}
                onNavigate={target => setViewingFile(entries.find(entry => entry.fullPath === target.fullPath) ?? null)}
                onDownload={target => {
                    const entry = entries.find(item => item.fullPath === target.fullPath);
                    if (entry) handleDownload(entry);
                }}
                onClose={() => setViewingFile(null)}
            />
        </div>
    );
}

function RowAction({title, icon, onClick, danger}: {
    title: string;
    icon: ReactNode;
    onClick: () => void;
    danger?: boolean;
}) {
    return (
        <Tooltip title={title}>
            <button
                type="button"
                onClick={event => {
                    event.stopPropagation();
                    onClick();
                }}
                className={`flex h-7 w-7 items-center justify-center rounded-md text-[13px] text-mute transition-colors hover:bg-hairline-soft ${
                    danger ? 'hover:text-error' : 'hover:text-ink'
                }`}
            >
                {icon}
            </button>
        </Tooltip>
    );
}

export default FileManager;
