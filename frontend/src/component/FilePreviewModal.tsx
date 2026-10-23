import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {Button, Empty, Modal, Spin, Tooltip, message} from 'antd';
import {
    CompressOutlined,
    CopyOutlined,
    DownloadOutlined,
    ExpandOutlined,
    LeftOutlined,
    RightOutlined,
} from '@ant-design/icons';
import {PreviewFile} from "../../wailsjs/go/main/App";
import {main} from "../../wailsjs/go/models";

export interface PreviewTarget {
    name: string;
    fullPath: string;
}

interface FilePreviewModalProps {
    deviceId: string;
    target: PreviewTarget | null;
    icon?: ReactNode;
    // 同目录下的图片，用于左右切换
    siblings: PreviewTarget[];
    onNavigate: (target: PreviewTarget) => void;
    onDownload: (target: PreviewTarget) => void;
    onClose: () => void;
}

function formatSize(raw: number): string {
    if (raw < 1024) return `${raw} B`;
    if (raw < 1024 * 1024) return `${(raw / 1024).toFixed(1)} KB`;
    return `${(raw / (1024 * 1024)).toFixed(1)} MB`;
}

const CHECKERBOARD = {
    backgroundColor: 'var(--color-elevated)',
    backgroundImage: 'linear-gradient(45deg,var(--color-hairline-soft) 25%,transparent 25%),linear-gradient(-45deg,var(--color-hairline-soft) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,var(--color-hairline-soft) 75%),linear-gradient(-45deg,transparent 75%,var(--color-hairline-soft) 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
};

function FilePreviewModal({deviceId, target, icon, siblings, onNavigate, onDownload, onClose}: FilePreviewModalProps) {
    const [preview, setPreview] = useState<main.FilePreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [fitToWindow, setFitToWindow] = useState(true);
    const [dimensions, setDimensions] = useState<{w: number; h: number} | null>(null);

    useEffect(() => {
        if (!target) {
            setPreview(null);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setPreview(null);
        setDimensions(null);
        PreviewFile(deviceId, target.fullPath)
            .then(result => !cancelled && setPreview(result))
            .catch(e => !cancelled && setPreview(main.FilePreview.createFrom({kind: '', size: 0, error: String(e?.message || e)})))
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [deviceId, target?.fullPath]);

    const siblingIndex = target ? siblings.findIndex(item => item.fullPath === target.fullPath) : -1;
    const canNavigate = siblingIndex >= 0 && siblings.length > 1;
    const step = (delta: number) => {
        if (!canNavigate) return;
        onNavigate(siblings[(siblingIndex + delta + siblings.length) % siblings.length]);
    };

    useEffect(() => {
        if (!target || !canNavigate) return;
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft') step(-1);
            if (event.key === 'ArrowRight') step(1);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    });

    const meta = [
        preview && !preview.error ? formatSize(preview.size) : null,
        dimensions ? `${dimensions.w} × ${dimensions.h}` : null,
        canNavigate ? `${siblingIndex + 1} / ${siblings.length}` : null,
    ].filter(Boolean).join(' · ');

    const renderBody = () => {
        if (loading || !preview) {
            return <div className="flex h-60 items-center justify-center"><Spin/></div>;
        }

        if (preview.error) {
            return (
                <div className="flex h-60 flex-col items-center justify-center gap-2 rounded-lg border border-hairline bg-canvas px-6 text-center">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} className="!m-0"/>
                    <div className="text-[13px] text-body">无法预览这个文件</div>
                    <div className="max-w-full break-all font-mono text-[12px] text-mute">{preview.error}</div>
                </div>
            );
        }

        if (preview.kind === 'binary') {
            return (
                <div className="flex h-60 flex-col items-center justify-center gap-2 rounded-lg border border-hairline bg-canvas text-center">
                    <i className="fa-solid fa-file-circle-question text-[32px] text-faint"/>
                    <div className="text-[13px] text-body">二进制文件，无法以文本预览</div>
                    <div className="text-[12px] text-mute">可以下载到电脑后用对应的工具打开</div>
                </div>
            );
        }

        if (preview.kind === 'image') {
            return (
                <div className="group relative">
                    <div
                        className={`flex rounded-lg border border-hairline ${fitToWindow ? 'h-[64vh] items-center justify-center overflow-hidden p-3' : 'max-h-[64vh] min-h-60 overflow-auto'}`}
                        style={CHECKERBOARD}
                    >
                        <img
                            src={`data:${preview.mime};base64,${preview.content}`}
                            alt={target?.name}
                            onLoad={event => setDimensions({w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight})}
                            onClick={() => setFitToWindow(value => !value)}
                            className={fitToWindow ? 'max-h-full max-w-full cursor-zoom-in object-contain' : 'max-w-none cursor-zoom-out'}
                        />
                    </div>
                    {canNavigate && (
                        <>
                            <NavButton side="left" onClick={() => step(-1)}/>
                            <NavButton side="right" onClick={() => step(1)}/>
                        </>
                    )}
                </div>
            );
        }

        return (
            <div className="overflow-hidden rounded-lg border border-hairline">
                {preview.truncated && (
                    <div className="border-b border-warning-soft bg-warning-soft px-4 py-1.5 text-[12px] text-warning-deep">
                        文件共 {formatSize(preview.size)}，仅显示开头 512 KB，完整内容请下载查看
                    </div>
                )}
                <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-all bg-canvas p-4 font-mono text-[12px] leading-5 text-body">
                    {preview.content || <span className="text-faint">（空文件）</span>}
                </pre>
            </div>
        );
    };

    const footer = target && preview && !loading ? [
        preview.kind === 'image' && !preview.error && (
            <Tooltip key="fit" title="也可以点击图片切换">
                <Button icon={fitToWindow ? <ExpandOutlined/> : <CompressOutlined/>} onClick={() => setFitToWindow(value => !value)}>
                    {fitToWindow ? '原始尺寸' : '适应窗口'}
                </Button>
            </Tooltip>
        ),
        preview.kind === 'text' && !preview.error && (
            <Button key="copy" icon={<CopyOutlined/>} onClick={() => {
                navigator.clipboard.writeText(preview.content);
                message.success('已复制内容');
            }}>
                复制内容
            </Button>
        ),
        <Button key="download" type="primary" icon={<DownloadOutlined/>} onClick={() => onDownload(target)}>
            下载到电脑
        </Button>,
    ].filter(Boolean) : null;

    return (
        <Modal
            open={target !== null}
            onCancel={onClose}
            width={preview?.kind === 'image' ? 880 : 760}
            footer={footer}
            title={
                <div className="flex min-w-0 items-center gap-2.5 pr-6">
                    {icon && <span className="text-[16px]">{icon}</span>}
                    <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold text-ink">{target?.name}</div>
                        <div className="truncate font-mono text-[11px] font-normal text-faint">
                            {target?.fullPath}{meta ? ` · ${meta}` : ''}
                        </div>
                    </div>
                </div>
            }
        >
            {renderBody()}
        </Modal>
    );
}

function NavButton({side, onClick}: { side: 'left' | 'right'; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-elevated/90 text-body opacity-0 shadow-floating transition-opacity hover:text-ink group-hover:opacity-100 ${
                side === 'left' ? 'left-3' : 'right-3'
            }`}
        >
            {side === 'left' ? <LeftOutlined/> : <RightOutlined/>}
        </button>
    );
}

export default FilePreviewModal;
