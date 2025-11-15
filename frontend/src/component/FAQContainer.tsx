import ReactMarkdown from 'react-markdown';
import { faqData } from '../data/faqData';

function FAQContainer() {
    return (
        <div className="flex-1 h-full overflow-y-auto bg-gray-50 p-6">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8">
                    <ReactMarkdown
                        components={{
                            h1: ({ children }) => (
                                <h1 className="text-3xl font-bold text-gray-800 mb-6 pb-3 border-b-2 border-gray-200">
                                    {children}
                                </h1>
                            ),
                            h2: ({ children }) => (
                                <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4">
                                    {children}
                                </h2>
                            ),
                            h3: ({ children }) => (
                                <h3 className="text-xl font-semibold text-gray-700 mt-6 mb-3">
                                    {children}
                                </h3>
                            ),
                            p: ({ children }) => (
                                <p className="text-gray-600 leading-relaxed mb-4">
                                    {children}
                                </p>
                            ),
                            ul: ({ children }) => (
                                <ul className="list-disc list-inside space-y-2 mb-4 ml-4">
                                    {children}
                                </ul>
                            ),
                            ol: ({ children }) => (
                                <ol className="list-decimal list-inside space-y-2 mb-4 ml-4">
                                    {children}
                                </ol>
                            ),
                            li: ({ children }) => (
                                <li className="text-gray-600">{children}</li>
                            ),
                            code: ({ className, children }) => {
                                // 判断是否为代码块（有 className）还是行内代码
                                const isCodeBlock = className?.includes('language-');

                                return isCodeBlock ? (
                                    <code className="block bg-gray-900 text-green-400 px-4 py-3 rounded-lg text-sm font-mono overflow-x-auto mb-4">
                                        {children}
                                    </code>
                                ) : (
                                    <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono">
                                        {children}
                                    </code>
                                );
                            },
                            pre: ({ children }) => <>{children}</>, // 避免双层包裹
                            a: ({ children, href }) => (
                                <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 underline"
                                >
                                    {children}
                                </a>
                            ),
                            strong: ({ children }) => (
                                <strong className="font-semibold text-gray-800">
                                    {children}
                                </strong>
                            ),
                        }}
                    >
                        {faqData}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}

export default FAQContainer;