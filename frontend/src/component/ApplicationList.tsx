// components/ApplicationList.tsx
import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Dropdown, Empty, Input, message, Pagination, Progress, Segmented, Spin, Tooltip, Typography} from 'antd';
import type {MenuProps} from 'antd';
import {AppstoreOutlined, MoreOutlined, ReloadOutlined, SearchOutlined} from '@ant-design/icons';
import {useDeviceStore} from '../store/deviceStore';
import {PackageInfo, useAppListStore} from '../store/appListStore';
import {usePackageListStore} from '../store/packageListStore';
import {usePerfMonitorStore} from '../store/perfMonitorStore';
import {useNavStore, VIEW} from '../store/navStore';
import {ActionType, quickActions} from '../data/quickActions';
import {runQuickAction} from '../actions/runQuickAction';
import PageHeader from './PageHeader';

const {Paragraph} = Typography;

type FilterType = 'all' | 'user' | 'system';

const formatTime = (timestamp: number) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleDateString('zh-CN');
};

// 卡片操作复用快捷功能的定义：确认框、执行记录与结果提示都与快捷功能一致
const ALL_ACTIONS = quickActions.flatMap(section => section.items);
const quickAction = (action: ActionType) => ALL_ACTIONS.find(item => item.action === action)!;

type CardAction = 'launch' | 'perf' | 'target' | 'export' | 'uninstall';

