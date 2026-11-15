import type {ReactNode} from 'react';

export function Eyebrow({children}: { children: ReactNode }) {
    return (
        <div className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
            {children}
        </div>
    );
}

interface PageHeaderProps {
    eyebrow?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    className?: string;
}

// 各页面统一的标题区：等宽小标签 + 标题 + 说明，右侧放主操作
function PageHeader({eyebrow, title, description, actions, className = ''}: PageHeaderProps) {
    return (
        <div className={`flex flex-wrap items-end justify-between gap-4 text-left ${className}`}>
            <div className="min-w-0 flex-[1_1_280px]">
                {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
                <h1 className="mt-1 truncate text-[22px] font-semibold leading-7 tracking-[-0.4px] text-ink">
                    {title}
                </h1>
                {description && <p className="mt-1 text-[13px] text-mute">{description}</p>}
            </div>
            {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </div>
    );
}

export default PageHeader;
