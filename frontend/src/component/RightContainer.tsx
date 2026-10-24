import {ACTION_DESC, ACTION_META, QuickAction, quickActions} from '../data/quickActions';
import {ExecuteAction, GetAdbPath, IsAdbDownloading} from '../../wailsjs/go/main/App';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {InputRef} from 'antd';
import {Empty, Input, message} from "antd";
import SystemPropertiesModal, {SystemProperty} from "./SystemPropertiesModal";
import {useDeviceStore} from "../store/deviceStore";
import TerminalPanel from './TerminalPanel';
import DeviceInfoCard from './DeviceInfoCard';
import ThreadSchedModal from './ThreadSchedModal';
import DeepLinkModal from './DeepLinkModal';
import QuickActionCard from './QuickActionCard';
import ActivityBar from './ActivityBar';
import TaskDetailDrawer from './TaskDetailDrawer';
import PageHeader from './PageHeader';
import {runQuickAction} from '../actions/runQuickAction';
import {ActionTask, useActionTaskStore} from '../store/actionTaskStore';
import {EMPTY_PACKAGES, usePackageListStore} from '../store/packageListStore';
import PackagePicker from './PackagePicker';

const KEY_SECTION = '按键';
const RECENT_STORAGE_KEY = 'quick_action_recent';
const MAX_RECENT = 6;

const ALL_ACTIONS = quickActions.flatMap(section => section.items);

function readRecent(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function writeRecent(list: string[]) {
    try {
        localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list));
    } catch {
        // 存储不可用时只保留在内存中
    }
}

// 按设备缓存页面数据：切换到其他页面再回来时直接显示，后台静默刷新，避免内容先清空再出现导致跳动
// 包名列表缓存在 packageListStore 中
interface DeviceCache {
    info: string | null;
}

const deviceCache = new Map<string, DeviceCache>();

function getCache(deviceId: string | undefined): DeviceCache {
    return (deviceId && deviceCache.get(deviceId)) || {info: null};
}

function updateCache(deviceId: string, patch: Partial<DeviceCache>) {
    deviceCache.set(deviceId, {...getCache(deviceId), ...patch});
}

