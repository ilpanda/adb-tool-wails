import LeftContainer from "./LeftContainer";
import RightContainer from "./RightContainer";
import {useState} from "react";
import FAQContainer from "./FAQContainer";
import SettingsContainer from "./SettingsContainer";
import ApplicationList from "./ApplicationList";
import MemoryMonitor from "./MemoryMonitor";

function RootContainer() {
    const [selectedView, setSelectedView] = useState('1');
    return (<div className="flex items-stretch h-screen w-screen ">
        <LeftContainer selectedView={selectedView} onViewChange={setSelectedView}/>
        {selectedView === '1' && <RightContainer />}
        {selectedView === '2' && <FAQContainer />}
        {selectedView === '3' && <SettingsContainer />}
        {selectedView === '4' && <ApplicationList />}
        {selectedView === '5' && <MemoryMonitor />}
    </div>)
}

export default RootContainer;