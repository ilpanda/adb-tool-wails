import LeftContainer from "./LeftContainer";
import RightContainer from "./RightContainer";

function RootContainer() {
    return (<div className="flex items-stretch h-screen w-screen ">
        <LeftContainer/>
        <RightContainer/>
    </div>)
}

export default RootContainer;