import {Children, isValidElement, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import {message} from 'antd';
import {faqData} from '../data/faqData';
import PageHeader, {Eyebrow} from "./PageHeader";

interface TocItem {
    id: string;
    text: string;
    level: 2 | 3;
}

function toText(children: ReactNode): string {
    return Children.toArray(children).map(child => {
        if (typeof child === 'string' || typeof child === 'number') return String(child);
        if (isValidElement<{children?: ReactNode}>(child)) return toText(child.props.children);
        return '';
    }).join('');
}

function slugify(text: string): string {
    return `faq-${text.trim().replace(/\s+/g, '-')}`;
}

// 目录只取二、三级标题，与正文 h2/h3 的 id 规则一致
function buildToc(markdown: string): TocItem[] {
    return markdown.split('\n').flatMap(line => {
        const match = line.match(/^(##|###)\s+(.+)$/);
        if (!match) return [];
        const text = match[2].trim();
        return [{id: slugify(text), text, level: match[1].length as 2 | 3}];
    });
}

function CodeBlock({language, code}: { language: string; code: string }) {
    const handleCopy = async () => {
        await navigator.clipboard.writeText(code);
        message.success('已复制');
    };

    return (
        <div className="group mb-5 overflow-hidden rounded-lg border border-hairline bg-canvas">
            <div className="flex items-center justify-between border-b border-hairline-soft px-4 py-1.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">{language}</span>
                <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-mute transition-colors hover:bg-hairline-soft hover:text-ink"
                >
                    <i className="fa-regular fa-copy"/>
                    复制
                </button>
            </div>
            <pre className={`m-0 overflow-x-auto px-4 py-3 font-mono text-[12px] leading-5 text-ink ${
                language === 'text' ? 'whitespace-pre-wrap break-all' : ''
            }`}>{code}</pre>
        </div>
    );
}

function FAQContainer() {
    const content = useMemo(() => faqData.replace(/^\s*#\s+.+\n/, ''), []);
    const toc = useMemo(() => buildToc(content), [content]);
    const [activeId, setActiveId] = useState(toc[0]?.id ?? '');
    const scrollRef = useRef<HTMLDivElement>(null);

    // 滚动时高亮当前所在章节
    useEffect(() => {
        const root = scrollRef.current;
        if (!root) return;
        const handleScroll = () => {
            const top = root.getBoundingClientRect().top + 96;
            let current = toc[0]?.id ?? '';
            for (const item of toc) {
                const el = document.getElementById(item.id);
                if (el && el.getBoundingClientRect().top <= top) current = item.id;
            }
            setActiveId(current);
        };
        root.addEventListener('scroll', handleScroll, {passive: true});
        return () => root.removeEventListener('scroll', handleScroll);
    }, [toc]);

    const jumpTo = (id: string) => {
        document.getElementById(id)?.scrollIntoView({behavior: 'smooth', block: 'start'});
    };

    return (
        <div ref={scrollRef} className="h-full min-w-0 flex-1 overflow-y-auto bg-canvas px-8 py-7 text-left text-ink">
            <div className="mx-auto flex max-w-5xl flex-col gap-5">
                <PageHeader
                    eyebrow="Help · FAQ"
                    title="常见问题"
                    description="连接设备、授权调试和常见报错的处理方法"
                />

                <div className="grid grid-cols-[minmax(0,1fr)_176px] items-start gap-6">
                    <article className="rounded-xl border border-hairline bg-elevated px-8 py-6 shadow-whisper">
                        <ReactMarkdown
                            components={{
                                h2: ({children}) => (
                                    <h2 id={slugify(toText(children))} className="mb-3 mt-8 scroll-mt-6 border-t border-hairline-soft pt-6 text-[18px] font-semibold tracking-[-0.3px] text-ink first:mt-0 first:border-t-0 first:pt-0">
                                        {children}
                                    </h2>
                                ),
                                h3: ({children}) => (
                                    <h3 id={slugify(toText(children))} className="mb-2 mt-6 scroll-mt-6 text-[15px] font-semibold text-ink">
                                        {children}
                                    </h3>
                                ),
                                h4: ({children}) => (
                                    <h4 className="mb-2 mt-5 text-[14px] font-medium text-body">{children}</h4>
                                ),
                                p: ({children}) => (
                                    <p className="mb-4 text-[14px] leading-6 text-body">{children}</p>
                                ),
                                ul: ({children}) => (
                                    <ul className="mb-4 list-disc space-y-1.5 pl-5 text-[14px] leading-6 text-body marker:text-faint">{children}</ul>
                                ),
                                ol: ({children}) => (
                                    <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[14px] leading-6 text-body marker:font-mono marker:text-[12px] marker:text-mute">{children}</ol>
                                ),
                                li: ({children}) => <li className="pl-1">{children}</li>,
                                pre: ({children}) => {
                                    const child = Children.toArray(children)[0];
                                    if (isValidElement<{className?: string; children?: ReactNode}>(child)) {
                                        const language = child.props.className?.replace('language-', '') || 'text';
                                        return <CodeBlock language={language} code={toText(child.props.children).replace(/\n$/, '')}/>;
                                    }
                                    return <pre>{children}</pre>;
                                },
                                code: ({children}) => (
                                    <code className="rounded border border-hairline bg-canvas px-1.5 py-px font-mono text-[12px] text-ink">{children}</code>
                                ),
                                a: ({children, href}) => (
                                    <a
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-link underline decoration-link-soft underline-offset-2 hover:text-link-deep hover:decoration-link"
                                    >
                                        {children}
                                    </a>
                                ),
                                strong: ({children}) => (
                                    <strong className="font-semibold text-ink">{children}</strong>
                                ),
                            }}
                        >
                            {content}
                        </ReactMarkdown>
                    </article>

                    <aside className="sticky top-0">
                        <div className="px-2 pb-2">
                            <Eyebrow>On this page</Eyebrow>
                        </div>
                        <div className="border-l border-hairline">
                            {toc.map(item => {
                                const isActive = activeId === item.id;
                                return (
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => jumpTo(item.id)}
                                        className={`-ml-px block w-full truncate border-l py-1 text-left text-[13px] transition-colors ${
                                            item.level === 3 ? 'pl-6' : 'pl-3'
                                        } ${
                                            isActive ? 'border-ink font-medium text-ink' : 'border-transparent text-mute hover:text-ink'
                                        }`}
                                    >
                                        {item.text}
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}

export default FAQContainer;
