import React, {useEffect, useState} from 'react';
import {CheckAdbPath, GetAdbPath, UpdateAdbPath} from "../../wailsjs/go/main/App";

function SettingsContainer() {
    const [adbPath, setAdbPath] = useState('');
    const [tempPath, setTempPath] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // 组件加载时读取配置
    useEffect(() => {
        loadAdbPath();
    }, []);

    const loadAdbPath = async () => {
        try {
            let adbPath = ""
            let adbResult = await GetAdbPath();
            if (adbResult.res) {
                adbPath = adbResult.res;
            }
            setAdbPath(adbPath);
        } catch (error) {
            console.error('加载 ADB 路径失败:', error);
        }
    };

    const handleTestConnection = async () => {
        try {
            const result = await CheckAdbPath(adbPath);
            if (result.res) {
                setMessage({type: 'success', text: `连接成功！ADB 版本:\n ${result.res}`});
            } else {
                setMessage({type: 'error', text: `连接失败:\n ${result.error}`});
            }
        } catch (error) {
            setMessage({type: 'error', text: 'ADB 连接测试失败'});
        }
    };

    const handleEdit = () => {
        setIsEditing(true);
        setMessage(null);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setMessage(null);
    };

    const handleSave = async () => {
        if (!tempPath.trim()) {
            setMessage({type: 'error', text: 'ADB 路径不能为空'});
            return;
        }

        setIsSaving(true);
        setMessage(null);

        try {
            await UpdateAdbPath(tempPath);
            await loadAdbPath();
            setIsEditing(false);
            setMessage({type: 'success', text: '保存成功！'});
        } catch (error) {
            setMessage({type: 'error', text: '保存失败，请重试'});
        } finally {
            setIsSaving(false);
        }
    };

    const handleAutoDetect = async () => {
        if (!tempPath.trim()) {
            setMessage({type: 'error', text: 'ADB 路径不能为空'});
            return;
        }

        setMessage(null);
        try {
            const result = await CheckAdbPath(tempPath);
            if (!result.error) {
                setTempPath(tempPath);
                setMessage({
                    type: 'success',
                    text: result.res
                });
            } else {
                setMessage({
                    type: 'error',
                    text: result.error
                });
            }
        } catch (error) {
            setMessage({
                type: 'error',
                text: '自动检测失败'
            });
        }
    };

    return (
        <div className="flex-1 h-full overflow-y-auto bg-gray-50 p-6">
            <div className="max-w-3xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8">
                    {/* 标题 */}
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold text-gray-800 mb-2">设置</h1>
                        <p className="text-gray-600">指定 Android Debug Bridge (ADB) 可执行文件的完整路径</p>
                    </div>

                    {/* ADB 路径设置 */}
                    <div className="space-y-6">
                        <div>
                            {!isEditing && adbPath ? (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                                            <code className="text-sm text-gray-700 font-mono break-all">
                                                {adbPath || '\u00A0'}
                                            </code>
                                        </div>
                                        <button
                                            onClick={handleEdit}
                                            className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 cursor-pointer"
                                        >
                                            <i className="fa-solid fa-pen-to-square"></i>
                                            编辑
                                        </button>
                                    </div>

                                    <button
                                        onClick={handleTestConnection}
                                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 cursor-pointer"
                                    >
                                        <i className="fa-solid fa-plug"></i>
                                        测试连接
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex gap-3">
                                        <input
                                            type="text"
                                            value={tempPath}
                                            onChange={(e) => setTempPath(e.target.value)}
                                            placeholder="输入 ADB 路径，例如: /usr/local/bin/adb"
                                            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                                        />
                                        <button
                                            onClick={handleAutoDetect}
                                            className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 whitespace-nowrap cursor-pointer">
                                            <i className="fa-solid fa-wand-magic-sparkles"></i>
                                            检测
                                        </button>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving}
                                            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-blue-300 flex items-center gap-2 cursor-pointer"
                                        >
                                            {isSaving ? (
                                                <>
                                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                                    保存中...
                                                </>
                                            ) : (
                                                <>
                                                    <i className="fa-solid fa-floppy-disk"></i>
                                                    保存
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={handleCancel}
                                            disabled={isSaving}
                                            className="px-6 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors disabled:bg-gray-200"
                                        >
                                            取消
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 提示信息 */}
                        {message && (
                            <div className={`p-4 rounded-lg flex items-center gap-3 ${
                                message.type === 'success'
                                    ? 'bg-green-50 text-green-800 border border-green-200'
                                    : 'bg-red-50 text-red-800 border border-red-200'
                            }`}>
                                <i className={`fa-solid ${
                                    message.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'
                                }`}></i>
                                <span className="whitespace-pre-line">{message.text}</span>
                            </div>
                        )}

                        {/* 帮助信息 */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h3 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                                <i className="fa-solid fa-circle-info"></i>
                                提示
                            </h3>
                            <ul className="text-sm text-blue-700 space-y-1 ml-6 list-disc">
                                <li>请输入完整路径，例如: <code
                                    className="bg-blue-100 px-1 rounded">C:\platform-tools\adb.exe</code></li>
                                <li>macOS/Linux 示例: <code
                                    className="bg-blue-100 px-1 rounded">/usr/local/bin/adb</code></li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SettingsContainer;