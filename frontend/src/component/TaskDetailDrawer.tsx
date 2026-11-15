import {actionLabel} from '../data/quickActions';
import {t, useLocale, getLocale} from '../i18n';
import type {ReactNode} from 'react';
import {Button, Drawer, Spin, message} from 'antd';
import {CopyOutlined, FolderOpenOutlined} from '@ant-design/icons';
import {elapsedMs, formatElapsed, isActive, useActionTaskStore} from '../store/actionTaskStore';
import {useNow} from '../hooks/useNow';
import {revealLocalPath} from '../actions/runQuickAction';
import {Eyebrow} from './PageHeader';
import {iconClass} from '../data/quickActions';

const STATUS_PILL = (): Record<string, {text: string; className: string}> => ({
    dialog: {text: t("等待选择文件"), className: 'bg-link-soft text-link-deep'},
    running: {text: t("执行中"), className: 'bg-link-soft text-link-deep'},
    pulling: {text: t("保存中"), className: 'bg-link-soft text-link-deep'},
    success: {text: t("成功"), className: 'bg-link-soft text-link-deep'},
    error: {text: t("失败"), className: 'bg-error-soft text-error'},
    canceled: {text: t("已取消"), className: 'bg-hairline-soft text-mute'},
});

function copy(text: string, tip: string) {
    void navigator.clipboard.writeText(text);
    message.success(tip);
}

function Block({title, action, children}: { title: string; action?: ReactNode; children: ReactNode }) {
    useLocale();
    return (
        <section className="mb-5">
            <div className="mb-1.5 flex items-center justify-between">
                <Eyebrow>{title}</Eyebrow>
                {action}
            </div>
            {children}
        </section>
    );
}

// 单个任务的详情：查询类命令执行成功后自动打开，也可从活动条、执行记录进入
function TaskDetailDrawer() {
    useLocale();
    const {tasks, detailTaskId, openDetail} = useActionTaskStore();
    const task = tasks.find(item => item.id === detailTaskId);
    const now = useNow(task ? isActive(task) : false, 200);
    const pill = task ? STATUS_PILL()[task.status] : undefined;

    return (
        <Drawer
            open={Boolean(task)}
            onClose={() => openDetail(null)}
            width={560}
            title={task && (
                <div className="flex min-w-0 items-center gap-2.5">
                    <i className={`${iconClass(task.icon)} w-4 text-center text-[14px] text-mute`}/>
                    <span className="truncate text-[15px] font-semibold text-ink">{actionLabel(task.action, task.label)}</span>
                    {pill && <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-medium ${pill.className}`}>{pill.text}</span>}
                </div>
            )}
        >
            {task && (
                <div className="text-left">
                    <div className="mb-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                        <span className="text-mute">{t("耗时")}</span>
                        <span className="font-mono tabular-nums text-ink">{formatElapsed(elapsedMs(task, now))}</span>
                        <span className="text-mute">{t("时间")}</span>
                        <span className="font-mono tabular-nums text-body">{new Date(task.createdAt).toLocaleTimeString(getLocale(), {hour12: false})}</span>
                        {task.deviceName && <>
                            <span className="text-mute">{t("设备")}</span>
                            <span className="truncate text-body">{task.deviceName}</span>
                        </>}
                        {task.packageName && <>
                            <span className="text-mute">{t("应用")}</span>
                            <span className="truncate font-mono text-[12px] text-body">{task.packageName}</span>
                        </>}
                    </div>

                    {isActive(task) ? (
                        <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-lg border border-hairline bg-canvas">
                            <Spin/>
                            <span className="text-[13px] text-mute">{task.status === 'dialog' ? t("等待选择文件…") : t("命令执行中，完成后会在这里显示结果")}</span>
                        </div>
                    ) : (
                        <>
                            {task.localPath && (
                                <Block title="Saved to">
                                    <div className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas px-4 py-3">
                                        <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{task.localPath}</span>
                                        <Button size="small" icon={<FolderOpenOutlined/>} onClick={() => void revealLocalPath(task.localPath)}>
                                            {t("在访达中显示")}</Button>
                                    </div>
                                </Block>
                            )}

                            {task.error && (
                                <Block
                                    title={task.status === 'canceled' ? 'Canceled' : 'Error'}
                                    action={<Button type="text" size="small" icon={<CopyOutlined/>} onClick={() => copy(task.error, t("已复制错误信息"))}/>}
                                >
                                    <pre className={`m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border px-4 py-3 font-mono text-[12px] leading-5 ${
                                        task.status === 'canceled' ? 'border-hairline bg-canvas text-mute' : 'border-error-soft bg-error-soft text-error'
                                    }`}>
                                        {task.error}
                                    </pre>
                                </Block>
                            )}

                            {task.output && !task.localPath && (
                                <Block
                                    title="Result"
                                    action={<Button type="text" size="small" icon={<CopyOutlined/>} onClick={() => copy(task.output, t("已复制结果"))}/>}
                                >
                                    <pre className={`m-0 max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-hairline bg-canvas px-4 py-3 font-mono leading-6 text-ink ${
                                        task.output.trim().split('\n').length <= 2 && task.output.length < 120 ? 'text-[15px] font-medium' : 'text-[12px] leading-5'
                                    }`}>
                                        {task.output.trim()}
                                    </pre>
                                </Block>
                            )}

                            {!task.error && !task.output && !task.localPath && (
                                <Block title="Result">
                                    <div className="rounded-lg border border-hairline bg-canvas px-4 py-3 text-[13px] text-mute">{t("命令执行成功，没有输出")}</div>
                                </Block>
                            )}
                        </>
                    )}

                    {task.cmd && (
                        <Block
                            title="Command"
                            action={<Button type="text" size="small" icon={<CopyOutlined/>} onClick={() => copy(task.cmd, t("已复制命令"))}/>}
                        >
                            <pre className="m-0 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-hairline bg-canvas px-4 py-3 font-mono text-[12px] leading-5 text-body">
                                {task.cmd}
                            </pre>
                        </Block>
                    )}
                </div>
            )}
        </Drawer>
    );
}

export default TaskDetailDrawer;
