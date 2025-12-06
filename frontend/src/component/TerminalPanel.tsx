// TerminalPanel.tsx
import { useState, useRef, useEffect } from 'react';
import {message} from "antd";

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

interface TerminalPanelProps {
    isOpen: boolean;
    onClose: () => void;
    logs: TerminalLog[];
    onClear: () => void;
}

function TerminalPanel({ isOpen, onClose, logs, onClear }: TerminalPanelProps) {
    const [terminalHeight, setTerminalHeight] = useState(400);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const terminalEndRef = useRef<HTMLDivElement>(null);

    const filteredLogs = logs.filter(log =>
        log.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (log.action && log.action.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const copyLog = (content: string) => {
        navigator.clipboard.writeText(content);
        message.success("复制成功")
    };

    const exportLogs = () => {
        const logText = logs.map(log => {
            if (log.type === 'command') {
                return `[${log.timestamp}] $ ${log.content}`;
            } else {
                return `${log.content}\n`;
            }
        }).join('\n');

        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `adb-logs-${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();

        const startY = e.clientY;
        const startHeight = terminalHeight;

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';

        const handleMouseMove = (e: MouseEvent) => {
            e.preventDefault();

            requestAnimationFrame(() => {
                const diff = startY - e.clientY;
                const newHeight = Math.min(Math.max(200, startHeight + diff), window.innerHeight - 100);
                setTerminalHeight(newHeight);
            });
        };

        const handleMouseUp = () => {
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    useEffect(() => {
        terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    if (!isOpen) return null;

    return (
        <div
            className={`bg-white border-t-2 border-blue-500 shadow-2xl flex flex-col ${
                isFullscreen ? 'absolute inset-0 z-50' : ''
            }`}
            style={{
                height: isFullscreen ? '100%' : `${terminalHeight}px`
            }}
        >
            {/* 拖拽手柄 */}
            {!isFullscreen && (
                <div
                    className="h-3 cursor-ns-resize bg-gray-100 hover:bg-blue-200 flex items-center justify-center group"
                    onMouseDown={handleMouseDown}
                >
                    <div className="w-12 h-1 bg-gray-300 rounded-full group-hover:bg-blue-400"></div>
                </div>
            )}

            {/* Terminal 头部 */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-400"></div>
                        <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                        <div className="w-3 h-3 rounded-full bg-green-400"></div>
                    </div>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <i className="fa-solid fa-terminal text-blue-600 text-sm"></i>
                    <span className="text-sm font-semibold text-blue-600 font-mono">ADB Terminal</span>
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="bg-blue-100 px-2 py-0.5 rounded font-medium">
                            {logs.filter(l => l.type === 'command').length} cmds
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {/* 搜索框 */}
                    <div className="relative mr-2">
                        <i className="fa-solid fa-search absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs"></i>
                        <input
                            type="text"
                            placeholder="搜索..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-48 bg-white text-gray-900 text-xs pl-7 pr-3 py-1.5 rounded border border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>

                    <button
                        onClick={exportLogs}
                        disabled={logs.length === 0}
                        className="p-1.5 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="导出日志"
                    >
                        <i className="fa-solid fa-download text-sm"></i>
                    </button>
                    <button
                        onClick={onClear}
                        disabled={logs.length === 0}
                        className="p-1.5 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="清空"
                    >
                        <i className="fa-solid fa-trash-can text-sm"></i>
                    </button>
                    <div className="w-px h-4 bg-gray-300 mx-1"></div>
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-1.5 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-900"
                        title={isFullscreen ? '退出全屏' : '全屏'}
                    >
                        <i className={`fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'} text-sm`}></i>
                    </button>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-red-100 rounded text-gray-600 hover:text-red-600"
                        title="关闭"
                    >
                        <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>
            </div>

            {/* Terminal 内容 */}
            <div className="flex-1 overflow-auto p-4 font-mono text-sm bg-gray-50">
                {filteredLogs.length === 0 && logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <i className="fa-solid fa-terminal text-5xl mb-4 opacity-30"></i>
                        <p className="text-base font-medium mb-2 text-gray-600">终端已就绪</p>
                        <p className="text-xs text-gray-500">点击功能按钮执行命令，或使用搜索过滤历史记录</p>
                    </div>
                ) : filteredLogs.length === 0 && logs.length > 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <i className="fa-solid fa-search text-5xl mb-4 opacity-30"></i>
                        <p className="text-sm text-gray-600">未找到匹配 "{searchTerm}" 的结果</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredLogs.map((log) => (
                            <div key={log.id} className="group">
                                {log.type === 'command' ? (
                                    <div className="flex items-start gap-2 ">
                                        <span className="text-blue-600 select-none text-base leading-6 font-bold">❯</span>
                                        <div className="flex-1 min-w-0  items-center">
                                            <div className="flex items-center gap-2 mb-1.5 mt-1 ">
                                                <span className="text-blue-600 text-xs font-medium">{log.timestamp}</span>
                                                <span className="text-purple-600 text-xs font-bold bg-purple-100 px-2 py-0.5 rounded">
                                                    {log.action}
                                                </span>
                                            </div>
                                            {log.content && <div className="flex items-start gap-2 group/cmd">
                                                <span className="text-green-700 flex-1 whitespace-pre-wrap break-all leading-relaxed font-medium">
                                                   参考命令： {log.content}
                                                </span>
                                                <button
                                                    onClick={() => copyLog(log.content)}
                                                    className="opacity-100  text-gray-400 hover:text-blue-600 shrink-0 mt-0.5 cursor-pointer"
                                                    title="复制命令"
                                                >
                                                    <i className="fa-solid fa-copy text-base"></i>
                                                </button>
                                            </div>}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-start gap-2 ml-6 mt-2">
                                        <div className="flex-1 bg-white rounded-lg p-3 border border-gray-200 hover:border-blue-300 shadow-sm group/output">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-500 text-xs font-medium">{log.timestamp}</span>
                                                    <span className="text-gray-400 text-xs">·</span>
                                                    <span className="text-green-600 text-xs font-semibold">{log.duration}s</span>
                                                    {log.success && <span className="text-green-600 text-xs">✓</span>}
                                                </div>
                                                <button
                                                    onClick={() => copyLog(log.content)}
                                                    className="opacity-100  text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                                    title="复制输出"
                                                >
                                                    <i className="fa-solid fa-copy text-base"></i>
                                                </button>
                                            </div>
                                            <pre className="text-gray-700 whitespace-pre-wrap break-words text-xs leading-relaxed">
                                               命令执行结果： {log.content}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        <div ref={terminalEndRef} />
                    </div>
                )}
            </div>

            {/* Terminal 底部状态栏 */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs">
                <div className="flex items-center gap-4 text-gray-600">
                    <span className="font-mono">总计 {logs.length} 行</span>
                    <span className="text-gray-400">|</span>
                    <span className="font-mono">{logs.filter(l => l.type === 'command').length} 条命令</span>
                    {searchTerm && (
                        <>
                            <span className="text-gray-400">|</span>
                            <span className="text-blue-600 font-medium">过滤: {filteredLogs.length} 条结果</span>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="font-mono">ADB 已连接</span>
                </div>
            </div>
        </div>
    );
}

export default TerminalPanel;