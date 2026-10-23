import {useEffect, useRef, useState} from 'react';
import {EventsOn} from "../../wailsjs/runtime";
import {DeviceInfo, useDeviceStore} from "../store/deviceStore";
import {GetDeviceNameArray, GetVersion} from "../../wailsjs/go/main/App";
import {Eyebrow} from "./PageHeader";
import WirelessModal from "./WirelessModal";
import {useUpdateStore} from "../store/updateStore";
import {BrowserOpenURL} from "../../wailsjs/runtime";

const MENU_GROUPS: Array<{title: string; items: Array<{key: string; label: string; icon: string}>}> = [
    {
        title: 'Tools',
        items: [
            {key: '1', label: '快捷功能', icon: 'fa-bolt'},
            {key: '4', label: '应用列表', icon: 'fa-table-cells-large'},
            {key: '5', label: '性能监控', icon: 'fa-chart-line'},
            {key: '6', label: '文件管理', icon: 'fa-folder'},
        ],
    },
    {
        title: 'Support',
        items: [
            {key: '7', label: '诊断日志', icon: 'fa-file-waveform'},
            {key: '2', label: '常见问题', icon: 'fa-circle-question'},
            {key: '3', label: '设置', icon: 'fa-gear'},
        ],
    },
];

// 设备列表变化后保持当前选择；当前设备断开时回落到第一台
function syncSelection(devices: DeviceInfo[]) {
    const {selectedDevice, setDevices, setSelectedDevices} = useDeviceStore.getState();
    setDevices(devices);
    const stillConnected = selectedDevice && devices.find(device => device.id === selectedDevice.id);
    if (stillConnected) {
        if (stillConnected.name !== selectedDevice.name) setSelectedDevices(stillConnected);
        return;
    }
    setSelectedDevices(devices[0] ?? null);
}

function LeftContainer({selectedView, onViewChange}: {
    selectedView: string;
    onViewChange: (view: string) => void
}) {
    const {devices, selectedDevice, setSelectedDevices} = useDeviceStore();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [wirelessOpen, setWirelessOpen] = useState(false);
    const update = useUpdateStore(state => state.info);
    const [version, setVersion] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return EventsOn("adb_update", (next: DeviceInfo[]) => syncSelection(next || []));
    }, []);

    useEffect(() => {
        GetDeviceNameArray().then(result => syncSelection(result || []));
        GetVersion().then(setVersion);
    }, []);

    // 点击外部关闭下拉框
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const connected = devices.length > 0;
    const current = selectedDevice ? devices.find(device => device.id === selectedDevice.id) : undefined;

    return (
        <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-hairline bg-canvas text-left">
            {/* 品牌 */}
            <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ink">
                    <i className="fa-brands fa-android text-[15px] text-elevated"/>
                </div>
                <span className="text-[15px] font-semibold tracking-[-0.3px] text-ink">ADB Tool</span>
            </div>

            {/* 设备切换 */}
            <div className="relative px-3" ref={dropdownRef}>
                <button
                    type="button"
                    onClick={() => connected && setIsDropdownOpen(open => !open)}
                    disabled={!connected}
                    className={`flex w-full items-center gap-2.5 rounded-lg border border-hairline bg-elevated px-3 py-2.5 text-left shadow-whisper transition-colors ${
                        connected ? 'cursor-pointer hover:border-hairline-strong' : 'cursor-default'
                    } ${isDropdownOpen ? 'border-hairline-strong' : ''}`}
                >
                    <span className="relative flex h-2 w-2 shrink-0">
                        {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-link opacity-30"/>}
                        <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-link' : 'bg-faint'}`}/>
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                            {current?.name || (connected ? '选择设备' : '未连接设备')}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-faint">
                            {current?.id || (connected ? `${devices.length} 台设备可用` : '等待 USB 调试连接')}
                        </span>
                    </span>
                    {connected && (
                        <i className={`fa-solid fa-chevron-down shrink-0 text-[10px] text-faint transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}/>
                    )}
                </button>

                {isDropdownOpen && (
                    <div className="absolute left-3 right-3 top-full z-20 mt-1.5 overflow-hidden rounded-lg border border-hairline bg-elevated p-1 shadow-floating">
                        <div className="px-2.5 pb-1 pt-1.5">
                            <Eyebrow>Devices · {devices.length}</Eyebrow>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                            {devices.map(device => {
                                const isSelected = selectedDevice?.id === device.id;
                                return (
                                    <button
                                        type="button"
                                        key={device.id}
                                        onClick={() => {
                                            setSelectedDevices(device);
                                            setIsDropdownOpen(false);
                                        }}
                                        className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                                            isSelected ? 'bg-hairline-soft' : 'hover:bg-canvas'
                                        }`}
                                    >
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[13px] text-ink">{device.name}</span>
                                            <span className="block truncate font-mono text-[11px] text-faint">{device.id}</span>
                                        </span>
                                        {isSelected && <i className="fa-solid fa-check shrink-0 text-[11px] text-ink"/>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setWirelessOpen(true)}
                    className="mt-1.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-mute transition-colors hover:bg-hairline-soft hover:text-ink"
                >
                    <i className="fa-solid fa-wifi w-3.5 text-center text-[11px]"/>
                    无线连接
                </button>
            </div>
            <WirelessModal open={wirelessOpen} onClose={() => setWirelessOpen(false)}/>

            {/* 导航 */}
            <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-5">
                {MENU_GROUPS.map(group => (
                    <div key={group.title} className="mb-5 last:mb-0">
                        <div className="px-2.5 pb-1.5">
                            <Eyebrow>{group.title}</Eyebrow>
                        </div>
                        <div className="space-y-0.5">
                            {group.items.map(item => {
                                const isActive = selectedView === item.key;
                                return (
                                    <button
                                        type="button"
                                        key={item.key}
                                        onClick={() => onViewChange(item.key)}
                                        className={`flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-[14px] transition-colors ${
                                            isActive
                                                ? 'bg-elevated font-medium text-ink shadow-[0_0_0_1px_var(--color-hairline),var(--shadow-whisper)]'
                                                : 'text-body hover:bg-hairline-soft hover:text-ink'
                                        }`}
                                    >
                                        <i className={`fa-solid ${item.icon} w-4 text-center text-[13px] ${isActive ? 'text-ink' : 'text-mute'}`}/>
                                        <span className="truncate">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {version && (
                <div className="flex items-center justify-between border-t border-hairline px-5 py-3 font-mono text-[11px] text-faint">
                    <span>Version</span>
                    {update?.hasUpdate ? (
                        <button
                            type="button"
                            onClick={() => BrowserOpenURL(update.url)}
                            title={`新版本 ${update.latest}，点击前往下载`}
                            className="flex items-center gap-1.5 text-link transition-colors hover:text-link-deep"
                        >
                            <span className="h-1.5 w-1.5 rounded-full bg-link"/>
                            {version} → {update.latest}
                        </button>
                    ) : (
                        <span>{version}</span>
                    )}
                </div>
            )}
        </div>
    );
}

export default LeftContainer;
