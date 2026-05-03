import {useEffect, useRef, useState} from 'react';
import {EventsOn} from "../../wailsjs/runtime";
import {DeviceInfo, useDeviceStore} from "../store/deviceStore";
import {GetDeviceNameArray, GetVersion} from "../../wailsjs/go/main/App";


function LeftContainer({selectedView, onViewChange}: {
    selectedView: string;
    onViewChange: (view: string) => void
}) {
    const {devices, setDevices, selectedDevice, toggleDevice, setSelectedDevices} = useDeviceStore();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [version, setVersion] = useState('')
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        return EventsOn("adb_update", (devices: DeviceInfo[]) => {
            console.log("devices", devices);
            setDevices(devices)
            // 自动选中第一个设备
            if (devices.length > 0 && selectedDevice === null) {
                setSelectedDevices(devices[0])
            } else if (devices.length === 0) {
                setSelectedDevices(null);
            }
        });
    }, []);

    useEffect(() => {
        let fetchDeviceArray = async () => {
            const result = await GetDeviceNameArray();
            setDevices(result)
            if (result.length > 0 && selectedDevice === null) {
                setSelectedDevices(result[0])
            }
        };
        fetchDeviceArray()
    }, []);

    useEffect(() => {
        GetVersion().then(setVersion)
    }, []);

    // 点击外部关闭下拉框
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const getDisplayText = () => {
        if (devices.length === 0) return '等待连接...'
        if (selectedDevice === null) return '请选择设备'
        const device = devices.find(d => d.id === selectedDevice.id)
        return device?.name || '未知设备'
    }

    const menuItems = [
        {key: '1', label: '快捷功能'},
        {key: '4', label: '应用列表'},
        {key: '5', label: '内存监控'},
        {key: '6', label: '文件管理'},
        {key: '7', label: '诊断日志'},
        {key: '2', label: '常见问题'},
        {key: '3', label: '设置'},
    ];

    return (
        <div className="flex h-full w-[248px] shrink-0 flex-col border-r border-[#E7ECF2] bg-white">
            <div className="border-b border-gray-200 p-6">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500">
                        <i className="fa-solid fa-mobile text-lg text-white"/>
                    </div>
                    <div className="relative min-w-0 flex-1" ref={dropdownRef}>
                        <button
                            onClick={() => devices.length > 0 && setIsDropdownOpen(!isDropdownOpen)}
                            disabled={devices.length === 0}
                            className="group flex w-full items-center justify-between gap-2"
                        >
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <div
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${devices.length > 0 ? 'bg-blue-500' : 'bg-gray-300'}`}/>
                                <span className="truncate font-mono text-xs text-gray-500">
                                    {getDisplayText()}
                                </span>
                            </div>
                            {devices.length > 1 && (
                                <i className={`fa-solid fa-chevron-down text-xs text-gray-400 transition-transform group-hover:text-gray-600 ${isDropdownOpen ? 'rotate-180' : ''}`}/>
                            )}
                        </button>

                        {isDropdownOpen && (
                            <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                {devices.map(device => {
                                    const isChecked = selectedDevice?.id === device.id
                                    return (
                                        <div
                                            key={device.id}
                                            onClick={() => toggleDevice(device)}
                                            className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-gray-50"
                                        >
                                            <div
                                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all ${
                                                    isChecked
                                                        ? 'border-blue-500 bg-blue-500'
                                                        : 'border-gray-300 bg-white hover:border-gray-400'
                                                }`}>
                                                {isChecked && (
                                                    <i className="fa-solid fa-check text-xs text-white"/>
                                                )}
                                            </div>

                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-xs font-medium text-gray-900">
                                                    {device.name}
                                                </div>
                                                <div className="truncate font-mono text-xs text-gray-400">
                                                    {device.id}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto px-5 py-6">
                <div className="space-y-1">
                    {menuItems.map((item) => {
                        const isActive = selectedView === item.key
                        return (
                            <button
                                type="button"
                                key={item.key}
                                onClick={() => onViewChange(item.key)}
                                className={`relative flex h-12 w-full items-center rounded-[14px] px-5 text-left transition-colors ${
                                    isActive
                                        ? 'bg-[#F3F6FB] text-[#111827]'
                                        : 'text-[#5D6878] hover:bg-[#F7F9FC]'
                                }`}
                            >
                                {isActive && (
                                    <span className="absolute left-[14px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[#2F6BFF]"/>
                                )}
                                <span className={`truncate pl-3 text-base ${isActive ? 'font-semibold' : 'font-medium'}`}>
                                    {item.label}
                                </span>
                            </button>
                        )
                    })}
                </div>
            </nav>

            {version && (
                <div className="border-t border-gray-200 px-4 py-3 text-center">
                    <span className="font-mono text-xs text-gray-400">{version}</span>
                </div>
            )}
        </div>
    );
}

export default LeftContainer;
