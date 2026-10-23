import {useEffect, useRef, useState} from 'react';
import {Button, Checkbox, Input, Modal} from 'antd';
import type {InputRef} from 'antd';
import {OpenDeepLink} from '../../wailsjs/go/main/App';
import {adb} from '../../wailsjs/go/models';

const RECENT_KEY = 'deep_link_recent';
const MAX_RECENT = 10;

function readRecent(): string[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function writeRecent(list: string[]) {
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
        // 存储不可用时只保留在内存中
    }
}

interface DeepLinkModalProps {
    visible: boolean;
    onClose: () => void;
    deviceId: string;
    targetPackage: string;
}

// Deep Link 测试：am start -W -a VIEW -d <link> [package]，展示打开的 Activity 与启动耗时
function DeepLinkModal({visible, onClose, deviceId, targetPackage}: DeepLinkModalProps) {
    const [link, setLink] = useState('');
    const [limitToTarget, setLimitToTarget] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<adb.DeepLinkResult | null>(null);
    const [recent, setRecent] = useState<string[]>(readRecent);
    const inputRef = useRef<InputRef>(null);

    useEffect(() => {
        if (visible) setResult(null);
    }, [visible]);

    const open = async (value = link) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        setLink(trimmed);
        setRunning(true);
        setResult(null);
        try {
            const res = await OpenDeepLink(deviceId, trimmed, limitToTarget ? targetPackage : '');
            setResult(res);
            if (!res.error) {
                const next = [trimmed, ...recent.filter(item => item !== trimmed)].slice(0, MAX_RECENT);
                setRecent(next);
                writeRecent(next);
            }
        } catch (error: any) {
            setResult({cmd: '', output: '', activity: '', totalTime: 0, error: error?.message || String(error)});
        } finally {
            setRunning(false);
        }
    };

    const clearRecent = () => {
        setRecent([]);
        writeRecent([]);
    };

    return (
        <Modal
            title="Deep Link 测试"
            open={visible}
            onCancel={onClose}
            footer={null}
            width={640}
            destroyOnHidden
            // 弹窗动画结束后再聚焦，autoFocus 在动画期间不生效
            afterOpenChange={open => open && inputRef.current?.focus()}
        >
            <div className="flex flex-col gap-3 pt-1">
                <div className="flex gap-2">
                    <Input
                        ref={inputRef}
                        value={link}
                        onChange={e => setLink(e.target.value)}
                        onPressEnter={() => void open()}
                        placeholder="myapp://detail?id=1 或 https://example.com/path"
                        className="!font-mono !text-[13px]"
                        allowClear
                    />
                    <Button type="primary" loading={running} disabled={!link.trim()} onClick={() => void open()}>
                        打开
                    </Button>
                </div>

                <Checkbox
                    checked={limitToTarget && Boolean(targetPackage)}
                    disabled={!targetPackage}
                    onChange={e => setLimitToTarget(e.target.checked)}
                >
                    <span className="text-[13px] text-body">
                        只用目标应用解析（指定包名）
                        {targetPackage
                            ? <span className="ml-1 font-mono text-[12px] text-mute">{targetPackage}</span>
                            : <span className="ml-1 text-[12px] text-faint">（未选择目标应用）</span>}
                    </span>
                    <div className="text-[12px] text-faint">
                        不弹选择框，也不会被浏览器等其他应用接走，用于验证目标应用能否处理这个链接
                    </div>
                </Checkbox>

                {result && (
                    <div className={`rounded-lg border px-3 py-2.5 text-[13px] ${
                        result.error ? 'border-error-soft bg-error-soft/40' : 'border-link-soft bg-link-soft/40'
                    }`}>
                        {result.error ? (
                            <>
                                <div className="font-medium text-error">无法打开：{result.error}</div>
                                {result.output && !result.output.includes(result.error) && (
                                    <div className="mt-1 break-all font-mono text-[11.5px] text-body">{result.output.split('\n').find(line => line.startsWith('Error')) ?? ''}</div>
                                )}
                            </>
                        ) : (
                            <div className="text-ink">
                                <span className="font-medium">已打开</span>
                                {result.activity && <span className="ml-2 break-all font-mono text-[12px]">{result.activity}</span>}
                                {result.totalTime > 0 && <span className="ml-2 text-mute">启动耗时 {result.totalTime} ms</span>}
                            </div>
                        )}
                        {result.cmd && (
                            <div className="mt-1.5 break-all font-mono text-[11.5px] text-mute">$ {result.cmd}</div>
                        )}
                    </div>
                )}

                {recent.length > 0 && (
                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">Recent</span>
                            <Button type="link" size="small" className="!px-0 !text-[12px]" onClick={clearRecent}>清空</Button>
                        </div>
                        <div className="flex flex-col gap-1">
                            {recent.map(item => (
                                <button
                                    key={item}
                                    onClick={() => setLink(item)}
                                    onDoubleClick={() => void open(item)}
                                    title="单击填入，双击直接打开"
                                    className="truncate rounded-md px-2 py-1 text-left font-mono text-[12px] text-body transition-colors hover:bg-hairline-soft"
                                >
                                    {item}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export default DeepLinkModal;