function ApplicationList() {
    const {selectedDevice} = useDeviceStore();
    const {apps, isLoading, progress, load} = useAppListStore();
    const targetPackage = usePackageListStore(state =>
        selectedDevice ? state.targetByDevice[selectedDevice.id] ?? '' : '');

    const [searchText, setSearchText] = useState('');
    const [filterType, setFilterType] = useState<FilterType>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const mountedRef = useRef(true);

    // 离开页面不取消加载：加载由 store 持有，会在后台继续完成并写入缓存
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // 优先使用缓存（含后台预加载的结果）；预加载仍在进行时复用同一次加载
    const loadApps = async (force = false) => {
        if (!selectedDevice) {
            return;
        }
        if (force) {
            setCurrentPage(1);
        }
        const result = await load(selectedDevice.id, {force});
        if (!mountedRef.current) {
            return;
        }
        if (result.status === 'loaded') {
            if (result.count > 0) {
                message.success(`成功加载 ${result.count} 个应用`);
            } else {
                message.info('未找到应用');
            }
        } else if (result.status === 'error') {
            message.error(`加载失败: ${result.error}`);
        }
    };

    // 设备变化时加载（设备断开时的清理由 useAppListPreload 负责）
    useEffect(() => {
        if (selectedDevice) {
            loadApps(false);
        }
    }, [selectedDevice?.id]);

    // 手动刷新（强制重新加载）
    const handleRefresh = () => {
        if (!selectedDevice) {
            message.warning('请先连接设备');
            return;
        }
        loadApps(true);
    };

    const handleAction = useCallback(async (action: CardAction, app: PackageInfo) => {
        if (!selectedDevice) {
            message.warning('请先连接设备');
            return;
        }
        const deviceId = selectedDevice.id;
        const ctx = {packageName: app.packageName, deviceId, deviceName: selectedDevice.name};
        switch (action) {
            case 'launch':
                await runQuickAction(quickAction('launch-app'), ctx);
                return;
            case 'export':
                await runQuickAction(quickAction('export-app'), ctx);
                return;
            case 'uninstall': {
                const outcome = await runQuickAction(quickAction('uninstall-app'), ctx);
                if (outcome && outcome.task.status === 'success') {
                    useAppListStore.getState().removeApp(deviceId, app.packageName);
                    usePackageListStore.getState().removePackage(deviceId, app.packageName);
                }
                return;
            }
            case 'target':
                usePackageListStore.getState().setTarget(deviceId, app.packageName);
                message.success(`已将 ${app.label} 设为快捷功能的目标应用`);
                return;
            case 'perf': {
                const perf = usePerfMonitorStore.getState();
                if (perf.running && perf.packageName !== app.packageName) {
                    message.warning(`性能监控正在监控 ${perf.packageName}，请先停止后再切换`);
                } else if (!perf.running) {
                    perf.setPackageName(app.packageName);
                }
                useNavStore.getState().setView(VIEW.perfMonitor);
                return;
            }
        }
    }, [selectedDevice]);

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
        <div className="flex h-full min-w-0 flex-1 flex-col gap-5 overflow-hidden bg-canvas px-8 py-7 text-left text-ink">
            <PageHeader
                eyebrow="Apps · aya"
                title="应用列表"
                description={selectedDevice ? `${selectedDevice.name} 上已安装的应用，可直接启动、导出或卸载` : '连接设备后查看已安装的应用'}
                actions={
                    <Button icon={<ReloadOutlined/>} onClick={handleRefresh} loading={isLoading} disabled={!selectedDevice}>
                        刷新
                    </Button>
                }
            />

            {/* 搜索与筛选 */}
            <div className="rounded-xl border border-hairline bg-elevated px-4 py-3 shadow-whisper">
                <div className="flex flex-wrap items-center gap-3">
                    <Input
                        placeholder="搜索应用名称或包名"
                        prefix={<SearchOutlined className="text-faint"/>}
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        allowClear
                        className="max-w-sm flex-1"
                    />
                    <Segmented
                        value={filterType}
                        onChange={(value) => setFilterType(value as FilterType)}
                        options={[
                            {label: `全部 ${stats.total}`, value: 'all'},
                            {label: `用户 ${stats.user}`, value: 'user'},
                            {label: `系统 ${stats.system}`, value: 'system'},
                        ]}
                    />
                    <span className="ml-auto text-[12px] text-mute">
                        {filteredApps.length === apps.length
                            ? `共 ${apps.length} 个应用`
                            : `筛选出 ${filteredApps.length} / ${apps.length} 个应用`}
                    </span>
                </div>
                {progress && !progress.completed && isLoading && (
                    <Progress
                        className="!mb-0 !mt-2"
                        size="small"
                        percent={progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
                        status="active"
                        format={() => `${progress.current} / ${progress.total}`}
                    />
                )}
            </div>

            {/* 内容区域 */}
            <div className="min-h-0 flex-1 overflow-auto">
                {showLoading ? (
                    <div className="flex h-full items-center justify-center">
                        <Spin size="large" tip="正在加载应用列表..."/>
                    </div>
                ) : showEmpty ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty description={selectedDevice ? '暂无应用数据，点击刷新加载' : '请先连接设备'}/>
                    </div>
                ) : filteredApps.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty description="未找到匹配的应用"/>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {paginatedApps.map((app) => (
                            <AppCard key={app.packageName} app={app} isTarget={app.packageName === targetPackage} onAction={handleAction}/>
                        ))}
                    </div>
                )}
            </div>

            {/* 分页器 */}
            {filteredApps.length > 0 && (
                <div className="flex justify-end">
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

function InfoRow({label, children}: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="shrink-0 text-mute">{label}</span>
            <span className="min-w-0 truncate text-right text-body">{children}</span>
        </div>
    );
}

function CopyBlock({label, value}: { label: string; value: string }) {
    return (
        <div>
            <div className="mb-1 text-[12px] text-mute">{label}</div>
            <Paragraph
                className="!mb-0 break-all rounded-md bg-canvas px-2 py-1.5 !font-mono !text-[11px] !text-body"
                copyable={{tooltips: ['复制', '已复制']}}
            >
                {value}
            </Paragraph>
        </div>
    );
}

interface AppCardProps {
    app: PackageInfo;
    isTarget: boolean;
    onAction: (action: CardAction, app: PackageInfo) => void;
}

// 使用 memo 优化 AppCard，避免不必要的重渲染
const AppCard = memo(function AppCard({app, isTarget, onAction}: AppCardProps) {
    const moreItems: MenuProps['items'] = [
        {key: 'target', icon: <i className="fa-solid fa-location-crosshairs w-4 text-[12px]"/>, label: '设为目标应用', disabled: isTarget},
        {key: 'export', icon: <i className="fa-solid fa-download w-4 text-[12px]"/>, label: '导出 APK'},
        {type: 'divider'},
        {key: 'uninstall', icon: <i className="fa-solid fa-circle-minus w-4 text-[12px]"/>, label: '卸载', danger: true},
    ];

    return (
        <div className="flex h-full flex-col rounded-xl border border-hairline bg-elevated shadow-whisper transition-shadow hover:shadow-floating">
            <div className="flex items-start gap-3 px-4 pt-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-hairline bg-canvas">
                    {app.icon ? (
                        <img src={app.icon} alt={app.label} className="h-full w-full object-cover" loading="lazy"/>
                    ) : (
                        <AppstoreOutlined className="text-[20px] text-faint"/>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                        <h3 className="truncate text-[14px] font-semibold text-ink" title={app.label}>{app.label}</h3>
                        {isTarget && (
                            <Tooltip title="快捷功能当前的目标应用">
                                <i className="fa-solid fa-location-crosshairs shrink-0 text-[11px] text-link"/>
                            </Tooltip>
                        )}
                    </div>
                    <Paragraph
                        className="!mb-0 !font-mono !text-[11.5px] !text-mute"
                        copyable={{tooltips: ['复制包名', '已复制']}}
                        ellipsis={{rows: 1, tooltip: app.packageName}}
                    >
                        {app.packageName}
                    </Paragraph>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    app.system ? 'bg-hairline-soft text-mute' : 'bg-link-soft text-link-deep'
                }`}>
                    {app.system ? '系统' : '用户'}
                </span>
            </div>

            <div className="mt-3 space-y-1.5 border-t border-hairline-soft px-4 py-3">
                <InfoRow label="版本">
                    <span className="font-mono">{app.versionName || '-'}</span>
                    <span className="text-faint"> · {app.versionCode || '-'}</span>
                </InfoRow>
                <InfoRow label="SDK">
                    <span className="font-mono">min {app.minSdkVersion || '-'} · target {app.targetSdkVersion || '-'}</span>
                </InfoRow>
                <InfoRow label="首次安装">{formatTime(app.firstInstallTime)}</InfoRow>
                <InfoRow label="最后更新">{formatTime(app.lastUpdateTime)}</InfoRow>
            </div>

            <div className="space-y-2.5 border-t border-hairline-soft px-4 py-3">
                <CopyBlock label="APK 路径" value={app.apkPath || '-'}/>
                {app.signatureSha256s?.map((sha256, index) => (
                    <CopyBlock key={index} label={index === 0 ? '签名 SHA256' : `签名 SHA256 #${index + 1}`} value={sha256}/>
                ))}
            </div>

            <div className="mt-auto flex items-center gap-2 border-t border-hairline-soft px-3 py-2.5">
                <Button size="small" icon={<i className="fa-solid fa-play text-[11px]"/>} onClick={() => onAction('launch', app)}>
                    启动
                </Button>
                <Button size="small" icon={<i className="fa-solid fa-chart-line text-[11px]"/>} onClick={() => onAction('perf', app)}>
                    性能监控
                </Button>
                <Dropdown
                    trigger={['click']}
                    placement="bottomRight"
                    menu={{items: moreItems, onClick: ({key}) => onAction(key as CardAction, app)}}
                >
                    <Button size="small" type="text" icon={<MoreOutlined/>} className="ml-auto" aria-label="更多操作"/>
                </Dropdown>
            </div>
        </div>
    );
});

export default ApplicationList;
