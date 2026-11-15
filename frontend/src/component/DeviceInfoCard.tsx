import {t, useLocale, getLocale} from '../i18n';
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
        const rawLabel = line.substring(0, colonIndex).trim();
        const label = t(DEVICE_LABEL_KEYS[rawLabel] ?? rawLabel);
        let value = line.substring(colonIndex + 1).trim();
        if (rawLabel === 'CPU 型号' || rawLabel === 'CPU model') {
            value = getLocale() === 'en'
                ? value.replace(/、(\d+) 核$/, ', $1 cores')
                : value.replace(/, (\d+) cores$/, '、$1 核');
        }
        return label ? [{label, value: value || '--'}] : [];
    });
}

const DEVICE_LABEL_KEYS: Record<string, string> = {
    Name: '名称', Brand: '品牌', Model: '产品型号', 'Android version': '安卓版本',
    'Screen size': '屏幕尺寸', 'Screen density': '屏幕像素密度', Density: '密度',
    'CPU architecture': 'CPU 架构', 'CPU model': 'CPU 型号', Memory: '内存',
    Storage: '存储', 'Font scale': '字体缩放', 'Wi-Fi name': 'WIFI 名称',
    'IP address': 'IP 地址', 'OTA build': 'OTA 版本号',
};

// 首次读取时用同样的字段占位，读到数据后高度不变，避免页面跳动
const PLACEHOLDER_LABELS = () => ([t("名称"), t("品牌"), t("产品型号"), t("安卓版本"), t("屏幕尺寸"), t("屏幕像素密度"), t("密度"), t("CPU 架构"), t("CPU 型号"), t("内存"), t("存储"), t("字体缩放"), t("WIFI 名称"), t("IP 地址"), t("OTA 版本号")]);

// 超过这个长度的值（如 OTA 版本号）在放得下两列时占两列
const WIDE_VALUE_LENGTH = 24;

// 只有被截断时才显示完整内容的提示；点击复制
function InfoValue({label, value}: DeviceInfoItem) {
    useLocale();
    const [open, setOpen] = useState(false);
    const empty = value === '--';
    const copy = async () => {
        if (empty) return;
        // 通过 Wails 写系统剪贴板，不依赖 WebView 的剪贴板权限
        const ok = await ClipboardSetText(value).catch(() => false);
        if (ok) {
            message.success(t("已复制「{0}」", [label]));
        } else {
            message.error(t("复制失败"));
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
    const locale = useLocale();
    const parsed = useMemo(() => parseDeviceInfo(infoString), [infoString, locale]);
    const loading = connected && parsed.length === 0;
    const items = loading ? PLACEHOLDER_LABELS().map(label => ({label, value: ''})) : parsed;

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
                            <span className="shrink-0 whitespace-nowrap text-mute">{item.label}{locale === 'en' ? ': ' : '：'}</span>
                            {loading
                                ? <span className="w-16 animate-pulse rounded bg-hairline-soft">{'\u00a0'}</span>
                                : <InfoValue label={item.label} value={item.value}/>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex items-center gap-2 px-4 py-3.5 text-[12px] text-mute">
                    <i className="fa-solid fa-mobile-screen text-[12px] text-faint"/>
                    {t("连接设备后显示设备信息")}</div>
            )}
        </div>
    );
}

export default DeviceInfoCard;
