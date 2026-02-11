// DeviceInfoCard.tsx
import React from 'react';
import { Spin } from 'antd';

interface DeviceInfoItem {
    label: string;
    value: string;
}

// 默认显示的字段
const defaultLabels = [
    '名称',
    '品牌',
    '产品型号',
    '安卓版本',
    '屏幕尺寸',
    '屏幕像素密度',
    '密度',
    'CPU 架构',
    'CPU 型号',
    '内存',
    '存储',
    '字体缩放',
    'WIFI 名称',
    'IP 地址',
    'OTA 版本号'
];

interface DeviceInfoCardProps {
    infoString: string | null;
    loading?: boolean;
}

const DeviceInfoCard: React.FC<DeviceInfoCardProps> = ({ infoString, loading = false }) => {
    const parseDeviceInfo = (str: string | null): DeviceInfoItem[] => {
        if (!str) {
            // 断开连接时，返回空值的默认字段
            return defaultLabels.map(label => ({ label, value: '--' }));
        }

        try {
            const lines = str.split('\n').filter(line => line.trim());
            const items: DeviceInfoItem[] = [];

            for (const line of lines) {
                const colonIndex = line.search(/[:：]/);
                if (colonIndex > 0) {
                    const label = line.substring(0, colonIndex).trim();
                    const value = line.substring(colonIndex + 1).trim();
                    if (label) {
                        items.push({ label, value: value || '--' });
                    }
                }
            }

            // 如果解析结果为空，返回默认字段
            return items.length > 0 ? items : defaultLabels.map(label => ({ label, value: '--' }));
        } catch (e) {
            console.error('Failed to parse device info:', e);
            return defaultLabels.map(label => ({ label, value: '--' }));
        }
    };

    const deviceInfoItems = parseDeviceInfo(infoString);

    return (
        <div className="flex flex-col gap-4">
            {/* 标题 */}
            <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-800">
                    设备信息
                </h2>
            </div>

            {/* 卡片内容 */}
            <div className="bg-white rounded-lg shadow-md p-6">
                {loading ? (
                    <div className="flex items-center justify-center h-16">
                        <Spin tip="加载设备信息中..." />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-4">
                        {deviceInfoItems.map((item, index) => (
                            <div key={index} className="grid grid-cols-[auto_1fr] gap-x-2">
                                <span className="text-gray-400 text-[13px] whitespace-nowrap">
                                    {item.label}:
                                </span>
                                <span className={`text-[13px] break-words ${item.value === '--' ? 'text-gray-300' : 'text-gray-700'}`}>
                                    {item.value}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DeviceInfoCard;