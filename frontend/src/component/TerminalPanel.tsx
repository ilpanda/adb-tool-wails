import {useEffect, useMemo, useRef, useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {Button, Empty, Input, Segmented, Tooltip, message} from 'antd';
import {CloseOutlined, CompressOutlined, CopyOutlined, DeleteOutlined, DownloadOutlined, ExpandOutlined, SearchOutlined} from '@ant-design/icons';
import {SaveFile} from '../../wailsjs/go/main/App';
import {ActionTask, elapsedMs, formatElapsed, isActive, useActionTaskStore} from '../store/actionTaskStore';
import {useNow} from '../hooks/useNow';
import {Eyebrow} from './PageHeader';

type Filter = 'all' | 'error';

const STATUS_ICON: Record<string, {icon: string; className: string}> = {
    dialog: {icon: 'fa-circle-notch fa-spin', className: 'text-link'},
    running: {icon: 'fa-circle-notch fa-spin', className: 'text-link'},
    pulling: {icon: 'fa-circle-notch fa-spin', className: 'text-link'},
    success: {icon: 'fa-circle-check', className: 'text-link'},
    error: {icon: 'fa-circle-xmark', className: 'text-error'},
    canceled: {icon: 'fa-circle-minus', className: 'text-faint'},
};

const STAGE_TEXT: Record<string, string> = {
    dialog: '等待选择文件…',
    running: '执行中…',
    pulling: '正在保存到电脑…',
};

function formatClock(ts: number) {
    return new Date(ts).toLocaleTimeString('zh-CN', {hour12: false});
}

function copy(text: string) {
    void navigator.clipboard.writeText(text);
    message.success('已复制');
}

function TaskRow({task, now, defaultOpen}: { task: ActionTask; now: number; defaultOpen: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    const openDetail = useActionTaskStore(state => state.openDetail);
    const status = STATUS_ICON[task.status];
    const active = isActive(task);
    const body = task.status === 'error' || task.status === 'canceled' ? task.error : task.output;

    useEffect(() => {
        if (task.status === 'error') setOpen(true);
    }, [task.status]);

    return (
        <div className={`border-b border-hairline-soft ${task.status === 'error' ? 'bg-error-soft/30' : ''}`}>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                className="group flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-canvas"
            >
                <i className={`fa-solid ${status.icon} w-3.5 text-center text-[12px] ${status.className}`}/>
                <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-faint">{formatClock(task.createdAt)}</span>
                <span className="shrink-0 text-[13px] font-medium text-ink">{task.label}</span>
                {task.packageName && <span className="min-w-0 truncate font-mono text-[11px] text-mute">{task.packageName}</span>}
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-mute">
                    {active ? STAGE_TEXT[task.status] : ''} {task.status === 'dialog' ? '' : formatElapsed(elapsedMs(task, now))}
                </span>
                <span
                    role="button"
                    tabIndex={0}
                    onClick={event => {
                        event.stopPropagation();
                        openDetail(task.id);
                    }}
                    className="shrink-0 rounded px-1.5 text-[12px] text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                >
                    详情
                </span>
                <i className={`fa-solid fa-chevron-right text-[9px] text-faint transition-transform ${open ? 'rotate-90' : ''}`}/>
            </button>

            {open && (
                <div className="space-y-2 px-4 pb-3 pl-[52px] font-mono text-[12px] leading-5">
                    {task.cmd && (
                        <div className="group/cmd flex items-start gap-2">
                            <span className="select-none text-faint">$</span>
                            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-body">{task.cmd}</span>
                            <CopyOutlined className="mt-1 shrink-0 cursor-pointer text-faint opacity-0 hover:text-ink group-hover/cmd:opacity-100" onClick={() => copy(task.cmd)}/>
                        </div>
                    )}
                    {active ? (
                        <div className="text-faint">{STAGE_TEXT[task.status]}</div>
                    ) : body ? (
                        <div className="group/out relative">
                            <pre className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border px-3 py-2 ${
                                task.status === 'error' ? 'border-error-soft bg-elevated text-error' : 'border-hairline bg-canvas text-ink'
                            }`}>
                                {body.trim()}
                            </pre>
                            <CopyOutlined className="absolute right-2 top-2 cursor-pointer text-faint opacity-0 hover:text-ink group-hover/out:opacity-100" onClick={() => copy(body)}/>
                        </div>
                    ) : (
                        <div className="text-faint">（无输出）</div>
                    )}
                </div>
            )}
        </div>
    );
}

// 快捷功能的执行记录：点击时立即插入一条，执行完成后原地更新
function TerminalPanel() {
    const {tasks, panelOpen, setPanelOpen, clearFinished} = useActionTaskStore();
    const [height, setHeight] = useState(320);
    const [fullscreen, setFullscreen] = useState(false);
    const [filter, setFilter] = useState<Filter>('all');
    const [keyword, setKeyword] = useState('');
    const endRef = useRef<HTMLDivElement>(null);
    const now = useNow(tasks.some(isActive), 200);

    const visible = useMemo(() => {
        const lower = keyword.trim().toLowerCase();
        return tasks.filter(task => {
            if (filter === 'error' && task.status !== 'error') return false;
            if (!lower) return true;
            return [task.label, task.packageName, task.cmd, task.output, task.error].some(text => text.toLowerCase().includes(lower));
        });
    }, [filter, keyword, tasks]);

    const errorCount = tasks.filter(task => task.status === 'error').length;

    useEffect(() => {
        if (panelOpen) endRef.current?.scrollIntoView({block: 'end'});
    }, [panelOpen, tasks.length]);

    const handleResize = (event: ReactMouseEvent) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = height;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';

        const onMove = (e: MouseEvent) => {
            const next = Math.min(Math.max(180, startHeight + startY - e.clientY), window.innerHeight - 120);
            requestAnimationFrame(() => setHeight(next));
        };
        const onUp = () => {
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const handleExport = async () => {
        const text = tasks.map(task => [
            `[${formatClock(task.createdAt)}] ${task.label}${task.packageName ? ` (${task.packageName})` : ''} · ${task.status} · ${formatElapsed(elapsedMs(task))}`,
            task.cmd && `$ ${task.cmd}`,
            (task.error || task.output).trim(),
        ].filter(Boolean).join('\n')).join('\n\n');
        await SaveFile(text, 'quick_action_log');
    };

    if (!panelOpen) return null;

    return (
        <div
            className={`flex flex-col border-t border-hairline bg-elevated text-left ${fullscreen ? 'absolute inset-0 z-40' : 'shrink-0'}`}
            style={fullscreen ? undefined : {height}}
        >
            {!fullscreen && (
                <div onMouseDown={handleResize} className="group flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center hover:bg-hairline-soft">
                    <span className="h-0.5 w-10 rounded-full bg-hairline group-hover:bg-faint"/>
                </div>
            )}

            <div className="flex shrink-0 items-center gap-3 border-b border-hairline-soft px-4 py-2">
                <Eyebrow>Execution log · {tasks.length}</Eyebrow>
                <Segmented
                    size="small"
                    value={filter}
                    onChange={value => setFilter(value as Filter)}
                    options={[
                        {value: 'all', label: '全部'},
                        {value: 'error', label: `失败${errorCount ? ` ${errorCount}` : ''}`},
                    ]}
                />
                <Input
                    size="small"
                    allowClear
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    prefix={<SearchOutlined className="text-faint"/>}
                    placeholder="搜索命令或输出"
                    className="!w-48"
                />
                <div className="ml-auto flex items-center gap-0.5">
                    <Tooltip title="导出记录">
                        <Button type="text" size="small" icon={<DownloadOutlined/>} disabled={tasks.length === 0} onClick={() => void handleExport()}/>
                    </Tooltip>
                    <Tooltip title="清空已完成的记录">
                        <Button type="text" size="small" icon={<DeleteOutlined/>} disabled={tasks.length === 0} onClick={clearFinished}/>
                    </Tooltip>
                    <Tooltip title={fullscreen ? '退出全屏' : '全屏'}>
                        <Button type="text" size="small" icon={fullscreen ? <CompressOutlined/> : <ExpandOutlined/>} onClick={() => setFullscreen(value => !value)}/>
                    </Tooltip>
                    <Tooltip title="收起">
                        <Button type="text" size="small" icon={<CloseOutlined/>} onClick={() => {
                            setFullscreen(false);
                            setPanelOpen(false);
                        }}/>
                    </Tooltip>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {visible.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={tasks.length === 0 ? '还没有执行记录' : '没有匹配的记录'}/>
                    </div>
                ) : (
                    <>
                        {visible.map((task, index) => (
                            <TaskRow key={task.id} task={task} now={now} defaultOpen={index === visible.length - 1 || task.status === 'error'}/>
                        ))}
                        <div ref={endRef}/>
                    </>
                )}
            </div>
        </div>
    );
}

export default TerminalPanel;
