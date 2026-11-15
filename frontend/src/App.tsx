import {useLocale} from './i18n';
import {ConfigProvider} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import './App.css';
import RootContainer from "./component/RootContainer";
import {getAppTheme} from "./theme";
import {useThemeStore} from "./store/themeStore";
import type {ReactNode} from "react";

// 跟随浅色 / 深色切换 antd 主题
function ThemedProvider({children}: { children: ReactNode }) {
    const locale = useLocale();
    const dark = useThemeStore(state => state.resolved === 'dark');
    return (
        <ConfigProvider theme={getAppTheme(dark)} locale={locale === 'zh-CN' ? zhCN : enUS} button={{autoInsertSpace: false}}>
            {children}
        </ConfigProvider>
    );
}

// message / Modal.confirm 等静态方法不在组件树内，需单独注入主题
ConfigProvider.config({
    holderRender: children => <ThemedProvider>{children}</ThemedProvider>,
});

function App() {
    return (
        <ThemedProvider>
            <div id="App">
                <RootContainer/>
            </div>
        </ThemedProvider>
    )
}

export default App
