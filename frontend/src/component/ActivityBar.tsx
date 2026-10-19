import {useActionTaskStore, elapsedMs, formatElapsed, isActive, ActionTask} from '../store/actionTaskStore';
import {useNow} from '../hooks/useNow';

const STAGE_TEXT: Record<string, string> = {
    dialog: '等待选择文件',
    running: '执行中',
    pulling: '正在保存到电脑',
};

function summary(task: ActionTask): string {
    if (task.status === 'canceled') return '已取消';
    const text = (task.status === 'error' ? task.error : task.output).trim().split('\n')[0] ?? '';
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

// 快捷功能页底部的状态条：执行中显示进度，空闲时显示最近一次结果
function ActivityBar() {
    const {tasks, panelOpen, setPanelOpen, openDetail} = useActionTaskStore();
    const running = tasks.filter(isActive);
    const now = useNow(running.length > 0, 200);
    const latest = tasks[tasks.length - 1];
    const current = running[running.length - 1];
    const unreadErrors = tasks.filter(task => task.status === 'error' && !task.acknowledged).length;

    let content;
    if (current) {
        content = (
            <>
                <i className="fa-solid fa-circle-notch fa-spin text-[12px] text-link"/>
                <span className="shrink-0 font-medium text-ink">{current.label}</span>
                {current.packageName && <span className="min-w-0 truncate font-mono text-[11px] text-mute">{current.packageName}</span>}
                <span className="shrink-0 text-mute">
                    · {STAGE_TEXT[current.status]}
                    {current.status !== 'dialog' && <span className="ml-1 font-mono tabular-nums">{formatElapsed(elapsedMs(current, now))}</span>}
                </span>
                {running.length > 1 && (
                    <span className="shrink-0 rounded-full bg-link-soft px-2 py-px text-[11px] font-medium text-link-deep">
                        共 {running.length} 个任务执行中
                    </span>
                )}
            </>
        );
    } else if (latest) {
        const tone = latest.status === 'error' ? 'text-error' : latest.status === 'canceled' ? 'text-faint' : 'text-link';
        const icon = latest.status === 'error' ? 'fa-circle-xmark' : latest.status === 'canceled' ? 'fa-circle-minus' : 'fa-circle-check';
        content = (
            <>
                <i className={`fa-solid ${icon} text-[12px] ${tone}`}/>
                <span className="shrink-0 font-medium text-ink">{latest.label}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{formatElapsed(elapsedMs(latest))}</span>
                <span className={`min-w-0 truncate ${latest.status === 'error' ? 'text-error' : 'text-mute'}`}>{summary(latest)}</span>
                <button
                    type="button"
                    onClick={() => openDetail(latest.id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-body transition-colors hover:bg-hairline-soft hover:text-ink"
                >
                    查看详情
                </button>
            </>
        );
    } else {
        content = <span className="text-faint">就绪 · 点击上方功能执行命令，执行状态会显示在这里</span>;
    }

    return (
        <div className="flex h-10 shrink-0 items-center gap-3 border-t border-hairline bg-elevated px-4 text-left text-[13px]">
            <div className="flex min-w-0 flex-1 items-center gap-2">{content}</div>
            <button
                type="button"
                onClick={() => setPanelOpen(!panelOpen)}
                className={`flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                    panelOpen ? 'bg-hairline-soft text-ink' : 'text-body hover:bg-hairline-soft hover:text-ink'
                }`}
            >
                <i className="fa-solid fa-terminal text-[11px]"/>
                执行记录
                {tasks.length > 0 && <span className="font-mono text-[11px] text-faint">{tasks.length}</span>}
                {unreadErrors > 0 && (
                    <span className="rounded-full bg-error px-1.5 text-[10px] font-medium leading-4 text-white">{unreadErrors}</span>
                )}
                <i className={`fa-solid fa-chevron-up text-[9px] text-faint transition-transform ${panelOpen ? 'rotate-180' : ''}`}/>
            </button>
        </div>
    );
}

export default ActivityBar;
