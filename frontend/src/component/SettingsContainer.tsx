import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {Button, Input, Segmented, message as toast} from 'antd';
import {
    CheckAdbPath,
    GetAdbPath,
    GetTerminalOpenMode,
    GetVersion,
    OpenLogDirectory,
    SetTerminalOpenMode,
    UpdateAdbPath
} from "../../wailsjs/go/main/App";
import PageHeader, {Eyebrow} from "./PageHeader";
import {useUpdateStore} from '../store/updateStore';
import {ThemeMode, useThemeStore} from '../store/themeStore';
import {BrowserOpenURL} from '../../wailsjs/runtime/runtime';

type Feedback = { type: 'success' | 'error'; title: string; detail?: string };
type TerminalOpenMode = 'always' | 'error' | 'never';

const TERMINAL_MODE_HINT: Record<TerminalOpenMode, string> = {
    always: '每次执行后都展开底部执行记录',
    error: '只在命令失败时展开，成功的结果通过提示和结果面板展示',
    never: '不自动展开，可随时点击底部「执行记录」查看',
};

function SettingsSection({eyebrow, title, children}: { eyebrow: string; title: string; children: ReactNode }) {
    return (
        <section>
            <div className="mb-2 px-1">
                <Eyebrow>{eyebrow}</Eyebrow>
                <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.2px] text-ink">{title}</h2>
            </div>
            <div className="divide-y divide-hairline-soft rounded-xl border border-hairline bg-elevated shadow-whisper">
                {children}
            </div>
        </section>
    );
}

