import {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Button, Input, Modal, QRCode, Segmented, Spin} from 'antd';
import {
    CancelWirelessPairByQR,
    WirelessConnect,
    WirelessDisconnect,
    WirelessFromUSB,
    WirelessMdnsSupported,
    WirelessPair,
    WirelessPairByQR,
} from '../../wailsjs/go/main/App';
import {adb} from '../../wailsjs/go/models';
import {useDeviceStore} from '../store/deviceStore';

type Mode = 'qr' | 'code' | 'ip' | 'usb';

const RECENT_KEY = 'wireless_recent_addresses';
const MAX_RECENT = 6;

function readRecent(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function rememberAddress(address: string) {
    const next = [address, ...readRecent().filter(item => item !== address)].slice(0, MAX_RECENT);
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
        // 存储不可用时不记录
    }
    return next;
}

// 无线连接的设备序列号形如 192.168.1.5:5555 或 adb-XXXX._adb-tls-connect._tcp
export const isWirelessDevice = (id: string) => id.includes(':') || id.includes('._adb-tls-connect.');

const randomString = (length: number, chars: string) =>
    Array.from(crypto.getRandomValues(new Uint32Array(length)), n => chars[n % chars.length]).join('');

function Steps({children}: { children: React.ReactNode }) {
    return <div className="rounded-lg bg-canvas px-3 py-2.5 text-[12.5px] leading-6 text-body">{children}</div>;
}

function ResultLine({result}: { result: adb.WirelessResult | null }) {
    if (!result) return null;
    if (result.error) {
        return <Alert type="error" showIcon message={result.error}/>;
    }
    // 配对成功但没找到连接端口时由 PairedConnect 引导补充，这里不显示「成功」
    if (result.paired && !result.connected) return null;
    return <Alert type="success" showIcon message={result.connected ? `已连接 ${result.connected}` : '操作成功'}/>;
}

// 配对成功但自动连接失败（电脑与手机不在同一网段时 mDNS 找不到连接端口）：让用户补充连接端口
function PairedConnect({host, busy, onConnect}: { host: string; busy: boolean; onConnect: (address: string) => void }) {
    const [address, setAddress] = useState(`${host}:`);
    const valid = /:\d+$/.test(address);
    return (
        <Alert
            type="warning"
            showIcon
            message="配对成功，还差一步：连接"
            description={
                <div className="flex flex-col gap-2">
                    <span>没能自动找到连接端口（电脑与手机不在同一网段时常见）。请填写手机「无线调试」页面上「IP 地址和端口」中的端口，它与配对端口不同。</span>
                    <div className="flex gap-2">
                        <Input
                            value={address}
                            onChange={e => setAddress(e.target.value.trim())}
                            onPressEnter={() => valid && onConnect(address)}
                            className="!font-mono"
                        />
                        <Button type="primary" loading={busy} disabled={!valid} onClick={() => onConnect(address)}>连接</Button>
                    </div>
                </div>
            }
        />
    );
}

interface WirelessModalProps {
    open: boolean;
    onClose: () => void;
}

