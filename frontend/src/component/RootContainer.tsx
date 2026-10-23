import LeftContainer from "./LeftContainer";
import RightContainer from "./RightContainer";
import {useState} from "react";
import FAQContainer from "./FAQContainer";
import SettingsContainer from "./SettingsContainer";
import ApplicationList from "./ApplicationList";
import PerfMonitor from "./PerfMonitor";
import FileManager from "./FileManager";
import LogViewer from "./LogViewer";
import APKInstallConfirm from "./APKInstallConfirm";
import {useAppListPreload} from "../hooks/useAppListPreload";

function RootContainer() {
    const [selectedView, setSelectedView] = useState('1');
    useAppListPreload();
    return (<div className="flex items-stretch h-screen w-screen ">
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
