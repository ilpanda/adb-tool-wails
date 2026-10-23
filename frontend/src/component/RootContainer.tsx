import LeftContainer from "./LeftContainer";
import RightContainer from "./RightContainer";
import FAQContainer from "./FAQContainer";
import SettingsContainer from "./SettingsContainer";
import ApplicationList from "./ApplicationList";
import PerfMonitor from "./PerfMonitor";
import FileManager from "./FileManager";
import LogViewer from "./LogViewer";
import APKInstallConfirm from "./APKInstallConfirm";
import {useAppListPreload} from "../hooks/useAppListPreload";
import {useNavStore} from "../store/navStore";
import {useDropHint, useFileDrop} from "../hooks/useFileDrop";
import {useUpdateCheck} from "../hooks/useUpdateCheck";

function RootContainer() {
    const {view: selectedView, setView: setSelectedView} = useNavStore();
    useAppListPreload();
    useFileDrop();
    useUpdateCheck();
    const dropHint = useDropHint();
    // 整个窗口都是拖放目标，拖拽经过时由 style.css 中的 .wails-drop-target-active 显示提示浮层
    return (<div
        className="flex items-stretch h-screen w-screen"
        style={{'--wails-drop-target': 'drop'} as React.CSSProperties}
        data-drop-hint={dropHint}
    >
        <APKInstallConfirm />
        <LeftContainer selectedView={selectedView} onViewChange={setSelectedView}/>
        {selectedView === '1' && <RightContainer />}
        {selectedView === '2' && <FAQContainer />}
        {selectedView === '3' && <SettingsContainer />}
        {selectedView === '4' && <ApplicationList />}
        {selectedView === '5' && <PerfMonitor />}
        {selectedView === '6' && <FileManager />}
        {selectedView === '7' && <LogViewer />}
    </div>)
}

export default RootContainer;
