import {ConfigProvider} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import './App.css';
import RootContainer from "./component/RootContainer";
import {appTheme} from "./theme";

// message / Modal.confirm 等静态方法不在组件树内，需单独注入主题
ConfigProvider.config({
    holderRender: children => (
        <ConfigProvider theme={appTheme} locale={zhCN} button={{autoInsertSpace: false}}>
            {children}
        </ConfigProvider>
    ),
});

function App() {
    return (
        <ConfigProvider theme={appTheme} locale={zhCN} button={{autoInsertSpace: false}}>
            <div id="App">
                <RootContainer/>
            </div>
        </ConfigProvider>
    )
}

export default App
