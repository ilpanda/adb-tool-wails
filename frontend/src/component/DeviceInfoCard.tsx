import {useMemo, useState} from 'react';
import {message, Tooltip} from 'antd';
import {ClipboardSetText} from '../../wailsjs/runtime/runtime';

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

// 超过这个长度的值（如 OTA 版本号）在放得下两列时占两列
const WIDE_VALUE_LENGTH = 24;

// 只有被截断时才显示完整内容的提示；点击复制
function InfoValue({label, value}: DeviceInfoItem) {
    const [open, setOpen] = useState(false);
    const empty = value === '--';
    const copy = async () => {
        if (empty) return;
        // 通过 Wails 写系统剪贴板，不依赖 WebView 的剪贴板权限
        const ok = await ClipboardSetText(value).catch(() => false);
        if (ok) {
            message.success(`已复制「${label}」`);
        } else {
            message.error('复制失败');
        }
    };
    return (
        <Tooltip
            title={<span className="font-mono">{value}</span>}
            open={open}
            placement="topLeft"
            styles={{root: {maxWidth: 'none'}}}
        >
            <span
                onMouseEnter={e => setOpen(e.currentTarget.scrollWidth > e.currentTarget.clientWidth)}
                onMouseLeave={() => setOpen(false)}
                onClick={copy}
                className={`truncate ${empty ? 'text-faint' : 'cursor-copy text-ink hover:underline hover:decoration-hairline hover:underline-offset-2'}`}
            >
                {value}
            </span>
        </Tooltip>
    );
}

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
        <div className="@container rounded-xl border border-hairline bg-elevated shadow-whisper">
            {items.length > 0 ? (
                // 456px = 两列 200px + 列间距 24px + 左右内边距 32px，窄于此时只有一列，不再跨列
                <div className="grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-2.5 px-4 py-3.5">
                    {items.map(item => (
                        <div
                            key={item.label}
                            className={`flex min-w-0 items-baseline gap-0.5 text-[12px] ${item.value.length >= WIDE_VALUE_LENGTH ? '@min-[456px]:col-span-2' : ''}`}
                        >
                            {/* 全角冒号自带右侧留白，标签与值的间距相应缩小 */}
                            <span className="shrink-0 whitespace-nowrap text-mute">{item.label}：</span>
                            {loading
                                ? <span className="w-16 animate-pulse rounded bg-hairline-soft">{'\u00a0'}</span>
                                : <InfoValue label={item.label} value={item.value}/>}
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
