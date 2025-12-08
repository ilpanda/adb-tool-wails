// components/ApplicationList.tsx
import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import { Input, Select, message, Space, Button, Progress, Empty, Spin, Pagination, Typography } from 'antd';
import { SearchOutlined, ReloadOutlined, AppstoreOutlined, ClockCircleOutlined, FolderOutlined } from '@ant-design/icons';
import { useDeviceStore } from '../store/deviceStore';
import { useAppListStore, PackageInfo, ProgressInfo } from '../store/appListStore';
import {GetApplicationListWithProgress, CancelApplicationListLoading, LogMsg} from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

const { Paragraph } = Typography;

type FilterType = 'all' | 'user' | 'system';

const formatTime = (timestamp: number) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleDateString('zh-CN');
};

function ApplicationList() {
    const { devices, selectedDevice } = useDeviceStore();
    const {
        apps,
        isLoading,
        progress,
        loadedDeviceId,
        setApps,
        getAppsFromCache,
        setLoading,
        setProgress,
    } = useAppListStore();

    const [searchText, setSearchText] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const mountedRef = useRef(true);
    const loadIdRef = useRef(0);
    const isLoadingRef = useRef(false);  // 新增：跟踪是否正在加载

    // 获取当前设备的 deviceId 参数
    const getDeviceIdParam = useCallback(() => {
        return devices.length > 1 && selectedDevice ? selectedDevice.id : '';
    }, [devices.length, selectedDevice]);

    // 组件挂载/卸载处理
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // 只有在正在加载时才取消
            if (isLoadingRef.current) {
                CancelApplicationListLoading().catch(() => {});
            }
        };
    }, []);

    // 监听进度事件
    useEffect(() => {
        const handleProgress = (data: ProgressInfo) => {
            if (mountedRef.current) {
                setProgress(data);
            }
        };

        EventsOn('app-list-progress', handleProgress);
        return () => {
            EventsOff('app-list-progress');
        };
    }, [setProgress]);

    // 加载应用列表
// 直接定义普通函数
    const doLoadApps = async (forceRefresh = false) => {
        if (!selectedDevice) {
            return;
        }

        const deviceIdParam = getDeviceIdParam();

        if (!forceRefresh) {
            const cached = getAppsFromCache(deviceIdParam);
            if (cached && cached.length > 0) {
                if (loadedDeviceId !== deviceIdParam) {
                    setApps(deviceIdParam, cached);
                }
                setLoading(false);
                console.log('Using cached app list for device:', deviceIdParam || 'default');
                return;
            }
        }

        loadIdRef.current++;
        const currentLoadId = loadIdRef.current;

        setLoading(true);
        setProgress(null);
        setCurrentPage(1);
        isLoadingRef.current = true;

        try {
            const result = await GetApplicationListWithProgress(deviceIdParam);

            if (!mountedRef.current || loadIdRef.current !== currentLoadId) {
                return;
            }

            if (result && result.length > 0) {
                setApps(deviceIdParam, result);
                message.success(`成功加载 ${result.length} 个应用`);
            } else {
                setApps(deviceIdParam, []);
                message.info('未找到应用');
            }
        } catch (error: any) {
            if (!mountedRef.current || loadIdRef.current !== currentLoadId) {
                return;
            }

            const errorStr = error?.toString() || '';
            if (errorStr.includes('cancel') || errorStr.includes('context')) {
                return;
            }

            message.error(`加载失败: ${errorStr}`);
            setApps(deviceIdParam, []);
        } finally {
            isLoadingRef.current = false;
            setLoading(false);
        }
    };

    // 设备变化时自动加载（优先使用缓存）
    useEffect(() => {
        if (selectedDevice) {
            const deviceIdParam = getDeviceIdParam();
            const cached = getAppsFromCache(deviceIdParam);
            // 没有缓存才强制刷新
            const forceRefresh = !cached || cached.length === 0;
            doLoadApps(forceRefresh);
        } else {
            // 设备断开时，清除缓存
            useAppListStore.getState().clearCache();  // 清除所有缓存
            useAppListStore.setState({
                apps: [],
                isLoading: false,
                progress: null,
            });
        }
    }, [selectedDevice?.id]);

    // 手动刷新（强制重新加载）
    const handleRefresh = () => {
        if (!selectedDevice) {
            message.warning('请先连接设备');
            return;
        }
        doLoadApps(true);
    };

    // 过滤应用列表
    const filteredApps = useMemo(() => {
        let result = apps;

        switch (filterType) {
            case 'user':
                result = result.filter(app => !app.system);
                break;
            case 'system':
                result = result.filter(app => app.system);
                break;
        }

        if (searchText.trim()) {
            const searchLower = searchText.toLowerCase();
            result = result.filter(app =>
                app.packageName.toLowerCase().includes(searchLower) ||
                app.label.toLowerCase().includes(searchLower)
            );
        }

        return result;
    }, [apps, searchText, filterType]);

    // 筛选条件变化时重置页码
    useEffect(() => {
        setCurrentPage(1);
    }, [searchText, filterType]);

    // 分页
    const paginatedApps = useMemo(() => {
        const startIndex = (currentPage - 1) * pageSize;
        return filteredApps.slice(startIndex, startIndex + pageSize);
    }, [filteredApps, currentPage, pageSize]);

    // 统计
    const stats = useMemo(() => ({
        total: apps.length,
        user: apps.filter(app => !app.system).length,
        system: apps.filter(app => app.system).length,
    }), [apps]);

    const handlePageChange = (page: number, size: number) => {
        setCurrentPage(page);
        setPageSize(size);
    };

    // 判断是否显示空状态
    const showEmpty = !isLoading && apps.length === 0;
    const showLoading = isLoading && apps.length === 0;

    return (
        <div className="flex flex-col h-full flex-1 min-w-0 bg-gray-50">
            {/* 头部工具栏 */}
            <div className="bg-white border-b border-gray-200 p-4 space-y-4 flex-shrink-0">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                        <Input
                            placeholder="搜索应用名称或包名..."
                            prefix={<SearchOutlined />}
                            value={searchText}
                            onChange={(e) => setSearchText(e.target.value)}
                            allowClear
                            className="max-w-md"
                        />
                        <Select
                            value={filterType}
                            onChange={setFilterType}
                            className="w-40"
                            options={[
                                { label: `全部应用 (${stats.total})`, value: 'all' },
                                { label: `用户应用 (${stats.user})`, value: 'user' },
                                { label: `系统应用 (${stats.system})`, value: 'system' },
                            ]}
                        />
                    </div>
                    <Space>
                        <span className="text-sm text-gray-500">
                            {filteredApps.length === apps.length
                                ? `共 ${apps.length} 个应用`
                                : `筛选出 ${filteredApps.length} / ${apps.length} 个应用`
                            }
                        </span>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={handleRefresh}
                            loading={isLoading}
                            disabled={isLoading}
                        >
                            刷新
                        </Button>
                    </Space>
                </div>

                {/* 进度条 */}
                {progress && !progress.completed && isLoading && (
                    <Progress
                        percent={progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
                        status="active"
                        format={() => `${progress.current} / ${progress.total}`}
                    />
                )}
            </div>

            {/* 内容区域 */}
            <div className="flex-1 min-h-0 overflow-auto p-6">
                {showLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Spin size="large" tip="正在加载应用列表..." />
                    </div>
                ) : showEmpty ? (
                    <div className="flex items-center justify-center h-full">
                        <Empty description={selectedDevice ? "暂无应用数据，点击刷新加载" : "请先连接设备"} />
                    </div>
                ) : filteredApps.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <Empty description="未找到匹配的应用" />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {paginatedApps.map((app) => (
                            <AppCard key={app.packageName} app={app} />
                        ))}
                    </div>
                )}
            </div>

            {/* 分页器 */}
            {filteredApps.length > 0 && (
                <div className="bg-white border-t border-gray-200 px-6 py-4 flex-shrink-0">
                    <Pagination
                        current={currentPage}
                        pageSize={pageSize}
                        total={filteredApps.length}
                        onChange={handlePageChange}
                        showSizeChanger
                        showQuickJumper
                        showTotal={(total, range) => `第 ${range[0]}-${range[1]} 项，共 ${total} 项`}
                        pageSizeOptions={['12', '20', '40', '60', '100']}
                    />
                </div>
            )}
        </div>
    );
}

