import {useEffect, useRef, useState} from 'react';
import {EventsOn} from "../../wailsjs/runtime";
import {DeviceInfo, useDeviceStore} from "../store/deviceStore";
import {GetDeviceNameArray} from "../../wailsjs/go/main/App";


function LeftContainer({selectedView, onViewChange}: {
    selectedView: string;
    onViewChange: (view: string) => void
}) {
    const {devices, setDevices, selectedDevice, toggleDevice, setSelectedDevices} = useDeviceStore();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        return EventsOn("adb_update", (devices: DeviceInfo[]) => {
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
        return EventsOn("adb_update", (devices: DeviceInfo[]) => {
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
        {key: '1', icon: 'fa-rocket', label: '快捷功能', iconColor: 'text-amber-500'},
        {key: '4', icon: 'fa-gear', label: '应用列表', iconColor: 'text-purple-500'},
        {key: '5', icon: 'fa-memory', label: '内存监控', iconColor: 'text-green-500'},
        {key: '2', icon: 'fa-circle-question', label: '常见问题', iconColor: 'text-blue-500'},
        {key: '3', icon: 'fa-gear', label: '设置', iconColor: 'text-purple-500'},

        // {key: '3', icon: 'fa-terminal', label: 'Logcat', iconColor: 'text-green-500'},
        // {key: '4', icon: 'fa-gear', label: '设置', iconColor: 'text-purple-500'},
    ];

    return (
        <div className="flex w-60 flex-col h-full bg-white border-r border-gray-200 flex-shrink-0">
            {/* 头部 */}
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center">
                        <i className="fa-solid fa-mobile text-white text-lg"/>
                    </div>
                    <div className="flex-1 min-w-0 relative" ref={dropdownRef}>
                        {/* 设备选择器 */}
                        <button
                            onClick={() => devices.length > 0 && setIsDropdownOpen(!isDropdownOpen)}
                            disabled={devices.length === 0}
                            className="w-full flex items-center justify-between gap-2 group"
                        >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div
                                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${devices.length > 0 ? 'bg-blue-500' : 'bg-gray-300'}`}/>
                                <span className="text-xs text-gray-500 font-mono truncate">
                                    {getDisplayText()}
                                </span>
                            </div>
                            {devices.length > 1 && (
                                <i className={`fa-solid fa-chevron-down text-xs text-gray-400 group-hover:text-gray-600 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}/>
                            )}
                        </button>

                        {/* 下拉菜单 */}
                        {isDropdownOpen && (
                            <div
                                className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
                                {devices.map(device => {
                                    const isChecked = selectedDevice === device
                                    return (
                                        <div
                                            key={device.id}
                                            onClick={() => toggleDevice(device)}
                                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer transition-colors"
                                        >
                                            {/* 自定义复选框 */}
                                            <div
                                                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                                    isChecked
                                                        ? 'bg-blue-500 border-blue-500'
                                                        : 'bg-white border-gray-300 hover:border-gray-400'
                                                }`}>
                                                {isChecked && (
                                                    <i className="fa-solid fa-check text-white text-xs"/>
                                                )}
                                            </div>

                                            {/* 设备信息 */}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-medium text-gray-900 truncate">
                                                    {device.name}
                                                </div>
                                                <div className="text-xs text-gray-400 font-mono truncate">
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

            {/* 菜单 */}
            <nav className="flex-1 px-4 py-6 overflow-y-auto">
                {menuItems.map(item => (
                    <button
                        key={item.key}
                        onClick={() => onViewChange(item.key)}
                        className={`flex items-center justify-center
                            w-full px-4 py-3 mb-2 rounded-lg
                            text-left transition-all duration-150 cursor-pointer 
                            ${selectedView === item.key
                            ? 'bg-gray-100'
                            : 'hover:bg-gray-100'
                        }`}>
                        <i className={`fa-solid ${item.icon} w-5 text-base ${item.iconColor}`}/>
                        <span
                            className={`ml-3 text-base font-medium ${selectedView === item.key ? 'text-gray-900' : 'text-gray-700'}`}>
                            {item.label}
                        </span>
                    </button>
                ))}
            </nav>
        </div>
    );
}

export default LeftContainer;