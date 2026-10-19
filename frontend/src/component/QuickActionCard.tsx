import {useEffect, useState} from 'react';
import {Tooltip} from 'antd';
import {ACTION_DESC, ACTION_TONE, QuickAction, TONE_CLASS, iconClass} from '../data/quickActions';
import {ActionTask, elapsedMs, formatElapsed, isActive} from '../store/actionTaskStore';
import {useNow} from '../hooks/useNow';

const FLASH_MS = 1500;

const STAGE_TEXT: Record<string, string> = {
    dialog: '等待选择文件…',
    running: '执行中',
    pulling: '正在保存到电脑',
};

interface QuickActionCardProps {
    item: QuickAction;
    // 该功能最近一次执行的任务
    task?: ActionTask;
    disabledReason?: string;
    // tile：带说明的卡片；key：按键按钮；chip：最近使用
    variant?: 'tile' | 'key' | 'chip';
    onClick: () => void;
}

// 执行状态：运行中、刚完成（短暂显示）、失败未查看
function useTaskState(task?: ActionTask) {
    const running = task ? isActive(task) : false;
    const now = useNow(running);
    const [flash, setFlash] = useState(false);

    useEffect(() => {
        if (!task?.endedAt || Date.now() - task.endedAt > FLASH_MS) {
            setFlash(false);
            return;
        }
        setFlash(true);
        const timer = window.setTimeout(() => setFlash(false), FLASH_MS - (Date.now() - task.endedAt));
        return () => window.clearTimeout(timer);
    }, [task?.endedAt]);

    return {
        running,
        now,
        succeeded: flash && task?.status === 'success',
        failed: task?.status === 'error' && !task.acknowledged,
    };
}

function QuickActionCard({item, task, disabledReason, variant = 'tile', onClick}: QuickActionCardProps) {
    const {running, now, succeeded, failed} = useTaskState(task);
    const tone = TONE_CLASS[ACTION_TONE[item.action]];
    const disabled = Boolean(disabledReason) || running;

    const statusText = running && task
        ? task.status === 'dialog'
            ? STAGE_TEXT.dialog
            : `${STAGE_TEXT[task.status]} ${formatElapsed(elapsedMs(task, now))}`
        : failed
            ? '执行失败，点击重试'
            : succeeded && task
                ? `完成 · ${formatElapsed(elapsedMs(task))}`
                : '';

    const icon = running
        ? <i className="fa-solid fa-circle-notch fa-spin text-link"/>
        : <i className={iconClass(item.icon)}/>;

    const stateRing = running
        ? 'border-link shadow-[0_0_0_3px_rgba(0,112,243,0.10)]'
        : failed
            ? 'border-error/50'
            : succeeded
                ? 'border-link/40'
                : 'border-hairline hover:border-[#d9d9d9]';

    // 分组卡片内的单元格：由外层网格画分隔线，单元格本身只负责背景和状态
    const cellTone = running
        ? 'bg-[#F5F9FF]'
        : disabledReason
            ? 'bg-elevated'
            : 'bg-elevated hover:bg-canvas';
    const cellCursor = disabledReason ? 'cursor-not-allowed' : running ? 'cursor-progress' : 'cursor-pointer';
    const iconBox = (
        <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-[13px] ${
            running ? 'bg-link-soft' : `${tone.box} ${tone.icon}`
        }`}>
            {icon}
        </span>
    );
    const stateMark = (succeeded || failed) && (
        <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] text-white ${failed ? 'bg-error' : 'bg-link'}`}>
            <i className={`fa-solid ${failed ? 'fa-xmark' : 'fa-check'}`}/>
        </span>
    );

    let card;
    if (variant === 'key') {
        card = (
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                title={item.label}
                className={`group flex h-[52px] w-full items-center gap-3 px-3.5 text-left transition-colors ${cellTone} ${cellCursor}`}
            >
                {iconBox}
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{item.label.replace(/按键$|键$/, '')}</span>
                {running && statusText && <span className="shrink-0 font-mono text-[11px] tabular-nums text-link">{statusText.replace(/^执行中 /, '')}</span>}
                {stateMark}
            </button>
        );
    } else if (variant === 'chip') {
        card = (
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={`flex h-8 max-w-[220px] items-center gap-2 rounded-full border bg-elevated px-3 text-[12px] text-body transition-colors ${stateRing} ${
                    disabledReason ? 'cursor-not-allowed opacity-50' : running ? 'cursor-progress' : 'cursor-pointer hover:text-ink'
                }`}
            >
                <span className="text-[11px] text-mute">{icon}</span>
                <span className="truncate">{item.label}</span>
                {running && statusText && <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">{statusText.replace(/^执行中 /, '')}</span>}
            </button>
        );
    } else {
        card = (
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={`group flex h-full w-full items-center gap-3 px-3.5 py-3 text-left transition-colors ${cellTone} ${cellCursor}`}
            >
                <span className={disabledReason ? 'opacity-50' : ''}>{iconBox}</span>
                <span className={`min-w-0 flex-1 ${disabledReason ? 'opacity-50' : ''}`}>
                    <span className="block truncate text-[13px] font-medium text-ink">{item.label}</span>
                    <span className={`mt-0.5 block truncate text-[12px] ${
                        failed ? 'text-error' : running || succeeded ? 'font-mono tabular-nums text-link' : 'text-mute'
                    }`}>
                        {statusText || ACTION_DESC[item.action] || '\u00a0'}
                    </span>
                </span>
                {stateMark}
            </button>
        );
    }

    // 禁用的按钮不触发鼠标事件，需要包一层才能显示提示
    return disabledReason
        ? <Tooltip title={disabledReason}><span className={variant === 'chip' ? 'inline-block' : 'block h-full'}>{card}</span></Tooltip>
        : card;
}

export default QuickActionCard;