function SettingsRow({label, description, control, children}: {
    label: string;
    description?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="px-5 py-4">
            <div className="flex items-center justify-between gap-6">
                <div className="min-w-0">
                    <div className="text-[14px] font-medium text-ink">{label}</div>
                    {description && <div className="mt-0.5 text-[13px] text-mute">{description}</div>}
                </div>
                {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
            </div>
            {children}
        </div>
    );
}

function SettingsContainer() {
    const [adbPath, setAdbPath] = useState('');
    const [adbError, setAdbError] = useState('');
    // 读取完成前显示「检测中」，避免先闪一下「未找到」
    const [adbLoaded, setAdbLoaded] = useState(false);
    const [tempPath, setTempPath] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [terminalMode, setTerminalMode] = useState<TerminalOpenMode | null>(null);
    const [version, setVersion] = useState('');
    const [feedback, setFeedback] = useState<Feedback | null>(null);

    useEffect(() => {
        void loadAdbPath();
        GetTerminalOpenMode().then(mode => setTerminalMode(mode as TerminalOpenMode)).catch(error => console.error('加载执行记录打开方式失败:', error));
        GetVersion().then(setVersion);
    }, []);

    const loadAdbPath = async () => {
        try {
            const result = await GetAdbPath();
            setAdbPath(result.res || '');
            setAdbError(result.error || '');
            if (!result.res) setIsEditing(true);
        } catch (error) {
            console.error('加载 ADB 路径失败:', error);
        } finally {
            setAdbLoaded(true);
        }
    };

    const runCheck = async (path: string) => {
        setIsTesting(true);
        setFeedback(null);
        try {
            const result = await CheckAdbPath(path);
            if (!result.error && result.res) {
                setFeedback({type: 'success', title: 'ADB 可用', detail: result.res.trim()});
                return true;
            }
            setFeedback({type: 'error', title: '无法执行 ADB', detail: result.error || '没有输出'});
            return false;
        } catch (error) {
            setFeedback({type: 'error', title: 'ADB 检测失败', detail: String(error)});
            return false;
        } finally {
            setIsTesting(false);
        }
    };

    const handleEdit = () => {
        setTempPath(adbPath);
        setIsEditing(true);
        setFeedback(null);
    };

    const handleCancel = () => {
        setIsEditing(false);
        setFeedback(null);
    };

    const handleSave = async () => {
        const path = tempPath.trim();
        if (!path) {
            setFeedback({type: 'error', title: 'ADB 路径不能为空'});
            return;
        }

        setIsSaving(true);
        try {
            await UpdateAdbPath(path);
            await loadAdbPath();
            setIsEditing(false);
            toast.success('ADB 路径已保存');
            await runCheck(path);
        } catch (error) {
            setFeedback({type: 'error', title: '保存失败，请重试', detail: String(error)});
        } finally {
            setIsSaving(false);
        }
    };

    const handleTerminalModeChange = async (mode: TerminalOpenMode) => {
        const previous = terminalMode;
        setTerminalMode(mode);
        try {
            await SetTerminalOpenMode(mode);
        } catch (error) {
            setTerminalMode(previous);
            toast.error('保存执行记录打开方式失败');
        }
    };

    const handleOpenLogDir = async () => {
        const result = await OpenLogDirectory();
        if (result.error) toast.error(result.error);
    };

    const themeMode = useThemeStore(state => state.mode);
    const setThemeMode = useThemeStore(state => state.setMode);
    const update = useUpdateStore(state => state.info);
    const checkingUpdate = useUpdateStore(state => state.checking);
    const [updateChecked, setUpdateChecked] = useState(false);
    const checkUpdate = async () => {
        await useUpdateStore.getState().check();
        setUpdateChecked(true);
    };
    const updateDescription = () => {
        if (!update) return undefined;
        if (update.error) return updateChecked ? `检查失败：${update.error}` : undefined;
        if (update.hasUpdate) return `发现新版本 ${update.latest}`;
        if (version === 'dev') return update.latest ? `开发版本，最新发布为 ${update.latest}` : undefined;
        return updateChecked ? '已是最新版本' : undefined;
    };

    const adbStatus = !adbLoaded
        ? <StatusPill tone="pending">检测中</StatusPill>
        : adbPath
            ? <StatusPill tone="ok">已找到</StatusPill>
            : <StatusPill tone="error">未找到</StatusPill>;

    return (
        <div className="h-full min-w-0 flex-1 overflow-y-auto bg-canvas px-8 py-7 text-left text-ink">
            <div className="mx-auto flex max-w-3xl flex-col gap-7">
                <PageHeader
                    eyebrow="Preferences"
                    title="设置"
                    description="配置 ADB 可执行文件与应用行为"
                />

                <SettingsSection eyebrow="Android Debug Bridge" title="ADB">
                    <SettingsRow
                        label="ADB 可执行文件"
                        description={isEditing ? '填写 adb 可执行文件的完整路径' : (
                            !adbLoaded
                                ? '正在查找 adb…'
                                : adbPath
                                    ? <span className="break-all font-mono text-[12px] text-body">{adbPath}</span>
                                    : adbError || '未在 PATH 中找到 adb，请手动指定'
                        )}
                        control={isEditing ? adbStatus : <>
                            {adbStatus}
                            <Button onClick={() => void runCheck(adbPath)} loading={isTesting} disabled={!adbPath}>测试连接</Button>
                            <Button onClick={handleEdit}>修改</Button>
                        </>}
                    >
                        {isEditing && (
                            <div className="mt-3 flex flex-col gap-3">
                                <Input
                                    autoFocus
                                    value={tempPath}
                                    onChange={event => setTempPath(event.target.value)}
                                    onPressEnter={() => void handleSave()}
                                    placeholder="/usr/local/bin/adb 或 C:\platform-tools\adb.exe"
                                    className="!font-mono !text-[13px]"
                                />
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[12px] text-faint">
                                        macOS / Linux 可在终端执行 <code className="rounded border border-hairline bg-canvas px-1 font-mono text-[11px] text-body">which adb</code> 查看路径
                                    </span>
                                    <div className="flex shrink-0 gap-2">
                                        {adbPath && <Button onClick={handleCancel} disabled={isSaving}>取消</Button>}
                                        <Button onClick={() => void runCheck(tempPath.trim())} loading={isTesting} disabled={!tempPath.trim()}>
                                            检测
                                        </Button>
                                        <Button type="primary" onClick={() => void handleSave()} loading={isSaving}>保存</Button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {feedback && (
                            <div className={`mt-3 rounded-lg border px-4 py-3 ${
                                feedback.type === 'success' ? 'border-hairline bg-canvas' : 'border-error-soft bg-error-soft'
                            }`}>
                                <div className={`flex items-center gap-2 text-[13px] font-medium ${feedback.type === 'success' ? 'text-ink' : 'text-error'}`}>
                                    <i className={`fa-solid ${feedback.type === 'success' ? 'fa-circle-check text-link' : 'fa-circle-exclamation'}`}/>
                                    {feedback.title}
                                </div>
                                {feedback.detail && (
                                    <pre className={`m-0 mt-1.5 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 ${feedback.type === 'success' ? 'text-mute' : 'text-error/80'}`}>
                                        {feedback.detail}
                                    </pre>
                                )}
                            </div>
                        )}
                    </SettingsRow>
                </SettingsSection>

                <SettingsSection eyebrow="Appearance" title="外观">
                    <SettingsRow
                        label="主题"
                        description={themeMode === 'system' ? '跟随系统的浅色 / 深色设置自动切换' : undefined}
                        control={
                            <Segmented<ThemeMode>
                                value={themeMode}
                                onChange={setThemeMode}
                                options={[
                                    {value: 'system', label: '跟随系统'},
                                    {value: 'light', label: '浅色'},
                                    {value: 'dark', label: '深色'},
                                ]}
                            />
                        }
                    />
                </SettingsSection>

                <SettingsSection eyebrow="Quick actions" title="快捷功能">
                    <SettingsRow
                        label="自动展开执行记录"
                        description={terminalMode ? TERMINAL_MODE_HINT[terminalMode] : '执行快捷功能后何时展开底部执行记录'}
                        control={terminalMode !== null && (
                            <Segmented<TerminalOpenMode>
                                value={terminalMode}
                                onChange={value => void handleTerminalModeChange(value)}
                                options={[
                                    {value: 'always', label: '总是'},
                                    {value: 'error', label: '仅失败时'},
                                    {value: 'never', label: '从不'},
                                ]}
                            />
                        )}
                    />
                </SettingsSection>

                <SettingsSection eyebrow="About" title="关于">
                    <SettingsRow
                        label="版本"
                        description={updateDescription()}
                        control={<>
                            <span className="font-mono text-[13px] text-body">{version || '-'}</span>
                            {update?.hasUpdate
                                ? <Button type="primary" onClick={() => BrowserOpenURL(update.url)}>下载 {update.latest}</Button>
                                : <Button onClick={() => void checkUpdate()} loading={checkingUpdate}>检查更新</Button>}
                        </>}
                    />
                    <SettingsRow
                        label="运行日志"
                        description="遇到问题时可在「诊断日志」中查看或导出"
                        control={<Button onClick={() => void handleOpenLogDir()}>打开日志目录</Button>}
                    />
                </SettingsSection>
            </div>
        </div>
    );
}

const STATUS_TONES = {
    ok: {pill: 'bg-link-soft text-link-deep', dot: 'bg-link'},
    error: {pill: 'bg-error-soft text-error', dot: 'bg-error'},
    pending: {pill: 'bg-hairline-soft text-mute', dot: 'bg-faint animate-pulse'},
};

function StatusPill({tone, children}: { tone: keyof typeof STATUS_TONES; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ${STATUS_TONES[tone].pill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONES[tone].dot}`}/>
            {children}
        </span>
    );
}

export default SettingsContainer;
