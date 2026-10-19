import {useMemo} from 'react';

interface DeviceInfoItem {
    label: string;
    value: string;
}

function parseDeviceInfo(str: string | null): DeviceInfoItem[] {
    if (!str) return [];
    return str.split('\n').flatMap(line => {
        const colonIndex = line.search(/[:：]/);
        if (colonIndex <= 0) return [];
        const label = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        return label ? [{label, value: value || '--'}] : [];
    });
}

// 首次读取时用同样的字段占位，读到数据后高度不变，避免页面跳动
const PLACEHOLDER_LABELS = ['名称', '品牌', '产品型号', '安卓版本', '屏幕尺寸', '屏幕像素密度', '密度', 'CPU 架构', 'CPU 型号', '内存', '存储', '字体缩放', 'WIFI 名称', 'IP 地址', 'OTA 版本号'];

interface DeviceInfoCardProps {
    infoString: string | null;
    connected: boolean;
}

// 设备信息：直接展示全部字段；设备名和序列号已在左侧导航中显示
function DeviceInfoCard({infoString, connected}: DeviceInfoCardProps) {
    const parsed = useMemo(() => parseDeviceInfo(infoString), [infoString]);
    const loading = connected && parsed.length === 0;
    const items = loading ? PLACEHOLDER_LABELS.map(label => ({label, value: ''})) : parsed;

    return (
        <div className="rounded-xl border border-hairline bg-elevated shadow-whisper">
            {items.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-2.5 px-4 py-3.5">
                    {items.map(item => (
                        <div key={item.label} className="flex min-w-0 items-baseline gap-2 text-[12px]">
                            <span className="shrink-0 whitespace-nowrap text-mute">{item.label}</span>
                            {loading
                                ? <span className="w-16 animate-pulse rounded bg-hairline-soft">{'\u00a0'}</span>
                                : <span title={item.value} className={`truncate ${item.value === '--' ? 'text-faint' : 'text-ink'}`}>{item.value}</span>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex items-center gap-2 px-4 py-3.5 text-[12px] text-mute">
                    <i className="fa-solid fa-mobile-screen text-[12px] text-faint"/>
                    连接设备后显示设备信息
                </div>
            )}
        </div>
    );
}

export default DeviceInfoCard;
