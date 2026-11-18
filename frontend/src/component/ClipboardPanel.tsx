import {useEffect, useRef, useState} from 'react';
import {Alert, Button, Empty, Input, Popconfirm, Select, Spin, Tooltip, message} from 'antd';
import {CopyOutlined, DeleteOutlined, DownloadOutlined, SendOutlined} from '@ant-design/icons';
import {ClearClipboardHistory, DeleteClipboardEntry, GetClipboardHistory, GetClipboardHistoryDevices,
    ReadPhoneClipboard, SendPhoneClipboard, TouchClipboardEntry} from '../../wailsjs/go/main/App';
import type {storage} from '../../wailsjs/go/models';
import {retryClipboardWatch, useClipboardWatchStore} from '../hooks/useClipboardWatch';
import {ClipboardSetText, EventsOn} from '../../wailsjs/runtime/runtime';
import {t, useLocale} from '../i18n';
import {useDeviceStore} from '../store/deviceStore';
import PageHeader from './PageHeader';

// Notify any newly mounted view even if an earlier action finished after a device switch.
const historyChanges = new EventTarget();
const changed = (serial: string) => historyChanges.dispatchEvent(new CustomEvent('change', {detail: serial}));

export default function ClipboardPanel() {
    useLocale();
    const device = useDeviceStore(state => state.selectedDevice);
    const [devices, setDevices] = useState<string[]>([]);
    const [offline, setOffline] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (device) return;
        let request = 0;
        const load = async () => {
            const version = ++request;
            try {
                const result = await GetClipboardHistoryDevices();
                if (request === version) { setDevices(result); setError(''); }
            } catch {
                if (request === version) setError(t("无法加载本地历史"));
            }
        };
        void load();
        historyChanges.addEventListener('change', load);
        return () => { request++; historyChanges.removeEventListener('change', load); };
    }, [device]);

    const serial = device?.id || (devices.includes(offline) ? offline : devices[0]) || '';
    return <main className="h-full min-w-0 flex-1 overflow-y-auto bg-canvas p-4 text-left lg:p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
            <PageHeader title={t("剪贴板")} description={t("自动记录当前手机新复制的文本，每台设备在电脑上保留最近 20 条。")}
                actions={!device && devices.length > 0 && <Select aria-label={t("离线设备历史")}
                    className="min-w-40 max-w-full" value={serial} onChange={setOffline}
                    options={devices.map(value => ({value, label: value}))}/>} />
            {!device && error && <Alert type="error" showIcon message={error}/>}
            {serial ? <DeviceClipboard key={JSON.stringify([serial, !!device])} serial={serial} online={!!device}/>
                : <div className="rounded-xl border border-hairline bg-elevated py-12">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("连接设备后即可收发文本")}/>
                </div>}
        </div>
    </main>;
}