// 使用 memo 优化 AppCard，避免不必要的重渲染
const AppCard = memo(function AppCard({ app }: { app: PackageInfo }) {
    return (
        <div className="bg-white rounded-lg shadow-sm hover:shadow-md transition-all duration-200 p-4 border border-gray-100 h-full flex flex-col">
            <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-blue-50 to-blue-100 overflow-hidden border border-blue-200">
                    {app.icon ? (
                        <img
                            src={app.icon}
                            alt={app.label}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <AppstoreOutlined className={`text-2xl ${app.system ? 'text-orange-500' : 'text-blue-500'}`} />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-800 truncate text-sm mb-1.5" title={app.label}>
                        {app.label}
                    </h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${app.system ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {app.system ? '系统应用' : '用户应用'}
                    </span>
                </div>
            </div>

            <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">包名</p>
                <Paragraph
                    className="!text-xs !font-mono !text-gray-700 !mb-0 bg-gray-50 px-2 py-1.5 rounded"
                    copyable={{ tooltips: ['复制', '已复制'] }}
                    ellipsis={{ rows: 1, tooltip: app.packageName }}
                >
                    {app.packageName}
                </Paragraph>
            </div>

            <div className="flex items-center justify-between text-xs mb-3 pb-3 border-b border-gray-100">
                <div>
                    <span className="text-gray-500">版本：</span>
                    <span className="font-medium text-gray-700">{app.versionName || '-'}</span>
                </div>
                <div>
                    <span className="text-gray-500">Code：</span>
                    <span className="font-medium text-gray-700">{app.versionCode || '-'}</span>
                </div>
            </div>

            <div className="mb-3 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-1.5 text-xs mb-1">
                    <FolderOutlined className="text-gray-400" />
                    <span className="text-gray-500">APK 路径</span>
                </div>
                <Paragraph
                    className="!text-xs !font-mono !text-gray-600 !mb-0 bg-gray-50 px-2 py-1.5 rounded break-all"
                    copyable={{ tooltips: ['复制', '已复制'] }}
                >
                    {app.apkPath || '-'}
                </Paragraph>
            </div>

            <div className="space-y-1.5 mb-3 pb-3 border-b border-gray-100">
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                        <ClockCircleOutlined className="text-gray-400" />
                        <span className="text-gray-500">首次安装：</span>
                    </div>
                    <span className="text-gray-600">{formatTime(app.firstInstallTime)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                        <ClockCircleOutlined className="text-gray-400" />
                        <span className="text-gray-500">最后更新：</span>
                    </div>
                    <span className="text-gray-600">{formatTime(app.lastUpdateTime)}</span>
                </div>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-600 mt-auto">
                <div>
                    <span className="text-gray-500">Min SDK：</span>
                    <span className="font-medium">{app.minSdkVersion || '-'}</span>
                </div>
                <div>
                    <span className="text-gray-500">Target：</span>
                    <span className="font-medium">{app.targetSdkVersion || '-'}</span>
                </div>
            </div>
        </div>
    );
});

export default ApplicationList;