function RightContainer() {
    const searchRef = useRef<InputRef>(null);
    const [modalVisible, setModalVisible] = useState(false);
    const [properties, setProperties] = useState<SystemProperty[]>([]);
    const [searchText, setSearchText] = useState('');
    const [threadSchedVisible, setThreadSchedVisible] = useState(false);
    const [deepLinkVisible, setDeepLinkVisible] = useState(false);
    const initialCache = getCache(useDeviceStore.getState().selectedDevice?.id);
    const [deviceInfoString, setDeviceInfoString] = useState<string | null>(initialCache.info);
    const [recent, setRecent] = useState<string[]>(readRecent);

    const {selectedDevice} = useDeviceStore();
    const packageList = usePackageListStore(state =>
        selectedDevice ? state.packagesByDevice[selectedDevice.id] ?? EMPTY_PACKAGES : EMPTY_PACKAGES);
    const selectedPackage = usePackageListStore(state =>
        selectedDevice ? state.targetByDevice[selectedDevice.id] ?? '' : '');
    const tasks = useActionTaskStore(state => state.tasks);
    // 始终传序列号：执行过程中再插入一台设备时，adb 不会因为 "more than one device" 失败
    const deviceId = selectedDevice?.id ?? '';

    // 每个功能最近一次执行的任务，用于卡片状态
    const latestTaskByAction = useMemo(() => {
        const map = new Map<string, ActionTask>();
        tasks.forEach(task => map.set(task.action, task));
        return map;
    }, [tasks]);

    const filteredQuickActions = useMemo(() => {
        const keyword = searchText.trim().toLowerCase();
        if (!keyword) {
            return quickActions;
        }

        return quickActions
            .map(section => {
                const categoryMatched = section.title.toLowerCase().includes(keyword);
                return {
                    ...section,
                    items: categoryMatched
                        ? section.items
                        : section.items.filter(item =>
                            item.label.toLowerCase().includes(keyword) ||
                            item.action.toLowerCase().includes(keyword) ||
                            (ACTION_DESC[item.action] ?? '').toLowerCase().includes(keyword)
                        )
                };
            })
            .filter(section => section.items.length > 0);
    }, [searchText]);

    const recentActions = useMemo(
        () => recent.map(action => ALL_ACTIONS.find(item => item.action === action)).filter((item): item is QuickAction => Boolean(item)),
        [recent],
    );

    // ⌘K / Ctrl+K 聚焦搜索
    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                searchRef.current?.focus({cursor: 'all'});
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, []);

    const fetchDeviceInfo = async () => {
        if (!selectedDevice) {
            setDeviceInfoString(null);
            return;
        }
        try {
            const result = await ExecuteAction({action: "get-system-info", targetPackageName: "", deviceId});
            // 读取失败时保留已有信息，不清空
            if (!result.error && result.res) {
                updateCache(selectedDevice.id, {info: result.res});
                setDeviceInfoString(result.res);
            }
        } catch (error) {
            console.error('Failed to fetch device info:', error);
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedDevice) {
                setDeviceInfoString(null);
                return;
            }

            // 先用缓存填充（切换设备时立即显示该设备上次的数据），再后台刷新
            setDeviceInfoString(getCache(selectedDevice.id).info);
            // 目标应用：保留当前选择，没有时恢复该设备上次的选择；都没有时留空，由用户选择或使用前台应用
            usePackageListStore.getState().restoreTarget(selectedDevice.id);
            void fetchDeviceInfo();
            void usePackageListStore.getState().fetchPackages(selectedDevice.id);
        };
        void fetchData();
    }, [selectedDevice]);

    const handlePackageChange = (value: string) => {
        if (selectedDevice) usePackageListStore.getState().setTarget(selectedDevice.id, value);
    };

    const rememberRecent = (action: string) => {
        setRecent(prev => {
            const next = [action, ...prev.filter(item => item !== action)].slice(0, MAX_RECENT);
            writeRecent(next);
            return next;
        });
    };

    async function handleClick(action: QuickAction) {
        const adbPath = await GetAdbPath();
        if (adbPath.error) {
            if (await IsAdbDownloading()) {
                message.info("本机未找到 adb，正在后台下载，请稍候。");
            } else {
                message.error("请在设置项配置 adb 路径。");
            }
            return;
        }
        rememberRecent(action.action);

        if (action.action === 'thread-sched') {
            setThreadSchedVisible(true);
            return;
        }
        if (action.action === 'deep-link') {
            setDeepLinkVisible(true);
            return;
        }

        const outcome = await runQuickAction(action, {
            packageName: selectedPackage,
            deviceId,
            deviceName: selectedDevice?.name ?? '',
        });

        if (outcome && action.action === 'get-system-property' && outcome.task.status === 'success') {
            const parsedProperties: SystemProperty[] = (outcome.result.res ?? '')
                .split("\n")
                .filter((line: string) => line.trim() && line.includes(":"))
                .map((line: string) => {
                    const colonIndex = line.indexOf(":");
                    return {
                        key: line.substring(0, colonIndex).trim(),
                        value: line.substring(colonIndex + 1).trim()
                    };
                });
            setProperties(parsedProperties);
            setModalVisible(true);
        }
    }

    const renderCard = (item: QuickAction, variant: 'tile' | 'key' | 'chip' = 'tile') => (
        <QuickActionCard
            key={item.action}
            item={item}
            variant={variant}
            task={latestTaskByAction.get(item.action)}
            disabledReason={ACTION_META[item.action].needsPackage && !selectedPackage ? '请先在上方选择目标应用' : undefined}
            onClick={() => void handleClick(item)}
        />
    );

    // 一个分组一张卡片：网格 1px 间隙露出底色形成分隔线，末行空位用白色补齐
    const renderGroupCard = (items: QuickAction[], columns: number, variant: 'tile' | 'key') => {
        const fillers = (columns - (items.length % columns)) % columns;
        return (
            <div
                className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline-soft shadow-whisper"
                style={{gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`}}
            >
                {items.map(item => renderCard(item, variant))}
                {Array.from({length: fillers}, (_, index) => <div key={`filler-${index}`} className="bg-elevated"/>)}
            </div>
        );
    };

    return (
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-canvas text-left text-ink">
            <SystemPropertiesModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                properties={properties}
            />

            <ThreadSchedModal
                visible={threadSchedVisible}
                onClose={() => setThreadSchedVisible(false)}
                packageName={selectedPackage}
                deviceId={deviceId}
            />

            <DeepLinkModal
                visible={deepLinkVisible}
                onClose={() => setDeepLinkVisible(false)}
                deviceId={selectedDevice?.id ?? ''}
                targetPackage={selectedPackage}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
                <div className="mx-auto flex max-w-6xl flex-col gap-5">
                    <PageHeader
                        eyebrow="Quick actions · adb"
                        title="快捷功能"
                        description="常用的 adb 操作，「应用」分组会作用于下方选择的目标应用"
                        actions={
                            <Input
                                ref={searchRef}
                                value={searchText}
                                onChange={(event) => setSearchText(event.target.value)}
                                placeholder="搜索功能"
                                allowClear
                                prefix={<i className="fa-solid fa-magnifying-glass text-[12px] text-faint"/>}
                                suffix={!searchText && <kbd className="rounded border border-hairline px-1 font-mono text-[10px] text-faint">⌘K</kbd>}
                                className="!w-64"
                            />
                        }
                    />

                    <DeviceInfoCard infoString={deviceInfoString} connected={Boolean(selectedDevice)}/>

                    {/* 目标应用：应用分组的所有操作都作用于它 */}
                    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-elevated px-4 py-3 shadow-whisper">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-hairline-soft text-[14px] text-body">
                            <i className="fa-solid fa-cube"/>
                        </span>
                        <div className="shrink-0">
                            <div className="text-[13px] font-medium text-ink">目标应用</div>
                            <div className="text-[11px] text-mute">共 {packageList.length} 个已安装应用</div>
                        </div>
                        <PackagePicker value={selectedPackage} onChange={handlePackageChange} className="flex-1"/>
                    </div>

                    {!searchText && recentActions.length > 0 && (
                        <section className="flex flex-wrap items-center gap-2">
                            <span className="pr-1 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">Recent</span>
                            {recentActions.map(item => renderCard(item, 'chip'))}
                            <button
                                type="button"
                                onClick={() => {
                                    setRecent([]);
                                    writeRecent([]);
                                }}
                                className="ml-auto text-[11px] text-faint hover:text-ink"
                            >
                                清空
                            </button>
                        </section>
                    )}

                    {filteredQuickActions.length === 0 ? (
                        <div className="rounded-xl border border-hairline bg-elevated py-10">
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的功能"/>
                        </div>
                    ) : filteredQuickActions.map((section) => {
                        const appScoped = section.items.some(item => ACTION_META[item.action].needsPackage);
                        return (
                            <section key={section.title}>
                                <div className="mb-2 flex items-baseline gap-2 px-1">
                                    <h2 className="text-[15px] font-semibold tracking-[-0.2px] text-ink">{section.title}</h2>
                                    {appScoped && (
                                        <span className={`truncate font-mono text-[11px] ${selectedPackage ? 'text-link-deep' : 'text-error'}`}>
                                            → {selectedPackage || '未选择目标应用'}
                                        </span>
                                    )}
                                </div>
                                {section.title === KEY_SECTION
                                    ? renderGroupCard(section.items, 4, 'key')
                                    : renderGroupCard(section.items, 3, 'tile')}
                            </section>
                        );
                    })}
                </div>
            </div>

            {/* 执行记录与状态条 */}
            <TerminalPanel/>
            <ActivityBar/>
            <TaskDetailDrawer/>
        </div>
    );
}

export default RightContainer;