// 无线调试：二维码配对 / 配对码配对 / IP 连接 / USB 转无线，参考 aya 的实现
function WirelessModal({open, onClose}: WirelessModalProps) {
    const {devices, selectedDevice, setSelectedDevices} = useDeviceStore();
    const [mode, setMode] = useState<Mode>('qr');
    const [mdnsSupported, setMdnsSupported] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<adb.WirelessResult | null>(null);
    const [recent, setRecent] = useState<string[]>(readRecent);

    const [pairAddress, setPairAddress] = useState('');
    const [pairCode, setPairCode] = useState('');
    const [connectAddress, setConnectAddress] = useState('');

    // 二维码内容：服务名与密码随机生成，手机扫码后以该服务名广播配对服务
    const [qrSeed, setQrSeed] = useState(0);
    const qr = useMemo(() => {
        const name = `adb-tool-${randomString(6, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
        const password = randomString(10, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
        return {name, password, text: `WIFI:T:ADB;S:${name};P:${password};;`};
    }, [qrSeed]);
    const [qrState, setQrState] = useState<'waiting' | 'done' | 'error'>('waiting');
    // 等待超过 15 秒仍未发现手机时提示可能的网络原因
    const [qrSlow, setQrSlow] = useState(false);
    const qrRun = useRef(0);

    const wirelessDevices = devices.filter(device => isWirelessDevice(device.id));
    const usbDevice = selectedDevice && !isWirelessDevice(selectedDevice.id) ? selectedDevice : null;

    useEffect(() => {
        if (!open) return;
        setResult(null);
        if (mdnsSupported === null) {
            WirelessMdnsSupported().then(setMdnsSupported).catch(() => setMdnsSupported(false));
        }
    }, [open]);

    // 显示二维码时开始等待扫码；切换方式或关闭弹窗时取消
    useEffect(() => {
        if (!open || mode !== 'qr' || mdnsSupported !== true) return;
        const run = ++qrRun.current;
        setQrState('waiting');
        setQrSlow(false);
        setResult(null);
        const slowTimer = window.setTimeout(() => run === qrRun.current && setQrSlow(true), 15000);
        WirelessPairByQR(qr.name, qr.password).then(res => {
            if (run !== qrRun.current) return;
            if (res.error === '已取消') return;
            setResult(res);
            setQrState(res.error ? 'error' : 'done');
            if (res.connected) setRecent(rememberAddress(res.connected));
        });
        return () => {
            qrRun.current++;
            window.clearTimeout(slowTimer);
            void CancelWirelessPairByQR();
        };
    }, [open, mode, mdnsSupported, qr]);

    const finish = (res: adb.WirelessResult) => {
        setResult(res);
        if (res.connected) setRecent(rememberAddress(res.connected));
    };

    const run = async (action: () => Promise<adb.WirelessResult>) => {
        setBusy(true);
        setResult(null);
        try {
            finish(await action());
        } catch (error: any) {
            setResult({cmd: '', output: '', connected: '', paired: false, host: '', error: error?.message || String(error)});
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async (serial: string) => {
        const res = await WirelessDisconnect(serial);
        setResult(res.error ? res : {...res, connected: '', error: ''});
        if (!res.error && selectedDevice?.id === serial) setSelectedDevices(null);
    };

    return (
        <Modal title="无线调试" open={open} onCancel={onClose} footer={null} width={560} destroyOnHidden>
            <div className="flex flex-col gap-4 pt-1">
                <Segmented
                    block
                    value={mode}
                    onChange={value => {
                        setMode(value as Mode);
                        setResult(null);
                    }}
                    options={[
                        {value: 'qr', label: '二维码配对'},
                        {value: 'code', label: '配对码配对'},
                        {value: 'ip', label: 'IP 连接'},
                        {value: 'usb', label: 'USB 转无线'},
                    ]}
                />

                {mode === 'qr' && (
                    mdnsSupported === false ? (
                        <Alert
                            type="warning"
                            showIcon
                            message="当前 adb 不支持 mDNS，无法使用二维码配对"
                            description="请升级 Android SDK Platform-Tools（31 及以上），或改用「配对码配对」。"
                        />
                    ) : (
                        <div className="flex gap-5">
                            <div className="relative shrink-0">
                                {/* 固定白底黑码：深色背景下部分手机扫码识别不了 */}
                                <QRCode value={qr.text} size={176} bordered color="#000000" bgColor="#ffffff" status={mdnsSupported === null ? 'loading' : undefined}/>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-3">
                                <Steps>
                                    1. 手机与电脑连接同一 Wi-Fi（Android 11 及以上）<br/>
                                    2. 打开「开发者选项 → 无线调试」<br/>
                                    3. 点击「使用二维码配对设备」并扫描左侧二维码
                                </Steps>
                                {qrState === 'waiting' && mdnsSupported && (
                                    <div className="flex items-center gap-2 text-[13px] text-mute">
                                        <Spin size="small"/> 等待手机扫码…
                                    </div>
                                )}
                                {qrState === 'waiting' && qrSlow && (
                                    <Alert
                                        type="info"
                                        showIcon
                                        message="扫码后一直没有反应？"
                                        description="二维码配对依赖 mDNS（局域网组播）发现手机。电脑与手机不在同一网段（公司网络常见）或网络屏蔽组播时无法使用，请改用「配对码配对」。"
                                    />
                                )}
                                <ResultLine result={result}/>
                                {result?.paired && !result.connected && !result.error && (
                                    <PairedConnect host={result.host} busy={busy} onConnect={address => void run(() => WirelessConnect(address))}/>
                                )}
                                {qrState !== 'waiting' && (
                                    <Button onClick={() => setQrSeed(seed => seed + 1)}>重新生成二维码</Button>
                                )}
                            </div>
                        </div>
                    )
                )}

                {mode === 'code' && (
                    <div className="flex flex-col gap-3">
                        <Steps>
                            在手机「开发者选项 → 无线调试」中点击「使用配对码配对设备」，填写弹窗里的 IP 地址和端口、6 位配对码。
                            配对成功后会自动连接。
                        </Steps>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[13px] font-medium text-body">IP 地址和端口</span>
                            <Input
                                value={pairAddress}
                                onChange={e => setPairAddress(e.target.value.trim())}
                                placeholder="192.168.1.5:37123"
                                className="!font-mono"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[13px] font-medium text-body">配对码</span>
                            <Input.OTP length={6} value={pairCode} onChange={setPairCode}/>
                        </div>
                        <Button
                            type="primary"
                            loading={busy}
                            disabled={!pairAddress || pairCode.length !== 6}
                            onClick={() => void run(() => WirelessPair(pairAddress, pairCode))}
                        >
                            配对并连接
                        </Button>
                        <ResultLine result={result}/>
                        {result?.paired && !result.connected && !result.error && (
                            <PairedConnect host={result.host} busy={busy} onConnect={address => void run(() => WirelessConnect(address))}/>
                        )}
                    </div>
                )}

                {mode === 'ip' && (
                    <div className="flex flex-col gap-3">
                        <Steps>
                            连接已配对的设备（「无线调试」页面上显示的 IP 地址和端口），或已通过「USB 转无线」开启 5555 端口的设备。
                        </Steps>
                        <div className="flex gap-2">
                            <Input
                                value={connectAddress}
                                onChange={e => setConnectAddress(e.target.value.trim())}
                                onPressEnter={() => connectAddress && void run(() => WirelessConnect(connectAddress))}
                                placeholder="192.168.1.5:5555"
                                className="!font-mono"
                            />
                            <Button type="primary" loading={busy} disabled={!connectAddress} onClick={() => void run(() => WirelessConnect(connectAddress))}>
                                连接
                            </Button>
                        </div>
                        {recent.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {recent.map(address => (
                                    <button
                                        key={address}
                                        onClick={() => setConnectAddress(address)}
                                        className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[12px] text-body transition-colors hover:border-hairline-strong"
                                    >
                                        {address}
                                    </button>
                                ))}
                            </div>
                        )}
                        <ResultLine result={result}/>
                    </div>
                )}

                {mode === 'usb' && (
                    <div className="flex flex-col gap-3">
                        <Steps>
                            让当前 USB 连接的设备开启 5555 端口并通过 WLAN 连接，适用于 Android 10 及以下或未开启无线调试的设备。
                            切换时设备会短暂断开，完成后可以拔掉数据线。手机需要与电脑在同一网络。
                        </Steps>
                        {usbDevice ? (
                            <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5">
                                <div className="min-w-0">
                                    <div className="truncate text-[13px] font-medium text-ink">{usbDevice.name}</div>
                                    <div className="truncate font-mono text-[11.5px] text-mute">{usbDevice.id}</div>
                                </div>
                                <Button type="primary" loading={busy} onClick={() => void run(() => WirelessFromUSB(usbDevice.id))}>
                                    切换到无线
                                </Button>
                            </div>
                        ) : (
                            <Alert type="info" showIcon message="请先在左侧选择一台通过 USB 连接的设备"/>
                        )}
                        <ResultLine result={result}/>
                    </div>
                )}

                {wirelessDevices.length > 0 && (
                    <div className="border-t border-hairline-soft pt-3">
                        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-faint">已连接的无线设备</div>
                        <div className="flex flex-col gap-1.5">
                            {wirelessDevices.map(device => (
                                <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                                    <div className="min-w-0">
                                        <div className="truncate text-[13px] text-ink">{device.name}</div>
                                        <div className="truncate font-mono text-[11.5px] text-mute">{device.id}</div>
                                    </div>
                                    <Button size="small" onClick={() => void disconnect(device.id)}>断开</Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default WirelessModal;