function DeviceClipboard({serial, online}: {serial: string; online: boolean}) {
    const locale = useLocale();
    const [entries, setEntries] = useState<storage.ClipboardEntry[]>([]);
    const [draft, setDraft] = useState('');
    const [sensitive, setSensitive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState(false);
    const watch = useClipboardWatchStore();
    const watchState = online && watch.serial === serial ? watch.state : 'off';
    const alive = useRef(false);
    const pending = useRef(false);

    useEffect(() => {
        alive.current = true;
        let request = 0;
        const load = async (event?: Event) => {
            if (event && (event as CustomEvent<string>).detail !== serial) return;
            const version = ++request;
            try {
                const result = await GetClipboardHistory(serial);
                if (version === request) { setEntries(result); setLoadError(false); }
            } catch {
                if (version === request) setLoadError(true);
            } finally {
                if (version === request) setLoading(false);
            }
        };
        const off = EventsOn('clipboard-history-updated', (device: string) => { if (device === serial) void load(); });
        void load();
        historyChanges.addEventListener('change', load);
        return () => {
            off();
            alive.current = false;
            request++;
            historyChanges.removeEventListener('change', load);
        };
    }, [serial]);

    const perform = async (name: string, action: () => Promise<void>) => {
        if (pending.current) return;
        pending.current = true;
        setBusy(name);
        setError('');
        try { await action(); }
        catch (err) { if (alive.current) setError(String(err)); }
        finally { pending.current = false; if (alive.current) setBusy(''); }
    };
    const transfer = (direction: 'read' | 'send', text = draft, marked = sensitive) =>
        perform(direction, async () => {
            const result = direction === 'read' ? await ReadPhoneClipboard(serial)
                : await SendPhoneClipboard(serial, text, marked);
            if (result.historySaved) changed(serial);
            if (!alive.current) return;
            if (direction === 'read') { setDraft(result.text); setSensitive(result.sensitive); }
            if (!result.historySaved && !result.sensitive) {
                message.warning(t("传输成功，但未能保存本地历史"));
            } else {
                message.success(direction === 'read' ? t("已将手机剪贴板内容读入编辑框") : t("已复制到手机剪贴板"));
            }
        });
    const copy = (entry?: storage.ClipboardEntry) => perform('copy', async () => {
        if (!(await ClipboardSetText(entry ? entry.text : draft))) throw Error(t("复制到电脑剪贴板失败"));
        const used = entry ?? (!sensitive && entries.find(item => item.text === draft));
        if (used) {
            await TouchClipboardEntry(serial, used.id);
            changed(serial);
        }
        if (alive.current) message.success(t("已复制，可在电脑上的其他应用中粘贴"));
    });
    const remove = (id?: string) => perform('delete', async () => {
        if (id) await DeleteClipboardEntry(serial, id);
        else await ClearClipboardHistory(serial);
        changed(serial);
    });

    const actionsDisabled = !!busy;
    const copyHint = t("复制到电脑剪贴板，供其他应用粘贴");
    return <>
        {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')}/>}
        {online && <section className="rounded-xl border border-hairline bg-elevated p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="clipboard-text" className="text-sm font-semibold text-ink">{t("文本")}</label>
                <span className="break-all font-mono text-xs text-mute">{serial}</span>
            </div>
            <Input.TextArea id="clipboard-text" value={draft} autoSize={{minRows: 4, maxRows: 10}}
                placeholder={t("输入或粘贴要发送的文本")} disabled={actionsDisabled}
                onChange={e => { setDraft(e.target.value); if (!e.target.value) setSensitive(false); }}/>
            {sensitive && <p className="mt-2 text-xs text-warning-deep">{t("系统标记为敏感，此文本仅在本次操作中使用。")}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="primary" icon={<SendOutlined aria-hidden/>} disabled={actionsDisabled || !draft}
                    loading={busy === 'send'} onClick={() => transfer('send')}>{t("复制文本到手机剪贴板")}</Button>
                <Button icon={<DownloadOutlined aria-hidden/>} disabled={actionsDisabled}
                    loading={busy === 'read'} onClick={() => transfer('read')}>{t("读取手机当前剪贴板")}</Button>
                <Button type="text" title={copyHint} icon={<CopyOutlined aria-hidden/>} disabled={actionsDisabled || !draft}
                    onClick={() => copy()}>{t("复制")}</Button>
            </div>
        </section>}
        <section className="overflow-hidden rounded-xl border border-hairline bg-elevated">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="flex items-baseline gap-2 text-base font-semibold text-ink">{t("近期历史")}
                        <span className="font-mono text-xs font-normal text-mute">{entries.length} / 20</span></h2>
                    {(watchState === 'watching' || watchState === 'starting') &&
                        <span role="status" className="text-xs text-body">{watchState === 'watching' ? t("正在自动记录") : t("正在连接手机…")}</span>}
                </div>
                <Popconfirm title={t("清空这台设备的全部剪贴板历史？")} okText={t("清空")} cancelText={t("取消")}
                    okButtonProps={{danger:true}} onConfirm={() => remove()} disabled={actionsDisabled || !entries.length}>
                    <Button type="text" size="small" danger disabled={actionsDisabled || !entries.length}>{t("清空")}</Button>
                </Popconfirm>
            </div>
            {watchState === 'error' && <Alert type="warning" showIcon message={t("自动记录已停止")} description={watch.error}
                action={<Button size="small" onClick={retryClipboardWatch}>{t("重试")}</Button>}/>}
            {loadError ? <Alert type="error" showIcon message={t("无法加载本地历史")}
                action={<Button size="small" onClick={() => changed(serial)}>{t("重试")}</Button>}/> :
                loading ? <div className="p-8 text-center"><Spin/></div> :
                entries.length === 0 ? <p className="border-t border-hairline px-5 py-8 text-center text-sm text-mute">{t("暂无收发记录")}</p> :
                <ul className="m-0 list-none p-0">
                    {entries.map(entry => <li key={entry.id} className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3 sm:px-5">
                        <div className="min-w-0 flex-[1_1_230px]">
                            <details>
                                <summary className="cursor-pointer truncate rounded-sm text-sm font-medium text-ink focus-visible:outline-link">
                                    {entry.text}
                                </summary>
                                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-canvas p-3 font-sans text-sm text-body">{entry.text}</pre>
                            </details>
                            <p className="mt-1 text-xs text-mute">
                                {entry.source === 'phone' ? t("来自手机") : t("来自电脑")} · {new Date(entry.lastUsedAt).toLocaleString(locale)}
                            </p>
                        </div>
                        <div className="flex max-w-full flex-wrap items-center gap-1">
                            <Button type="text" title={copyHint} disabled={actionsDisabled} icon={<CopyOutlined aria-hidden/>}
                                onClick={() => copy(entry)}>{t("复制")}</Button>
                            <Tooltip title={t("复制文本到手机剪贴板")}><Button aria-label={t("复制文本到手机剪贴板")} type="text" disabled={!online || actionsDisabled}
                                icon={<SendOutlined aria-hidden/>} onClick={() => transfer('send', entry.text, false)}/></Tooltip>
                            <Popconfirm title={t("删除这条剪贴板记录？")} okText={t("删除")} cancelText={t("取消")}
                                okButtonProps={{danger:true}} onConfirm={() => remove(entry.id)} disabled={actionsDisabled}>
                                <Button aria-label={t("删除")} title={t("删除")} type="text" danger disabled={actionsDisabled} icon={<DeleteOutlined/>}/>
                            </Popconfirm>
                        </div>
                    </li>)}
                </ul>}
        </section>
    </>;
}
