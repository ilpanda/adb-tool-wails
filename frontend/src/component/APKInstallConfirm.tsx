import {useEffect} from 'react';
import {ConfigProvider, Modal} from 'antd';
import type {ThemeConfig} from 'antd';
import {EventsEmit, EventsOn} from '../../wailsjs/runtime/runtime';

interface DowngradeRequest {
    requestId: string;
    packageName: string;
    fileName: string;
}

// DESIGN.md：局部使用 Geist 字体栈、语义色、6px 控件圆角及 Level 2 浮层阴影。
const CONFIRM_THEME: ThemeConfig = {
    token: {
        fontFamily: 'Geist, Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: 14,
        lineHeight: 20 / 14,
        colorPrimary: '#171717',
        colorText: '#171717',
        colorTextSecondary: '#4d4d4d',
        colorTextTertiary: '#8f8f8f',
        colorBorder: '#ebebeb',
        colorBgElevated: '#ffffff',
        colorError: '#ee0000',
        colorErrorHover: '#c50000',
        colorErrorActive: '#c50000',
        borderRadius: 6,
        borderRadiusLG: 12,
        controlHeight: 44,
        boxShadow: '0 2px 2px rgba(0,0,0,0.04), 0 8px 16px -4px rgba(0,0,0,0.08)',
    },
    components: {
        Modal: {titleFontSize: 20, titleLineHeight: 1.4},
        Button: {
            fontWeight: 500,
            paddingInline: 6,
            primaryShadow: 'none',
            dangerShadow: 'none',
            defaultShadow: 'none',
            defaultHoverBg: '#fafafa',
            defaultHoverBorderColor: '#8f8f8f',
            defaultHoverColor: '#171717',
        },
    },
};

const MONO_FONT = {fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace'};

// 保持全局监听，切换页面时也能完成正在等待的安装确认。
function APKInstallConfirm() {
    const [modal, contextHolder] = Modal.useModal();

    useEffect(() => {
        const dialogs = new Map<string, {destroy: () => void}>();
        const stopConfirm = EventsOn('apk-downgrade-confirm', (request: DowngradeRequest) => {
            if (dialogs.has(request.requestId)) return;
            const respond = (confirmed: boolean) => {
                dialogs.delete(request.requestId);
                EventsEmit(`apk-downgrade-response:${request.requestId}`, confirmed);
            };
            const dialog = modal.confirm({
                title: <span className="font-semibold tracking-[-0.4px]">无法降级安装</span>,
                icon: null,
                content: (
                    <div className="text-sm leading-5 text-[#4d4d4d]">
                        <p>手机不允许用较低版本覆盖当前应用。你可以卸载现有应用，再安装此 APK。</p>
                        <p className="mt-2 text-xs leading-4 break-all text-[#8f8f8f]" style={MONO_FONT}>
                            INSTALL_FAILED_VERSION_DOWNGRADE
                        </p>
                        <dl className="my-6 grid grid-cols-[64px_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-xl border border-[#ebebeb] bg-[#fafafa] p-4">
                            <dt>应用包名</dt>
                            <dd className="min-w-0 break-all text-xs leading-5 text-[#171717]" style={MONO_FONT}>{request.packageName}</dd>
                            <dt>安装文件</dt>
                            <dd className="min-w-0 break-all text-[#171717]">{request.fileName}</dd>
                        </dl>
                        <div className="space-y-2">
                            <p className="font-medium text-[#ee0000]">卸载会删除该应用的全部本地数据，且无法恢复。</p>
                            <p>若重新安装失败，原应用不会自动恢复。</p>
                        </div>
                    </div>
                ),
                width: 560,
                centered: true,
                styles: {content: {border: '1px solid #ebebeb', padding: 24}},
                okText: '卸载后安装',
                cancelText: '取消',
                okButtonProps: {danger: true, style: {minWidth: 112}},
                cancelButtonProps: {style: {minWidth: 72}},
                autoFocusButton: 'cancel',
                maskClosable: false,
                onOk: () => respond(true),
                onCancel: () => respond(false),
            });
            dialogs.set(request.requestId, dialog);
        });
        const stopClosed = EventsOn('apk-downgrade-confirm-closed', (requestId: string) => {
            dialogs.get(requestId)?.destroy();
            dialogs.delete(requestId);
        });
        return () => {
            stopConfirm();
            stopClosed();
            dialogs.forEach((dialog, requestId) => {
                dialog.destroy();
                EventsEmit(`apk-downgrade-response:${requestId}`, false);
            });
        };
    }, [modal]);

    return <ConfigProvider theme={CONFIRM_THEME} button={{autoInsertSpace: false}}>{contextHolder}</ConfigProvider>;
}

export default APKInstallConfirm;
