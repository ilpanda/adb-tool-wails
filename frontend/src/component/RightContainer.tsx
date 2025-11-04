import {QuickAction, quickActions} from '../data/quickActions';
import {ExecuteAction} from '../../wailsjs/go/main/App';
import {useEffect, useRef, useState} from 'react';
import SystemPropertiesModal, {SystemProperty} from "./SystemPropertiesModal";
import {Select} from "antd";
import {useDeviceStore} from "../store/deviceStore";
import TerminalPanel from './TerminalPanel';

interface CommandLog {
    id: number;
    action: string;
    status: 'success' | 'error' | 'loading';
    label: string
    message: string;
    timestamp: Date;
}

interface TerminalLog {
    id: number;
    type: 'command' | 'output';
    content: string;
    timestamp: string;
    action?: string;
    icon?: string;
    success?: boolean;
    duration?: string;
}

function RightContainer() {
    const selectRef = useRef(null);
    const [logs, setLogs] = useState<CommandLog[]>([]);
    const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>([]);
    const [showTerminal, setShowTerminal] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [properties, setProperties] = useState<SystemProperty[]>([]);

    const [selectedPackage, setSelectedPackage] = useState<string>('');
    const [packageList, setPackageList] = useState<string[]>([]);

    const {devices, selectedDevice} = useDeviceStore();

    async function handleClick(action: QuickAction) {
        if (!showTerminal) {
            setShowTerminal(true);
        }

        const logId = Date.now();
        const timestamp = new Date().toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const startTime = Date.now();

        var hideLog = action.action === "get-system-property";

        if (!hideLog) {
            setLogs(prev => [{
                id: logId,
                action: action.action,
                status: 'loading',
                message: '执行中...',
                label: action.label,
                timestamp: new Date()
            }, ...prev]);
        }
        try {
            const result = await ExecuteAction({
                action: action.action,
                targetPackageName: selectedPackage ? selectedPackage : "",
                deviceId: devices.length > 1 ? selectedDevice ? selectedDevice.id.toString() : "" : "",
            });

            // 添加命令日志到 Terminal
            const commandLog: TerminalLog = {
                id: logId,
                type: 'command',
                content: result.cmd,
                timestamp,
                action: action.label,
                icon: action.icon
            };

            setTerminalLogs(prev => [...prev, commandLog]);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);

            if (!result.error && hideLog) {
                const parsedProperties: SystemProperty[] = result.res
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

                // 添加输出日志到 Terminal
                const outputLog: TerminalLog = {
                    id: Date.now(),
                    type: 'output',
                    content: `已获取 ${parsedProperties.length} 条系统属性`,
                    timestamp: new Date().toLocaleTimeString('zh-CN', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    }),
                    success: true,
                    duration
                };
                setTerminalLogs(prev => [...prev, outputLog]);
                return;
            }

            // 添加输出日志到 Terminal
            const outputLog: TerminalLog = {
                id: Date.now(),
                type: 'output',
                content: result.error || result.res || '操作成功',
                timestamp: new Date().toLocaleTimeString('zh-CN', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }),
                success: !result.error,
                duration
            };
            setTerminalLogs(prev => [...prev, outputLog]);

            if (result.error) {
                setLogs(prev => prev.map(log =>
                    log.id === logId
                        ? {...log, status: 'error', message: result.error || '未知错误'}
                        : log
                ));
            } else {
                setLogs(prev => prev.map(log =>
                    log.id === logId
                        ? {...log, status: 'success', message: result.res || '操作成功'}
                        : log
                ));
            }
        } catch (error: any) {
            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            // 添加错误输出日志到 Terminal
            const errorLog: TerminalLog = {
                id: Date.now(),
                type: 'output',
                content: error?.toString() || '操作失败',
                timestamp: new Date().toLocaleTimeString('zh-CN', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }),
                success: false,
                duration
            };
            setTerminalLogs(prev => [...prev, errorLog]);

            setLogs(prev => prev.map(log =>
                log.id === logId
                    ? {...log, status: 'error', message: error?.toString() || '操作失败'}
                    : log
            ));
        }
    }


    // 清空 Terminal 日志
    const clearTerminalLogs = () => {
        setTerminalLogs([]);
    };

    useEffect(() => {
        const fetchData = async () => {
            const result = await ExecuteAction({
                action: "get-all-packages",
                targetPackageName: "",
                deviceId: devices.length > 1 ? selectedDevice ? selectedDevice.id.toString() : "" : "",
            });

            const stored = localStorage.getItem('selectedPackage');
            let defaultPackage = "com.baidu.input_oppo";
            if (stored && selectedDevice) {
                try {
                    const data = JSON.parse(stored);
                    if (selectedDevice?.id === data.selectedDevice) {
                        defaultPackage = data.selectedPackage
                    }
                } catch (error) {
                    localStorage.removeItem('selectedPackage'); // 清除损坏的数据
                }
            }
            if (result.res != "" && selectedDevice != null) {
                let packages = result.res.split("\n").map(line => line.trim());
                if (packages.filter((line: string) => line.trim() && line.includes(defaultPackage))) {
                    setSelectedPackage(defaultPackage)
                }
                setPackageList(packages);
            } else {
                setSelectedPackage("")
                setPackageList([]);
            }
        };
        fetchData();
    }, [selectedDevice])

    const handlePackageChange = (value: string) => {
        setSelectedPackage(value);
        if (selectedDevice != null && value) {
            localStorage.setItem("selectedPackage",
                JSON.stringify({
                    selectedDevice: selectedDevice.id,
                    selectedPackage: value
                }));
        }
    };

    useEffect(() => {
        const input = document.querySelector('.package-select-wrapper .ant-select input')
        if (input) {
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('autocapitalize', 'off');
            input.setAttribute('autocorrect', 'off');
        }
    }, []);

    return (
        <div className="flex flex-1 h-full overflow-hidden flex-col">

            <SystemPropertiesModal
                visible={modalVisible}
                onClose={() => setModalVisible(false)}
                properties={properties}
            />

            {/* 主内容区域 */}
            <div className="flex-1 flex flex-col p-6 bg-gray-50 gap-6 overflow-y-auto overflow-x-hidden">
                {quickActions.map((section, sectionIndex) => (
                    <div key={sectionIndex} className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-gray-800">
                                {section.title}
                            </h2>

                            {/* 如果是"应用"分区，显示包名选择器 */}
                            {section.title === '应用' && (
                                <div className="flex items-center gap-2 package-select-wrapper">
                                    <span className="text-sm text-gray-600">包名:</span>
                                    <Select
                                        ref={selectRef}
                                        value={selectedPackage}
                                        onChange={handlePackageChange}
                                        className="min-w-[300px]"
                                        placeholder="请选择包名"
                                        showSearch
                                        optionFilterProp="children"
                                        filterOption={(input, option) =>
                                            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                        }
                                        options={packageList.map(pkg => ({
                                            value: pkg,
                                            label: pkg
                                        }))}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {section.items.map((item, itemIndex) => (
                                <div
                                    key={itemIndex}
                                    onClick={() => handleClick(item)}
                                    className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer"
                                >
                                    <div className="flex flex-col items-center text-center gap-3">
                                        <div
                                            className={`w-14 h-14 ${item.bgColor} rounded-full flex items-center justify-center`}>
                                            <i className={`fa-solid ${item.icon} text-2xl ${item.color}`}/>
                                        </div>
                                        <span className="text-sm font-medium text-gray-700">{item.label}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                    </div>
                ))}
            </div>

            {/* Terminal 面板 */}
            <TerminalPanel
                isOpen={showTerminal}
                onClose={() => setShowTerminal(false)}
                logs={terminalLogs}
                onClear={clearTerminalLogs}
            />

            {/* 悬浮打开按钮（当 Terminal 关闭时） */}
            {!showTerminal && (
                <button
                    onClick={() => setShowTerminal(true)}
                    className="fixed bottom-8 right-8 w-12 h-12 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group"
                    title="显示终端"
                >
                    <i className="fa-solid fa-terminal"></i>
                    {logs.some(log => log.status === 'loading') && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
                    )}
                </button>
            )}
        </div>
    );
}

export default RightContainer;