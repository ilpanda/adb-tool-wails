import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Dropdown, Empty, Input, Modal, Popconfirm, Spin, Tree, Tooltip, message} from 'antd';
import type {TreeDataNode, MenuProps} from 'antd';
import {
    DeleteOutlined,
    DownloadOutlined,
    EyeOutlined,
    ReloadOutlined,
    UploadOutlined,
    EnterOutlined,
    LoadingOutlined,
    StarOutlined,
    StarFilled,
} from '@ant-design/icons';
import {DeleteRemoteFile, DownloadFile, ListDirectory, ReadFileContent, UploadFile, GetBookmarkPaths, SetBookmarkPaths} from "../../wailsjs/go/main/App";
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

type ExtTreeNode = TreeDataNode & {_entry?: FileEntry};

function formatSize(raw: number): string {
    if (raw < 0) return '-';
    if (raw < 1024) return `${raw} B`;
    if (raw < 1024 * 1024) return `${(raw / 1024).toFixed(1)} KB`;
    if (raw < 1024 * 1024 * 1024) return `${(raw / (1024 * 1024)).toFixed(1)} MB`;
    return `${(raw / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function parseLsOutput(output: string, parentPath: string): FileEntry[] {
    const lines = output.split('\n');
    const entries: FileEntry[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('total')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 7) continue;

        const permissions = parts[0];
        const nameStartIndex = 7;
        const nameStr = parts.slice(nameStartIndex).join(' ');
        if (!nameStr) continue;

        // 跳过软链接
        const isSymlink = permissions.startsWith('l');
        if (isSymlink) continue;

        const name = nameStr;

        if (name === '.' || name === '..') continue;

        const isDirectory = permissions.startsWith('d');
        const date = `${parts[5]} ${parts[6]}`;
        const sizeNum = parseInt(parts[4], 10);
        const sizeRaw = isDirectory ? -1 : (isNaN(sizeNum) ? -1 : sizeNum);
        const fullPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;

        entries.push({
            permissions,
            size: formatSize(sizeRaw),
            sizeRaw,
            date,
            name,
            isDirectory,
            fullPath,
        });
    }

    entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
    });

    return entries;
}

/** 纯数据的 TreeNode 构建，title 使用 renderTitle 回调延迟渲染 */
function entriesToTreeData(entries: FileEntry[]): ExtTreeNode[] {
    return entries.map(entry => ({
        key: entry.fullPath,
        title: entry.name,
        icon: entry.isDirectory
            ? <i className="fa-solid fa-folder text-amber-400"/>
            : <i className="fa-regular fa-file text-blue-400 text-xs"/>,
        isLeaf: !entry.isDirectory,
        _entry: entry,
    }));
}

/** 在 nodeMap 中注册节点，用于 O(1) 查找 */
function registerNodes(nodes: ExtTreeNode[], map: Map<string, ExtTreeNode>) {
    for (const node of nodes) {
        map.set(node.key as string, node);
        if (node.children) registerNodes(node.children as ExtTreeNode[], map);
    }
}

function FileManager() {
    const {selectedDevice} = useDeviceStore();
    const [treeData, setTreeData] = useState<ExtTreeNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [viewingFileName, setViewingFileName] = useState('');
    const [fileLoading, setFileLoading] = useState(false);
    const [pathInput, setPathInput] = useState('/');
    const [filterText, setFilterText] = useState('');
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
    const [uploading, setUploading] = useState(false);
    const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
    const [treeHeight, setTreeHeight] = useState(400);
    const [bookmarks, setBookmarks] = useState<string[]>([]);
    const treeContainerRef = useRef<HTMLDivElement>(null);
    // 节点索引 Map，key -> node 引用
    const nodeMapRef = useRef<Map<string, ExtTreeNode>>(new Map());
    // 存储每个路径对应的 entries 用于过滤
    const entriesMapRef = useRef<Map<string, FileEntry[]>>(new Map());
    const refreshPathRef = useRef<(path: string) => Promise<void>>();

    const handleView = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;
        setFileLoading(true);
        setViewingFileName(entry.name);
        setFileContent(null);
        ReadFileContent(selectedDevice.id, entry.fullPath).then(result => {
            if (result.error) {
                message.error(`读取失败: ${result.error}`);
                return;
            }
            setFileContent(result.res);
        }).catch(e => {
            message.error(`读取失败: ${e.message || e}`);
        }).finally(() => setFileLoading(false));
    }, [selectedDevice]);

    const handleDelete = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;
        DeleteRemoteFile(selectedDevice.id, entry.fullPath).then(result => {
            if (result.error) {
                message.error(`删除失败: ${result.error}`);
                return;
            }
            message.success(`已删除: ${entry.name}`);
            const parentPath = entry.fullPath.substring(0, entry.fullPath.lastIndexOf('/')) || '/';
            refreshPathRef.current?.(parentPath);
        }).catch(e => message.error(`删除失败: ${e.message || e}`));
    }, [selectedDevice]);

    const handleDownload = useCallback((entry: FileEntry) => {
        if (!selectedDevice) return;
        DownloadFile(selectedDevice.id, entry.fullPath).then(result => {
            if (result.error) {
                if (result.error !== '已取消') message.error(`下载失败: ${result.error}`);
                return;
            }
            message.success(`下载完成: ${entry.name}`);
        }).catch(e => message.error(`下载失败: ${e.message || e}`));
    }, [selectedDevice]);

    const loadEntries = useCallback(async (path: string): Promise<FileEntry[]> => {
        if (!selectedDevice) return [];
        const result = await ListDirectory(selectedDevice.id, path);
        if (result.error) {
            message.error(`加载失败: ${result.error}`);
            return [];
        }
        const entries = parseLsOutput(result.res, path);
        entriesMapRef.current.set(path, entries);
        return entries;
    }, [selectedDevice]);

    const toggleBookmark = useCallback((path: string) => {
        if (path === '/') return;
        setBookmarks(prev => {
            const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
            SetBookmarkPaths(next);
            return next;
        });
    }, []);

    // titleRender：按需渲染每个节点的标题，避免存储大量 JSX
    const titleRender = useCallback((nodeData: any) => {
        const entry = nodeData._entry as FileEntry | undefined;
        if (!entry) return nodeData.title;

        const isNodeLoading = loadingKeys.has(entry.fullPath);
        const isFav = entry.isDirectory && bookmarks.includes(entry.fullPath);

        return (
            <div className="flex items-center gap-2 group py-0.5 w-full min-w-0">
                <span className="truncate text-gray-800 text-sm">{entry.name}</span>
                {isNodeLoading && <LoadingOutlined className="text-blue-400 text-xs"/>}
                <span className="text-gray-400 text-xs font-mono flex-shrink-0">{entry.size}</span>
                <span className="text-gray-300 text-xs font-mono flex-shrink-0">{entry.permissions}</span>
                <span className="text-gray-300 text-xs flex-shrink-0">{entry.date}</span>
                {/* 操作按钮，hover 时显示 */}
                <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0 flex-shrink-0 ml-auto"
                      onClick={e => e.stopPropagation()}>
                    {entry.isDirectory && (
                        <Tooltip title={isFav ? '取消收藏' : '收藏路径'}>
                            <Button type="text" size="small"
                                    icon={isFav ? <StarFilled className="!text-yellow-400"/> : <StarOutlined/>}
                                    onClick={() => toggleBookmark(entry.fullPath)}
                                    className="!text-gray-400 hover:!text-yellow-500"/>
                        </Tooltip>
                    )}
                    {!entry.isDirectory && (
                        <Tooltip title="查看">
                            <Button type="text" size="small" icon={<EyeOutlined/>}
                                    onClick={() => handleView(entry)}
                                    className="!text-gray-400 hover:!text-blue-500"/>
                        </Tooltip>
                    )}
                    <Tooltip title="下载">
                        <Button type="text" size="small" icon={<DownloadOutlined/>}
                                onClick={() => handleDownload(entry)}
                                className="!text-gray-400 hover:!text-green-500"/>
                    </Tooltip>
                    <Popconfirm
                        title="确认删除"
                        description={`确定要删除 ${entry.name} 吗？`}
                        onConfirm={() => handleDelete(entry)}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{danger: true}}
                    >
                        <Tooltip title="删除">
                            <Button type="text" size="small" danger icon={<DeleteOutlined/>}
                                    className="!text-gray-400 hover:!text-red-500"/>
                        </Tooltip>
                    </Popconfirm>
                </span>
            </div>
        );
    }, [handleView, handleDelete, handleDownload, loadingKeys, bookmarks, toggleBookmark]);

    // 加载根目录（重置展开状态）
    const loadRoot = useCallback(async (rootPath: string = '/') => {
        setLoading(true);
        entriesMapRef.current.clear();
        nodeMapRef.current.clear();
        try {
            const entries = await loadEntries(rootPath);
            const nodes = entriesToTreeData(entries);
            registerNodes(nodes, nodeMapRef.current);
            setTreeData(nodes);
            setExpandedKeys([]);
        } finally {
            setLoading(false);
        }
    }, [loadEntries]);

    // 刷新当前树（保留展开状态）
    const refreshTree = useCallback(async (rootPath: string = '/') => {
        setLoading(true);
        entriesMapRef.current.clear();
        nodeMapRef.current.clear();
        try {
            const entries = await loadEntries(rootPath);
            const nodes = entriesToTreeData(entries);
            registerNodes(nodes, nodeMapRef.current);
            setTreeData(nodes);
            // 保留 expandedKeys，已展开的目录会通过 loadData 自动重新加载
        } finally {
            setLoading(false);
        }
    }, [loadEntries]);

    // 刷新指定路径
    const refreshPath = useCallback(async (path: string) => {
        const entries = await loadEntries(path);
        const newChildren = entriesToTreeData(entries);
        registerNodes(newChildren, nodeMapRef.current);

        if (path === '/' || path === pathInput) {
            setTreeData(newChildren);
            return;
        }

        // 通过 nodeMap 直接找到父节点并更新
        const parentNode = nodeMapRef.current.get(path);
        if (parentNode) {
            parentNode.children = newChildren;
            setTreeData(prev => [...prev]); // 触发重渲染
        } else {
            // 回退到递归方式
            const updateChildren = (nodes: ExtTreeNode[]): ExtTreeNode[] => {
                return nodes.map(node => {
                    if (node.key === path) return {...node, children: newChildren};
                    if (node.children) return {...node, children: updateChildren(node.children as ExtTreeNode[])};
                    return node;
                });
            };
            setTreeData(prev => updateChildren(prev));
        }
    }, [loadEntries, pathInput]);
    refreshPathRef.current = refreshPath;

    useEffect(() => {
        if (selectedDevice) {
            loadRoot('/');
            setPathInput('/');
        }
    }, [selectedDevice?.id]);

    // 监听树容器高度变化，驱动虚拟滚动
    useEffect(() => {
        const el = treeContainerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                setTreeHeight(Math.floor(entry.contentRect.height));
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 加载收藏路径
    useEffect(() => {
        GetBookmarkPaths().then(paths => setBookmarks(paths || []));
    }, []);

    const bookmarkMenuItems: MenuProps['items'] = bookmarks.length > 0
        ? bookmarks.map((p, i) => ({
            key: i,
            label: (
                <div className="flex items-center justify-between gap-3 min-w-[200px]">
                    <span className="font-mono text-sm truncate">{p}</span>
                    <Tooltip title="取消收藏">
                        <DeleteOutlined
                            className="text-gray-400 hover:text-red-500 flex-shrink-0"
                            onClick={e => { e.stopPropagation(); toggleBookmark(p); }}
                        />
                    </Tooltip>
                </div>
            ),
            onClick: () => { setPathInput(p); loadRoot(p); },
        }))
        : [{key: 'empty', label: <span className="text-gray-400 text-sm">暂无收藏路径</span>, disabled: true}];

    // 懒加载子目录
    const onLoadData = useCallback(async (treeNode: any) => {
        const entry = treeNode._entry as FileEntry | undefined;
        if (!entry || treeNode.children) return;

        const key = entry.fullPath;
        setLoadingKeys(prev => new Set(prev).add(key));

        try {
            const entries = await loadEntries(key);
            const children = entriesToTreeData(entries);
            registerNodes(children, nodeMapRef.current);

            // 通过 nodeMap O(1) 找到目标节点
            const targetNode = nodeMapRef.current.get(key);
            if (targetNode) {
                targetNode.children = children;
                setTreeData(prev => [...prev]);
            } else {
                // 回退到递归
                setTreeData(prev => {
                    const updateTree = (nodes: ExtTreeNode[]): ExtTreeNode[] => {
                        return nodes.map(node => {
                            if (node.key === key) return {...node, children};
                            if (node.children) return {...node, children: updateTree(node.children as ExtTreeNode[])};
                            return node;
                        });
                    };
                    return updateTree(prev);
                });
            }
        } finally {
            setLoadingKeys(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    }, [loadEntries]);

    // 点击节点时，如果是文件夹则 toggle 展开/收起
    const handleSelect = useCallback((_: React.Key[], info: any) => {
        const entry = info.node?._entry as FileEntry | undefined;
        if (!entry || !entry.isDirectory) return;
        const key = entry.fullPath;
        setExpandedKeys(prev =>
            prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
        );
    }, []);

    const handlePathSubmit = () => {
        const trimmed = pathInput.trim();
        if (!trimmed || !trimmed.startsWith('/')) return;
        const normalized = trimmed.replace(/\/+/g, '/') || '/';
        setPathInput(normalized);
        loadRoot(normalized);
    };

    const handleUpload = async () => {
        if (!selectedDevice) {
            message.warning('请先连接设备');
            return;
        }
        const dest = pathInput.trim() || '/sdcard/';
        setUploading(true);
        try {
            const result = await UploadFile(selectedDevice.id, dest);
            if (result.error) {
                if (result.error !== '已取消') message.error(`上传失败: ${result.error}`);
                return;
            }
            message.success('上传成功');
            loadRoot(pathInput);
        } catch (e: any) {
            message.error(`上传失败: ${e.message || e}`);
        } finally {
            setUploading(false);
        }
    };

    // 过滤树节点
    const filteredTreeData = useMemo(() => {
        if (!filterText) return treeData;
        const lower = filterText.toLowerCase();

        const filterNodes = (nodes: ExtTreeNode[]): ExtTreeNode[] => {
            const result: ExtTreeNode[] = [];
            for (const node of nodes) {
                const entry = node._entry;
                const nameMatch = entry?.name.toLowerCase().includes(lower);
                const filteredChildren = node.children ? filterNodes(node.children as ExtTreeNode[]) : [];

                if (nameMatch || filteredChildren.length > 0) {
                    result.push({
                        ...node,
                        children: filteredChildren.length > 0 ? filteredChildren : node.children,
                    });
                }
            }
            return result;
        };

        return filterNodes(treeData);
    }, [treeData, filterText]);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-50">
            {/* 顶部工具栏 */}
            <div className="flex flex-col gap-3 px-4 py-4 bg-white border-b border-gray-200 flex-shrink-0">
                {/* 第一行：标题 + 路径 + 按钮组 */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <i className="fa-solid fa-folder-open text-yellow-500 text-lg"/>
                        <span className="font-medium text-gray-800 text-base">文件管理</span>
                    </div>
                    <Input
                        size="middle"
                        value={pathInput}
                        onChange={e => setPathInput(e.target.value)}
                        onPressEnter={handlePathSubmit}
                        placeholder="输入路径跳转，如 /sdcard/Download"
                        suffix={
                            <EnterOutlined
                                className="text-gray-400 cursor-pointer hover:text-blue-500"
                                onClick={handlePathSubmit}
                            />
                        }
                        className="flex-1"
                        style={{fontFamily: 'monospace'}}
                    />
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <Dropdown menu={{items: bookmarkMenuItems}} trigger={['click']}>
                            <Tooltip title="收藏夹">
                                <Button size="middle" icon={<StarOutlined/>}>
                                    收藏
                                </Button>
                            </Tooltip>
                        </Dropdown>
                        <Button
                            icon={<UploadOutlined/>}
                            size="middle"
                            onClick={handleUpload}
                            loading={uploading}
                        >
                            上传
                        </Button>
                        <Button
                            icon={<ReloadOutlined/>}
                            size="middle"
                            onClick={() => refreshTree(pathInput)}
                            loading={loading}
                        >
                            刷新
                        </Button>
                    </div>
                </div>
                {/* 第二行：过滤 */}
                <div className="flex items-center">
                    <Input
                        size="middle"
                        placeholder="过滤文件名..."
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        allowClear
                        prefix={<i className="fa-solid fa-filter text-gray-400"/>}
                    />
                </div>
            </div>

            {/* 文件树 */}
            <div className="flex-1 overflow-hidden px-2 py-2" ref={treeContainerRef}>
                {!selectedDevice ? (
                    <div className="flex items-center justify-center h-full">
                        <Empty description="请先连接设备"/>
                    </div>
                ) : loading && treeData.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <Spin tip="加载中..."/>
                    </div>
                ) : filteredTreeData.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <Empty description={filterText ? '无匹配文件' : '目录为空'}/>
                    </div>
                ) : (
                    <Tree
                        showIcon
                        blockNode
                        virtual
                        height={treeHeight}
                        loadData={onLoadData}
                        treeData={filteredTreeData}
                        expandedKeys={expandedKeys}
                        onExpand={(keys) => setExpandedKeys(keys)}
                        onSelect={handleSelect}
                        titleRender={titleRender}
                        className="file-tree"
                        style={{background: 'transparent'}}
                    />
                )}
            </div>

            {/* 文件内容查看 Modal */}
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
                    <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
                        {fileContent}
                    </pre>
                )}
            </Modal>
        </div>
    );
}

export default FileManager;
